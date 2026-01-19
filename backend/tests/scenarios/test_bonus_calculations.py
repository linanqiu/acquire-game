"""Tests for majority/minority bonus calculations."""

from game.rules import Rules
from tests.scenarios.conftest import (
    ChainBuilder,
    give_player_stocks,
)


class TestBonusDistribution:
    """Tests for bonus distribution rules."""

    def test_single_holder_gets_both_bonuses(self, game_with_two_players):
        """Single stockholder gets both majority and minority bonuses."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up chain with size 3 (cheap tier: $300 stock price)
        builder.setup_chain("Luxor", 3, start_col=1, row="A")

        # Give only one player stocks
        p1 = game.get_player("p1")
        give_player_stocks(p1, "Luxor", 5, game.hotel)

        bonuses = Rules.calculate_bonuses(game.players, "Luxor", 3, game.hotel)

        # Luxor size 3 = $300 price -> $3000 majority, $1500 minority
        assert "p1" in bonuses
        assert bonuses["p1"]["majority"] == 3000
        assert bonuses["p1"]["minority"] == 1500

        # P2 should not be in bonuses
        assert "p2" not in bonuses

    def test_clear_majority_and_minority(self, game_with_three_players):
        """Clear majority and minority holders get respective bonuses."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up chain
        builder.setup_chain("Tower", 4, start_col=1, row="A")  # $400 price

        # P1 has majority (5 shares), P2 has minority (3 shares), P3 has (1 share)
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p3 = game.get_player("p3")

        give_player_stocks(p1, "Tower", 5, game.hotel)
        give_player_stocks(p2, "Tower", 3, game.hotel)
        give_player_stocks(p3, "Tower", 1, game.hotel)

        bonuses = Rules.calculate_bonuses(game.players, "Tower", 4, game.hotel)

        # P1 gets majority bonus ($4000)
        assert bonuses["p1"]["majority"] == 4000
        assert bonuses["p1"]["minority"] == 0

        # P2 gets minority bonus ($2000)
        assert bonuses["p2"]["majority"] == 0
        assert bonuses["p2"]["minority"] == 2000

        # P3 gets nothing
        assert "p3" not in bonuses or (
            bonuses.get("p3", {}).get("majority", 0) == 0
            and bonuses.get("p3", {}).get("minority", 0) == 0
        )

    def test_tie_for_majority_splits_both(self, game_with_three_players):
        """Tie for majority splits both majority and minority bonuses."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up chain
        builder.setup_chain(
            "American", 5, start_col=1, row="A"
        )  # Medium tier, $600 price

        # P1 and P2 tied for majority
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p3 = game.get_player("p3")

        give_player_stocks(p1, "American", 5, game.hotel)
        give_player_stocks(p2, "American", 5, game.hotel)
        give_player_stocks(p3, "American", 2, game.hotel)

        bonuses = Rules.calculate_bonuses(game.players, "American", 5, game.hotel)

        # Majority = $6000, Minority = $3000, Total = $9000
        # Split between 2 = $4500 each, rounded up to $4500
        expected_split = Rules._round_up_to_hundred(9000 / 2)

        assert bonuses["p1"]["majority"] == expected_split
        assert bonuses["p1"]["minority"] == 0
        assert bonuses["p2"]["majority"] == expected_split
        assert bonuses["p2"]["minority"] == 0

        # P3 gets nothing (tied players got both bonuses)
        assert "p3" not in bonuses or bonuses.get("p3", {}).get("minority", 0) == 0

    def test_three_way_tie_for_majority(self, game_with_three_players):
        """Three-way tie for majority splits both bonuses three ways."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up chain
        builder.setup_chain("Festival", 6, start_col=1, row="A")  # $700 price

        # All three players tied for majority
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p3 = game.get_player("p3")

        give_player_stocks(p1, "Festival", 4, game.hotel)
        give_player_stocks(p2, "Festival", 4, game.hotel)
        give_player_stocks(p3, "Festival", 4, game.hotel)

        bonuses = Rules.calculate_bonuses(game.players, "Festival", 6, game.hotel)

        # Majority = $7000, Minority = $3500, Total = $10500
        # Split 3 ways = $3500 each, rounded up
        expected_split = Rules._round_up_to_hundred(10500 / 3)

        assert bonuses["p1"]["majority"] == expected_split
        assert bonuses["p2"]["majority"] == expected_split
        assert bonuses["p3"]["majority"] == expected_split

    def test_tie_for_minority_only(self, game_with_four_players):
        """Tie for minority only splits the minority bonus."""
        game = game_with_four_players
        builder = ChainBuilder(game)

        # Set up chain
        builder.setup_chain(
            "Imperial", 5, start_col=1, row="A"
        )  # Expensive, $700 price

        # P1 has clear majority, P2 and P3 tied for minority
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p3 = game.get_player("p3")
        p4 = game.get_player("p4")

        give_player_stocks(p1, "Imperial", 6, game.hotel)  # Majority
        give_player_stocks(p2, "Imperial", 3, game.hotel)  # Tied minority
        give_player_stocks(p3, "Imperial", 3, game.hotel)  # Tied minority
        give_player_stocks(p4, "Imperial", 1, game.hotel)  # Less than minority

        bonuses = Rules.calculate_bonuses(game.players, "Imperial", 5, game.hotel)

        # P1 gets full majority ($7000)
        assert bonuses["p1"]["majority"] == 7000
        assert bonuses["p1"]["minority"] == 0

        # P2 and P3 split minority ($3500 / 2 = $1750, round up to $1800)
        expected_minority_split = Rules._round_up_to_hundred(3500 / 2)
        assert bonuses["p2"]["majority"] == 0
        assert bonuses["p2"]["minority"] == expected_minority_split
        assert bonuses["p3"]["majority"] == 0
        assert bonuses["p3"]["minority"] == expected_minority_split


class TestBonusRounding:
    """Tests for bonus rounding rules."""

    def test_bonuses_rounded_up_to_100(self):
        """Bonuses should be rounded up to nearest $100."""
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


class TestBonusEdgeCases:
    """Tests for edge cases in bonus calculations."""

    def test_no_stockholders(self, game_with_two_players):
        """No bonuses if no one owns stock."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        builder.setup_chain("Luxor", 3, start_col=1, row="A")

        # No one owns Luxor stock
        bonuses = Rules.calculate_bonuses(game.players, "Luxor", 3, game.hotel)

        assert bonuses == {}

    def test_zero_size_chain(self, game_with_two_players):
        """Chain with size 0 should have $0 bonuses."""
        game = game_with_two_players

        p1 = game.get_player("p1")
        p1._stocks["Luxor"] = 5

        bonuses = Rules.calculate_bonuses(game.players, "Luxor", 0, game.hotel)

        # Size 0 = $0 price = $0 bonuses
        if bonuses:
            assert bonuses.get("p1", {}).get("majority", 0) == 0
            assert bonuses.get("p1", {}).get("minority", 0) == 0
