"""Tests for tile placement rules and results."""


from game.game import GamePhase
from game.board import Tile, TileState
from game.rules import Rules
from tests.scenarios.conftest import (
    ChainBuilder,
    give_player_tile,
)


class TestPlacementResults:
    """Tests for different placement results."""

    def test_isolated_tile_nothing(self, game_with_two_players):
        """Placing an isolated tile (no adjacent tiles) results in nothing."""
        game = game_with_two_players
        player = game.get_current_player()

        # Place a tile that has no adjacent played tiles
        tile = Tile(6, "E")  # Center of board, should be isolated
        give_player_tile(player, tile, game)

        result = game.play_tile(player.player_id, tile)

        assert result["success"] is True
        assert result["result"] == "nothing"
        assert game.board.get_cell(6, "E").state == TileState.PLAYED
        assert game.board.get_cell(6, "E").chain is None

    def test_adjacent_to_chain_expands(self, game_with_two_players):
        """Placing a tile adjacent to a chain expands it."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up a Luxor chain at 1A-2A
        builder.setup_chain("Luxor", 2, start_col=1, row="A")

        player = game.get_current_player()
        tile = Tile(3, "A")  # Adjacent to Luxor chain
        give_player_tile(player, tile, game)

        result = game.play_tile(player.player_id, tile)

        assert result["success"] is True
        assert result["result"] == "expand"
        assert result["chain"] == "Luxor"
        assert game.board.get_cell(3, "A").chain == "Luxor"

    def test_adjacent_to_played_tiles_founds(self, game_with_two_players):
        """Placing a tile adjacent to lone tiles triggers chain founding."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Place a lone tile (not part of any chain)
        builder.setup_lone_tiles([(5, "C")])

        player = game.get_current_player()
        tile = Tile(5, "D")  # Adjacent to lone tile at 5C
        give_player_tile(player, tile, game)

        result = game.play_tile(player.player_id, tile)

        assert result["success"] is True
        assert result["result"] == "found"
        assert "available_chains" in result
        assert len(result["available_chains"]) == 7  # All chains available
        assert game.phase == GamePhase.FOUNDING_CHAIN

    def test_between_two_chains_merges(self, game_with_two_players):
        """Placing a tile between two chains triggers a merger."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up Luxor at 1A-2A and Tower at 4A-5A
        builder.setup_chain("Luxor", 2, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=4, row="A")

        player = game.get_current_player()
        tile = Tile(3, "A")  # Between Luxor and Tower
        give_player_tile(player, tile, game)

        result = game.play_tile(player.player_id, tile)

        assert result["success"] is True
        # Could be merge or merge_tie depending on sizes
        assert result["result"] in ("merge", "merge_tie")


class TestPlacementValidation:
    """Tests for placement validation rules."""

    def test_cannot_place_on_occupied_cell(self, game_with_two_players):
        """Cannot place a tile on an already occupied cell."""
        game = game_with_two_players

        # Place a tile
        tile = Tile(5, "E")
        game.board.place_tile(tile)

        # Try to place on same spot
        player = game.get_current_player()
        give_player_tile(player, tile, game)

        result = game.play_tile(player.player_id, tile)

        assert result["success"] is False
        assert "cannot be placed" in result["error"].lower()

    def test_cannot_merge_two_safe_chains(self, game_with_two_players):
        """Cannot place a tile that would merge two safe (11+) chains."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up two safe chains
        builder.setup_chain("Luxor", 11, start_col=1, row="A")
        builder.setup_chain("Tower", 11, start_col=1, row="C")

        # 1B would connect them but both are safe
        player = game.get_current_player()
        tile = Tile(1, "B")
        give_player_tile(player, tile, game)

        # The tile should not be playable
        assert not Rules.can_place_tile(game.board, tile, game.hotel)

        result = game.play_tile(player.player_id, tile)
        assert result["success"] is False

    def test_can_merge_safe_plus_unsafe(self, game_with_two_players):
        """Can place a tile that merges a safe chain with an unsafe chain."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up one safe chain and one unsafe chain
        builder.setup_chain("Luxor", 11, start_col=1, row="A")  # Safe
        builder.setup_chain("Tower", 5, start_col=1, row="C")  # Unsafe

        # 1B would connect them - safe absorbs unsafe
        player = game.get_current_player()
        tile = Tile(1, "B")
        give_player_tile(player, tile, game)

        # The tile should be playable
        assert Rules.can_place_tile(game.board, tile, game.hotel)

    def test_cannot_create_8th_chain(self, game_with_two_players):
        """Cannot place a tile that would create an 8th chain when 7 exist."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Activate all 7 chains
        chains = ["Luxor", "Tower", "American", "Worldwide", "Festival", "Imperial", "Continental"]
        row_letters = ["A", "B", "C", "D", "E", "F", "G"]
        for i, chain in enumerate(chains):
            builder.setup_chain(chain, 2, start_col=1, row=row_letters[i])

        # Place two lone tiles that would form a new chain
        game.board.place_tile(Tile(10, "I"))

        # 11I adjacent to 10I would try to found an 8th chain
        player = game.get_current_player()
        tile = Tile(11, "I")
        give_player_tile(player, tile, game)

        # The tile should not be playable
        assert not Rules.can_place_tile(game.board, tile, game.hotel)


class TestTileFromString:
    """Tests for tile string parsing."""

    def test_single_digit_column(self):
        """Parse tiles with single digit columns."""
        tile = Tile.from_string("1A")
        assert tile.column == 1
        assert tile.row == "A"

    def test_double_digit_column(self):
        """Parse tiles with double digit columns."""
        tile = Tile.from_string("12I")
        assert tile.column == 12
        assert tile.row == "I"

    def test_lowercase_accepted(self):
        """Lowercase input should be accepted."""
        tile = Tile.from_string("5e")
        assert tile.column == 5
        assert tile.row == "E"

    def test_whitespace_stripped(self):
        """Whitespace should be stripped."""
        tile = Tile.from_string("  3B  ")
        assert tile.column == 3
        assert tile.row == "B"
