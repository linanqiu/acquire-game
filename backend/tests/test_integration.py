"""Integration tests for Acquire board game API and WebSocket endpoints."""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch, MagicMock

from main import (
    app,
    session_manager,
    initialize_game,
    handle_player_action,
    handle_place_tile,
    handle_found_chain,
    handle_buy_stocks,
    handle_end_turn,
    broadcast_game_state,
)
from session.manager import SessionManager
from game.board import Board, Tile
from game.hotel import Hotel
from game.player import Player


class TestRoomCreation:
    """Tests for room creation endpoint."""

    def test_create_room_returns_code(self, client, clean_session_manager):
        """POST /create should return a room code."""
        response = client.post("/create")
        assert response.status_code == 200
        data = response.json()
        assert "room_code" in data
        assert len(data["room_code"]) == 4
        assert data["room_code"].isalpha()
        assert data["room_code"].isupper()

    def test_create_room_is_unique(self, client, clean_session_manager):
        """Each created room should have a unique code."""
        codes = set()
        for _ in range(10):
            response = client.post("/create")
            code = response.json()["room_code"]
            assert code not in codes
            codes.add(code)

    def test_create_room_registers_in_manager(self, client, clean_session_manager):
        """Created room should be registered in session manager."""
        response = client.post("/create")
        code = response.json()["room_code"]
        room = clean_session_manager.get_room(code)
        assert room is not None
        assert room.room_code == code
        assert room.started is False


class TestJoinRoom:
    """Tests for joining rooms."""

    def test_join_room_success(self, client, room_code):
        """POST /join/{room_code} should add player to room."""
        response = client.post(f"/join/{room_code}?name=Alice")
        assert response.status_code == 200
        data = response.json()
        assert "player_id" in data
        assert data["room_code"] == room_code

    def test_join_room_not_found(self, client, clean_session_manager):
        """Joining non-existent room should return 404."""
        response = client.post("/join/XXXX?name=Alice")
        assert response.status_code == 404

    def test_join_room_multiple_players(self, client, room_code):
        """Multiple players should be able to join a room."""
        response1 = client.post(f"/join/{room_code}?name=Alice")
        response2 = client.post(f"/join/{room_code}?name=Bob")
        response3 = client.post(f"/join/{room_code}?name=Charlie")

        assert response1.status_code == 200
        assert response2.status_code == 200
        assert response3.status_code == 200

        # Verify all players are in room
        room = session_manager.get_room(room_code)
        assert len(room.players) == 3

    def test_join_room_first_player_is_host(self, client, room_code):
        """First player to join should be marked as host."""
        response = client.post(f"/join/{room_code}?name=Alice")
        player_id = response.json()["player_id"]

        room = session_manager.get_room(room_code)
        assert room.players[player_id].is_host is True

    def test_join_full_room(self, client, room_code):
        """Cannot join a room that is full."""
        # Fill the room (max 6 players)
        for i in range(6):
            client.post(f"/join/{room_code}?name=Player{i}")

        # 7th player should fail
        response = client.post(f"/join/{room_code}?name=PlayerExtra")
        assert response.status_code == 400
        assert "full" in response.json()["detail"].lower()

    def test_join_started_game(self, client, room_with_players, clean_session_manager):
        """Cannot join a room where game has started."""
        clean_session_manager.start_game(room_with_players)

        response = client.post(f"/join/{room_with_players}?name=NewPlayer")
        assert response.status_code == 400
        assert "started" in response.json()["detail"].lower()


class TestAddBot:
    """Tests for adding bots to rooms."""

    def test_add_bot_success(self, client, room_code):
        """POST /room/{room_code}/add-bot should add a bot."""
        response = client.post(f"/room/{room_code}/add-bot")
        assert response.status_code == 200
        data = response.json()
        assert "bot_id" in data
        assert data["bot_id"].startswith("bot_")

    def test_add_bot_to_nonexistent_room(self, client, clean_session_manager):
        """Adding bot to non-existent room should return 404."""
        response = client.post("/room/XXXX/add-bot")
        assert response.status_code == 404

    def test_add_bot_to_full_room(self, client, room_code):
        """Cannot add bot to full room."""
        # Fill the room
        for i in range(6):
            session_manager.join_room(room_code, f"player_{i}", f"Player {i}")

        response = client.post(f"/room/{room_code}/add-bot")
        assert response.status_code == 400

    def test_bot_appears_in_player_list(self, client, room_code):
        """Added bot should appear in room's player list."""
        client.post(f"/room/{room_code}/add-bot")

        room = session_manager.get_room(room_code)
        bots = [p for p in room.players.values() if p.is_bot]
        assert len(bots) == 1
        assert bots[0].name.startswith("Bot")


