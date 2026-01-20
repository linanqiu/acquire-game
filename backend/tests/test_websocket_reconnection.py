"""WebSocket reconnection tests (BH-011).

Tests for disconnect/reconnect handling in the session manager.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock

from session.manager import SessionManager


class TestDisconnectHandling:
    """Tests for handling WebSocket disconnections."""

    def test_disconnect_removes_websocket(self):
        """Disconnecting removes the specific websocket."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")

        ws = MagicMock()
        manager.connect_player(code, "p1", ws)
        manager.disconnect(code, "p1", ws)

        room = manager.get_room(code)
        assert ws not in room.players["p1"].websockets

    def test_disconnect_keeps_player_in_room(self):
        """Disconnecting doesn't remove player from room."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")
        manager.join_room(code, "p2", "Bob")

        ws = MagicMock()
        manager.connect_player(code, "p1", ws)
        manager.disconnect(code, "p1", ws)

        room = manager.get_room(code)
        assert "p1" in room.players
        assert room.players["p1"].name == "Alice"

    def test_multiple_connections_one_disconnect(self):
        """Disconnecting one connection keeps others."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")

        ws1 = MagicMock()
        ws2 = MagicMock()
        manager.connect_player(code, "p1", ws1)
        manager.connect_player(code, "p1", ws2)

        manager.disconnect(code, "p1", ws1)

        room = manager.get_room(code)
        assert ws1 not in room.players["p1"].websockets
        assert ws2 in room.players["p1"].websockets

    def test_disconnect_nonexistent_websocket_no_error(self):
        """Disconnecting non-connected websocket doesn't raise."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")

        ws = MagicMock()
        manager.disconnect(code, "p1", ws)  # Never connected, should not raise

    def test_disconnect_nonexistent_player_no_error(self):
        """Disconnecting nonexistent player doesn't raise."""
        manager = SessionManager()
        code = manager.create_room()

        ws = MagicMock()
        manager.disconnect(code, "nonexistent", ws)  # Should not raise

    def test_disconnect_from_nonexistent_room_no_error(self):
        """Disconnecting from nonexistent room doesn't raise."""
        manager = SessionManager()

        ws = MagicMock()
        manager.disconnect("XXXX", "p1", ws)  # Should not raise


class TestReconnection:
    """Tests for player reconnection."""

    def test_reconnect_with_new_websocket(self):
        """Player can connect new websocket after disconnect."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")

        # First connection
        ws1 = MagicMock()
        manager.connect_player(code, "p1", ws1)

        # Disconnect
        manager.disconnect(code, "p1", ws1)

        # Reconnect with new websocket
        ws2 = MagicMock()
        manager.connect_player(code, "p1", ws2)

        room = manager.get_room(code)
        assert ws2 in room.players["p1"].websockets

    def test_session_token_still_valid_after_disconnect(self):
        """Session token remains valid after disconnect."""
        manager = SessionManager()
        code = manager.create_room()
        token = manager.join_room(code, "p1", "Alice")

        ws = MagicMock()
        manager.connect_player(code, "p1", ws)
        manager.disconnect(code, "p1", ws)

        # Token should still be valid
        is_valid = manager.validate_session_token(code, "p1", token)
        assert is_valid is True

    def test_invalid_token_fails_validation(self):
        """Invalid token fails validation."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")

        is_valid = manager.validate_session_token(code, "p1", "invalid-token")
        assert is_valid is False


