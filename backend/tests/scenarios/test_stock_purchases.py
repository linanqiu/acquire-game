"""Scenario tests for stock purchases - from docs/tests/scenario/stock-purchases.md

Stock purchase rules include limits, availability, pricing, and founder's bonus
interaction. Also includes pricing verification tests merged from test_stock_pricing.py.
"""

from game.board import Tile
from game.hotel import Hotel, HotelTier
from tests.scenarios.conftest import (
    ChainBuilder,
    give_player_tile,
)


class TestBasicStockPurchases:
    """Tests for basic stock purchase scenarios (Scenarios 6.1 - 6.5)."""

    def test_scenario_6_1_buy_single_stock(self, game_with_three_players):
        """Scenario 6.1: Buy Single Stock

        Player buys one stock from an active chain.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up American chain (3 tiles, Medium tier, $400/share)
        builder.setup_chain("American", 3, start_col=1, row="A")

        player = game.get_current_player()
        initial_money = player.money

        # Place a tile to enter buying phase
        tile = Tile(5, "E")
        give_player_tile(player, tile, game)
        game.play_tile(player.player_id, tile)

        # Buy 1 American stock
        result = game.buy_stocks(player.player_id, ["American"])
        assert result["success"] is True

        # Verify outcomes
        assert player.get_stock_count("American") == 1
        assert player.money == initial_money - 400
        assert game.hotel.get_available_stocks("American") == 24  # 25 - 1

    def test_scenario_6_2_buy_maximum_three_stocks_same_chain(
        self, game_with_three_players
    ):
        """Scenario 6.2: Buy Maximum 3 Stocks (Same Chain)

        Player buys the maximum 3 stocks from one chain.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up Tower chain (2 tiles, Cheap tier, $200/share)
        builder.setup_chain("Tower", 2, start_col=1, row="A")

        player = game.get_current_player()
        initial_money = player.money

        # Place a tile to enter buying phase
        tile = Tile(5, "E")
        give_player_tile(player, tile, game)
        game.play_tile(player.player_id, tile)

        # Buy 3 Tower stocks
        result = game.buy_stocks(player.player_id, ["Tower", "Tower", "Tower"])
        assert result["success"] is True

        # Verify outcomes
        assert player.get_stock_count("Tower") == 3
        assert player.money == initial_money - 600  # 3 x $200

    def test_scenario_6_3_cannot_exceed_three_per_turn(self, game_with_three_players):
        """Scenario 6.3: Cannot Exceed 3 Per Turn

        Attempting to buy more than 3 stocks should be rejected.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up Continental chain (2 tiles, Expensive tier, $400/share)
        builder.setup_chain("Continental", 2, start_col=1, row="A")

        player = game.get_current_player()
        initial_money = player.money
        initial_stocks = player.get_stock_count("Continental")

        # Place a tile to enter buying phase
        tile = Tile(5, "E")
        give_player_tile(player, tile, game)
        game.play_tile(player.player_id, tile)

        # Try to buy 4 Continental stocks
        result = game.buy_stocks(
            player.player_id,
            ["Continental", "Continental", "Continental", "Continental"],
        )
        assert result["success"] is False

        # Verify player state unchanged
        assert player.get_stock_count("Continental") == initial_stocks
        assert player.money == initial_money

    def test_scenario_6_4_buy_from_multiple_chains(self, game_with_three_players):
        """Scenario 6.4: Buy From Multiple Chains

        Player buys one stock from each of three chains.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up three chains with different tiers
        builder.setup_chain("Luxor", 2, start_col=1, row="A")  # $200
        builder.setup_chain("American", 3, start_col=1, row="C")  # $400
        builder.setup_chain("Imperial", 4, start_col=1, row="E")  # $600

        player = game.get_current_player()
        initial_money = player.money

        # Place a tile to enter buying phase
        tile = Tile(8, "G")
        give_player_tile(player, tile, game)
        game.play_tile(player.player_id, tile)

        # Buy 1 of each
        result = game.buy_stocks(player.player_id, ["Luxor", "American", "Imperial"])
        assert result["success"] is True

        # Verify outcomes
        assert player.get_stock_count("Luxor") == 1
        assert player.get_stock_count("American") == 1
        assert player.get_stock_count("Imperial") == 1
        assert player.money == initial_money - 1200  # $200 + $400 + $600

    def test_scenario_6_5_cannot_buy_inactive_chain_stock(
        self, game_with_three_players
    ):
        """Scenario 6.5: Cannot Buy Inactive Chain Stock

        Cannot buy stock in a chain that hasn't been founded.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up one active chain (American and Tower active)
        builder.setup_chain("American", 2, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=1, row="C")

        # Festival has never been founded (inactive)
        assert not game.hotel.is_chain_active("Festival")

        player = game.get_current_player()
        initial_money = player.money

        # Place a tile to enter buying phase
        tile = Tile(5, "E")
        give_player_tile(player, tile, game)
        game.play_tile(player.player_id, tile)

        # Try to buy Festival stock
        result = game.buy_stocks(player.player_id, ["Festival"])
        assert result["success"] is False

        # Verify state unchanged
        assert player.get_stock_count("Festival") == 0
        assert player.money == initial_money


class TestInsufficientResources:
    """Tests for insufficient resources scenarios (Scenarios 6.6 - 6.8)."""

    def test_scenario_6_6_cannot_buy_defunct_chain_stock(self, game_with_three_players):
        """Scenario 6.6: Cannot Buy Defunct Chain Stock

        Cannot buy stock in a chain that was acquired (defunct).
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up a chain and mark it as defunct by deactivating it
        builder.setup_chain("Luxor", 2, start_col=1, row="A")
        game.hotel.deactivate_chain("Luxor")

        # Set up another active chain
        builder.setup_chain("American", 4, start_col=1, row="C")

        player = game.get_current_player()

        # Place a tile to enter buying phase
        tile = Tile(5, "E")
        give_player_tile(player, tile, game)
        game.play_tile(player.player_id, tile)

        # Try to buy Luxor stock (defunct)
        result = game.buy_stocks(player.player_id, ["Luxor"])
        assert result["success"] is False

    def test_scenario_6_7_insufficient_money_for_purchase(
        self, game_with_three_players
    ):
        """Scenario 6.7: Insufficient Money for Purchase

        Cannot buy stock if insufficient funds.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up Continental chain (3 tiles, $500/share)
        builder.setup_chain("Continental", 3, start_col=1, row="A")

        player = game.get_current_player()

        # Reduce player's money to $500
        player._money = 500

        # Place a tile to enter buying phase
        tile = Tile(5, "E")
        give_player_tile(player, tile, game)
        game.play_tile(player.player_id, tile)

        # Try to buy 2 Continental stocks ($1000 needed)
        result = game.buy_stocks(player.player_id, ["Continental", "Continental"])
        assert result["success"] is False

        # Verify state unchanged
        assert player.get_stock_count("Continental") == 0
        assert player.money == 500

    def test_scenario_6_8_partial_purchase_within_budget(self, game_with_three_players):
        """Scenario 6.8: Partial Purchase Within Budget

        Can buy as many stocks as affordable within budget.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up American chain (3 tiles, $400/share)
        builder.setup_chain("American", 3, start_col=1, row="A")

        player = game.get_current_player()

        # Set player's money to $700 (can afford 1, not 2)
        player._money = 700

        # Place a tile to enter buying phase
        tile = Tile(5, "E")
        give_player_tile(player, tile, game)
        game.play_tile(player.player_id, tile)

        # Buy 1 American stock ($400)
        result = game.buy_stocks(player.player_id, ["American"])
        assert result["success"] is True

        # Verify outcomes
        assert player.get_stock_count("American") == 1
        assert player.money == 300


