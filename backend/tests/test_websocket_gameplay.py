"""WebSocket gameplay integration tests.

These tests verify the WebSocket handlers in main.py work correctly
for game flow without requiring a browser.
"""

import pytest
from unittest.mock import AsyncMock, patch

from app_state import session_manager
from broadcast import broadcast_game_state
from lifecycle import handle_player_action, initialize_game
from game.game import GamePhase


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
        assert len(game.turn_order) == 3  # 3 players
        assert game.phase == GamePhase.PLAYING
        assert game.get_public_state()["phase"] == "place_tile"

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

        initial_turn_index = game.current_player_index
        current_player_id = game.get_current_player_id()
        player = game.get_player(current_player_id)
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
                    if game.get_public_state()["phase"] == "buy_stocks":
                        await handle_player_action(
                            game_room,
                            current_player_id,
                            {"action": "buy_stocks", "purchases": {}},
                        )

        # Turn should have advanced
        new_turn_index = game.current_player_index
        assert new_turn_index != initial_turn_index, (
            f"Turn index should have changed from {initial_turn_index}"
        )

    @pytest.mark.asyncio
    async def test_turn_wraps_around(self, game_room, clean_session_manager):
        """Turn should wrap from last player to first player."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        # Set to last player
        num_players = len(game.turn_order)
        game.current_player_index = num_players - 1

        last_player_id = game.turn_order[num_players - 1]
        player = game.get_player(last_player_id)
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

                    if game.get_public_state()["phase"] == "buy_stocks":
                        await handle_player_action(
                            game_room,
                            last_player_id,
                            {"action": "buy_stocks", "purchases": {}},
                        )

        # Should wrap to first player
        assert game.current_player_index == 0


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

        current_player_id = game.get_current_player_id()
        player = game.get_player(current_player_id)
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


class TestWebSocketExceptionHandling:
    """Tests for WebSocket exception handling robustness.

    These tests verify that the WebSocket handler properly handles errors
    and keeps connections alive, preventing silent disconnections.
    """

    @pytest.mark.asyncio
    async def test_invalid_action_sends_error(
        self, game_room, clean_session_manager, mock_websocket
    ):
        """Invalid actions should send error message, not crash."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        current_player_id = game.get_current_player_id()
        room.players[current_player_id].websockets.append(mock_websocket)

        # Invalid action gets caught by validation
        await handle_player_action(
            game_room,
            current_player_id,
            {"action": "invalid_action_that_does_not_exist"},
        )

        # Should have received an error message
        assert len(mock_websocket.sent_messages) == 1
        assert mock_websocket.sent_messages[0]["type"] == "error"

    @pytest.mark.asyncio
    async def test_wrong_turn_player_sends_error(
        self, game_room, clean_session_manager, mock_websocket
    ):
        """Actions from wrong player should send error message."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        # Get a player who is NOT the current player
        current_player_id = game.get_current_player_id()
        other_player_ids = [pid for pid in game.turn_order if pid != current_player_id]
        wrong_player_id = other_player_ids[0]

        room.players[wrong_player_id].websockets.append(mock_websocket)

        wrong_player = game.get_player(wrong_player_id)
        tile = wrong_player.hand[0]

        # Try to place tile when it's not their turn
        await handle_player_action(
            game_room,
            wrong_player_id,
            {"action": "place_tile", "tile": str(tile)},
        )

        # Should have received an error message
        assert len(mock_websocket.sent_messages) == 1
        assert mock_websocket.sent_messages[0]["type"] == "error"
        assert "turn" in mock_websocket.sent_messages[0]["message"].lower()

    @pytest.mark.asyncio
    async def test_invalid_tile_sends_error(
        self, game_room, clean_session_manager, mock_websocket
    ):
        """Placing a tile not in hand should send error message."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        current_player_id = game.get_current_player_id()
        room.players[current_player_id].websockets.append(mock_websocket)
        player = game.get_player(current_player_id)

        # Find a tile NOT in the player's hand
        player_tile_strs = {str(t) for t in player.hand}
        invalid_tile = next(
            f"{c}{r}"
            for c in range(1, 13)
            for r in "ABCDEFGHI"
            if f"{c}{r}" not in player_tile_strs
        )

        # Try to place a tile not in hand
        await handle_player_action(
            game_room,
            current_player_id,
            {"action": "place_tile", "tile": invalid_tile},
        )

        # Should have received an error message
        assert len(mock_websocket.sent_messages) == 1
        assert mock_websocket.sent_messages[0]["type"] == "error"

    @pytest.mark.asyncio
    async def test_error_message_sent_to_player(
        self, game_room, clean_session_manager, mock_websocket
    ):
        """When action fails, error message should be sent to player."""
        room = clean_session_manager.get_room(game_room)

        # Connect a mock websocket to the player
        current_player_id = room.game.get_current_player_id()
        room.players[current_player_id].websockets.append(mock_websocket)

        # Send error message
        await session_manager.send_to_player(
            game_room,
            current_player_id,
            {"type": "error", "message": "Test error message"},
        )

        # Verify error was sent
        assert len(mock_websocket.sent_messages) == 1
        assert mock_websocket.sent_messages[0]["type"] == "error"
        assert "Test error message" in mock_websocket.sent_messages[0]["message"]

    @pytest.mark.asyncio
    async def test_game_continues_after_exception(
        self, game_room, clean_session_manager
    ):
        """Game state should remain valid after an exception is raised."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        initial_phase = game.get_public_state()["phase"]
        initial_player = game.get_current_player_id()

        # Try an invalid action (will raise exception)
        try:
            await handle_player_action(
                game_room,
                initial_player,
                {"action": "invalid_action"},
            )
        except Exception:
            pass  # Exception is expected

        # Game state should be unchanged
        assert game.get_public_state()["phase"] == initial_phase
        assert game.get_current_player_id() == initial_player
        assert room.game is not None  # Game still exists

    @pytest.mark.asyncio
    async def test_multiple_errors_dont_corrupt_state(
        self, game_room, clean_session_manager
    ):
        """Multiple consecutive errors should not corrupt game state."""
        room = clean_session_manager.get_room(game_room)
        game = room.game

        current_player_id = game.get_current_player_id()

        # Send multiple invalid actions
        for i in range(5):
            try:
                await handle_player_action(
                    game_room,
                    current_player_id,
                    {"action": f"invalid_action_{i}"},
                )
            except Exception:
                pass  # Expected

        # Game should still be in valid state
        assert game.get_public_state()["phase"] == "place_tile"
        assert game.get_current_player_id() == current_player_id

        # Valid action should still work
        player = game.get_player(current_player_id)
        tile = player.hand[0]

        with patch.object(session_manager, "send_to_player", new_callable=AsyncMock):
            with patch.object(session_manager, "send_to_host", new_callable=AsyncMock):
                with patch.object(
                    session_manager, "broadcast_to_room", new_callable=AsyncMock
                ):
                    await handle_player_action(
                        game_room,
                        current_player_id,
                        {"action": "place_tile", "tile": str(tile)},
                    )

        # Action should have been processed
        assert (
            game.get_public_state()["phase"] != "place_tile"
            or game.current_player_index != 0
        )
