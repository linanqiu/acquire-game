"""Tests for tile placement rules and results."""

from game.game import GamePhase
from game.board import Tile, TileState
from game.rules import Rules, UnplayableReason
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
        chains = [
            "Luxor",
            "Tower",
            "American",
            "Worldwide",
            "Festival",
            "Imperial",
            "Continental",
        ]
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


class TestTilePlayability:
    """Tests for tile playability details (BH-006)."""

    def test_playable_tile_returns_playable_true(self, game_with_two_players):
        """A playable tile should return playable: True."""
        game = game_with_two_players
        tile = Tile(6, "E")  # Empty location with no adjacent tiles

        result = Rules.get_tile_playability(game.board, tile, game.hotel)

        assert result["playable"] is True
        assert result["reason"] is None
        assert result["permanent"] is None
        assert result["would_trigger_merger"] is False

    def test_tile_between_safe_chains_returns_merge_reason(self, game_with_two_players):
        """A tile between two safe chains should show merge reason."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up two safe chains
        builder.setup_chain("Luxor", 11, start_col=1, row="A")
        builder.setup_chain("Tower", 11, start_col=1, row="C")

        # 1B would merge them
        tile = Tile(1, "B")

        result = Rules.get_tile_playability(game.board, tile, game.hotel)

        assert result["playable"] is False
        assert result["reason"] == UnplayableReason.MERGE_SAFE_CHAINS.value
        assert result["permanent"] is False  # Could become playable if chains merge
        assert result["would_trigger_merger"] is True

    def test_tile_creating_8th_chain_returns_eighth_chain_reason(
        self, game_with_two_players
    ):
        """A tile that would create an 8th chain should show reason."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Activate all 7 chains
        chains = [
            "Luxor",
            "Tower",
            "American",
            "Worldwide",
            "Festival",
            "Imperial",
            "Continental",
        ]
        row_letters = ["A", "B", "C", "D", "E", "F", "G"]
        for i, chain in enumerate(chains):
            builder.setup_chain(chain, 2, start_col=1, row=row_letters[i])

        # Place a lone tile
        game.board.place_tile(Tile(10, "I"))

        # 11I adjacent to 10I would try to found an 8th chain
        tile = Tile(11, "I")

        result = Rules.get_tile_playability(game.board, tile, game.hotel)

        assert result["playable"] is False
        assert result["reason"] == UnplayableReason.EIGHTH_CHAIN.value
        assert (
            result["permanent"] is True
        )  # Permanently unplayable while 7 chains exist
        assert result["would_trigger_merger"] is False

    def test_get_tiles_playability_returns_dict_for_all_tiles(
        self, game_with_two_players
    ):
        """get_tiles_playability should return info for all provided tiles."""
        game = game_with_two_players
        player = game.get_current_player()

        result = Rules.get_tiles_playability(game.board, player.hand, game.hotel)

        # Should have entry for each tile in hand
        assert len(result) == len(player.hand)

        # Each tile should have playability info
        for tile_str, info in result.items():
            assert "playable" in info
            assert "reason" in info
            assert "permanent" in info
            assert "would_trigger_merger" in info

    def test_player_state_includes_tile_playability(self, game_with_two_players):
        """get_player_state should include tile_playability field."""
        game = game_with_two_players
        player = game.get_current_player()

        state = game.get_player_state(player.player_id)

        assert "tile_playability" in state
        assert isinstance(state["tile_playability"], dict)

        # Should have same tiles as hand
        assert len(state["tile_playability"]) == len(state["hand"])

        # Each tile in hand should have playability info
        for tile_str in state["hand"]:
            assert tile_str in state["tile_playability"]

    def test_playability_shows_correct_reasons_in_player_state(
        self, game_with_two_players
    ):
        """Player state should show correct playability reasons."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up two safe chains
        builder.setup_chain("Luxor", 11, start_col=1, row="A")
        builder.setup_chain("Tower", 11, start_col=1, row="C")

        # Give player a tile that would merge them
        player = game.get_current_player()
        blocking_tile = Tile(1, "B")
        give_player_tile(player, blocking_tile, game)

        state = game.get_player_state(player.player_id)

        # The blocking tile should show as unplayable
        assert "1B" in state["tile_playability"]
        assert state["tile_playability"]["1B"]["playable"] is False
        assert state["tile_playability"]["1B"]["reason"] == "would_merge_safe_chains"

    def test_tile_adjacent_to_single_safe_chain_is_playable(
        self, game_with_two_players
    ):
        """A tile adjacent to only one safe chain should be playable."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up one safe chain
        builder.setup_chain("Luxor", 11, start_col=1, row="A")

        # Tile adjacent to only Luxor
        tile = Tile(12, "A")

        result = Rules.get_tile_playability(game.board, tile, game.hotel)

        assert result["playable"] is True

    def test_tile_between_safe_and_unsafe_chain_is_playable(
        self, game_with_two_players
    ):
        """A tile between a safe and unsafe chain should be playable."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up one safe chain and one unsafe chain
        builder.setup_chain("Luxor", 11, start_col=1, row="A")  # Safe
        builder.setup_chain("Tower", 5, start_col=1, row="C")  # Unsafe

        # Tile between them
        tile = Tile(1, "B")

        result = Rules.get_tile_playability(game.board, tile, game.hotel)

        assert result["playable"] is True
        assert result["would_trigger_merger"] is True  # Would merge safe and unsafe

    def test_tile_between_two_unsafe_chains_triggers_merger(
        self, game_with_two_players
    ):
        """A tile between two unsafe chains should be playable and flag merger."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up two small (unsafe) chains
        builder.setup_chain("Luxor", 3, start_col=1, row="A")  # Unsafe
        builder.setup_chain("Tower", 3, start_col=1, row="C")  # Unsafe

        # Tile between them
        tile = Tile(1, "B")

        result = Rules.get_tile_playability(game.board, tile, game.hotel)

        assert result["playable"] is True
        assert result["would_trigger_merger"] is True

    def test_tile_adjacent_to_single_chain_no_merger(self, game_with_two_players):
        """A tile adjacent to only one chain should not trigger merger."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up one chain
        builder.setup_chain("Luxor", 5, start_col=1, row="A")

        # Tile adjacent to only Luxor (extends the chain, no merger)
        tile = Tile(6, "A")

        result = Rules.get_tile_playability(game.board, tile, game.hotel)

        assert result["playable"] is True
        assert result["would_trigger_merger"] is False