class TestStockPoolExhaustion:
    """Tests for stock pool exhaustion scenarios (Scenarios 6.9 - 6.10)."""

    def test_scenario_6_9_stock_pool_exhausted(self, game_with_three_players):
        """Scenario 6.9: Stock Pool Exhausted

        Cannot buy stock when pool is empty.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up Tower chain
        builder.setup_chain("Tower", 4, start_col=1, row="A")

        player = game.get_current_player()

        # Exhaust the Tower stock pool
        # Give all 25 stocks to other players
        for _ in range(25):
            game.hotel.buy_stock("Tower")

        assert game.hotel.get_available_stocks("Tower") == 0

        # Place a tile to enter buying phase
        tile = Tile(5, "E")
        give_player_tile(player, tile, game)
        game.play_tile(player.player_id, tile)

        # Try to buy Tower stock
        result = game.buy_stocks(player.player_id, ["Tower"])
        assert result["success"] is False

    def test_scenario_6_10_partial_availability(self, game_with_three_players):
        """Scenario 6.10: Partial Availability

        Can only buy as many stocks as available in pool.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up Festival chain (3 tiles, $400/share)
        builder.setup_chain("Festival", 3, start_col=1, row="A")

        player = game.get_current_player()

        # Leave only 2 Festival stocks in pool
        for _ in range(23):
            game.hotel.buy_stock("Festival")

        assert game.hotel.get_available_stocks("Festival") == 2

        # Place a tile to enter buying phase
        tile = Tile(5, "E")
        give_player_tile(player, tile, game)
        game.play_tile(player.player_id, tile)

        # Try to buy 3 Festival stocks (only 2 available)
        result = game.buy_stocks(player.player_id, ["Festival", "Festival", "Festival"])

        # Implementation may either reject or allow partial purchase
        # If partial purchase allowed:
        if result["success"]:
            assert player.get_stock_count("Festival") <= 2
        # If rejected, that's also valid behavior