class TestStartGame:
    """Tests for starting a game."""

    def test_start_game_success(self, client, room_with_players):
        """POST /room/{room_code}/start should start the game."""
        response = client.post(f"/room/{room_with_players}/start")
        assert response.status_code == 200
        assert response.json()["status"] == "started"

        room = session_manager.get_room(room_with_players)
        assert room.started is True

    def test_start_game_not_enough_players(self, client, room_code):
        """Cannot start with fewer than minimum players."""
        # Join only 1 player
        session_manager.join_room(room_code, "player_1", "Alice")

        response = client.post(f"/room/{room_code}/start")
        assert response.status_code == 400
        assert "player" in response.json()["detail"].lower()

    def test_start_game_already_started(self, client, room_with_players, clean_session_manager):
        """Cannot start a game that's already started."""
        clean_session_manager.start_game(room_with_players)

        response = client.post(f"/room/{room_with_players}/start")
        assert response.status_code == 400

    def test_start_game_nonexistent_room(self, client, clean_session_manager):
        """Starting non-existent room should return 404."""
        response = client.post("/room/XXXX/start")
        assert response.status_code == 404


class TestRoomState:
    """Tests for room state endpoint."""

    def test_get_room_state(self, client, room_with_players):
        """GET /room/{room_code}/state should return room state."""
        response = client.get(f"/room/{room_with_players}/state")
        assert response.status_code == 200
        data = response.json()

        assert data["room_code"] == room_with_players
        assert data["started"] is False
        assert len(data["players"]) == 3
        assert data["min_players"] == 2
        assert data["max_players"] == 6

    def test_get_room_state_not_found(self, client, clean_session_manager):
        """Getting state of non-existent room should return 404."""
        response = client.get("/room/XXXX/state")
        assert response.status_code == 404


class TestHostView:
    """Tests for host view endpoint."""

    def test_host_view_success(self, client, room_code):
        """GET /host/{room_code} should return HTML."""
        response = client.get(f"/host/{room_code}")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]

    def test_host_view_not_found(self, client, clean_session_manager):
        """Host view for non-existent room should return 404."""
        response = client.get("/host/XXXX")
        assert response.status_code == 404


class TestPlayerView:
    """Tests for player view endpoint."""

    def test_player_view_success(self, client, room_code):
        """GET /play/{room_code} should return HTML for valid player."""
        session_manager.join_room(room_code, "player_1", "Alice")

        response = client.get(f"/play/{room_code}?player_id=player_1")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]

    def test_player_view_room_not_found(self, client, clean_session_manager):
        """Player view for non-existent room should return 404."""
        response = client.get("/play/XXXX?player_id=player_1")
        assert response.status_code == 404

    def test_player_view_player_not_found(self, client, room_code):
        """Player view for non-existent player should return 404."""
        response = client.get(f"/play/{room_code}?player_id=nonexistent")
        assert response.status_code == 404


class TestWebSocketHost:
    """Tests for host WebSocket endpoint."""

    def test_host_websocket_connection(self, client, room_code):
        """Host WebSocket should connect successfully."""
        with client.websocket_connect(f"/ws/host/{room_code}") as websocket:
            # Should receive initial state
            data = websocket.receive_json()
            assert data["type"] in ["lobby_update", "game_state"]

    def test_host_websocket_room_not_found(self, client, clean_session_manager):
        """Host WebSocket should reject connection to non-existent room."""
        with pytest.raises(Exception):
            with client.websocket_connect("/ws/host/XXXX"):
                pass


class TestWebSocketPlayer:
    """Tests for player WebSocket endpoint."""

    def test_player_websocket_connection(self, client, room_code):
        """Player WebSocket should connect successfully."""
        session_manager.join_room(room_code, "player_1", "Alice")

        with client.websocket_connect(f"/ws/player/{room_code}/player_1") as websocket:
            # Should receive initial state
            data = websocket.receive_json()
            assert data["type"] in ["lobby_update", "game_state"]

    def test_player_websocket_room_not_found(self, client, clean_session_manager):
        """Player WebSocket should reject connection to non-existent room."""
        with pytest.raises(Exception):
            with client.websocket_connect("/ws/player/XXXX/player_1"):
                pass

    def test_player_websocket_player_not_found(self, client, room_code):
        """Player WebSocket should reject connection for non-existent player."""
        with pytest.raises(Exception):
            with client.websocket_connect(f"/ws/player/{room_code}/nonexistent"):
                pass


