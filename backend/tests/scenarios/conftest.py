"""Shared fixtures for scenario-based tests."""

import pytest

from game.game import Game
from game.board import Tile
from game.hotel import Hotel
from game.player import Player


@pytest.fixture
def game_with_two_players():
    """Fresh game with 3 players, started (MIN_PLAYERS=3)."""
    game = Game(seed=42)
    game.add_player("p1", "Alice")
    game.add_player("p2", "Bob")
    game.add_player("p3", "Charlie")
    game.start_game()
    return game


@pytest.fixture
def game_with_three_players():
    """Fresh game with 3 players, started."""
    game = Game(seed=42)
    game.add_player("p1", "Alice")
    game.add_player("p2", "Bob")
    game.add_player("p3", "Charlie")
    game.start_game()
    return game


@pytest.fixture
def game_with_four_players():
    """Fresh game with 4 players, started."""
    game = Game(seed=42)
    game.add_player("p1", "Alice")
    game.add_player("p2", "Bob")
    game.add_player("p3", "Charlie")
    game.add_player("p4", "Diana")
    game.start_game()
    return game


@pytest.fixture
def game_with_six_players():
    """Fresh game with 6 players, started."""
    game = Game(seed=42)
    game.add_player("p1", "Alice")
    game.add_player("p2", "Bob")
    game.add_player("p3", "Charlie")
    game.add_player("p4", "Diana")
    game.add_player("p5", "Eve")
    game.add_player("p6", "Frank")
    game.start_game()
    return game


@pytest.fixture
def game_in_lobby():
    """Game in lobby state (not started)."""
    game = Game(seed=42)
    return game


class ChainBuilder:
    """Helper class to set up chains on a board."""

    def __init__(self, game: Game):
        self.game = game

    def setup_chain(
        self, chain_name: str, size: int, start_col: int = 1, row: str = "A"
    ) -> list[Tile]:
        """Set up a chain of given size.

        Args:
            chain_name: Name of the chain to create
            size: Number of tiles in the chain
            start_col: Starting column (1-12)
            row: Row letter (A-I)

        Returns:
            List of tiles placed
        """
        tiles = []
        for i in range(size):
            tile = Tile(start_col + i, row)
            self.game.board.place_tile(tile)
            self.game.board.set_chain(tile, chain_name)
            tiles.append(tile)
        self.game.hotel.activate_chain(chain_name)
        return tiles

    def setup_lone_tiles(self, positions: list[tuple[int, str]]) -> list[Tile]:
        """Place tiles without assigning to any chain.

        Args:
            positions: List of (column, row) tuples

        Returns:
            List of tiles placed
        """
        tiles = []
        for col, row in positions:
            tile = Tile(col, row)
            self.game.board.place_tile(tile)
            tiles.append(tile)
        return tiles


@pytest.fixture
def chain_builder(game_with_two_players):
    """Chain builder for game with two players."""
    return ChainBuilder(game_with_two_players)


@pytest.fixture
def fresh_chain_builder():
    """Factory for creating chain builders with custom games."""

    def _make_builder(game: Game) -> ChainBuilder:
        return ChainBuilder(game)

    return _make_builder


def give_player_stocks(player: Player, chain_name: str, count: int, hotel: Hotel):
    """Helper to give a player stocks in a chain."""
    for _ in range(count):
        if hotel.get_available_stocks(chain_name) > 0:
            hotel.buy_stock(chain_name)
            player.add_stocks(chain_name, 1)


def give_player_tile(player: Player, tile: Tile, game: Game):
    """Helper to give a player a specific tile."""
    # Remove a tile from hand to make room if needed
    if player.hand_size >= Player.MAX_HAND_SIZE:
        player.remove_tile(player.hand[0])
    player.add_tile(tile)


def set_current_player(game: Game, player_id: str):
    """Helper to set a specific player as current."""
    for i, p in enumerate(game.players):
        if p.player_id == player_id:
            game.current_player_index = i
            return
    raise ValueError(f"Player {player_id} not found")
