"""WebSocket gameplay integration tests.

These tests verify the WebSocket handlers in main.py work correctly
for game flow without requiring a browser.
"""

import pytest
from unittest.mock import AsyncMock, patch

from main import (
    session_manager,
    initialize_game,
    handle_player_action,
    broadcast_game_state,
)
from game.board import Tile


class TestBotTurnAutoExecution:
    """Tests for bot turn auto-execution after game start."""

    @pytest.mark.asyncio
    async def test_game_starts_with_valid_state(
        self, room_with_players, clean_session_manager
    ):
        """When game starts, game state should be properly initialized."""
        clean_session_manager.start_game(room_with_players)
        await initialize_game(room_with_players)

        room = clean_session_manager.get_room(room_with_players)
        game = room.game

        assert game is not None
        assert "turn_order" in game
        assert "current_turn_index" in game
        assert game["phase"] == "place_tile"
        assert len(game["turn_order"]) == 3  # 3 players

    @pytest.mark.asyncio
    async def test_current_player_has_tiles(self, game_room, clean_session_manager):
        """Current player should have tiles to play."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        current_player_id = game["turn_order"][game["current_turn_index"]]
        current_player = game["players"][current_player_id]

        assert current_player.hand_size == 6
        assert len(current_player.hand) == 6

    @pytest.mark.asyncio
    async def test_game_state_includes_all_required_fields(
        self, game_room, clean_session_manager, mock_websocket
    ):
        """Broadcast game state should include all required fields."""
        room = clean_session_manager.get_room(game_room)
        room.host_websocket = mock_websocket

        await broadcast_game_state(game_room)

        assert len(mock_websocket.sent_messages) > 0
        msg = mock_websocket.sent_messages[0]

        # Verify required fields
        assert msg["type"] == "game_state"
        assert "board" in msg
        assert "hotel" in msg
        assert "turn_order" in msg
        assert "current_player" in msg
        assert "phase" in msg
        assert "players" in msg
        assert "tiles_remaining" in msg


class TestTurnAdvancesAfterHumanAction:
    """Tests for turn advancement after human player actions."""

    @pytest.mark.asyncio
    async def test_turn_advances_after_valid_tile_placement(
        self, game_room, clean_session_manager
    ):
        """After placing a tile and ending turn, current player should change."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        initial_turn_index = game["current_turn_index"]
        current_player_id = game["turn_order"][initial_turn_index]
        player = game["players"][current_player_id]
        tile = player.hand[0]

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    # Place tile
                    await handle_player_action(
                        game_room,
                        current_player_id,
                        {"action": "place_tile", "tile": str(tile)},
                    )

                    # If in buy_stocks phase, proceed to end turn
                    if game["phase"] == "buy_stocks":
                        await handle_player_action(
                            game_room,
                            current_player_id,
                            {"action": "buy_stocks", "purchases": {}},
                        )

        # Turn should have advanced
        new_turn_index = game["current_turn_index"]
        assert new_turn_index != initial_turn_index, (
            f"Turn index should have changed from {initial_turn_index}"
        )

    @pytest.mark.asyncio
    async def test_turn_wraps_around(self, game_room, clean_session_manager):
        """Turn should wrap from last player to first player."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        # Set to last player
        num_players = len(game["turn_order"])
        game["current_turn_index"] = num_players - 1

        last_player_id = game["turn_order"][num_players - 1]
        player = game["players"][last_player_id]
        tile = player.hand[0]

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    await handle_player_action(
                        game_room,
                        last_player_id,
                        {"action": "place_tile", "tile": str(tile)},
                    )

                    if game["phase"] == "buy_stocks":
                        await handle_player_action(
                            game_room,
                            last_player_id,
                            {"action": "buy_stocks", "purchases": {}},
                        )

        # Should wrap to first player
        assert game["current_turn_index"] == 0


class TestMultiPhaseBotTurn:
    """Tests for multi-phase bot turns (found chain + buy + end turn)."""

    @pytest.mark.asyncio
    async def test_chain_founding_changes_phase(self, game_room, clean_session_manager):
        """Placing adjacent tiles should trigger chain founding phase."""
        room = clean_session_manager.get_room(game_room)
        game = room.game
        board = game["board"]

        # Place a tile first
        tile1 = Tile(5, "E")
        board.place_tile(tile1)

        # Give current player an adjacent tile
        current_player_id = game["turn_order"][0]
        player = game["players"][current_player_id]

        # Clear player's hand and add adjacent tile
        player._hand.clear()
        adjacent_tile = Tile(6, "E")
        player.add_tile(adjacent_tile)
        # Add more tiles to meet minimum
        for col in range(1, 6):
            player.add_tile(Tile(col, "A"))

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    await handle_player_action(
                        game_room,
                        current_player_id,
                        {"action": "place_tile", "tile": str(adjacent_tile)},
                    )

        # Should be in found_chain phase
        assert game["phase"] == "found_chain"

    @pytest.mark.asyncio
    async def test_found_chain_then_buy_stocks(self, game_room, clean_session_manager):
        """After founding chain, game should proceed to buy_stocks phase."""
        room = clean_session_manager.get_room(game_room)
        game = room.game
        board = game["board"]
        hotel = game["hotel"]

        # Set up for chain founding
        tile1 = Tile(5, "E")
        tile2 = Tile(6, "E")
        board.place_tile(tile1)
        board.place_tile(tile2)

        game["phase"] = "found_chain"
        current_player_id = game["turn_order"][0]

        game["pending_action"] = {
            "tile": tile1,
            "connected_tiles": board.get_connected_tiles(tile1),
        }

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    await handle_player_action(
                        game_room,
                        current_player_id,
                        {"action": "found_chain", "chain": "Luxor"},
                    )

        # Should be in buy_stocks phase now
        assert game["phase"] == "buy_stocks"
        assert hotel.is_chain_active("Luxor")


class TestBotMergerHandling:
    """Tests for bot handling of merger decisions."""

    @pytest.mark.asyncio
    async def test_merger_phase_detection(self, game_room, clean_session_manager):
        """Merger should be detected when connecting two chains."""
        room = clean_session_manager.get_room(game_room)
        game = room.game
        board = game["board"]
        hotel = game["hotel"]

        # Set up two chains with a gap
        # Chain 1: Luxor at 1A, 2A, 3A
        for col in range(1, 4):
            tile = Tile(col, "A")
            board.place_tile(tile)
            board.set_chain(tile, "Luxor")
        hotel.activate_chain("Luxor")

        # Chain 2: Tower at 5A, 6A
        for col in range(5, 7):
            tile = Tile(col, "A")
            board.place_tile(tile)
            board.set_chain(tile, "Tower")
        hotel.activate_chain("Tower")

        # Give current player the merger tile (4A)
        current_player_id = game["turn_order"][0]
        player = game["players"][current_player_id]
        player._hand.clear()

        merger_tile = Tile(4, "A")
        player.add_tile(merger_tile)
        # Add more tiles to fill hand
        for col in range(7, 12):
            player.add_tile(Tile(col, "A"))

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    await handle_player_action(
                        game_room,
                        current_player_id,
                        {"action": "place_tile", "tile": str(merger_tile)},
                    )

        # Since Luxor is larger, it should automatically win
        # Game should proceed to buy_stocks phase after merger
        assert game["phase"] == "buy_stocks"


class TestMultipleConsecutiveBotTurns:
    """Tests for multiple consecutive bot turns in bot-only games."""

    @pytest.mark.asyncio
    async def test_tile_pool_decreases_with_turns(
        self, game_room, clean_session_manager
    ):
        """Each turn should draw a tile, reducing pool size."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        initial_pool_size = len(game["tile_pool"])

        # Play multiple turns
        for turn in range(3):
            current_player_id = game["turn_order"][game["current_turn_index"]]
            player = game["players"][current_player_id]

            if player.hand_size > 0:
                tile = player.hand[0]

                with patch.object(
                    session_manager, "send_to_player", new_callable=AsyncMock
                ):
                    with patch.object(
                        session_manager, "send_to_host", new_callable=AsyncMock
                    ):
                        with patch.object(
                            session_manager, "broadcast_to_room", new_callable=AsyncMock
                        ):
                            await handle_player_action(
                                game_room,
                                current_player_id,
                                {"action": "place_tile", "tile": str(tile)},
                            )

                            if game["phase"] == "buy_stocks":
                                await handle_player_action(
                                    game_room,
                                    current_player_id,
                                    {"action": "buy_stocks", "purchases": {}},
                                )

        # Tile pool should have decreased
        final_pool_size = len(game["tile_pool"])
        assert final_pool_size < initial_pool_size, (
            f"Pool size should decrease. Initial: {initial_pool_size}, "
            f"Final: {final_pool_size}"
        )


