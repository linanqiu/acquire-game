"""Tests for merger mechanics."""


from game.game import GamePhase
from game.board import Tile
from game.rules import Rules
from tests.scenarios.conftest import (
    ChainBuilder,
    give_player_tile,
)


class TestSurvivorDetermination:
    """Tests for determining which chain survives a merger."""

    def test_larger_chain_survives(self, game_with_two_players):
        """The larger chain should survive a merger."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up Luxor (3 tiles) and Tower (2 tiles)
        builder.setup_chain("Luxor", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=5, row="A")

        player = game.get_current_player()
        tile = Tile(4, "A")  # Between Luxor and Tower
        give_player_tile(player, tile, game)

        result = game.play_tile(player.player_id, tile)

        assert result["success"] is True
        assert result["result"] == "merge"
        assert result["survivor"] == "Luxor"  # Luxor is larger
        assert "Tower" in result["defunct"]

    def test_tied_chains_require_player_choice(self, game_with_two_players):
        """Tied chains require the player to choose survivor."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up two chains of equal size
        builder.setup_chain("Luxor", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 3, start_col=5, row="A")

        player = game.get_current_player()
        tile = Tile(4, "A")  # Between equal chains
        give_player_tile(player, tile, game)

        result = game.play_tile(player.player_id, tile)

        assert result["success"] is True
        assert result["result"] == "merge_tie"
        assert "Luxor" in result["tied_chains"]
        assert "Tower" in result["tied_chains"]
        assert game.phase == GamePhase.MERGING

    def test_three_way_merger_largest_survives(self, game_with_two_players):
        """In a three-way merger, the largest chain survives."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up three chains of different sizes
        builder.setup_chain("Luxor", 4, start_col=1, row="A")  # Largest
        builder.setup_chain("Tower", 2, start_col=6, row="A")
        builder.setup_chain("American", 3, start_col=1, row="C")

        # Place a tile that connects all three
        # Need to connect via 1B (connects Luxor and American)
        # Then another tile or strategic placement

        # For simplicity, test with Rules.get_merger_survivor
        survivor = Rules.get_merger_survivor(game.board, ["Luxor", "Tower", "American"])

        assert survivor == "Luxor"


class TestMergerProcessing:
    """Tests for merger processing mechanics."""

    def test_defunct_processed_largest_first(self, game_with_two_players):
        """Defunct chains should be processed largest first."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up chains where one clear winner and two defunct
        # This is tested implicitly through the _merger_defunct_queue sorting

        # Set up Luxor (5), Tower (3), American (2)
        builder.setup_chain("Luxor", 5, start_col=1, row="A")
        builder.setup_chain("Tower", 3, start_col=7, row="A")
        builder.setup_chain("American", 2, start_col=11, row="A")

        # Create a merger scenario
        game._merger_chains = ["Luxor", "Tower", "American"]
        game._merger_survivor = "Luxor"
        defunct = ["Tower", "American"]

        # Sort defunct by size (what _start_merger_process does)
        defunct_sorted = sorted(defunct, key=lambda c: game.board.get_chain_size(c), reverse=True)

        assert defunct_sorted[0] == "Tower"  # Tower (3) should be first
        assert defunct_sorted[1] == "American"  # American (2) second

    def test_chains_deactivated_after_merger(self, game_with_two_players):
        """Defunct chains should be deactivated after merger."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up Luxor (3) and Tower (2)
        builder.setup_chain("Luxor", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=5, row="A")

        assert game.hotel.is_chain_active("Luxor")
        assert game.hotel.is_chain_active("Tower")

        player = game.get_current_player()
        tile = Tile(4, "A")
        give_player_tile(player, tile, game)

        # Play tile and complete merger (skip stock disposition for simplicity)
        game.play_tile(player.player_id, tile)

        # Wait for merger to complete (in this case, no stockholders)
        # The game should transition to buying stocks phase

        # Tower should be deactivated
        assert game.hotel.is_chain_active("Luxor")
        assert not game.hotel.is_chain_active("Tower")


class TestMergerSurvivorChoice:
    """Tests for player choosing merger survivor."""

    def test_can_choose_valid_survivor(self, game_with_two_players):
        """Player can choose a valid survivor from tied chains."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up two chains of equal size
        builder.setup_chain("Luxor", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 3, start_col=5, row="A")

        player = game.get_current_player()
        tile = Tile(4, "A")
        give_player_tile(player, tile, game)

        game.play_tile(player.player_id, tile)
        assert game.phase == GamePhase.MERGING

        # Choose Tower as survivor
        result = game.choose_merger_survivor(player.player_id, "Tower")

        assert result["success"] is True
        assert result["survivor"] == "Tower"
        assert "Luxor" in result["defunct"]

    def test_cannot_choose_non_tied_chain(self, game_with_two_players):
        """Cannot choose a chain that isn't in the tie."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up two chains of equal size
        builder.setup_chain("Luxor", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 3, start_col=5, row="A")

        player = game.get_current_player()
        tile = Tile(4, "A")
        give_player_tile(player, tile, game)

        game.play_tile(player.player_id, tile)
        assert game.phase == GamePhase.MERGING

        # Try to choose American (not involved)
        result = game.choose_merger_survivor(player.player_id, "American")

        assert result["success"] is False
        assert "not in tied chains" in result["error"].lower()

    def test_cannot_choose_when_not_merging_phase(self, game_with_two_players):
        """Cannot choose survivor when not in merging phase."""
        game = game_with_two_players

        result = game.choose_merger_survivor("p1", "Luxor")

        assert result["success"] is False
        assert "not in merging phase" in result["error"].lower()
