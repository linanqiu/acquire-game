"""Session Manager tests (BH-009).

Tests for room lifecycle, player management, and connection handling.
"""

import pytest
from unittest.mock import MagicMock, AsyncMock

from session.manager import SessionManager


class TestRoomCreation:
    """Tests for room creation."""

    def test_create_room_returns_code(self):
        """Creating room returns 4-letter code."""
        manager = SessionManager()
        code = manager.create_room()

        assert len(code) == 4
        assert code.isalpha()
        assert code.isupper()

    def test_create_room_stores_room(self):
        """Created room is stored and retrievable."""
        manager = SessionManager()
        code = manager.create_room()

        room = manager.get_room(code)
        assert room is not None
        assert room.room_code == code

    def test_create_multiple_rooms_unique_codes(self):
        """Multiple rooms get unique codes."""
        manager = SessionManager()
        codes = set()

        for i in range(100):
            code = manager.create_room()
            codes.add(code)

        assert len(codes) == 100  # All unique

    def test_room_starts_empty(self):
        """Newly created room has no players."""
        manager = SessionManager()
        code = manager.create_room()

        room = manager.get_room(code)
        assert len(room.players) == 0

    def test_room_not_started_by_default(self):
        """Room starts in not-started state."""
        manager = SessionManager()
        code = manager.create_room()

        room = manager.get_room(code)
        assert room.started is False


class TestPlayerJoining:
    """Tests for players joining rooms."""

    def test_player_can_join_room(self):
        """Player can join existing room."""
        manager = SessionManager()
        code = manager.create_room()

        result = manager.join_room(code, "player_1", "Alice")

        assert result is True
        room = manager.get_room(code)
        assert "player_1" in room.players
        assert room.players["player_1"].name == "Alice"

    def test_first_player_is_host(self):
        """First player to join becomes host."""
        manager = SessionManager()
        code = manager.create_room()

        manager.join_room(code, "player_1", "Alice")

        room = manager.get_room(code)
        assert room.players["player_1"].is_host is True

    def test_second_player_not_host(self):
        """Second player is not host."""
        manager = SessionManager()
        code = manager.create_room()

        manager.join_room(code, "player_1", "Alice")
        manager.join_room(code, "player_2", "Bob")

        room = manager.get_room(code)
        assert room.players["player_2"].is_host is False

    def test_join_nonexistent_room_fails(self):
        """Joining nonexistent room fails."""
        manager = SessionManager()

        result = manager.join_room("XXXX", "player_1", "Bob")

        assert result is False

    def test_join_started_game_fails(self):
        """Cannot join room after game started."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")
        manager.join_room(code, "p2", "Bob")

        manager.start_game(code)

        result = manager.join_room(code, "player_3", "Carol")
        assert result is False

    def test_duplicate_player_id_fails(self):
        """Same player ID cannot join twice."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "player_1", "Alice")

        result = manager.join_room(code, "player_1", "Bob")

        assert result is False

    def test_duplicate_name_fails(self):
        """Same name cannot join twice (case-insensitive)."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "player_1", "Alice")

        result = manager.join_room(code, "player_2", "ALICE")

        assert result is False

    def test_max_players_enforced(self):
        """Cannot exceed max players."""
        manager = SessionManager()
        code = manager.create_room()

        # Join 6 players
        for i in range(6):
            manager.join_room(code, f"player_{i}", f"Player{i}")

        # 7th should fail
        result = manager.join_room(code, "player_7", "Player7")
        assert result is False


class TestPlayerLeaving:
    """Tests for players leaving rooms."""

    def test_player_can_leave_room(self):
        """Player can leave room."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "player_1", "Alice")

        manager.leave_room(code, "player_1")

        room = manager.get_room(code)
        assert room is None  # Room deleted when empty

    def test_host_leaving_transfers_host(self):
        """When host leaves, another player becomes host."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "player_1", "Alice")
        manager.join_room(code, "player_2", "Bob")

        manager.leave_room(code, "player_1")

        room = manager.get_room(code)
        assert room.players["player_2"].is_host is True

    def test_leave_nonexistent_room_no_error(self):
        """Leaving nonexistent room doesn't raise."""
        manager = SessionManager()

        manager.leave_room("XXXX", "player_1")  # Should not raise

    def test_empty_room_deleted(self):
        """Room is deleted when last player leaves."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "player_1", "Alice")

        manager.leave_room(code, "player_1")

        assert manager.get_room(code) is None


class TestBotPlayers:
    """Tests for bot player management."""

    def test_add_bot_to_room(self):
        """Can add bot player to room."""
        manager = SessionManager()
        code = manager.create_room()

        bot_id = manager.add_bot(code)

        assert bot_id is not None
        room = manager.get_room(code)
        assert bot_id in room.players
        assert room.players[bot_id].is_bot is True

    def test_bot_gets_auto_name(self):
        """Bot gets automatic name."""
        manager = SessionManager()
        code = manager.create_room()

        bot_id = manager.add_bot(code)

        room = manager.get_room(code)
        assert room.players[bot_id].name == "Bot 1"

    def test_bot_names_increment(self):
        """Bot names increment correctly."""
        manager = SessionManager()
        code = manager.create_room()

        bot1_id = manager.add_bot(code)
        bot2_id = manager.add_bot(code)

        room = manager.get_room(code)
        assert room.players[bot1_id].name == "Bot 1"
        assert room.players[bot2_id].name == "Bot 2"

    def test_bot_counts_toward_player_limit(self):
        """Bots count toward maximum player limit."""
        manager = SessionManager()
        code = manager.create_room()

        # Add 6 bots to reach limit
        for i in range(6):
            manager.add_bot(code)

        # 7th should fail
        result = manager.add_bot(code)
        assert result is None

    def test_cannot_add_bot_to_started_game(self):
        """Cannot add bot after game started."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")
        manager.join_room(code, "p2", "Bob")
        manager.start_game(code)

        result = manager.add_bot(code)

        assert result is None


