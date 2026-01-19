"""Unit tests for main.py WebSocket handlers.

These tests verify individual handler functions in main.py work correctly
with proper validation and error handling.
"""

import pytest
from unittest.mock import AsyncMock, patch

from main import (
    session_manager,
    handle_place_tile,
    handle_found_chain,
    handle_buy_stocks,
    handle_end_turn,
    handle_merger_choice,
    handle_player_action,
    validate_websocket_message,
    PlaceTileMessage,
    FoundChainMessage,
    BuyStocksMessage,
    EndTurnMessage,
)
from game.board import Tile


class TestMessageValidation:
    """Tests for WebSocket message validation."""

    def test_validate_place_tile_valid(self):
        """Valid place_tile message should pass validation."""
        data = {"action": "place_tile", "tile": "1A"}
        msg, error = validate_websocket_message(data)

        assert error is None
        assert msg is not None
        assert isinstance(msg, PlaceTileMessage)
        assert msg.tile == "1A"

    def test_validate_place_tile_normalizes_case(self):
        """Tile should be normalized to uppercase."""
        data = {"action": "place_tile", "tile": "1a"}
        msg, error = validate_websocket_message(data)

        assert error is None
        assert msg.tile == "1A"

    def test_validate_place_tile_invalid_format(self):
        """Invalid tile format should be rejected."""
        # Note: validator only checks format pattern, not column range (1-12)
        # 13A passes format check (1?[0-9][A-I]) but would fail board placement
        invalid_tiles = ["AA", "1", "A1", "1J", "", "123", "0", "20A"]

        for tile in invalid_tiles:
            data = {"action": "place_tile", "tile": tile}
            msg, error = validate_websocket_message(data)
            assert error is not None, f"Tile '{tile}' should be invalid"
            assert msg is None

    def test_validate_found_chain_valid(self):
        """Valid found_chain message should pass validation."""
        data = {"action": "found_chain", "chain": "Luxor"}
        msg, error = validate_websocket_message(data)

        assert error is None
        assert isinstance(msg, FoundChainMessage)
        assert msg.chain == "Luxor"

    def test_validate_found_chain_invalid_chain(self):
        """Invalid chain name should be rejected."""
        data = {"action": "found_chain", "chain": "InvalidChain"}
        msg, error = validate_websocket_message(data)

        assert error is not None
        assert "Invalid chain" in error

    def test_validate_buy_stocks_valid(self):
        """Valid buy_stocks message should pass validation."""
        data = {"action": "buy_stocks", "purchases": {"Luxor": 2, "Tower": 1}}
        msg, error = validate_websocket_message(data)

        assert error is None
        assert isinstance(msg, BuyStocksMessage)
        assert msg.purchases["Luxor"] == 2
        assert msg.purchases["Tower"] == 1

    def test_validate_buy_stocks_exceeds_limit(self):
        """Buying more than 3 stocks should be rejected."""
        data = {"action": "buy_stocks", "purchases": {"Luxor": 4}}
        msg, error = validate_websocket_message(data)

        assert error is not None
        assert "more than 3" in error.lower()

    def test_validate_buy_stocks_invalid_chain(self):
        """Buying stock in invalid chain should be rejected."""
        data = {"action": "buy_stocks", "purchases": {"InvalidChain": 1}}
        msg, error = validate_websocket_message(data)

        assert error is not None

    def test_validate_end_turn_valid(self):
        """Valid end_turn message should pass validation."""
        data = {"action": "end_turn"}
        msg, error = validate_websocket_message(data)

        assert error is None
        assert isinstance(msg, EndTurnMessage)

    def test_validate_unknown_action(self):
        """Unknown action should be rejected."""
        data = {"action": "unknown_action"}
        msg, error = validate_websocket_message(data)

        assert error is not None
        assert "Unknown action" in error


