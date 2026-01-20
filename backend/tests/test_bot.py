"""Tests for the Bot AI player."""

import random

import pytest

from game.board import Board, Tile
from game.hotel import Hotel
from game.player import Player
from game.bot import Bot


class TestBotInit:
    """Tests for Bot initialization."""

    def test_bot_init_default_difficulty(self):
        """Test bot initializes with default medium difficulty."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player)

        assert bot.player == player
        assert bot.difficulty == "medium"

    def test_bot_init_easy_difficulty(self):
        """Test bot initializes with easy difficulty."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="easy")

        assert bot.difficulty == "easy"

    def test_bot_init_hard_difficulty(self):
        """Test bot initializes with hard difficulty."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="hard")

        assert bot.difficulty == "hard"

    def test_bot_init_invalid_difficulty(self):
        """Test bot raises error for invalid difficulty."""
        player = Player("bot1", "Bot Player")

        with pytest.raises(ValueError, match="Invalid difficulty"):
            Bot(player, difficulty="extreme")


class TestChooseTileToPlay:
    """Tests for tile selection strategy."""

    def test_no_valid_tiles_returns_none(self):
        """Test returns None when no playable tiles."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="hard")
        board = Board()
        hotel = Hotel()

        # Player has no tiles
        result = bot.choose_tile_to_play(board, hotel)
        assert result is None

    def test_prefers_founding_tiles(self):
        """Test bot prefers tiles that would found a new chain."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="hard")
        board = Board()
        hotel = Hotel()

        # Add tiles to hand
        founding_tile = Tile(1, "B")  # Adjacent to played tile
        non_founding_tile = Tile(5, "E")  # Isolated

        player.add_tile(founding_tile)
        player.add_tile(non_founding_tile)

        # Place a tile on board that founding_tile would connect to
        board.place_tile(Tile(1, "A"))

        result = bot.choose_tile_to_play(board, hotel)
        assert result == founding_tile

    def test_prefers_expanding_owned_chains(self):
        """Test bot prefers tiles that expand chains it owns stock in."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="hard")
        board = Board()
        hotel = Hotel()

        # Set up a chain on the board
        board.place_tile(Tile(1, "A"))
        board.place_tile(Tile(1, "B"))
        board.set_chain(Tile(1, "A"), "Luxor")
        board.set_chain(Tile(1, "B"), "Luxor")
        hotel.activate_chain("Luxor")

        # Give player stock in Luxor
        player._stocks["Luxor"] = 5

        # Add tiles to hand
        expand_tile = Tile(1, "C")  # Would expand Luxor
        isolated_tile = Tile(10, "I")  # Isolated

        player.add_tile(expand_tile)
        player.add_tile(isolated_tile)

        result = bot.choose_tile_to_play(board, hotel)
        assert result == expand_tile

    def test_avoids_illegal_mergers(self):
        """Test bot doesn't select tiles that would illegally merge safe chains."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="hard")
        board = Board()
        hotel = Hotel()

        # Create two safe chains (11+ tiles each)
        # Chain 1: Luxor (columns 1-11, row A)
        for col in range(1, 12):
            tile = Tile(col, "A")
            board.place_tile(tile)
            board.set_chain(tile, "Luxor")
        hotel.activate_chain("Luxor")

        # Chain 2: Tower (columns 1-11, row C)
        for col in range(1, 12):
            tile = Tile(col, "C")
            board.place_tile(tile)
            board.set_chain(tile, "Tower")
        hotel.activate_chain("Tower")

        # Add tiles to hand
        illegal_tile = Tile(1, "B")  # Would merge two safe chains
        legal_tile = Tile(12, "I")  # Safe isolated tile

        player.add_tile(illegal_tile)
        player.add_tile(legal_tile)

        result = bot.choose_tile_to_play(board, hotel)
        assert result == legal_tile

    def test_easy_difficulty_random_selection(self):
        """Test easy difficulty uses random selection based on RNG seed."""
        board = Board()
        hotel = Hotel()

        # Add multiple tiles to player hands
        tiles = [Tile(1, "A"), Tile(5, "E"), Tile(10, "I")]

        # Use many different seeds to prove randomness is used
        # With 3 options and 20 seeds, probability of all same is (1/3)^19 ≈ 0%
        results_by_seed = {}
        for seed in range(20):
            player = Player("bot1", "Bot Player")
            for tile in tiles:
                player.add_tile(tile)
            rng = random.Random(seed)
            bot = Bot(player, difficulty="easy", rng=rng)
            result = bot.choose_tile_to_play(board, hotel)
            results_by_seed[seed] = result

        # Different seeds should produce different results (proves randomness is used)
        unique_results = set(results_by_seed.values())
        assert len(unique_results) >= 2, (
            "Easy mode should use randomness - different seeds should give different tiles"
        )


class TestChooseChainToFound:
    """Tests for chain founding preferences."""

    def test_no_available_chains_raises_error(self):
        """Test raises error when no chains available."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="hard")
        board = Board()

        with pytest.raises(ValueError, match="No chains available"):
            bot.choose_chain_to_found([], board)

    def test_prefers_expensive_when_wealthy(self):
        """Test bot prefers expensive chains when has money."""
        player = Player("bot1", "Bot Player")
        # Player starts with $6000
        bot = Bot(player, difficulty="hard")
        board = Board()

        available = ["Luxor", "American", "Imperial"]  # Cheap, Medium, Expensive

        result = bot.choose_chain_to_found(available, board)
        assert result == "Imperial"

    def test_prefers_cheap_when_low_cash(self):
        """Test bot prefers cheap chains when low on money."""
        player = Player("bot1", "Bot Player")
        player._money = 1000  # Low cash
        bot = Bot(player, difficulty="hard")
        board = Board()

        available = ["Luxor", "American", "Imperial"]  # Cheap, Medium, Expensive

        result = bot.choose_chain_to_found(available, board)
        assert result == "Luxor"

    def test_falls_back_to_medium_tier(self):
        """Test bot picks medium tier when expensive not available and wealthy."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="hard")
        board = Board()

        available = ["Luxor", "American", "Worldwide"]  # Cheap, Medium, Medium

        result = bot.choose_chain_to_found(available, board)
        assert result in ["American", "Worldwide"]

    def test_easy_difficulty_random_chain(self):
        """Test easy difficulty picks randomly based on RNG seed."""
        board = Board()
        available = ["Luxor", "American", "Imperial"]

        # Use many different seeds to prove randomness is used
        # With 3 options and 20 seeds, probability of all same is (1/3)^19 ≈ 0%
        results_by_seed = {}
        for seed in range(20):
            player = Player("bot1", "Bot Player")
            rng = random.Random(seed)
            bot = Bot(player, difficulty="easy", rng=rng)
            result = bot.choose_chain_to_found(available, board)
            results_by_seed[seed] = result

        # Different seeds should produce different results (proves randomness is used)
        unique_results = set(results_by_seed.values())
        assert len(unique_results) >= 2, (
            "Easy mode should use randomness - different seeds should give different chains"
        )


class TestChooseMergerSurvivor:
    """Tests for merger survivor decisions."""

    def test_single_chain_returns_it(self):
        """Test returns the only chain when just one option."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="hard")
        board = Board()
        hotel = Hotel()

        result = bot.choose_merger_survivor(["Luxor"], board, hotel)
        assert result == "Luxor"

    def test_empty_chains_raises_error(self):
        """Test raises error for empty chain list."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="hard")
        board = Board()
        hotel = Hotel()

        with pytest.raises(ValueError, match="No chains to choose from"):
            bot.choose_merger_survivor([], board, hotel)

    def test_favors_chain_with_most_stock(self):
        """Test bot prefers chain it owns more stock in."""
        player = Player("bot1", "Bot Player")
        player._stocks["Luxor"] = 2
        player._stocks["Tower"] = 8
        bot = Bot(player, difficulty="hard")
        board = Board()
        hotel = Hotel()

        result = bot.choose_merger_survivor(["Luxor", "Tower"], board, hotel)
        assert result == "Tower"

    def test_tiebreaks_by_tier(self):
        """Test bot uses tier as tiebreaker when equal stock."""
        player = Player("bot1", "Bot Player")
        player._stocks["Luxor"] = 5  # Cheap
        player._stocks["Imperial"] = 5  # Expensive
        bot = Bot(player, difficulty="hard")
        board = Board()
        hotel = Hotel()

        result = bot.choose_merger_survivor(["Luxor", "Imperial"], board, hotel)
        assert result == "Imperial"

    def test_easy_difficulty_random(self):
        """Test easy difficulty picks randomly based on RNG seed."""
        board = Board()
        hotel = Hotel()

        # Use many different seeds to prove randomness is used
        # With 2 options and 20 seeds, probability of all same is (0.5)^19 ≈ 0%
        results_by_seed = {}
        for seed in range(20):
            player = Player("bot1", "Bot Player")
            player._stocks["Luxor"] = 10
            player._stocks["Tower"] = 0
            rng = random.Random(seed)
            bot = Bot(player, difficulty="easy", rng=rng)
            result = bot.choose_merger_survivor(["Luxor", "Tower"], board, hotel)
            results_by_seed[seed] = result

        # Different seeds should produce different results (proves randomness is used)
        unique_results = set(results_by_seed.values())
        assert len(unique_results) >= 2, (
            "Easy mode should use randomness - different seeds should give different survivors"
        )


class TestChooseStockDisposition:
    """Tests for sell/trade/keep decisions."""

    def test_zero_defunct_stock(self):
        """Test returns zeros when player has no defunct stock."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="hard")
        board = Board()
        hotel = Hotel()

        result = bot.choose_stock_disposition("Luxor", "Tower", 0, board, hotel)

        assert result == {"sell": 0, "trade": 0, "keep": 0}

    def test_totals_match_defunct_count(self):
        """Test sell + trade + keep equals defunct count."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="medium")
        board = Board()
        hotel = Hotel()

        # Set up surviving chain on board
        for col in range(1, 6):
            tile = Tile(col, "A")
            board.place_tile(tile)
            board.set_chain(tile, "Tower")
        hotel.activate_chain("Tower")

        # Set up defunct chain
        for col in range(1, 4):
            tile = Tile(col, "C")
            board.place_tile(tile)
            board.set_chain(tile, "Luxor")
        hotel.activate_chain("Luxor")

        defunct_count = 10
        result = bot.choose_stock_disposition(
            "Luxor", "Tower", defunct_count, board, hotel
        )

        total = result["sell"] + result["trade"] + result["keep"]
        assert total == defunct_count

    def test_trade_count_is_even(self):
        """Test trade count is always even (2:1 ratio)."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="medium")
        board = Board()
        hotel = Hotel()

        # Set up chains on board
        for col in range(1, 6):
            tile = Tile(col, "A")
            board.place_tile(tile)
            board.set_chain(tile, "Tower")
        hotel.activate_chain("Tower")

        for col in range(1, 4):
            tile = Tile(col, "C")
            board.place_tile(tile)
            board.set_chain(tile, "Luxor")
        hotel.activate_chain("Luxor")

        for defunct_count in range(1, 15):
            result = bot.choose_stock_disposition(
                "Luxor", "Tower", defunct_count, board, hotel
            )
            assert result["trade"] % 2 == 0

    def test_sells_when_low_on_cash_medium(self):
        """Test medium bot sells more when low on cash."""
        player = Player("bot1", "Bot Player")
        player._money = 500  # Very low
        bot = Bot(player, difficulty="medium")
        board = Board()
        hotel = Hotel()

        # Set up chains
        for col in range(1, 6):
            tile = Tile(col, "A")
            board.place_tile(tile)
            board.set_chain(tile, "Tower")
        hotel.activate_chain("Tower")

        for col in range(1, 4):
            tile = Tile(col, "C")
            board.place_tile(tile)
            board.set_chain(tile, "Luxor")
        hotel.activate_chain("Luxor")

        defunct_count = 10
        result = bot.choose_stock_disposition(
            "Luxor", "Tower", defunct_count, board, hotel
        )

        # Should sell at least some stock when low on cash
        assert result["sell"] > 0


