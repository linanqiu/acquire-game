"""Unit tests for the human action path (main.handle_player_action).

The old per-action handle_* functions were replaced by one path through
game.decisions.apply_action; these tests drive it with wire messages.

These tests verify individual handler functions in main.py work correctly
with proper validation and error handling.
"""

import pytest
from unittest.mock import AsyncMock, patch

from app_state import session_manager
from lifecycle import handle_player_action
from protocol import (
    BuyStocksMessage,
    EndTurnMessage,
    FoundChainMessage,
    PlaceTileMessage,
    validate_websocket_message,
)
from game.board import Tile
from game.game import GamePhase


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
        data = {"action": "found_chain", "chain": "sandpiper"}
        msg, error = validate_websocket_message(data)

        assert error is None
        assert isinstance(msg, FoundChainMessage)
        assert msg.chain == "sandpiper"

    def test_validate_found_chain_invalid_chain(self):
        """Invalid chain name should be rejected."""
        data = {"action": "found_chain", "chain": "InvalidChain"}
        msg, error = validate_websocket_message(data)

        assert error is not None
        assert "Invalid chain" in error

    def test_validate_buy_stocks_valid(self):
        """Valid buy_stocks message should pass validation."""
        data = {"action": "buy_stocks", "purchases": {"sandpiper": 2, "marlowe": 1}}
        msg, error = validate_websocket_message(data)

        assert error is None
        assert isinstance(msg, BuyStocksMessage)
        assert msg.purchases["sandpiper"] == 2
        assert msg.purchases["marlowe"] == 1

    def test_validate_buy_stocks_exceeds_limit(self):
        """Buying more than 3 stocks should be rejected."""
        data = {"action": "buy_stocks", "purchases": {"sandpiper": 4}}
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


class TestHandleFoundChain:
    """Tests for handle_found_chain."""

    @pytest.mark.asyncio
    async def test_found_chain_rejects_wrong_phase(
        self, game_room, clean_session_manager
    ):
        """Should do nothing if not in found_chain phase."""
        room = clean_session_manager.get_room(game_room)
        game = room.game
        hotel = game.hotel

        game.phase = GamePhase.PLAYING  # Wrong phase
        current_player_id = game.get_current_player_id()

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    await handle_player_action(
                        game_room,
                        current_player_id,
                        {"action": "found_chain", "chain": "sandpiper"},
                    )

        # Chain should not be activated
        assert not hotel.is_chain_active("sandpiper")

    @pytest.mark.asyncio
    async def test_found_chain_rejects_unavailable_chain(
        self, game_room, clean_session_manager
    ):
        """Should reject founding an already active chain."""
        room = clean_session_manager.get_room(game_room)
        game = room.game
        hotel = game.hotel

        # Activate sandpiper
        hotel.activate_chain("sandpiper")

        game.phase = GamePhase.FOUNDING_CHAIN
        game.pending_action = {
            "type": "found_chain",
            "tile": Tile(1, "A"),
            "connected_tiles": [Tile(1, "A"), Tile(2, "A")],
        }

        current_player_id = game.get_current_player_id()

        with patch.object(
            session_manager, "send_to_player", new_callable=AsyncMock
        ) as mock_send:
            await handle_player_action(
                game_room,
                current_player_id,
                {"action": "found_chain", "chain": "sandpiper"},
            )

            # Should send error
            mock_send.assert_called()
            call_args = mock_send.call_args[0]
            assert call_args[2]["type"] == "error"