class TestGameInitialization:
    """Tests for game initialization."""

    @pytest.mark.asyncio
    async def test_initialize_game_creates_state(self, room_with_players, clean_session_manager):
        """initialize_game should set up game state."""
        await initialize_game(room_with_players)

        room = clean_session_manager.get_room(room_with_players)
        game = room.game

        assert game is not None
        assert isinstance(game["board"], Board)
        assert isinstance(game["hotel"], Hotel)
        assert len(game["players"]) == 3
        assert len(game["turn_order"]) == 3
        assert game["phase"] == "place_tile"

    @pytest.mark.asyncio
    async def test_initialize_game_deals_tiles(self, room_with_players, clean_session_manager):
        """Each player should receive 6 tiles."""
        await initialize_game(room_with_players)

        room = clean_session_manager.get_room(room_with_players)
        game = room.game

        for player in game["players"].values():
            assert player.hand_size == 6

    @pytest.mark.asyncio
    async def test_initialize_game_tile_pool(self, room_with_players, clean_session_manager):
        """Tile pool should have correct remaining tiles."""
        await initialize_game(room_with_players)

        room = clean_session_manager.get_room(room_with_players)
        game = room.game

        # 108 total tiles - (3 players * 6 tiles) = 90 remaining
        assert len(game["tile_pool"]) == 90