class TestChooseStocksToBuy:
    """Tests for stock purchase decisions."""

    def test_no_active_chains_returns_empty(self):
        """Test returns empty list when no active chains."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="hard")
        board = Board()
        hotel = Hotel()

        result = bot.choose_stocks_to_buy(board, hotel)
        assert result == []

    def test_respects_max_stocks_limit(self):
        """Test doesn't buy more than max_stocks."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="hard")
        board = Board()
        hotel = Hotel()

        # Set up an active chain
        for col in range(1, 6):
            tile = Tile(col, "A")
            board.place_tile(tile)
            board.set_chain(tile, "Luxor")
        hotel.activate_chain("Luxor")

        result = bot.choose_stocks_to_buy(board, hotel, max_stocks=3)
        assert len(result) <= 3

        result = bot.choose_stocks_to_buy(board, hotel, max_stocks=2)
        assert len(result) <= 2

    def test_diversifies_purchases(self):
        """Test bot diversifies across multiple chains."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="hard")
        board = Board()
        hotel = Hotel()

        # Set up two active chains
        for col in range(1, 4):
            tile = Tile(col, "A")
            board.place_tile(tile)
            board.set_chain(tile, "Luxor")
        hotel.activate_chain("Luxor")

        for col in range(1, 4):
            tile = Tile(col, "C")
            board.place_tile(tile)
            board.set_chain(tile, "Tower")
        hotel.activate_chain("Tower")

        # Buy stocks multiple times to check diversification tendency
        unique_chains_bought = set()
        for _ in range(10):
            result = bot.choose_stocks_to_buy(board, hotel, max_stocks=3)
            unique_chains_bought.update(result)

        # Should buy from both chains at some point
        assert len(unique_chains_bought) >= 2

    def test_prefers_owned_chains(self):
        """Test bot prefers chains it already owns stock in."""
        player = Player("bot1", "Bot Player")
        player._stocks["Luxor"] = 5
        player._stocks["Tower"] = 0
        bot = Bot(player, difficulty="hard")
        board = Board()
        hotel = Hotel()

        # Set up two chains with same size
        for col in range(1, 4):
            tile = Tile(col, "A")
            board.place_tile(tile)
            board.set_chain(tile, "Luxor")
        hotel.activate_chain("Luxor")

        for col in range(1, 4):
            tile = Tile(col, "C")
            board.place_tile(tile)
            board.set_chain(tile, "Tower")
        hotel.activate_chain("Tower")

        # Run multiple times and count Luxor purchases
        luxor_count = 0
        total_purchases = 0
        for _ in range(20):
            result = bot.choose_stocks_to_buy(board, hotel, max_stocks=1)
            if result and result[0] == "Luxor":
                luxor_count += 1
            total_purchases += 1

        # Should prefer Luxor most of the time
        assert luxor_count > total_purchases * 0.5

    def test_stops_when_cant_afford(self):
        """Test bot stops buying when can't afford more."""
        player = Player("bot1", "Bot Player")
        player._money = 300  # Can only afford 1 cheap stock
        bot = Bot(player, difficulty="hard")
        board = Board()
        hotel = Hotel()

        # Set up a chain
        for col in range(1, 4):
            tile = Tile(col, "A")
            board.place_tile(tile)
            board.set_chain(tile, "Luxor")
        hotel.activate_chain("Luxor")
        # Price should be $300 for 3-tile chain

        result = bot.choose_stocks_to_buy(board, hotel, max_stocks=3)
        assert len(result) == 1

    def test_no_purchase_when_no_stock_available(self):
        """Test bot doesn't buy from chains with no available stock."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="hard")
        board = Board()
        hotel = Hotel()

        # Set up a chain
        for col in range(1, 4):
            tile = Tile(col, "A")
            board.place_tile(tile)
            board.set_chain(tile, "Luxor")
        hotel.activate_chain("Luxor")

        # Remove all available stock
        hotel._available_stocks["Luxor"] = 0

        result = bot.choose_stocks_to_buy(board, hotel, max_stocks=3)
        assert "Luxor" not in result

    def test_easy_difficulty_random_purchase(self):
        """Test easy difficulty purchases randomly based on RNG seed."""
        board = Board()
        hotel = Hotel()

        # Set up two chains
        for col in range(1, 4):
            tile = Tile(col, "A")
            board.place_tile(tile)
            board.set_chain(tile, "Luxor")
        hotel.activate_chain("Luxor")

        for col in range(1, 4):
            tile = Tile(col, "C")
            board.place_tile(tile)
            board.set_chain(tile, "Tower")
        hotel.activate_chain("Tower")

        # Use many different seeds to prove randomness is used
        # With 2 options and 20 seeds, probability of all same is (0.5)^19 ≈ 0%
        results_by_seed = {}
        for seed in range(20):
            player = Player("bot1", "Bot Player")
            rng = random.Random(seed)
            bot = Bot(player, difficulty="easy", rng=rng)
            result = bot.choose_stocks_to_buy(board, hotel, max_stocks=1)
            if result:
                results_by_seed[seed] = result[0]

        # Different seeds should produce different results (proves randomness is used)
        unique_results = set(results_by_seed.values())
        assert len(unique_results) >= 2, (
            "Easy mode should use randomness - different seeds should give different purchases"
        )


class TestIntegration:
    """Integration tests for bot behavior."""

    def test_full_turn_simulation(self):
        """Test bot can make decisions for a full turn."""
        player = Player("bot1", "Bot Player")
        bot = Bot(player, difficulty="medium")
        board = Board()
        hotel = Hotel()

        # Give player tiles
        player.add_tile(Tile(1, "A"))
        player.add_tile(Tile(2, "A"))
        player.add_tile(Tile(5, "E"))

        # Set up a chain
        board.place_tile(Tile(3, "A"))
        board.place_tile(Tile(4, "A"))
        board.set_chain(Tile(3, "A"), "Luxor")
        board.set_chain(Tile(4, "A"), "Luxor")
        hotel.activate_chain("Luxor")

        # Bot chooses tile
        tile = bot.choose_tile_to_play(board, hotel)
        assert tile is not None
        assert tile in player.hand

        # Simulate playing the tile
        player.remove_tile(tile)
        board.place_tile(tile)

        # If founding, bot chooses chain
        inactive = hotel.get_inactive_chains()
        if inactive:
            chain = bot.choose_chain_to_found(inactive, board)
            assert chain in inactive

        # Bot chooses stocks to buy
        stocks = bot.choose_stocks_to_buy(board, hotel)
        assert len(stocks) <= 3

    def test_merger_handling(self):
        """Test bot handles merger decisions correctly."""
        player = Player("bot1", "Bot Player")
        player._stocks["Luxor"] = 5
        player._stocks["Tower"] = 3
        bot = Bot(player, difficulty="hard")
        board = Board()
        hotel = Hotel()

        # Set up two chains that could merge
        for col in range(1, 5):
            tile = Tile(col, "A")
            board.place_tile(tile)
            board.set_chain(tile, "Luxor")
        hotel.activate_chain("Luxor")

        for col in range(1, 5):
            tile = Tile(col, "C")
            board.place_tile(tile)
            board.set_chain(tile, "Tower")
        hotel.activate_chain("Tower")

        # Bot chooses survivor (tied at 4 tiles each)
        survivor = bot.choose_merger_survivor(["Luxor", "Tower"], board, hotel)
        assert survivor in ["Luxor", "Tower"]
        # Should prefer Luxor (more stock owned)
        assert survivor == "Luxor"

        # Bot handles stock disposition
        disposition = bot.choose_stock_disposition(
            "Tower", "Luxor", player._stocks["Tower"], board, hotel
        )
        assert "sell" in disposition
        assert "trade" in disposition
        assert "keep" in disposition
        assert disposition["sell"] + disposition["trade"] + disposition["keep"] == 3