class TestMultipleReconnections:
    """Tests for multiple disconnect/reconnect cycles."""

    def test_multiple_reconnections_same_player(self):
        """Player can disconnect and reconnect multiple times."""
        manager = SessionManager()
        code = manager.create_room()
        token = manager.join_room(code, "p1", "Alice")

        for i in range(5):
            ws = MagicMock()
            manager.connect_player(code, "p1", ws)

            # Verify connected
            room = manager.get_room(code)
            assert ws in room.players["p1"].websockets

            # Disconnect
            manager.disconnect(code, "p1", ws)

            # Verify disconnected
            assert ws not in room.players["p1"].websockets

            # Token still valid
            assert manager.validate_session_token(code, "p1", token)

    def test_all_players_disconnect_and_reconnect(self):
        """All players can disconnect and reconnect."""
        manager = SessionManager()
        code = manager.create_room()

        tokens = {}
        for i, name in enumerate(["Alice", "Bob", "Carol"]):
            pid = f"p{i + 1}"
            tokens[pid] = manager.join_room(code, pid, name)

        # Connect all
        websockets = {}
        for pid in tokens:
            ws = MagicMock()
            manager.connect_player(code, pid, ws)
            websockets[pid] = ws

        # Disconnect all
        for pid, ws in websockets.items():
            manager.disconnect(code, pid, ws)

        room = manager.get_room(code)

        # All disconnected but still in room
        for pid in tokens:
            assert pid in room.players
            assert len(room.players[pid].websockets) == 0

        # Reconnect all
        for pid in tokens:
            new_ws = MagicMock()
            manager.connect_player(code, pid, new_ws)

        # All reconnected
        for pid in tokens:
            assert len(room.players[pid].websockets) == 1


class TestConnectionState:
    """Tests for connection state tracking."""

    def test_player_with_no_websockets_still_in_room(self):
        """Player with no active websockets is still in room."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")

        # Never connect a websocket
        room = manager.get_room(code)
        assert "p1" in room.players
        assert len(room.players["p1"].websockets) == 0

    def test_player_has_websocket_after_connect(self):
        """Player has websocket after connecting."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")

        ws = MagicMock()
        manager.connect_player(code, "p1", ws)

        room = manager.get_room(code)
        assert len(room.players["p1"].websockets) == 1


class TestBroadcastAfterReconnect:
    """Tests for broadcasting after reconnection."""

    @pytest.mark.asyncio
    async def test_reconnected_player_receives_broadcasts(self):
        """Reconnected player receives broadcast messages."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")

        # Connect
        ws1 = AsyncMock()
        manager.connect_player(code, "p1", ws1)

        # Disconnect
        manager.disconnect(code, "p1", ws1)

        # Reconnect with new socket
        ws2 = AsyncMock()
        manager.connect_player(code, "p1", ws2)

        # Broadcast
        await manager.broadcast_to_room(code, {"type": "test"})

        ws2.send_json.assert_called_once_with({"type": "test"})

    @pytest.mark.asyncio
    async def test_disconnected_player_not_in_broadcast(self):
        """Disconnected player doesn't receive broadcasts."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")
        manager.join_room(code, "p2", "Bob")

        # Connect p1
        ws1 = AsyncMock()
        manager.connect_player(code, "p1", ws1)

        # Connect p2
        ws2 = AsyncMock()
        manager.connect_player(code, "p2", ws2)

        # Disconnect p1
        manager.disconnect(code, "p1", ws1)

        # Broadcast
        await manager.broadcast_to_room(code, {"type": "test"})

        # Only p2 receives
        ws1.send_json.assert_not_called()
        ws2.send_json.assert_called_once_with({"type": "test"})

    @pytest.mark.asyncio
    async def test_send_to_player_works_after_reconnect(self):
        """Private messages work after reconnection."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")

        # Connect
        ws1 = AsyncMock()
        manager.connect_player(code, "p1", ws1)

        # Disconnect
        manager.disconnect(code, "p1", ws1)

        # Reconnect
        ws2 = AsyncMock()
        manager.connect_player(code, "p1", ws2)

        # Send private message
        await manager.send_to_player(code, "p1", {"type": "private"})

        ws2.send_json.assert_called_once_with({"type": "private"})


class TestHostReconnection:
    """Tests for host reconnection scenarios."""

    def test_host_disconnect_keeps_host_status(self):
        """Host maintains host status after disconnect."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")  # First player is host
        manager.join_room(code, "p2", "Bob")

        ws = MagicMock()
        manager.connect_player(code, "p1", ws)
        manager.disconnect(code, "p1", ws)

        room = manager.get_room(code)
        assert room.players["p1"].is_host is True

    def test_host_websocket_reconnect(self):
        """Host display websocket can reconnect."""
        manager = SessionManager()
        code = manager.create_room()

        # Connect host display
        ws1 = MagicMock()
        manager.connect_host(code, ws1)

        room = manager.get_room(code)
        assert room.host_websocket == ws1

        # Reconnect with new socket
        ws2 = MagicMock()
        manager.connect_host(code, ws2)

        assert room.host_websocket == ws2