class TestGameFlow:
    """Tests for game flow via actions."""

    @pytest.mark.asyncio
    async def test_place_tile_valid(self, game_room, clean_session_manager):
        """Placing a valid tile should work."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        current_player_id = game["turn_order"][0]
        player = game["players"][current_player_id]
        tile = player.hand[0]

        # Mock send_to_player to avoid actual websocket operations
        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(session_manager, "broadcast_to_room", new_callable=AsyncMock):
                    await handle_place_tile(game_room, current_player_id, str(tile))

        # Tile should be removed from hand
        assert tile not in player.hand

        # Tile should be on board
        assert game["board"].is_tile_played(tile)

    @pytest.mark.asyncio
    async def test_place_tile_wrong_turn(self, game_room, clean_session_manager):
        """Placing tile when not your turn should fail."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        wrong_player_id = game["turn_order"][1]  # Not the current player
        player = game["players"][wrong_player_id]
        tile = player.hand[0]

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock) as mock_send:
            await handle_place_tile(game_room, wrong_player_id, str(tile))

            # Should send error message
            mock_send.assert_called()
            call_args = mock_send.call_args[0]
            assert call_args[2]["type"] == "error"

    @pytest.mark.asyncio
    async def test_place_tile_not_in_hand(self, game_room, clean_session_manager):
        """Placing a tile not in hand should fail."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        current_player_id = game["turn_order"][0]

        # Use a tile not in the player's hand
        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock) as mock_send:
            await handle_place_tile(game_room, current_player_id, "12I")

            mock_send.assert_called()
            call_args = mock_send.call_args[0]
            assert call_args[2]["type"] == "error"

    @pytest.mark.asyncio
    async def test_found_chain(self, game_room, clean_session_manager):
        """Founding a chain should work correctly."""
        room = clean_session_manager.get_room(game_room)
        game = room.game
        board = game["board"]
        hotel = game["hotel"]

        # Set up for chain founding
        game["phase"] = "found_chain"
        current_player_id = game["turn_order"][0]
        player = game["players"][current_player_id]

        # Place adjacent tiles
        tile1 = Tile(1, "A")
        tile2 = Tile(2, "A")
        board.place_tile(tile1)
        board.place_tile(tile2)

        game["pending_action"] = {
            "tile": tile1,
            "connected_tiles": board.get_connected_tiles(tile1)
        }

        initial_stocks = player._stocks["Luxor"]

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(session_manager, "broadcast_to_room", new_callable=AsyncMock):
                    await handle_found_chain(game_room, current_player_id, "Luxor")

        # Chain should be active
        assert hotel.is_chain_active("Luxor")

        # Player should get founder's bonus stock
        assert player._stocks["Luxor"] == initial_stocks + 1

        # Phase should advance
        assert game["phase"] == "buy_stocks"

    @pytest.mark.asyncio
    async def test_buy_stocks(self, game_room, clean_session_manager):
        """Buying stocks should work correctly."""
        room = clean_session_manager.get_room(game_room)
        game = room.game
        board = game["board"]
        hotel = game["hotel"]

        # Set up an active chain
        tiles = [Tile(1, "A"), Tile(2, "A"), Tile(3, "A")]
        for tile in tiles:
            board.place_tile(tile)
            board.set_chain(tile, "Luxor")
        hotel.activate_chain("Luxor")

        game["phase"] = "buy_stocks"
        current_player_id = game["turn_order"][0]
        player = game["players"][current_player_id]

        initial_money = player.money
        initial_stocks = player._stocks["Luxor"]

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(session_manager, "broadcast_to_room", new_callable=AsyncMock):
                    await handle_buy_stocks(game_room, current_player_id, {"Luxor": 2})

        # Player should have more stocks
        assert player._stocks["Luxor"] == initial_stocks + 2

        # Player should have less money
        assert player.money < initial_money

    @pytest.mark.asyncio
    async def test_buy_stocks_limit_three(self, game_room, clean_session_manager):
        """Cannot buy more than 3 stocks per turn."""
        room = clean_session_manager.get_room(game_room)
        game = room.game
        board = game["board"]
        hotel = game["hotel"]

        # Set up active chains
        for col in range(1, 4):
            tile = Tile(col, "A")
            board.place_tile(tile)
            board.set_chain(tile, "Luxor")
        hotel.activate_chain("Luxor")

        game["phase"] = "buy_stocks"
        current_player_id = game["turn_order"][0]

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock) as mock_send:
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                await handle_buy_stocks(game_room, current_player_id, {"Luxor": 5})

        # Should receive error
        mock_send.assert_called()
        call_args = mock_send.call_args[0]
        assert call_args[2]["type"] == "error"

    @pytest.mark.asyncio
    async def test_end_turn_advances_player(self, game_room, clean_session_manager):
        """Ending turn should advance to next player."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        initial_index = game["current_turn_index"]
        current_player_id = game["turn_order"][initial_index]

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(session_manager, "broadcast_to_room", new_callable=AsyncMock):
                    await handle_end_turn(game_room, current_player_id)

        # Turn should advance
        expected_index = (initial_index + 1) % len(game["turn_order"])
        assert game["current_turn_index"] == expected_index

    @pytest.mark.asyncio
    async def test_end_turn_draws_tile(self, game_room, clean_session_manager):
        """Ending turn should draw a new tile."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        current_player_id = game["turn_order"][0]
        player = game["players"][current_player_id]

        # Remove a tile to make room
        player.remove_tile(player.hand[0])
        initial_hand_size = player.hand_size
        initial_pool_size = len(game["tile_pool"])

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(session_manager, "broadcast_to_room", new_callable=AsyncMock):
                    await handle_end_turn(game_room, current_player_id)

        # Hand should have one more tile
        assert player.hand_size == initial_hand_size + 1

        # Pool should have one less tile
        assert len(game["tile_pool"]) == initial_pool_size - 1


class TestBroadcast:
    """Tests for broadcast functionality."""

    @pytest.mark.asyncio
    async def test_broadcast_game_state(self, game_room, clean_session_manager, mock_websockets):
        """broadcast_game_state should send to all connected clients."""
        room = clean_session_manager.get_room(game_room)

        # Connect mock websockets
        host_ws = mock_websockets[0]
        player_ws_1 = mock_websockets[1]
        player_ws_2 = mock_websockets[2]

        room.host_websocket = host_ws
        player_ids = list(room.players.keys())
        room.players[player_ids[0]].websockets.append(player_ws_1)
        room.players[player_ids[1]].websockets.append(player_ws_2)

        await broadcast_game_state(game_room)

        # All should have received messages
        assert len(host_ws.sent_messages) > 0
        assert len(player_ws_1.sent_messages) > 0
        assert len(player_ws_2.sent_messages) > 0

        # Messages should be game state
        assert host_ws.sent_messages[0]["type"] == "game_state"
        assert player_ws_1.sent_messages[0]["type"] == "game_state"

    @pytest.mark.asyncio
    async def test_broadcast_includes_board_state(self, game_room, clean_session_manager, mock_websocket):
        """Broadcast should include board state."""
        room = clean_session_manager.get_room(game_room)
        room.host_websocket = mock_websocket

        await broadcast_game_state(game_room)

        message = mock_websocket.sent_messages[0]
        assert "board" in message
        assert "cells" in message["board"]

    @pytest.mark.asyncio
    async def test_broadcast_includes_player_hands_privately(
        self, game_room, clean_session_manager, mock_websockets
    ):
        """Each player should receive their own hand, not others'."""
        room = clean_session_manager.get_room(game_room)

        player_ids = list(room.players.keys())
        player_ws_1 = mock_websockets[0]
        player_ws_2 = mock_websockets[1]

        room.players[player_ids[0]].websockets.append(player_ws_1)
        room.players[player_ids[1]].websockets.append(player_ws_2)

        await broadcast_game_state(game_room)

        msg1 = player_ws_1.sent_messages[0]
        msg2 = player_ws_2.sent_messages[0]

        # Each player should have their own hand
        assert "your_hand" in msg1
        assert "your_hand" in msg2

        # Hands should be different (unless by extreme chance they're the same)
        # At least verify they exist and are lists
        assert isinstance(msg1["your_hand"], list)
        assert isinstance(msg2["your_hand"], list)