class TestHandlePlaceTileValidation:
    """Tests for handle_place_tile validation."""

    @pytest.mark.asyncio
    async def test_place_tile_rejects_wrong_turn(
        self, game_room, clean_session_manager
    ):
        """Should reject tile placement if not player's turn."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        # Get a player who is NOT the current player
        wrong_player_id = game["turn_order"][1]  # Second player
        player = game["players"][wrong_player_id]
        tile = player.hand[0]

        with patch.object(
            session_manager, "send_to_player", new_callable=AsyncMock
        ) as mock_send:
            await handle_place_tile(game_room, wrong_player_id, str(tile))

            mock_send.assert_called()
            call_args = mock_send.call_args[0]
            assert call_args[2]["type"] == "error"
            assert "not your turn" in call_args[2]["message"].lower()

    @pytest.mark.asyncio
    async def test_place_tile_rejects_invalid_tile(
        self, game_room, clean_session_manager
    ):
        """Should reject tile player doesn't have."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        current_player_id = game["turn_order"][0]

        with patch.object(
            session_manager, "send_to_player", new_callable=AsyncMock
        ) as mock_send:
            # Try to place a tile not in hand
            await handle_place_tile(game_room, current_player_id, "12I")

            mock_send.assert_called()
            call_args = mock_send.call_args[0]
            assert call_args[2]["type"] == "error"

    @pytest.mark.asyncio
    async def test_place_tile_advances_to_correct_phase(
        self, game_room, clean_session_manager
    ):
        """After valid placement, phase should update correctly."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        current_player_id = game["turn_order"][0]
        player = game["players"][current_player_id]
        tile = player.hand[0]

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    await handle_place_tile(game_room, current_player_id, str(tile))

        # Phase should have changed (either to buy_stocks or found_chain)
        assert game["phase"] in ["buy_stocks", "found_chain", "merger"]


class TestHandleBuyStocksValidation:
    """Tests for handle_buy_stocks validation."""

    @pytest.mark.asyncio
    async def test_buy_stocks_rejects_inactive_chain(
        self, game_room, clean_session_manager
    ):
        """Should reject buying stock from inactive chain."""
        room = clean_session_manager.get_room(game_room)
        game = room.game
        game["phase"] = "buy_stocks"

        current_player_id = game["turn_order"][0]

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    # Luxor is not active
                    await handle_buy_stocks(game_room, current_player_id, {"Luxor": 1})

        # No stocks should have been purchased
        player = game["players"][current_player_id]
        assert player._stocks.get("Luxor", 0) == 0

    @pytest.mark.asyncio
    async def test_buy_stocks_respects_available_count(
        self, game_room, clean_session_manager
    ):
        """Should not buy more stocks than available."""
        room = clean_session_manager.get_room(game_room)
        game = room.game
        board = game["board"]
        hotel = game["hotel"]

        # Set up an active chain
        for col in range(1, 4):
            tile = Tile(col, "A")
            board.place_tile(tile)
            board.set_chain(tile, "Luxor")
        hotel.activate_chain("Luxor")

        # Reduce available stocks
        hotel._available_stocks["Luxor"] = 1

        game["phase"] = "buy_stocks"
        current_player_id = game["turn_order"][0]
        player = game["players"][current_player_id]
        initial_stocks = player._stocks.get("Luxor", 0)

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    # Try to buy 3, but only 1 available
                    await handle_buy_stocks(game_room, current_player_id, {"Luxor": 3})

        # Should only have bought 1 (or none if funds insufficient)
        final_stocks = player._stocks.get("Luxor", 0)
        assert final_stocks <= initial_stocks + 1

    @pytest.mark.asyncio
    async def test_buy_stocks_respects_player_funds(
        self, game_room, clean_session_manager
    ):
        """Should not buy stocks if player can't afford them."""
        room = clean_session_manager.get_room(game_room)
        game = room.game
        board = game["board"]
        hotel = game["hotel"]

        # Set up an active chain
        for col in range(1, 4):
            tile = Tile(col, "A")
            board.place_tile(tile)
            board.set_chain(tile, "Luxor")
        hotel.activate_chain("Luxor")

        game["phase"] = "buy_stocks"
        current_player_id = game["turn_order"][0]
        player = game["players"][current_player_id]

        # Make player poor
        player._money = 0
        initial_stocks = player._stocks.get("Luxor", 0)

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    await handle_buy_stocks(game_room, current_player_id, {"Luxor": 3})

        # Should not have bought any stocks
        final_stocks = player._stocks.get("Luxor", 0)
        assert final_stocks == initial_stocks