class TestHandleMergerChoice:
    """Tests for handle_merger_choice."""

    @pytest.mark.asyncio
    async def test_merger_choice_rejects_invalid_chain(
        self, game_room, clean_session_manager
    ):
        """Should reject choosing a chain not in the tie."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        game.pending_action = {
            "type": "choose_survivor",
            "chains": ["sandpiper", "marlowe"],
            "tied_chains": ["sandpiper", "marlowe"],
            "tile": Tile(4, "A"),
        }

        current_player_id = game.get_current_player_id()

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    # Choose halcyon which is not in the tie
                    await handle_player_action(
                        game_room,
                        current_player_id,
                        {"action": "merger_choice", "surviving_chain": "halcyon"},
                    )

        # Should not have set up process_merger
        pending = game.pending_action
        if pending:
            assert pending.get("type") != "process_merger"


class TestActionOnUnstartedGame:
    """Tests for actions on games that haven't started."""

    @pytest.mark.asyncio
    async def test_action_ignored_when_game_not_started(
        self, room_with_players, clean_session_manager
    ):
        """Actions on unstarted game should be ignored (nothing sent, no game)."""
        with patch.object(
            session_manager, "send_to_player", new_callable=AsyncMock
        ) as mock_send:
            await handle_player_action(
                room_with_players, "player_1", {"action": "place_tile", "tile": "1A"}
            )
            mock_send.assert_not_called()
        assert clean_session_manager.get_room(room_with_players).game is None

    @pytest.mark.asyncio
    async def test_action_ignored_when_room_not_found(self, clean_session_manager):
        """Actions on non-existent room should be ignored."""
        with patch.object(
            session_manager, "send_to_player", new_callable=AsyncMock
        ) as mock_send:
            await handle_player_action(
                "NONEXISTENT", "player_1", {"action": "place_tile", "tile": "1A"}
            )
            mock_send.assert_not_called()


class TestConfigureRoomEndpoint:
    """Tests for the /room/{code}/configure endpoint."""

    def test_configure_room_sets_seed(self, client, clean_session_manager):
        """Create a room, configure it with a seed, and verify it takes effect."""
        # Create a room (first player is added automatically)
        response = client.post("/create", data={"player_name": "Alice"})
        assert response.status_code == 200
        room_code = response.json()["room_code"]

        # Join 2 more players so game can start (3 total)
        for name in ["Bob", "Charlie"]:
            client.post("/join", data={"room_code": room_code, "player_name": name})

        # Configure the room with a seed
        response = client.post(
            f"/room/{room_code}/configure",
            json={"seed": 42},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "configured"

        # Verify seed was stored on the room
        room = clean_session_manager.get_room(room_code)
        assert room.seed == 42

    def test_configure_room_rejects_after_start(self, client, clean_session_manager):
        """Configuring a room after the game has started should return 400."""
        # Create a room and add players
        response = client.post("/create", data={"player_name": "Alice"})
        room_code = response.json()["room_code"]

        for name in ["Bob", "Charlie"]:
            client.post("/join", data={"room_code": room_code, "player_name": name})

        # Start the game
        client.post(f"/room/{room_code}/start")

        # Try to configure after start
        response = client.post(
            f"/room/{room_code}/configure",
            json={"seed": 42},
        )
        assert response.status_code == 400
        assert "started" in response.json()["detail"].lower()

    def test_configure_room_not_found(self, client, clean_session_manager):
        """Configuring a non-existent room should return 404."""
        response = client.post(
            "/room/ZZZZ/configure",
            json={"seed": 42},
        )
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()


def test_validation_uses_the_ruleset_passed_for_the_game_not_the_server_default():
    from game.ruleset import load_ruleset

    mini = load_ruleset("mini")
    # server default is default: a 4-share buy is refused and juniper (not in
    # mini) is a chain...
    ok, err = validate_websocket_message({"action": "found_chain", "chain": "juniper"})
    assert err is None and ok.chain == "juniper"
    _, err = validate_websocket_message(
        {"action": "buy_stocks", "purchases": {"sandpiper": 4}}
    )
    assert "more than 3" in err
    # ...but under mini a 4-share buy is legal and juniper is no chain
    ok, err = validate_websocket_message(
        {"action": "found_chain", "chain": "sandpiper"}, mini
    )
    assert err is None and ok.chain == "sandpiper"
    _, err = validate_websocket_message(
        {"action": "buy_stocks", "purchases": {"sandpiper": 4}}, mini
    )
    assert err is None
    _, err = validate_websocket_message(
        {"action": "found_chain", "chain": "juniper"}, mini
    )
    assert "Invalid chain" in err
    _, err = validate_websocket_message({"action": "place_tile", "tile": "10A"}, mini)
    assert err and "Invalid tile" in err