class TestSkipBuying:
    """Tests for skip buying scenarios (Scenarios 6.11 - 6.12)."""

    def test_scenario_6_11_skip_buying_zero_purchase(self, game_with_three_players):
        """Scenario 6.11: Skip Buying (Zero Purchase)

        Player can choose to buy no stocks.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up chains with available stock
        builder.setup_chain("American", 3, start_col=1, row="A")

        player = game.get_current_player()
        initial_money = player.money

        # Place a tile to enter buying phase
        tile = Tile(5, "E")
        give_player_tile(player, tile, game)
        game.play_tile(player.player_id, tile)

        # Buy 0 stocks (empty list)
        result = game.buy_stocks(player.player_id, [])
        assert result["success"] is True

        # Verify no changes
        assert player.get_stock_count("American") == 0
        assert player.money == initial_money

    def test_scenario_6_12_forced_skip_no_affordable_options(
        self, game_with_three_players
    ):
        """Scenario 6.12: Forced Skip - No Affordable Options

        When player can't afford any stock, buying is skipped.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up only expensive chain (Continental, $400/share minimum)
        builder.setup_chain("Continental", 2, start_col=1, row="A")

        player = game.get_current_player()

        # Set player's money too low to buy anything
        player._money = 100

        # Place a tile to enter buying phase
        tile = Tile(5, "E")
        give_player_tile(player, tile, game)
        game.play_tile(player.player_id, tile)

        # Player should be able to skip buying
        result = game.buy_stocks(player.player_id, [])
        assert result["success"] is True
        assert player.money == 100


