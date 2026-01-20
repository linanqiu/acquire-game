"""Pytest fixtures for Acquire board game tests."""

import pytest
from fastapi.testclient import TestClient

from main import app, session_manager
from session.manager import SessionManager
from game.board import Board, Tile
from game.hotel import Hotel
from game.player import Player
from game.game import Game


@pytest.fixture
def client():
    """Create FastAPI test client."""
    return TestClient(app)


@pytest.fixture
def clean_session_manager():
    """Reset session manager before each test."""
    # Clear all rooms
    session_manager._rooms.clear()
    yield session_manager
    # Cleanup after test
    session_manager._rooms.clear()


@pytest.fixture
def session_mgr():
    """Create a fresh SessionManager instance."""
    return SessionManager()


@pytest.fixture
def board():
    """Create a fresh game board."""
    return Board()


@pytest.fixture
def hotel():
    """Create a fresh hotel manager."""
    return Hotel()


@pytest.fixture
def player():
    """Create a test player."""
    return Player("test_player_1", "Test Player 1")


@pytest.fixture
def players():
    """Create multiple test players."""
    return [
        Player("player_1", "Alice"),
        Player("player_2", "Bob"),
        Player("player_3", "Charlie"),
    ]


@pytest.fixture
def tile_1a():
    """Tile at 1A."""
    return Tile(1, "A")


@pytest.fixture
def tile_2a():
    """Tile at 2A."""
    return Tile(2, "A")


@pytest.fixture
def tile_3a():
    """Tile at 3A."""
    return Tile(3, "A")


@pytest.fixture
def tile_1b():
    """Tile at 1B."""
    return Tile(1, "B")


@pytest.fixture
def tile_1c():
    """Tile at 1C."""
    return Tile(1, "C")


@pytest.fixture
def room_code(clean_session_manager):
    """Create a room and return its code."""
    return clean_session_manager.create_room()


@pytest.fixture
def room_with_players(clean_session_manager):
    """Create a room with 3 players."""
    code = clean_session_manager.create_room()
    clean_session_manager.join_room(code, "player_1", "Alice")
    clean_session_manager.join_room(code, "player_2", "Bob")
    clean_session_manager.join_room(code, "player_3", "Charlie")
    return code


@pytest.fixture
def started_room(clean_session_manager):
    """Create a room with players and start the game."""
    code = clean_session_manager.create_room()
    clean_session_manager.join_room(code, "player_1", "Alice")
    clean_session_manager.join_room(code, "player_2", "Bob")
    clean_session_manager.join_room(code, "player_3", "Charlie")
    clean_session_manager.start_game(code)
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

    # Initialize game state using Game class (same as main.initialize_game)
    game = Game()
    for player_id, connection in room.players.items():
        game.add_player(player_id, connection.name, is_bot=connection.is_bot)
    game.start_game()

    room.game = game

    return code


@pytest.fixture
def board_with_chain(board, hotel):
    """Create a board with an active chain."""
    # Place tiles to form a chain
    tiles = [Tile(1, "A"), Tile(2, "A"), Tile(3, "A")]
    for tile in tiles:
        board.place_tile(tile)
        board.set_chain(tile, "Luxor")
    hotel.activate_chain("Luxor")
    return board


@pytest.fixture
def board_with_two_chains(board, hotel):
    """Create a board with two active chains."""
    # First chain: Luxor at 1A-3A
    luxor_tiles = [Tile(1, "A"), Tile(2, "A"), Tile(3, "A")]
    for tile in luxor_tiles:
        board.place_tile(tile)
        board.set_chain(tile, "Luxor")
    hotel.activate_chain("Luxor")

    # Second chain: Tower at 6A-8A
    tower_tiles = [Tile(6, "A"), Tile(7, "A"), Tile(8, "A")]
    for tile in tower_tiles:
        board.place_tile(tile)
        board.set_chain(tile, "Tower")
    hotel.activate_chain("Tower")

    return board


@pytest.fixture
def player_with_hand(player):
    """Create a player with tiles in hand."""
    tiles = [
        Tile(1, "A"),
        Tile(5, "C"),
        Tile(7, "E"),
        Tile(9, "G"),
        Tile(11, "I"),
        Tile(12, "B"),
    ]
    for tile in tiles:
        player.add_tile(tile)
    return player


@pytest.fixture
def player_with_stocks(player, hotel):
    """Create a player with stock holdings."""
    # Give player some stocks
    player._stocks["Luxor"] = 5
    player._stocks["Tower"] = 3
    player._stocks["American"] = 2
    hotel.activate_chain("Luxor")
    hotel.activate_chain("Tower")
    hotel.activate_chain("American")
    # Reduce available stocks accordingly
    hotel._available_stocks["Luxor"] -= 5
    hotel._available_stocks["Tower"] -= 3
    hotel._available_stocks["American"] -= 2
    return player


@pytest.fixture
def safe_chain_board(board, hotel):
    """Create a board with a safe chain (11+ tiles)."""
    # Create Luxor chain with 11 tiles (safe)
    for col in range(1, 12):
        tile = Tile(col, "A")
        board.place_tile(tile)
        board.set_chain(tile, "Luxor")
    hotel.activate_chain("Luxor")
    return board


@pytest.fixture
def merger_board(board, hotel):
    """Create a board set up for a merger scenario."""
    # Luxor chain: 1A, 2A, 3A (3 tiles)
    for col in range(1, 4):
        tile = Tile(col, "A")
        board.place_tile(tile)
        board.set_chain(tile, "Luxor")
    hotel.activate_chain("Luxor")

    # Tower chain: 5A, 6A (2 tiles)
    for col in range(5, 7):
        tile = Tile(col, "A")
        board.place_tile(tile)
        board.set_chain(tile, "Tower")
    hotel.activate_chain("Tower")

    # Gap at 4A - placing here would merge Luxor and Tower
    return board


@pytest.fixture
def game_state(board, hotel, players):
    """Create a complete game state dict."""
    import random

    tile_pool = Board.all_tiles()
    random.shuffle(tile_pool)

    # Deal tiles to players
    for player in players:
        for _ in range(6):
            if tile_pool:
                player.add_tile(tile_pool.pop())

    return {
        "board": board,
        "hotel": hotel,
        "players": {p.player_id: p for p in players},
        "tile_pool": tile_pool,
        "turn_order": [p.player_id for p in players],
        "current_turn_index": 0,
        "phase": "place_tile",
        "pending_action": None,
    }


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


class AsyncIterator:
    """Helper for async iteration in tests."""

    def __init__(self, items):
        self.items = items
        self.index = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.index >= len(self.items):
            raise StopAsyncIteration
        item = self.items[self.index]
        self.index += 1
        return item


@pytest.fixture
def async_iterator():
    """Create an async iterator factory for tests."""
    return AsyncIterator
