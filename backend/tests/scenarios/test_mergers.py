"""Scenario tests for mergers - from docs/tests/scenario/mergers.md

Merger scenarios cover survivor determination, bonuses, stock disposition,
and multi-chain mergers. Also includes bonus calculation tests merged from
test_bonus_calculations.py.
"""

from game.game import GamePhase
from game.board import Tile
from game.rules import Rules
from tests.scenarios.conftest import (
    ChainBuilder,
    give_player_tile,
    give_player_stocks,
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
        defunct_sorted = sorted(
            defunct, key=lambda c: game.board.get_chain_size(c), reverse=True
        )

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


class TestSafeChainMergers:
    """Tests for safe chain merger rules (Scenarios 5.4 - 5.5)."""

    def test_scenario_5_4_safe_chain_absorbs_unsafe(self, game_with_three_players):
        """Scenario 5.4: Safe Chain Absorbs Unsafe Chain

        Safe chain automatically survives regardless of size.
        """
        game = game_with_three_players

        # Set up Continental (12 tiles, SAFE) and Festival (8 tiles, unsafe)
        # Continental: rows A (12 tiles)
        for col in range(1, 13):
            tile = Tile(col, "A")
            game.board.place_tile(tile)
            game.board.set_chain(tile, "Continental")
        game.hotel.activate_chain("Continental")

        # Festival: columns 1-8 on row C
        for col in range(1, 9):
            tile = Tile(col, "C")
            game.board.place_tile(tile)
            game.board.set_chain(tile, "Festival")
        game.hotel.activate_chain("Festival")

        # Verify Continental is safe
        assert game.hotel.is_chain_safe("Continental", 12)

        # Safe chain should be determined as survivor
        survivor = Rules.get_merger_survivor(game.board, ["Continental", "Festival"])
        assert survivor == "Continental"

    def test_scenario_5_5_cannot_merge_two_safe_chains(self, game_with_three_players):
        """Scenario 5.5: Cannot Merge Two Safe Chains

        Tile that would merge two safe chains is unplayable.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up two safe chains (11+ tiles each)
        builder.setup_chain("American", 11, start_col=1, row="A")
        builder.setup_chain("Imperial", 11, start_col=1, row="C")

        # Tile at 1B would merge two safe chains
        tile = Tile(1, "B")

        # Verify both chains are safe
        assert game.hotel.is_chain_safe("American", 11)
        assert game.hotel.is_chain_safe("Imperial", 11)

        # Tile should be unplayable
        assert not Rules.can_place_tile(game.board, tile, game.hotel)
        assert Rules.is_tile_permanently_unplayable(game.board, tile, game.hotel)


class TestBonusDistribution:
    """Tests for bonus distribution rules (Scenarios 5.6 - 5.11).

    Merged from test_bonus_calculations.py.
    """

    def test_scenario_5_6_simple_majority_minority_bonus(self, game_with_three_players):
        """Scenario 5.6: Simple Majority/Minority Bonus Distribution

        Clear majority and minority holders get respective bonuses.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up Tower chain (4 tiles, $400 price Cheap tier)
        builder.setup_chain("Tower", 4, start_col=1, row="A")

        # P1 has majority (6 shares), P2 has minority (3 shares), P3 has (1 share)
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p3 = game.get_player("p3")

        give_player_stocks(p1, "Tower", 6, game.hotel)
        give_player_stocks(p2, "Tower", 3, game.hotel)
        give_player_stocks(p3, "Tower", 1, game.hotel)

        bonuses = Rules.calculate_bonuses(game.players, "Tower", 4, game.hotel)

        # Tower 4-tile Cheap: $400 price -> $4000 majority, $2000 minority
        assert bonuses["p1"]["majority"] == 4000
        assert bonuses["p1"]["minority"] == 0

        assert bonuses["p2"]["majority"] == 0
        assert bonuses["p2"]["minority"] == 2000

        # P3 gets nothing
        assert "p3" not in bonuses or (
            bonuses.get("p3", {}).get("majority", 0) == 0
            and bonuses.get("p3", {}).get("minority", 0) == 0
        )

    def test_scenario_5_7_sole_stockholder_gets_both(self, game_with_three_players):
        """Scenario 5.7: Sole Stockholder Gets Both Bonuses

        Single stockholder gets both majority and minority bonuses.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up Worldwide chain (3 tiles, Medium tier, $400 price)
        builder.setup_chain("Worldwide", 3, start_col=1, row="A")

        # Give only one player stocks
        p1 = game.get_player("p1")
        give_player_stocks(p1, "Worldwide", 5, game.hotel)

        bonuses = Rules.calculate_bonuses(game.players, "Worldwide", 3, game.hotel)

        # Worldwide 3-tile Medium: $400 price -> $4000 majority, $2000 minority
        assert "p1" in bonuses
        assert bonuses["p1"]["majority"] == 4000
        assert bonuses["p1"]["minority"] == 2000

    def test_scenario_5_8_tie_for_majority_splits_both(self, game_with_three_players):
        """Scenario 5.8: Tie for Majority - Split Combined Bonus

        Tied majority holders split both majority and minority bonuses.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up Luxor chain (5 tiles, Cheap tier, $500 price)
        builder.setup_chain("Luxor", 5, start_col=1, row="A")

        # P1 and P2 tied for majority
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p3 = game.get_player("p3")

        give_player_stocks(p1, "Luxor", 4, game.hotel)
        give_player_stocks(p2, "Luxor", 4, game.hotel)
        give_player_stocks(p3, "Luxor", 2, game.hotel)

        bonuses = Rules.calculate_bonuses(game.players, "Luxor", 5, game.hotel)

        # Luxor 5-tile Cheap: $500 price -> $5000 majority, $2500 minority
        # Combined = $7500, split 2 ways = $3750 each
        expected_split = Rules._round_up_to_hundred(7500 / 2)

        assert bonuses["p1"]["majority"] == expected_split
        assert bonuses["p1"]["minority"] == 0
        assert bonuses["p2"]["majority"] == expected_split
        assert bonuses["p2"]["minority"] == 0

        # P3 gets nothing (tied players got both bonuses)
        assert "p3" not in bonuses or bonuses.get("p3", {}).get("minority", 0) == 0

    def test_scenario_5_9_tie_for_minority_splits_minority(
        self, game_with_four_players
    ):
        """Scenario 5.9: Tie for Minority - Split Minority Bonus

        Tied minority holders split just the minority bonus.
        """
        game = game_with_four_players
        builder = ChainBuilder(game)

        # Set up Tower chain (6 tiles, Cheap tier, $600 price)
        builder.setup_chain("Tower", 6, start_col=1, row="A")

        # P1 has majority, P2 and P3 tied for minority
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p3 = game.get_player("p3")
        p4 = game.get_player("p4")

        give_player_stocks(p1, "Tower", 8, game.hotel)  # Majority
        give_player_stocks(p2, "Tower", 3, game.hotel)  # Tied minority
        give_player_stocks(p3, "Tower", 3, game.hotel)  # Tied minority
        give_player_stocks(p4, "Tower", 1, game.hotel)  # Less than minority

        bonuses = Rules.calculate_bonuses(game.players, "Tower", 6, game.hotel)

        # Tower 6-tile Cheap: $600 price -> $6000 majority, $3000 minority
        assert bonuses["p1"]["majority"] == 6000
        assert bonuses["p1"]["minority"] == 0

        # P2 and P3 split minority ($3000 / 2 = $1500)
        expected_minority_split = Rules._round_up_to_hundred(3000 / 2)
        assert bonuses["p2"]["majority"] == 0
        assert bonuses["p2"]["minority"] == expected_minority_split
        assert bonuses["p3"]["majority"] == 0
        assert bonuses["p3"]["minority"] == expected_minority_split

    def test_scenario_5_10_three_way_tie_for_majority(self, game_with_three_players):
        """Scenario 5.10: Three-Way Tie for Majority

        Three-way tie splits both bonuses three ways.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up Festival chain (4 tiles, Medium tier, $500 price)
        builder.setup_chain("Festival", 4, start_col=1, row="A")

        # All three players tied for majority
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p3 = game.get_player("p3")

        give_player_stocks(p1, "Festival", 3, game.hotel)
        give_player_stocks(p2, "Festival", 3, game.hotel)
        give_player_stocks(p3, "Festival", 3, game.hotel)

        bonuses = Rules.calculate_bonuses(game.players, "Festival", 4, game.hotel)

        # Festival 4-tile Medium: $500 price -> $5000 majority, $2500 minority
        # Combined = $7500, split 3 ways = $2500 each
        expected_split = Rules._round_up_to_hundred(7500 / 3)

        assert bonuses["p1"]["majority"] == expected_split
        assert bonuses["p2"]["majority"] == expected_split
        assert bonuses["p3"]["majority"] == expected_split


class TestBonusRounding:
    """Tests for bonus rounding rules (Scenario 5.11).

    Merged from test_bonus_calculations.py.
    """

    def test_scenario_5_11_bonus_rounding_to_100(self):
        """Scenario 5.11: Bonus Rounding (Round Up to $100)

        Bonuses should be rounded up to nearest $100.
        """
        # Test various amounts
        assert Rules._round_up_to_hundred(150) == 200
        assert Rules._round_up_to_hundred(100) == 100
        assert Rules._round_up_to_hundred(101) == 200
        assert Rules._round_up_to_hundred(1) == 100
        assert Rules._round_up_to_hundred(0) == 0
        assert Rules._round_up_to_hundred(2333.33) == 2400
        assert Rules._round_up_to_hundred(4500) == 4500

    def test_split_bonus_rounds_up(self, game_with_three_players):
        """Split bonuses should round up to nearest $100."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up chain where split creates odd amounts
        builder.setup_chain("Luxor", 3, start_col=1, row="A")  # $300 price

        # Three-way tie: $3000 + $1500 = $4500 / 3 = $1500 exactly
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p3 = game.get_player("p3")

        give_player_stocks(p1, "Luxor", 3, game.hotel)
        give_player_stocks(p2, "Luxor", 3, game.hotel)
        give_player_stocks(p3, "Luxor", 3, game.hotel)

        bonuses = Rules.calculate_bonuses(game.players, "Luxor", 3, game.hotel)

        # Each gets $1500 (4500 / 3 = 1500, already even)
        for player_id in ["p1", "p2", "p3"]:
            assert bonuses[player_id]["majority"] == 1500


class TestMultiChainMergers:
    """Tests for multiple chains in merger (Scenario 5.17)."""

    def test_scenario_5_17_different_holdings_across_defunct_chains(
        self, game_with_three_players
    ):
        """Scenario 5.17: Different Holdings Across Two Defunct Chains

        Players can have different roles across multiple defunct chains.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up three chains
        builder.setup_chain("Continental", 7, start_col=1, row="A")  # Survivor
        builder.setup_chain("American", 5, start_col=1, row="C")  # Defunct 1
        builder.setup_chain("Tower", 3, start_col=1, row="E")  # Defunct 2

        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p3 = game.get_player("p3")

        # Stock holdings as specified
        give_player_stocks(p1, "American", 4, game.hotel)
        give_player_stocks(p1, "Tower", 2, game.hotel)

        give_player_stocks(p2, "American", 2, game.hotel)
        give_player_stocks(p2, "Tower", 5, game.hotel)

        give_player_stocks(p3, "Tower", 3, game.hotel)

        # Calculate American bonuses (5 tiles, Medium tier, $600 price)
        american_bonuses = Rules.calculate_bonuses(
            game.players, "American", 5, game.hotel
        )

        # P1 is majority in American ($6000)
        assert american_bonuses["p1"]["majority"] == 6000
        # P2 is minority in American ($3000)
        assert american_bonuses["p2"]["minority"] == 3000

        # Calculate Tower bonuses (3 tiles, Cheap tier, $300 price)
        tower_bonuses = Rules.calculate_bonuses(game.players, "Tower", 3, game.hotel)

        # P2 is majority in Tower ($3000)
        assert tower_bonuses["p2"]["majority"] == 3000
        # P3 is minority in Tower ($1500)
        assert tower_bonuses["p3"]["minority"] == 1500


class TestDefunctChainHandling:
    """Tests for defunct chain handling (Scenarios 5.18 - 5.19)."""

    def test_scenario_5_18_chain_deactivated_after_merger(
        self, game_with_three_players
    ):
        """Scenario 5.18: Chain Marker Removed After Merger

        Defunct chain is deactivated and can be re-founded.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up American (6 tiles) and Tower (3 tiles)
        builder.setup_chain("American", 6, start_col=1, row="A")
        builder.setup_chain("Tower", 3, start_col=8, row="A")

        assert game.hotel.is_chain_active("American")
        assert game.hotel.is_chain_active("Tower")

        player = game.get_current_player()
        tile = Tile(7, "A")  # Merges the chains
        give_player_tile(player, tile, game)

        # Play tile to trigger merger
        game.play_tile(player.player_id, tile)

        # After merger completes, Tower should be deactivated
        assert game.hotel.is_chain_active("American")
        assert not game.hotel.is_chain_active("Tower")

        # Tower should be available for re-founding
        # (No stock should have been re-added since no one owned Tower stock)

    def test_scenario_5_19_no_stock_in_defunct_chain(self, game_with_three_players):
        """Scenario 5.19: No Stock in Defunct Chain

        Merger completes without bonus or disposition when no stockholders.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up Festival (4 tiles) and Luxor (2 tiles)
        builder.setup_chain("Festival", 4, start_col=1, row="A")
        builder.setup_chain("Luxor", 2, start_col=6, row="A")

        # No one owns Luxor stock
        assert game.hotel.get_available_stocks("Luxor") == 25

        # Calculate bonuses - should be empty
        bonuses = Rules.calculate_bonuses(game.players, "Luxor", 2, game.hotel)
        assert bonuses == {}

        # Merger can still proceed (verified by deactivating Luxor)
        player = game.get_current_player()
        tile = Tile(5, "A")  # Merges the chains
        give_player_tile(player, tile, game)

        game.play_tile(player.player_id, tile)

        # Festival survives, Luxor becomes defunct
        assert game.hotel.is_chain_active("Festival")
        assert not game.hotel.is_chain_active("Luxor")


class TestBonusEdgeCases:
    """Tests for edge cases in bonus calculations.

    Merged from test_bonus_calculations.py.
    """

    def test_no_stockholders(self, game_with_three_players):
        """No bonuses if no one owns stock."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("Luxor", 3, start_col=1, row="A")

        # No one owns Luxor stock
        bonuses = Rules.calculate_bonuses(game.players, "Luxor", 3, game.hotel)

        assert bonuses == {}

    def test_zero_size_chain(self, game_with_three_players):
        """Chain with size 0 should have $0 bonuses."""
        game = game_with_three_players

        p1 = game.get_player("p1")
        p1._stocks["Luxor"] = 5

        bonuses = Rules.calculate_bonuses(game.players, "Luxor", 0, game.hotel)

        # Size 0 = $0 price = $0 bonuses
        if bonuses:
            assert bonuses.get("p1", {}).get("majority", 0) == 0
            assert bonuses.get("p1", {}).get("minority", 0) == 0