class TestWebSocketMessageBroadcasting:
    """Tests for WebSocket message broadcasting to all players."""

    @pytest.mark.asyncio
    async def test_all_players_receive_game_state(
        self, game_room, clean_session_manager, mock_websockets
    ):
        """All connected players should receive game_state updates."""
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

        # All messages should be game_state type
        assert host_ws.sent_messages[0]["type"] == "game_state"
        assert player_ws_1.sent_messages[0]["type"] == "game_state"
        assert player_ws_2.sent_messages[0]["type"] == "game_state"

    @pytest.mark.asyncio
    async def test_player_receives_private_hand(
        self, game_room, clean_session_manager, mock_websockets
    ):
        """Each player should receive their own hand in game state."""
        room = clean_session_manager.get_room(game_room)

        player_ids = list(room.players.keys())
        player_ws_1 = mock_websockets[0]
        player_ws_2 = mock_websockets[1]

        room.players[player_ids[0]].websockets.append(player_ws_1)
        room.players[player_ids[1]].websockets.append(player_ws_2)

        await broadcast_game_state(game_room)

        # Both should have your_hand field
        msg1 = player_ws_1.sent_messages[0]
        msg2 = player_ws_2.sent_messages[0]

        assert "your_hand" in msg1
        assert "your_hand" in msg2

        # Hands should be lists of tile strings
        assert isinstance(msg1["your_hand"], list)
        assert isinstance(msg2["your_hand"], list)
        assert len(msg1["your_hand"]) == 6  # Each player has 6 tiles

    @pytest.mark.asyncio
    async def test_broadcast_after_action(
        self, game_room, clean_session_manager, mock_websockets
    ):
        """Game state should be broadcast after each action."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        host_ws = mock_websockets[0]
        room.host_websocket = host_ws

        current_player_id = game["turn_order"][0]
        player = game["players"][current_player_id]
        tile = player.hand[0]

        player_ws = mock_websockets[1]
        room.players[current_player_id].websockets.append(player_ws)

        await handle_player_action(
            game_room,
            current_player_id,
            {"action": "place_tile", "tile": str(tile)},
        )

        # Both host and player should have received broadcasts
        assert len(host_ws.sent_messages) > 0
        assert len(player_ws.sent_messages) > 0