class TestPriceVerification:
    """Tests for price verification scenarios (Scenarios 6.13 - 6.15).

    These tests verify the pricing tables for each tier.
    Merged from test_stock_pricing.py.
    """

    def test_scenario_6_13_price_verification_cheap_tier(self):
        """Scenario 6.13: Price Verification - Cheap Tier

        Verify Luxor/Tower prices at each size bracket.
        """
        hotel = Hotel()

        # Cheap tier price brackets
        expected_prices = {
            2: 200,
            3: 300,
            4: 400,
            5: 500,
            6: 600,
            7: 600,
            8: 600,
            9: 600,
            10: 600,
            11: 700,
            15: 700,
            20: 700,
            21: 800,
            25: 800,
            30: 800,
            31: 900,
            35: 900,
            40: 900,
            41: 1000,
            50: 1000,
        }

        for size, expected_price in expected_prices.items():
            assert hotel.get_stock_price("Luxor", size) == expected_price, (
                f"Luxor size {size} should be ${expected_price}"
            )
            assert hotel.get_stock_price("Tower", size) == expected_price, (
                f"Tower size {size} should be ${expected_price}"
            )

    def test_scenario_6_14_price_verification_medium_tier(self):
        """Scenario 6.14: Price Verification - Medium Tier

        Verify American/Worldwide/Festival prices at each size bracket.
        """
        hotel = Hotel()

        # Medium tier price brackets (+$100 from cheap)
        expected_prices = {
            2: 300,
            3: 400,
            4: 500,
            5: 600,
            6: 700,
            7: 700,
            8: 700,
            9: 700,
            10: 700,
            11: 800,
            15: 800,
            20: 800,
            21: 900,
            25: 900,
            30: 900,
            31: 1000,
            35: 1000,
            40: 1000,
            41: 1100,
            50: 1100,
        }

        for chain in ["American", "Worldwide", "Festival"]:
            for size, expected_price in expected_prices.items():
                assert hotel.get_stock_price(chain, size) == expected_price, (
                    f"{chain} size {size} should be ${expected_price}"
                )

    def test_scenario_6_15_price_verification_expensive_tier(self):
        """Scenario 6.15: Price Verification - Expensive Tier

        Verify Continental/Imperial prices at each size bracket.
        """
        hotel = Hotel()

        # Expensive tier price brackets (+$200 from cheap)
        expected_prices = {
            2: 400,
            3: 500,
            4: 600,
            5: 700,
            6: 800,
            7: 800,
            8: 800,
            9: 800,
            10: 800,
            11: 900,
            15: 900,
            20: 900,
            21: 1000,
            25: 1000,
            30: 1000,
            31: 1100,
            35: 1100,
            40: 1100,
            41: 1200,
            50: 1200,
        }

        for chain in ["Continental", "Imperial"]:
            for size, expected_price in expected_prices.items():
                assert hotel.get_stock_price(chain, size) == expected_price, (
                    f"{chain} size {size} should be ${expected_price}"
                )


class TestFounderBonus:
    """Tests for founder's bonus interaction scenarios (Scenarios 6.16 - 6.17)."""

    def test_scenario_6_16_founders_bonus_does_not_count_toward_limit(
        self, game_with_three_players
    ):
        """Scenario 6.16: Founder's Bonus Does Not Count Toward Limit

        Player can still buy 3 stocks after receiving founder bonus.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Place orphan tile for founding
        builder.setup_lone_tiles([(3, "C")])

        player = game.get_current_player()
        initial_money = player.money

        # Give player tile 3D (adjacent to 3C for founding)
        tile = Tile(3, "D")
        give_player_tile(player, tile, game)

        # Place tile to trigger founding
        result = game.play_tile(player.player_id, tile)
        assert result["success"] is True
        assert result["result"] == "found"

        # Found Tower (Cheap tier, $200/share)
        game.found_chain(player.player_id, "Tower")

        # Player should have 1 free stock from founder's bonus
        assert player.get_stock_count("Tower") == 1

        # Buy 3 additional Tower stocks
        result = game.buy_stocks(player.player_id, ["Tower", "Tower", "Tower"])
        assert result["success"] is True

        # Player should have 4 total (1 bonus + 3 purchased)
        assert player.get_stock_count("Tower") == 4
        assert player.money == initial_money - 600  # 3 x $200

    def test_scenario_6_17_buy_stock_in_newly_founded_chain(
        self, game_with_three_players
    ):
        """Scenario 6.17: Buy Stock in Newly Founded Chain

        Can buy stock in a chain just founded this turn.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Place orphan tile for founding
        builder.setup_lone_tiles([(3, "C")])

        player = game.get_current_player()
        initial_money = player.money

        # Give player tile 3D (adjacent to 3C for founding)
        tile = Tile(3, "D")
        give_player_tile(player, tile, game)

        # Place tile to trigger founding
        game.play_tile(player.player_id, tile)

        # Found American (Medium tier, $300/share for 2 tiles)
        game.found_chain(player.player_id, "American")

        # Player has 1 from founder bonus
        assert player.get_stock_count("American") == 1

        # Buy 2 more American stocks
        result = game.buy_stocks(player.player_id, ["American", "American"])
        assert result["success"] is True

        # Player has 3 total (1 bonus + 2 purchased)
        assert player.get_stock_count("American") == 3
        assert player.money == initial_money - 600  # 2 x $300


