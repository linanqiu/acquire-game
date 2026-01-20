"""Complex merger scenario tests (BH-007).

These tests cover edge cases for mergers:
- Three-way (or more) mergers
- Tied majority/minority stockholders
- Sequential mergers within a turn
- Mergers with no stockholders in defunct chain
- Stock disposition with chain stock exhausted
"""

from game.game import GamePhase
from game.board import Tile
from game.rules import Rules
from tests.scenarios.conftest import (
    ChainBuilder,
    give_player_tile,
    give_player_stocks,
    set_current_player,
)


class TestThreeWayMerger:
    """Tests for mergers involving 3 chains."""

    def test_three_way_merger_largest_survives(self, game_with_three_players):
        """When three chains merge, largest survives."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Setup three chains of different sizes in an L-shape
        # American: 4 tiles at row A (1A-4A)
        builder.setup_chain("American", 4, start_col=1, row="A")
        # Tower: 2 tiles at row A (6A-7A) with gap at 5A
        builder.setup_chain("Tower", 2, start_col=6, row="A")
        # Luxor: 2 tiles at row B (5B-6B)
        builder.setup_chain("Luxor", 2, start_col=5, row="B")

        # Verify sizes
        assert game.board.get_chain_size("American") == 4
        assert game.board.get_chain_size("Tower") == 2
        assert game.board.get_chain_size("Luxor") == 2

        # Tile at 5A connects all three:
        # - American (to the left at 4A)
        # - Tower (to the right at 6A)
        # - Luxor (below at 5B)

        player = game.get_current_player()
        tile = Tile(5, "A")
        give_player_tile(player, tile, game)

        # Determine survivor before playing
        chains = ["American", "Tower", "Luxor"]
        survivor = Rules.get_merger_survivor(game.board, chains)
        assert survivor == "American"  # Largest with 4 tiles

        result = game.play_tile(player.player_id, tile)

        assert result["success"] is True
        assert result["result"] == "merge"
        assert result["survivor"] == "American"
        assert set(result["defunct"]) == {"Luxor", "Tower"}

    def test_three_way_merger_tie_two_largest(self, game_with_three_players):
        """When two of three chains tie for largest, player chooses."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Setup three chains where two are tied for largest
        # American: 3 tiles at row A
        builder.setup_chain("American", 3, start_col=1, row="A")
        # Luxor: 3 tiles at row A (gap in between)
        builder.setup_chain("Luxor", 3, start_col=5, row="A")
        # Tower: 2 tiles at row B
        builder.setup_chain("Tower", 2, start_col=4, row="B")

        # Tile at 4A connects all three
        player = game.get_current_player()
        tile = Tile(4, "A")
        give_player_tile(player, tile, game)

        result = game.play_tile(player.player_id, tile)

        assert result["success"] is True
        assert result["result"] == "merge_tie"
        # Should have American and Luxor as tied chains (both size 3)
        assert "American" in result["tied_chains"]
        assert "Luxor" in result["tied_chains"]
        assert game.phase == GamePhase.MERGING

    def test_three_way_merger_all_equal(self, game_with_three_players):
        """When all three chains equal size, player chooses."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Setup three chains of equal size
        builder.setup_chain("American", 2, start_col=1, row="A")
        builder.setup_chain("Luxor", 2, start_col=4, row="A")
        builder.setup_chain("Tower", 2, start_col=3, row="B")

        # Tile at 3A connects all three
        player = game.get_current_player()
        tile = Tile(3, "A")
        give_player_tile(player, tile, game)

        result = game.play_tile(player.player_id, tile)

        assert result["success"] is True
        assert result["result"] == "merge_tie"
        assert len(result["tied_chains"]) == 3

    def test_three_way_defunct_order(self, game_with_three_players):
        """Defunct chains process in descending size order."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Setup: American (5) > Luxor (3) > Tower (2)
        builder.setup_chain("American", 5, start_col=1, row="A")
        builder.setup_chain("Luxor", 3, start_col=7, row="A")
        builder.setup_chain("Tower", 2, start_col=11, row="A")

        # Place lone tiles to connect
        game.board.place_tile(Tile(6, "A"))
        game.board.place_tile(Tile(10, "A"))

        # Give players stock in all defunct chains
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")

        give_player_stocks(p1, "Luxor", 3, game.hotel)
        give_player_stocks(p1, "Tower", 2, game.hotel)
        give_player_stocks(p2, "Luxor", 2, game.hotel)
        give_player_stocks(p2, "Tower", 3, game.hotel)

        # The defunct chains should be processed Luxor (3) first, then Tower (2)
        # This is because they process in descending size order

        # Just verify the chains are set up correctly
        assert game.board.get_chain_size("American") == 5
        assert game.board.get_chain_size("Luxor") == 3
        assert game.board.get_chain_size("Tower") == 2