class TestConnectionManagement:
    """Tests for WebSocket connection management."""

    def test_connect_player_websocket(self):
        """Can connect websocket to player."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "player_1", "Alice")

        ws = MagicMock()
        manager.connect_player(code, "player_1", ws)

        room = manager.get_room(code)
        assert ws in room.players["player_1"].websockets

    def test_player_can_have_multiple_connections(self):
        """Same player can have multiple websocket connections."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "player_1", "Alice")

        ws1 = MagicMock()
        ws2 = MagicMock()
        manager.connect_player(code, "player_1", ws1)
        manager.connect_player(code, "player_1", ws2)

        room = manager.get_room(code)
        assert len(room.players["player_1"].websockets) == 2

    def test_disconnect_removes_websocket(self):
        """Disconnect removes specific websocket."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "player_1", "Alice")

        ws1 = MagicMock()
        ws2 = MagicMock()
        manager.connect_player(code, "player_1", ws1)
        manager.connect_player(code, "player_1", ws2)

        manager.disconnect(code, "player_1", ws1)

        room = manager.get_room(code)
        assert ws1 not in room.players["player_1"].websockets
        assert ws2 in room.players["player_1"].websockets

    def test_connect_host_websocket(self):
        """Can connect host display websocket."""
        manager = SessionManager()
        code = manager.create_room()

        ws = MagicMock()
        manager.connect_host(code, ws)

        room = manager.get_room(code)
        assert room.host_websocket == ws


class TestGameStart:
    """Tests for game start functionality."""

    def test_start_game_with_enough_players(self):
        """Can start game with minimum players."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")
        manager.join_room(code, "p2", "Bob")

        result = manager.start_game(code)

        assert result is True
        room = manager.get_room(code)
        assert room.started is True

    def test_cannot_start_with_one_player(self):
        """Cannot start game with only one player."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")

        result = manager.start_game(code)

        assert result is False
        room = manager.get_room(code)
        assert room.started is False

    def test_cannot_start_nonexistent_room(self):
        """Cannot start nonexistent room."""
        manager = SessionManager()

        result = manager.start_game("XXXX")

        assert result is False

    def test_cannot_start_already_started(self):
        """Cannot start already started game."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")
        manager.join_room(code, "p2", "Bob")
        manager.start_game(code)

        result = manager.start_game(code)

        assert result is False


class TestRoomDeletion:
    """Tests for room deletion."""

    def test_delete_room(self):
        """Can delete a room."""
        manager = SessionManager()
        code = manager.create_room()

        manager.delete_room(code)

        assert manager.get_room(code) is None

    def test_delete_nonexistent_room_no_error(self):
        """Deleting nonexistent room doesn't raise."""
        manager = SessionManager()

        manager.delete_room("XXXX")  # Should not raise


class TestBroadcasting:
    """Tests for message broadcasting."""

    @pytest.mark.asyncio
    async def test_broadcast_to_room(self):
        """Can broadcast message to room."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")
        manager.join_room(code, "p2", "Bob")

        ws1 = AsyncMock()
        ws2 = AsyncMock()
        manager.connect_player(code, "p1", ws1)
        manager.connect_player(code, "p2", ws2)

        await manager.broadcast_to_room(code, {"type": "test"})

        ws1.send_json.assert_called_once_with({"type": "test"})
        ws2.send_json.assert_called_once_with({"type": "test"})

    @pytest.mark.asyncio
    async def test_send_to_player(self):
        """Can send message to specific player."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")
        manager.join_room(code, "p2", "Bob")

        ws1 = AsyncMock()
        ws2 = AsyncMock()
        manager.connect_player(code, "p1", ws1)
        manager.connect_player(code, "p2", ws2)

        await manager.send_to_player(code, "p1", {"type": "private"})

        ws1.send_json.assert_called_once_with({"type": "private"})
        ws2.send_json.assert_not_called()

    @pytest.mark.asyncio
    async def test_send_to_host(self):
        """Can send message to host display."""
        manager = SessionManager()
        code = manager.create_room()

        ws = AsyncMock()
        manager.connect_host(code, ws)

        await manager.send_to_host(code, {"type": "host_message"})

        ws.send_json.assert_called_once_with({"type": "host_message"})

    @pytest.mark.asyncio
    async def test_broadcast_skips_bots(self):
        """Broadcast doesn't send to bot players."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")
        manager.add_bot(code)  # Add a bot to verify it doesn't receive broadcasts

        ws = AsyncMock()
        manager.connect_player(code, "p1", ws)

        await manager.broadcast_to_room(code, {"type": "test"})

        # Only human player receives
        ws.send_json.assert_called_once()

    @pytest.mark.asyncio
    async def test_broadcast_handles_dead_connection(self):
        """Broadcast removes dead connections."""
        manager = SessionManager()
        code = manager.create_room()
        manager.join_room(code, "p1", "Alice")

        ws = AsyncMock()
        ws.send_json.side_effect = Exception("Connection closed")
        manager.connect_player(code, "p1", ws)

        await manager.broadcast_to_room(code, {"type": "test"})

        room = manager.get_room(code)
        assert ws not in room.players["p1"].websockets
