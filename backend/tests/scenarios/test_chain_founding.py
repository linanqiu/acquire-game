"""Tests for chain founding mechanics."""

import pytest

from game.game import Game, GamePhase
from game.board import Tile
from game.hotel import Hotel
from tests.scenarios.conftest import (
    ChainBuilder,
    give_player_tile,
    give_player_stocks,
    set_current_player,
)


class TestChainFounding:
    """Tests for founding new hotel chains."""

    def test_founder_receives_free_stock(self, game_with_two_players):
        """Founder should receive one free stock when founding a chain."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Place a lone tile
        builder.setup_lone_tiles([(5, "C")])

        player = game.get_current_player()
        initial_luxor_stock = player.get_stock_count("Luxor")

        # Give player a tile adjacent to the lone tile
        tile = Tile(5, "D")
        give_player_tile(player, tile, game)

        # Play the tile to trigger founding
        game.play_tile(player.player_id, tile)
        assert game.phase == GamePhase.FOUNDING_CHAIN

        # Found Luxor
        result = game.found_chain(player.player_id, "Luxor")

        assert result["success"] is True
        assert result["founder_bonus"] is True
        assert player.get_stock_count("Luxor") == initial_luxor_stock + 1

    def test_all_connected_tiles_join_chain(self, game_with_two_players):
        """All tiles connected to the founding tile should join the chain."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Place multiple lone tiles in a connected group
        builder.setup_lone_tiles([(5, "C"), (5, "D"), (6, "D")])

        player = game.get_current_player()

        # Give player a tile that connects to the group
        tile = Tile(6, "C")
        give_player_tile(player, tile, game)

        # Play the tile to trigger founding
        game.play_tile(player.player_id, tile)
        assert game.phase == GamePhase.FOUNDING_CHAIN

        # Found Tower
        game.found_chain(player.player_id, "Tower")

        # All tiles should now be part of Tower
        for col, row in [(5, "C"), (5, "D"), (6, "C"), (6, "D")]:
            assert game.board.get_cell(col, row).chain == "Tower"

    def test_no_stock_if_none_available(self, game_with_two_players):
        """Founder gets no stock if chain has no available stocks."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Exhaust all Luxor stocks
        game.hotel._available_stocks["Luxor"] = 0

        # Place a lone tile
        builder.setup_lone_tiles([(5, "C")])

        player = game.get_current_player()
        initial_stock = player.get_stock_count("Luxor")

        # Give player a tile adjacent to the lone tile
        tile = Tile(5, "D")
        give_player_tile(player, tile, game)

        # Play the tile to trigger founding
        game.play_tile(player.player_id, tile)

        # Found Luxor
        result = game.found_chain(player.player_id, "Luxor")

        assert result["success"] is True
        assert player.get_stock_count("Luxor") == initial_stock  # No change

    def test_available_chains_offered(self, game_with_two_players):
        """Only inactive chains should be offered for founding."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Activate some chains first
        builder.setup_chain("Luxor", 2, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=1, row="C")

        # Place lone tiles for founding
        builder.setup_lone_tiles([(10, "H")])

        player = game.get_current_player()
        tile = Tile(10, "I")
        give_player_tile(player, tile, game)

        # Play the tile to trigger founding
        result = game.play_tile(player.player_id, tile)

        assert result["success"] is True
        assert result["result"] == "found"

        # Luxor and Tower should NOT be in available chains
        assert "Luxor" not in result["available_chains"]
        assert "Tower" not in result["available_chains"]

        # Other chains should be available
        assert "American" in result["available_chains"]
        assert "Worldwide" in result["available_chains"]


class TestFoundChainValidation:
    """Tests for chain founding validation."""

    def test_cannot_found_active_chain(self, game_with_two_players):
        """Cannot found a chain that is already active."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Activate Luxor
        builder.setup_chain("Luxor", 2, start_col=1, row="A")

        # Set up for founding
        builder.setup_lone_tiles([(10, "H")])

        player = game.get_current_player()
        tile = Tile(10, "I")
        give_player_tile(player, tile, game)

        game.play_tile(player.player_id, tile)

        # Try to found already active Luxor
        result = game.found_chain(player.player_id, "Luxor")

        assert result["success"] is False
        assert "not available" in result["error"].lower()

    def test_cannot_found_when_not_in_founding_phase(self, game_with_two_players):
        """Cannot found a chain when not in founding phase."""
        game = game_with_two_players

        result = game.found_chain("p1", "Luxor")

        assert result["success"] is False
        assert "not in founding" in result["error"].lower()

    def test_cannot_found_wrong_players_turn(self, game_with_two_players):
        """Cannot found a chain when it's not your turn."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up for founding
        builder.setup_lone_tiles([(10, "H")])

        current_player = game.get_current_player()
        other_player_id = "p2" if current_player.player_id == "p1" else "p1"

        tile = Tile(10, "I")
        give_player_tile(current_player, tile, game)

        game.play_tile(current_player.player_id, tile)
        assert game.phase == GamePhase.FOUNDING_CHAIN

        # Try to found as wrong player
        result = game.found_chain(other_player_id, "Luxor")

        assert result["success"] is False
        assert "not your turn" in result["error"].lower()
