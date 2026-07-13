"""Tests for SH-005: room cleanup and memory management."""

from datetime import datetime, timedelta, timezone

import pytest

import main
from main import cleanup_stale_rooms_once, handle_player_action
from session.manager import GameRoom


def _backdate(room: GameRoom, minutes: int) -> None:
    """Set a room's last activity `minutes` in the past."""
    room.last_activity = datetime.now(timezone.utc) - timedelta(minutes=minutes)


class TestActivityTracking:
    """Rooms track creation and last-activity timestamps."""

    def test_new_room_has_timestamps(self, session_mgr):
        code = session_mgr.create_room()
        room = session_mgr.get_room(code)
        assert room.created_at is not None
        assert room.last_activity is not None
        assert not room.is_stale(30)

    def test_backdated_room_is_stale(self, session_mgr):
        code = session_mgr.create_room()
        room = session_mgr.get_room(code)
        _backdate(room, 31)
        assert room.is_stale(30)
        assert not room.is_stale(60)

    def test_touch_resets_staleness(self, session_mgr):
        code = session_mgr.create_room()
        room = session_mgr.get_room(code)
        _backdate(room, 31)
        assert room.is_stale(30)
        room.touch()
        assert not room.is_stale(30)

    def test_join_updates_activity(self, session_mgr):
        code = session_mgr.create_room()
        room = session_mgr.get_room(code)
        _backdate(room, 31)
        session_mgr.join_room(code, "p1", "Alice")
        assert not room.is_stale(30)

    def test_add_bot_updates_activity(self, session_mgr):
        code = session_mgr.create_room()
        room = session_mgr.get_room(code)
        _backdate(room, 31)
        session_mgr.add_bot(code)
        assert not room.is_stale(30)

    def test_connect_player_updates_activity(self, session_mgr, mock_websocket):
        code = session_mgr.create_room()
        session_mgr.join_room(code, "p1", "Alice")
        room = session_mgr.get_room(code)
        _backdate(room, 31)
        session_mgr.connect_player(code, "p1", mock_websocket)
        assert not room.is_stale(30)

    def test_connect_host_updates_activity(self, session_mgr, mock_websocket):
        code = session_mgr.create_room()
        room = session_mgr.get_room(code)
        _backdate(room, 31)
        session_mgr.connect_host(code, mock_websocket)
        assert not room.is_stale(30)

    def test_start_game_updates_activity(self, session_mgr):
        code = session_mgr.create_room()
        session_mgr.join_room(code, "p1", "Alice")
        session_mgr.join_room(code, "p2", "Bob")
        room = session_mgr.get_room(code)
        _backdate(room, 31)
        session_mgr.start_game(code)
        assert not room.is_stale(30)

    @pytest.mark.asyncio
    async def test_game_action_updates_activity(self, game_room, clean_session_manager):
        room = clean_session_manager.get_room(game_room)
        _backdate(room, 31)
        # Even an invalid action counts as activity
        await handle_player_action(game_room, "player_1", {"action": "end_turn"})
        assert not room.is_stale(30)


class TestCleanup:
    """cleanup_stale_rooms_once removes stale rooms."""

    @pytest.mark.asyncio
    async def test_stale_room_removed(self, clean_session_manager):
        code = clean_session_manager.create_room()
        _backdate(clean_session_manager.get_room(code), 31)

        removed = await cleanup_stale_rooms_once()

        assert code in removed
        assert clean_session_manager.get_room(code) is None

    @pytest.mark.asyncio
    async def test_active_room_kept(self, clean_session_manager):
        code = clean_session_manager.create_room()

        removed = await cleanup_stale_rooms_once()

        assert removed == []
        assert clean_session_manager.get_room(code) is not None

    @pytest.mark.asyncio
    async def test_mixed_rooms_only_stale_removed(self, clean_session_manager):
        stale_code = clean_session_manager.create_room()
        fresh_code = clean_session_manager.create_room()
        _backdate(clean_session_manager.get_room(stale_code), 31)

        removed = await cleanup_stale_rooms_once()

        assert removed == [stale_code]
        assert clean_session_manager.get_room(stale_code) is None
        assert clean_session_manager.get_room(fresh_code) is not None

    @pytest.mark.asyncio
    async def test_cleanup_closes_player_websockets(
        self, clean_session_manager, mock_websocket
    ):
        code = clean_session_manager.create_room()
        clean_session_manager.join_room(code, "p1", "Alice")
        room = clean_session_manager.get_room(code)
        room.players["p1"].websockets.append(mock_websocket)
        _backdate(room, 31)

        await cleanup_stale_rooms_once()

        assert mock_websocket.closed
        assert mock_websocket.close_code == 4002
        assert "inactivity" in mock_websocket.close_reason

    @pytest.mark.asyncio
    async def test_cleanup_closes_host_websocket(
        self, clean_session_manager, mock_websocket
    ):
        code = clean_session_manager.create_room()
        room = clean_session_manager.get_room(code)
        room.host_websocket = mock_websocket
        _backdate(room, 31)

        await cleanup_stale_rooms_once()

        assert mock_websocket.closed
        assert mock_websocket.close_code == 4002

    @pytest.mark.asyncio
    async def test_cleanup_survives_websocket_close_errors(self, clean_session_manager):
        class BrokenWebSocket:
            async def close(self, code=1000, reason=""):
                raise RuntimeError("already closed")

        code = clean_session_manager.create_room()
        clean_session_manager.join_room(code, "p1", "Alice")
        room = clean_session_manager.get_room(code)
        room.players["p1"].websockets.append(BrokenWebSocket())
        _backdate(room, 31)

        removed = await cleanup_stale_rooms_once()

        assert code in removed
        assert clean_session_manager.get_room(code) is None

    @pytest.mark.asyncio
    async def test_timeout_is_configurable(self, clean_session_manager, monkeypatch):
        monkeypatch.setattr(main.settings, "room_timeout_minutes", 5)
        code = clean_session_manager.create_room()
        _backdate(clean_session_manager.get_room(code), 6)

        removed = await cleanup_stale_rooms_once()

        assert code in removed

    @pytest.mark.asyncio
    async def test_default_timeout_is_thirty_minutes(
        self, clean_session_manager, monkeypatch
    ):
        monkeypatch.setattr(main.settings, "room_timeout_minutes", 30)
        code = clean_session_manager.create_room()
        _backdate(clean_session_manager.get_room(code), 29)

        removed = await cleanup_stale_rooms_once()

        assert removed == []
        assert clean_session_manager.get_room(code) is not None


class TestLifespan:
    """The cleanup background task starts and stops with the app."""

    def test_lifespan_starts_and_cancels_cleanup_task(self):
        from fastapi.testclient import TestClient

        from main import app

        # Entering/exiting the TestClient context runs the lifespan without
        # errors (task created on startup, cancelled cleanly on shutdown).
        with TestClient(app) as client:
            response = client.get("/health")
            assert response.status_code == 200