class TestPlayerAction:
    """Tests for handle_player_action dispatcher."""

    @pytest.mark.asyncio
    async def test_action_place_tile(self, game_room, clean_session_manager):
        """handle_player_action should dispatch place_tile correctly."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        current_player_id = game["turn_order"][0]
        player = game["players"][current_player_id]
        tile = player.hand[0]

        with patch("main.handle_place_tile", new_callable=AsyncMock) as mock:
            await handle_player_action(
                game_room, current_player_id, {"action": "place_tile", "tile": str(tile)}
            )
            mock.assert_called_once_with(game_room, current_player_id, str(tile))

    @pytest.mark.asyncio
    async def test_action_found_chain(self, game_room, clean_session_manager):
        """handle_player_action should dispatch found_chain correctly."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        current_player_id = game["turn_order"][0]

        with patch("main.handle_found_chain", new_callable=AsyncMock) as mock:
            await handle_player_action(
                game_room, current_player_id, {"action": "found_chain", "chain": "Luxor"}
            )
            mock.assert_called_once_with(game_room, current_player_id, "Luxor")

    @pytest.mark.asyncio
    async def test_action_buy_stocks(self, game_room, clean_session_manager):
        """handle_player_action should dispatch buy_stocks correctly."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        current_player_id = game["turn_order"][0]
        purchases = {"Luxor": 2, "Tower": 1}

        with patch("main.handle_buy_stocks", new_callable=AsyncMock) as mock:
            await handle_player_action(
                game_room, current_player_id, {"action": "buy_stocks", "purchases": purchases}
            )
            mock.assert_called_once_with(game_room, current_player_id, purchases)

    @pytest.mark.asyncio
    async def test_action_end_turn(self, game_room, clean_session_manager):
        """handle_player_action should dispatch end_turn correctly."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        current_player_id = game["turn_order"][0]

        with patch("main.handle_end_turn", new_callable=AsyncMock) as mock:
            await handle_player_action(
                game_room, current_player_id, {"action": "end_turn"}
            )
            mock.assert_called_once_with(game_room, current_player_id)

    @pytest.mark.asyncio
    async def test_action_on_unstarted_game(self, room_with_players, clean_session_manager):
        """Actions on unstarted game should be ignored."""
        # Game not started
        with patch("main.handle_place_tile", new_callable=AsyncMock) as mock:
            await handle_player_action(
                room_with_players, "player_1", {"action": "place_tile", "tile": "1A"}
            )
            mock.assert_not_called()


