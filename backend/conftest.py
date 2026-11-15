"""Pytest fixtures for Buyout board game tests."""

import os
import tempfile

import pytest

# Every game the tests play writes a transcript: keep them out of the source
# tree. Each process (and, via the autouse fixture below, each TEST) gets its
# own directories, so tests never see each other's files, also under
# ``pytest -n auto`` (workers inherit the master's environment, hence the
# unconditional override in a worker).
if os.environ.get("PYTEST_XDIST_WORKER") or "GAME_TRANSCRIPT_DIR" not in os.environ:
    os.environ["GAME_TRANSCRIPT_DIR"] = tempfile.mkdtemp(
        prefix="game-test-transcripts-"
    )
if os.environ.get("PYTEST_XDIST_WORKER") or "GAME_BENCH_DIR" not in os.environ:
    os.environ["GAME_BENCH_DIR"] = tempfile.mkdtemp(prefix="game-test-bench-")
# A local ``frontend/dist`` (after ``npm run build``) must not change what the
# suite sees: without this the SPA fallback answers unknown bare paths with
# index.html. Static serving is tested with an explicit dist directory.
os.environ["FRONTEND_DIST"] = os.path.join(tempfile.gettempdir(), "no-frontend-dist")
from fastapi.testclient import TestClient

from main import app, session_manager
from game.game import Game


@pytest.fixture(autouse=True)
def isolated_data_dirs(tmp_path, monkeypatch):
    """Transcript and bench directories private to the running test (a test
    that needs specific ones sets the variables itself, after this)."""
    monkeypatch.setenv("GAME_TRANSCRIPT_DIR", str(tmp_path / "transcripts"))
    monkeypatch.setenv("GAME_BENCH_DIR", str(tmp_path / "bench"))


@pytest.fixture
def client():
    """Create FastAPI test client.

    Used as a context manager so every request shares one event loop: the
    seat driver runs as a background task on that loop.
    """
    with TestClient(app) as c:
        yield c


@pytest.fixture
def clean_session_manager():
    """Reset session manager before each test."""
    # Clear all rooms
    session_manager._rooms.clear()
    yield session_manager
    # Cleanup after test
    session_manager._rooms.clear()


@pytest.fixture
def room_with_players(clean_session_manager):
    """Create a room with 3 players."""
    code = clean_session_manager.create_room()
    clean_session_manager.join_room(code, "player_1", "Alice")
    clean_session_manager.join_room(code, "player_2", "Bob")
    clean_session_manager.join_room(code, "player_3", "Charlie")
    return code


@pytest.fixture
def game_room(clean_session_manager):
    """Create a room with players and fully initialized game state using Game class."""
    code = clean_session_manager.create_room()
    clean_session_manager.join_room(code, "player_1", "Alice")
    clean_session_manager.join_room(code, "player_2", "Bob")
    clean_session_manager.join_room(code, "player_3", "Charlie")
    clean_session_manager.start_game(code)

    room = clean_session_manager.get_room(code)

    # Initialize game state using Game class (same as main.initialize_game).
    # Seeded: tests must not depend on a lucky deal.
    game = Game(seed=7)
    for player_id, connection in room.players.items():
        game.add_player(player_id, connection.name, is_bot=connection.is_bot)
    game.start_game()

    room.game = game

    return code


@pytest.fixture
def mock_websocket():
    """Create a mock WebSocket for testing."""

    class MockWebSocket:
        def __init__(self):
            self.sent_messages = []
            self.accepted = False
            self.closed = False
            self.close_code = None
            self.close_reason = None

        async def accept(self):
            self.accepted = True

        async def send_json(self, data):
            self.sent_messages.append(data)

        async def receive_json(self):
            # For testing, this would be controlled by test
            pass

        async def close(self, code=1000, reason=""):
            self.closed = True
            self.close_code = code
            self.close_reason = reason

    return MockWebSocket()


@pytest.fixture
def mock_websockets():
    """Create multiple mock WebSockets."""

    class MockWebSocket:
        def __init__(self):
            self.sent_messages = []
            self.accepted = False

        async def accept(self):
            self.accepted = True

        async def send_json(self, data):
            self.sent_messages.append(data)

        async def close(self, code=1000, reason=""):
            pass

    return [MockWebSocket() for _ in range(4)]