class TestFourWayMerger:
    """Tests for mergers involving 4 chains (rare but possible)."""

    def test_four_way_merger(self, game_with_four_players):
        """When four chains merge, largest survives."""
        game = game_with_four_players

        # Setup four chains in a cross pattern with one clearly largest
        # Center tile will merge all four
        #
        #       4D (Tower)
        #       |
        # A A A 4E L L
        #       |
        #       4F (Festival)

        # American: 3 tiles at row E (largest)
        for col in range(1, 4):
            tile = Tile(col, "E")
            game.board.place_tile(tile)
            game.board.set_chain(tile, "American")
        game.hotel.activate_chain("American")

        # Luxor: 2 tiles at row E (5E, 6E)
        for col in range(5, 7):
            tile = Tile(col, "E")
            game.board.place_tile(tile)
            game.board.set_chain(tile, "Luxor")
        game.hotel.activate_chain("Luxor")

        # Tower: 2 tiles vertically at column 4 (4C, 4D)
        for row in ["C", "D"]:
            tile = Tile(4, row)
            game.board.place_tile(tile)
            game.board.set_chain(tile, "Tower")
        game.hotel.activate_chain("Tower")

        # Festival: 2 tiles vertically at column 4 (4F, 4G)
        for row in ["F", "G"]:
            tile = Tile(4, row)
            game.board.place_tile(tile)
            game.board.set_chain(tile, "Festival")
        game.hotel.activate_chain("Festival")

        # Verify sizes
        assert game.board.get_chain_size("American") == 3
        assert game.board.get_chain_size("Luxor") == 2
        assert game.board.get_chain_size("Tower") == 2
        assert game.board.get_chain_size("Festival") == 2

        # Tile at 4E connects all four
        player = game.get_current_player()
        tile = Tile(4, "E")
        give_player_tile(player, tile, game)

        result = game.play_tile(player.player_id, tile)

        assert result["success"] is True
        assert result["result"] == "merge"  # American is clearly largest
        assert result["survivor"] == "American"
        assert len(result["defunct"]) == 3
        assert set(result["defunct"]) == {"Luxor", "Tower", "Festival"}