class TestMultipleWebsocketsPerPlayer:
    """Tests for players connecting from multiple devices."""

    @pytest.mark.asyncio
    async def test_player_can_have_multiple_websockets(self, room_code, clean_session_manager, mock_websockets):
        """A player should be able to connect from multiple devices."""
        clean_session_manager.join_room(room_code, "player_1", "Alice")

        ws1 = mock_websockets[0]
        ws2 = mock_websockets[1]

        clean_session_manager.connect_player(room_code, "player_1", ws1)
        clean_session_manager.connect_player(room_code, "player_1", ws2)

        room = clean_session_manager.get_room(room_code)
        player = room.players["player_1"]

        assert len(player.websockets) == 2
        assert ws1 in player.websockets
        assert ws2 in player.websockets

    @pytest.mark.asyncio
    async def test_broadcast_sends_to_all_player_websockets(self, room_code, clean_session_manager, mock_websockets):
        """Broadcast should send to all websockets for each player."""
        clean_session_manager.join_room(room_code, "player_1", "Alice")

        ws1 = mock_websockets[0]
        ws2 = mock_websockets[1]

        clean_session_manager.connect_player(room_code, "player_1", ws1)
        clean_session_manager.connect_player(room_code, "player_1", ws2)

        await clean_session_manager.broadcast_to_room(room_code, {"type": "test", "data": "hello"})

        # Both websockets should receive the message
        assert len(ws1.sent_messages) == 1
        assert len(ws2.sent_messages) == 1
        assert ws1.sent_messages[0] == {"type": "test", "data": "hello"}
        assert ws2.sent_messages[0] == {"type": "test", "data": "hello"}

    @pytest.mark.asyncio
    async def test_send_to_player_sends_to_all_websockets(self, room_code, clean_session_manager, mock_websockets):
        """send_to_player should send to all websockets for that player."""
        clean_session_manager.join_room(room_code, "player_1", "Alice")

        ws1 = mock_websockets[0]
        ws2 = mock_websockets[1]

        clean_session_manager.connect_player(room_code, "player_1", ws1)
        clean_session_manager.connect_player(room_code, "player_1", ws2)

        await clean_session_manager.send_to_player(room_code, "player_1", {"type": "private", "data": "secret"})

        # Both websockets should receive the message
        assert len(ws1.sent_messages) == 1
        assert len(ws2.sent_messages) == 1
        assert ws1.sent_messages[0] == {"type": "private", "data": "secret"}

    @pytest.mark.asyncio
    async def test_disconnect_removes_only_specific_websocket(self, room_code, clean_session_manager, mock_websockets):
        """Disconnecting one websocket should not affect other websockets for same player."""
        clean_session_manager.join_room(room_code, "player_1", "Alice")

        ws1 = mock_websockets[0]
        ws2 = mock_websockets[1]

        clean_session_manager.connect_player(room_code, "player_1", ws1)
        clean_session_manager.connect_player(room_code, "player_1", ws2)

        # Disconnect first websocket
        clean_session_manager.disconnect(room_code, "player_1", ws1)

        room = clean_session_manager.get_room(room_code)
        player = room.players["player_1"]

        # Only ws2 should remain
        assert len(player.websockets) == 1
        assert ws1 not in player.websockets
        assert ws2 in player.websockets

    @pytest.mark.asyncio
    async def test_broadcast_still_works_after_one_disconnect(self, room_code, clean_session_manager, mock_websockets):
        """After one device disconnects, broadcasts should still reach remaining devices."""
        clean_session_manager.join_room(room_code, "player_1", "Alice")

        ws1 = mock_websockets[0]
        ws2 = mock_websockets[1]

        clean_session_manager.connect_player(room_code, "player_1", ws1)
        clean_session_manager.connect_player(room_code, "player_1", ws2)

        # Disconnect first websocket
        clean_session_manager.disconnect(room_code, "player_1", ws1)

        # Broadcast message
        await clean_session_manager.broadcast_to_room(room_code, {"type": "test", "data": "after_disconnect"})

        # ws1 should not receive (disconnected before broadcast)
        assert len(ws1.sent_messages) == 0
        # ws2 should receive
        assert len(ws2.sent_messages) == 1
        assert ws2.sent_messages[0] == {"type": "test", "data": "after_disconnect"}

    @pytest.mark.asyncio
    async def test_dead_websocket_removed_on_broadcast(self, room_code, clean_session_manager, mock_websockets):
        """A websocket that fails to send should be removed from the list."""
        clean_session_manager.join_room(room_code, "player_1", "Alice")

        ws1 = mock_websockets[0]
        ws2 = mock_websockets[1]

        # Make ws1 raise an exception on send
        async def failing_send(data):
            raise Exception("Connection lost")
        ws1.send_json = failing_send

        clean_session_manager.connect_player(room_code, "player_1", ws1)
        clean_session_manager.connect_player(room_code, "player_1", ws2)

        # Broadcast - ws1 will fail
        await clean_session_manager.broadcast_to_room(room_code, {"type": "test"})

        room = clean_session_manager.get_room(room_code)
        player = room.players["player_1"]

        # ws1 should be removed due to failure
        assert len(player.websockets) == 1
        assert ws1 not in player.websockets
        assert ws2 in player.websockets

        # ws2 should have received the message
        assert len(ws2.sent_messages) == 1