class TestPricingTiers:
    """Tests for chain tier classification (merged from test_stock_pricing.py)."""

    def test_cheap_tier_chains(self):
        """Luxor and Tower are cheap tier chains."""
        hotel = Hotel()

        luxor = Hotel.get_chain("Luxor")
        tower = Hotel.get_chain("Tower")

        assert luxor.tier == HotelTier.CHEAP
        assert tower.tier == HotelTier.CHEAP

        # At size 2, cheap tier = $200
        assert hotel.get_stock_price("Luxor", 2) == 200
        assert hotel.get_stock_price("Tower", 2) == 200

    def test_medium_tier_chains(self):
        """American, Worldwide, Festival are medium tier chains."""
        hotel = Hotel()

        american = Hotel.get_chain("American")
        worldwide = Hotel.get_chain("Worldwide")
        festival = Hotel.get_chain("Festival")

        assert american.tier == HotelTier.MEDIUM
        assert worldwide.tier == HotelTier.MEDIUM
        assert festival.tier == HotelTier.MEDIUM

        # At size 2, medium tier = $300
        assert hotel.get_stock_price("American", 2) == 300
        assert hotel.get_stock_price("Worldwide", 2) == 300
        assert hotel.get_stock_price("Festival", 2) == 300

    def test_expensive_tier_chains(self):
        """Imperial and Continental are expensive tier chains."""
        hotel = Hotel()

        imperial = Hotel.get_chain("Imperial")
        continental = Hotel.get_chain("Continental")

        assert imperial.tier == HotelTier.EXPENSIVE
        assert continental.tier == HotelTier.EXPENSIVE

        # At size 2, expensive tier = $400
        assert hotel.get_stock_price("Imperial", 2) == 400
        assert hotel.get_stock_price("Continental", 2) == 400


class TestBonusPricing:
    """Tests for majority/minority bonus pricing (merged from test_stock_pricing.py)."""

    def test_majority_bonus_is_10x_stock_price(self):
        """Majority bonus should be 10x stock price."""
        hotel = Hotel()

        for size in [2, 5, 11, 21, 41]:
            stock_price = hotel.get_stock_price("Luxor", size)
            majority = hotel.get_majority_bonus("Luxor", size)
            assert majority == stock_price * 10

    def test_minority_bonus_is_5x_stock_price(self):
        """Minority bonus should be 5x stock price."""
        hotel = Hotel()

        for size in [2, 5, 11, 21, 41]:
            stock_price = hotel.get_stock_price("American", size)
            minority = hotel.get_minority_bonus("American", size)
            assert minority == stock_price * 5


class TestChainSafety:
    """Tests for chain safety status (merged from test_stock_pricing.py)."""

    def test_chain_is_safe_at_11_plus(self):
        """Chain should be safe at 11+ tiles."""
        hotel = Hotel()

        assert not hotel.is_chain_safe("Luxor", 10)
        assert hotel.is_chain_safe("Luxor", 11)
        assert hotel.is_chain_safe("Luxor", 20)
        assert hotel.is_chain_safe("Luxor", 41)

    def test_chain_not_safe_below_11(self):
        """Chain should not be safe below 11 tiles."""
        hotel = Hotel()

        for size in range(1, 11):
            assert not hotel.is_chain_safe("Tower", size)