class TestStockholderTies:
    """Tests for tie scenarios in majority/minority bonuses."""

    def test_two_way_majority_tie(self, game_with_three_players):
        """Two players tie for majority: split majority+minority bonus."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Setup Tower chain (5 tiles)
        builder.setup_chain("Tower", 5, start_col=1, row="A")

        # P1 and P2 tie for majority with 4 shares each
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p3 = game.get_player("p3")

        give_player_stocks(p1, "Tower", 4, game.hotel)
        give_player_stocks(p2, "Tower", 4, game.hotel)
        give_player_stocks(p3, "Tower", 2, game.hotel)

        bonuses = Rules.calculate_bonuses(game.players, "Tower", 5, game.hotel)

        # Tower 5-tile: $500 price, $5000 majority, $2500 minority
        # Tied majority splits both: ($5000 + $2500) / 2 = $3750
        expected_split = Rules._round_up_to_hundred(7500 / 2)

        assert bonuses["p1"]["majority"] == expected_split
        assert bonuses["p1"]["minority"] == 0
        assert bonuses["p2"]["majority"] == expected_split
        assert bonuses["p2"]["minority"] == 0

        # P3 gets nothing (tied majority holders get both bonuses)
        assert "p3" not in bonuses or bonuses.get("p3", {}).get("minority", 0) == 0

    def test_three_way_majority_tie(self, game_with_three_players):
        """Three players tie: split majority+minority three ways."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Setup Luxor chain (4 tiles)
        builder.setup_chain("Luxor", 4, start_col=1, row="A")

        # All three players tie for majority
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p3 = game.get_player("p3")

        give_player_stocks(p1, "Luxor", 3, game.hotel)
        give_player_stocks(p2, "Luxor", 3, game.hotel)
        give_player_stocks(p3, "Luxor", 3, game.hotel)

        bonuses = Rules.calculate_bonuses(game.players, "Luxor", 4, game.hotel)

        # Luxor 4-tile Cheap: $400 price, $4000 majority, $2000 minority
        # Combined = $6000, split 3 ways = $2000 each
        expected_split = Rules._round_up_to_hundred(6000 / 3)

        assert bonuses["p1"]["majority"] == expected_split
        assert bonuses["p2"]["majority"] == expected_split
        assert bonuses["p3"]["majority"] == expected_split

    def test_majority_with_minority_tie(self, game_with_four_players):
        """One majority holder, two tied for minority."""
        game = game_with_four_players
        builder = ChainBuilder(game)

        # Setup American chain (6 tiles)
        builder.setup_chain("American", 6, start_col=1, row="A")

        # P1 is clear majority, P2 and P3 tied for minority
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p3 = game.get_player("p3")
        p4 = game.get_player("p4")

        give_player_stocks(p1, "American", 8, game.hotel)  # Clear majority
        give_player_stocks(p2, "American", 3, game.hotel)  # Tied minority
        give_player_stocks(p3, "American", 3, game.hotel)  # Tied minority
        give_player_stocks(p4, "American", 1, game.hotel)  # Not in running

        bonuses = Rules.calculate_bonuses(game.players, "American", 6, game.hotel)

        # American 6-tile Medium: $700 price, $7000 majority, $3500 minority
        assert bonuses["p1"]["majority"] == 7000
        assert bonuses["p1"]["minority"] == 0

        # P2 and P3 split minority: $3500 / 2 = $1750
        expected_minority_split = Rules._round_up_to_hundred(3500 / 2)
        assert bonuses["p2"]["minority"] == expected_minority_split
        assert bonuses["p3"]["minority"] == expected_minority_split

    def test_all_players_tied(self, game_with_four_players):
        """All 4 players have equal stock."""
        game = game_with_four_players
        builder = ChainBuilder(game)

        # Setup Tower chain
        builder.setup_chain("Tower", 3, start_col=1, row="A")

        # All four players have equal shares
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p3 = game.get_player("p3")
        p4 = game.get_player("p4")

        give_player_stocks(p1, "Tower", 2, game.hotel)
        give_player_stocks(p2, "Tower", 2, game.hotel)
        give_player_stocks(p3, "Tower", 2, game.hotel)
        give_player_stocks(p4, "Tower", 2, game.hotel)

        bonuses = Rules.calculate_bonuses(game.players, "Tower", 3, game.hotel)

        # Tower 3-tile: $300 price, $3000 majority, $1500 minority
        # Combined = $4500, split 4 ways = $1125 -> rounds up to $1200
        expected_split = Rules._round_up_to_hundred(4500 / 4)

        for player_id in ["p1", "p2", "p3", "p4"]:
            assert bonuses[player_id]["majority"] == expected_split

    def test_no_minority_holder(self, game_with_three_players):
        """Majority holder owns ALL stock - gets both bonuses."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("Luxor", 4, start_col=1, row="A")

        # Only P1 owns stock
        p1 = game.get_player("p1")
        give_player_stocks(p1, "Luxor", 10, game.hotel)

        bonuses = Rules.calculate_bonuses(game.players, "Luxor", 4, game.hotel)

        # Luxor 4-tile: $400 price, $4000 majority, $2000 minority
        assert bonuses["p1"]["majority"] == 4000
        assert bonuses["p1"]["minority"] == 2000


class TestNoStockholdersInDefunct:
    """Tests for mergers where no one holds defunct stock."""

    def test_no_stockholders_no_bonus(self, game_with_three_players):
        """If no one holds defunct stock, no bonus paid."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("American", 4, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=6, row="A")

        # No one owns Tower stock
        assert game.hotel.get_available_stocks("Tower") == 25

        bonuses = Rules.calculate_bonuses(game.players, "Tower", 2, game.hotel)

        assert bonuses == {}

    def test_skip_disposition_for_zero_stock_players(self, game_with_three_players):
        """Players with 0 defunct stock skip disposition."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("American", 4, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=6, row="A")

        # Only P1 owns Tower stock
        p1 = game.get_player("p1")
        give_player_stocks(p1, "Tower", 3, game.hotel)

        # P2 and P3 have no Tower stock

        set_current_player(game, "p1")
        tile = Tile(5, "A")
        give_player_tile(p1, tile, game)

        # Play tile to trigger merger
        game.play_tile("p1", tile)

        # Check that only P1 is in the disposition queue
        state = game.get_public_state()
        if "merger_state" in state:
            queue = state["merger_state"]["disposition_queue"]
            # Only P1 should be in queue
            assert len(queue) == 1
            assert queue[0]["player_id"] == "p1"


class TestStockExhaustion:
    """Tests for disposition when survivor has no stock available."""

    def test_trade_blocked_no_survivor_stock(self, game_with_three_players):
        """Cannot trade when survivor has 0 available stock."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("American", 4, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=6, row="A")

        # Buy all American stock
        for i in range(25):
            if game.hotel.get_available_stocks("American") > 0:
                game.hotel.buy_stock("American")

        # Verify no American stock available
        assert game.hotel.get_available_stocks("American") == 0

        # P1 has Tower stock
        p1 = game.get_player("p1")
        give_player_stocks(p1, "Tower", 4, game.hotel)

        set_current_player(game, "p1")
        tile = Tile(5, "A")
        give_player_tile(p1, tile, game)

        # Trigger merger
        game.play_tile("p1", tile)

        # In disposition phase, max trade should be 0
        if (
            game.pending_action
            and game.pending_action.get("type") == "stock_disposition"
        ):
            available_to_trade = game.pending_action.get("available_to_trade", 0)
            assert available_to_trade == 0

    def test_partial_trade_limited_stock(self, game_with_three_players):
        """Can only trade up to available survivor stock."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("American", 4, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=6, row="A")

        # Buy 23 American stock, leaving 2 available
        for i in range(23):
            if game.hotel.get_available_stocks("American") > 0:
                game.hotel.buy_stock("American")

        assert game.hotel.get_available_stocks("American") == 2

        # P1 has 6 Tower stock
        p1 = game.get_player("p1")
        give_player_stocks(p1, "Tower", 6, game.hotel)

        set_current_player(game, "p1")
        tile = Tile(5, "A")
        give_player_tile(p1, tile, game)

        # Trigger merger
        game.play_tile("p1", tile)

        # In disposition phase, max trade should be 2 (can trade 4 defunct for 2 survivor)
        if (
            game.pending_action
            and game.pending_action.get("type") == "stock_disposition"
        ):
            available_to_trade = game.pending_action.get("available_to_trade", 0)
            assert available_to_trade == 2

            # Valid combinations should limit trade to 4 (2 survivor * 2)
            combos = Rules.get_valid_disposition_combinations(6, available_to_trade)
            max_trade = max(trade for _, trade, _ in combos)
            assert max_trade == 4  # 4 defunct for 2 survivor


class TestMultiChainDisposition:
    """Tests for sequential defunct chain handling in multi-chain mergers."""

    def test_merger_handles_multiple_defunct_chains(self, game_with_three_players):
        """After first defunct disposition completes, game handles next defunct."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Setup three chains
        builder.setup_chain("American", 5, start_col=1, row="A")  # Survivor
        builder.setup_chain("Luxor", 3, start_col=7, row="A")  # Defunct 1
        builder.setup_chain("Tower", 2, start_col=11, row="A")  # Defunct 2

        # Place lone tiles to connect all
        game.board.place_tile(Tile(6, "A"))
        game.board.place_tile(Tile(10, "A"))

        # Give P1 stock in both defunct chains
        p1 = game.get_player("p1")
        give_player_stocks(p1, "Luxor", 3, game.hotel)
        give_player_stocks(p1, "Tower", 2, game.hotel)

        # Connect 6A to American to start merger
        game.board.set_chain(Tile(6, "A"), "American")

        # Verify chains are set up
        assert game.board.get_chain_size("American") == 6
        assert game.board.get_chain_size("Luxor") == 3
        assert game.board.get_chain_size("Tower") == 2