class TestHandleEndTurnFlow:
    """Tests for handle_end_turn flow."""

    @pytest.mark.asyncio
    async def test_end_turn_advances_player(self, game_room, clean_session_manager):
        """current_turn_index should increment."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        initial_index = game["current_turn_index"]
        current_player_id = game["turn_order"][initial_index]

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    await handle_end_turn(game_room, current_player_id)

        expected_index = (initial_index + 1) % len(game["turn_order"])
        assert game["current_turn_index"] == expected_index

    @pytest.mark.asyncio
    async def test_end_turn_wraps_around(self, game_room, clean_session_manager):
        """Turn should wrap from last player to first."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        # Set to last player
        num_players = len(game["turn_order"])
        game["current_turn_index"] = num_players - 1
        last_player_id = game["turn_order"][num_players - 1]

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    await handle_end_turn(game_room, last_player_id)

        assert game["current_turn_index"] == 0

    @pytest.mark.asyncio
    async def test_end_turn_draws_tile(self, game_room, clean_session_manager):
        """Player should receive new tile from pool."""
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
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    await handle_end_turn(game_room, current_player_id)

        assert player.hand_size == initial_hand_size + 1
        assert len(game["tile_pool"]) == initial_pool_size - 1

    @pytest.mark.asyncio
    async def test_end_turn_resets_phase(self, game_room, clean_session_manager):
        """Phase should reset to place_tile."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        game["phase"] = "buy_stocks"  # Set to non-initial phase
        current_player_id = game["turn_order"][0]

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    await handle_end_turn(game_room, current_player_id)

        assert game["phase"] == "place_tile"


class TestHandleFoundChain:
    """Tests for handle_found_chain."""

    @pytest.mark.asyncio
    async def test_found_chain_rejects_wrong_phase(
        self, game_room, clean_session_manager
    ):
        """Should do nothing if not in found_chain phase."""
        room = clean_session_manager.get_room(game_room)
        game = room.game
        hotel = game["hotel"]

        game["phase"] = "place_tile"  # Wrong phase
        current_player_id = game["turn_order"][0]

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    await handle_found_chain(game_room, current_player_id, "Luxor")

        # Chain should not be activated
        assert not hotel.is_chain_active("Luxor")

    @pytest.mark.asyncio
    async def test_found_chain_rejects_unavailable_chain(
        self, game_room, clean_session_manager
    ):
        """Should reject founding an already active chain."""
        room = clean_session_manager.get_room(game_room)
        game = room.game
        hotel = game["hotel"]

        # Activate Luxor
        hotel.activate_chain("Luxor")

        game["phase"] = "found_chain"
        game["pending_action"] = {
            "tile": Tile(1, "A"),
            "connected_tiles": [Tile(1, "A"), Tile(2, "A")],
        }

        current_player_id = game["turn_order"][0]

        with patch.object(
            session_manager, "send_to_player", new_callable=AsyncMock
        ) as mock_send:
            await handle_found_chain(game_room, current_player_id, "Luxor")

            # Should send error
            mock_send.assert_called()
            call_args = mock_send.call_args[0]
            assert call_args[2]["type"] == "error"

    @pytest.mark.asyncio
    async def test_found_chain_gives_founder_stock(
        self, game_room, clean_session_manager
    ):
        """Founder should receive a free stock."""
        room = clean_session_manager.get_room(game_room)
        game = room.game
        board = game["board"]

        # Set up tiles for founding
        tile1 = Tile(1, "A")
        tile2 = Tile(2, "A")
        board.place_tile(tile1)
        board.place_tile(tile2)

        game["phase"] = "found_chain"
        game["pending_action"] = {
            "tile": tile1,
            "connected_tiles": board.get_connected_tiles(tile1),
        }

        current_player_id = game["turn_order"][0]
        player = game["players"][current_player_id]
        initial_stocks = player._stocks.get("Tower", 0)

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    await handle_found_chain(game_room, current_player_id, "Tower")

        # Should have received founder's stock
        assert player._stocks["Tower"] == initial_stocks + 1


class TestHandleMergerChoice:
    """Tests for handle_merger_choice."""

    @pytest.mark.asyncio
    async def test_merger_choice_rejects_invalid_chain(
        self, game_room, clean_session_manager
    ):
        """Should reject choosing a chain not in the tie."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        game["pending_action"] = {
            "type": "choose_survivor",
            "chains": ["Luxor", "Tower"],
            "tied_chains": ["Luxor", "Tower"],
            "tile": Tile(4, "A"),
        }

        current_player_id = game["turn_order"][0]

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    # Choose American which is not in the tie
                    await handle_merger_choice(game_room, current_player_id, "American")

        # Should not have set up process_merger
        pending = game.get("pending_action")
        if pending:
            assert pending.get("type") != "process_merger"


class TestActionOnUnstartedGame:
    """Tests for actions on games that haven't started."""

    @pytest.mark.asyncio
    async def test_action_ignored_when_game_not_started(
        self, room_with_players, clean_session_manager
    ):
        """Actions on unstarted game should be ignored."""
        # Game not started yet
        with patch("main.handle_place_tile", new_callable=AsyncMock) as mock:
            await handle_player_action(
                room_with_players, "player_1", {"action": "place_tile", "tile": "1A"}
            )
            mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_action_ignored_when_room_not_found(self, clean_session_manager):
        """Actions on non-existent room should be ignored."""
        with patch("main.handle_place_tile", new_callable=AsyncMock) as mock:
            await handle_player_action(
                "NONEXISTENT", "player_1", {"action": "place_tile", "tile": "1A"}
            )
            mock.assert_not_called()


class TestValidationErrors:
    """Tests for validation error handling."""

    @pytest.mark.asyncio
    async def test_invalid_message_sends_error(self, game_room, clean_session_manager):
        """Invalid message should send error to player."""
        room = clean_session_manager.get_room(game_room)
        current_player_id = room.game["turn_order"][0]

        with patch.object(
            session_manager, "send_to_player", new_callable=AsyncMock
        ) as mock_send:
            # Send invalid action
            await handle_player_action(
                game_room, current_player_id, {"action": "invalid_action"}
            )

            mock_send.assert_called()
            call_args = mock_send.call_args[0]
            assert call_args[2]["type"] == "error"