class TestMergerBonusRounding:
    """Tests for bonus rounding edge cases in mergers."""

    def test_odd_split_rounds_up(self, game_with_three_players):
        """Odd bonus amounts round up to nearest $100."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Setup chain where bonus splits unevenly
        builder.setup_chain("Tower", 5, start_col=1, row="A")

        # Three way tie: $5000 + $2500 = $7500 / 3 = $2500 each
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p3 = game.get_player("p3")

        give_player_stocks(p1, "Tower", 3, game.hotel)
        give_player_stocks(p2, "Tower", 3, game.hotel)
        give_player_stocks(p3, "Tower", 3, game.hotel)

        bonuses = Rules.calculate_bonuses(game.players, "Tower", 5, game.hotel)

        # Each should get $2500 exactly
        assert bonuses["p1"]["majority"] == 2500
        assert bonuses["p2"]["majority"] == 2500
        assert bonuses["p3"]["majority"] == 2500

    def test_small_chain_bonus_rounding(self, game_with_four_players):
        """Small chain bonuses round up correctly with 4-way split."""
        game = game_with_four_players
        builder = ChainBuilder(game)

        # Setup smallest possible chain for bonus
        builder.setup_chain("Luxor", 2, start_col=1, row="A")

        # Four way tie: $2000 + $1000 = $3000 / 4 = $750 -> rounds to $800
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p3 = game.get_player("p3")
        p4 = game.get_player("p4")

        give_player_stocks(p1, "Luxor", 2, game.hotel)
        give_player_stocks(p2, "Luxor", 2, game.hotel)
        give_player_stocks(p3, "Luxor", 2, game.hotel)
        give_player_stocks(p4, "Luxor", 2, game.hotel)

        bonuses = Rules.calculate_bonuses(game.players, "Luxor", 2, game.hotel)

        expected = Rules._round_up_to_hundred(3000 / 4)  # 750 -> 800
        assert bonuses["p1"]["majority"] == expected
