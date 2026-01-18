"""Tests for Player class."""

from game.board import Tile
from game.player import Player
from game.hotel import Hotel


class TestPlayerInitialization:
    """Tests for player starting state."""

    def test_starting_money(self):
        """Player should start with $6000."""
        player = Player("p1", "Alice")
        assert player.money == 6000

    def test_starting_hand_empty(self):
        """Player should start with empty hand."""
        player = Player("p1", "Alice")
        assert player.hand == []
        assert player.hand_size == 0

    def test_starting_stocks_empty(self):
        """Player should start with no stocks."""
        player = Player("p1", "Alice")
        for chain_name in Hotel.get_all_chain_names():
            assert player.get_stock_count(chain_name) == 0

    def test_player_id_and_name(self):
        """Player should store id and name correctly."""
        player = Player("player_123", "Bob")
        assert player.player_id == "player_123"
        assert player.name == "Bob"


class TestTileManagement:
    """Tests for adding and removing tiles from hand."""

    def test_add_tile_success(self):
        """Should successfully add tile to hand."""
        player = Player("p1", "Alice")
        tile = Tile(1, "A")
        assert player.add_tile(tile) is True
        assert player.hand_size == 1
        assert player.has_tile(tile) is True

    def test_add_multiple_tiles(self):
        """Should add multiple tiles up to max hand size."""
        player = Player("p1", "Alice")
        for i in range(1, 7):
            tile = Tile(i, "A")
            assert player.add_tile(tile) is True
        assert player.hand_size == 6

    def test_add_tile_hand_full(self):
        """Should fail to add tile when hand is full."""
        player = Player("p1", "Alice")
        # Fill hand
        for i in range(1, 7):
            player.add_tile(Tile(i, "A"))
        # Try to add 7th tile
        extra_tile = Tile(7, "A")
        assert player.add_tile(extra_tile) is False
        assert player.hand_size == 6
        assert player.has_tile(extra_tile) is False

    def test_add_duplicate_tile(self):
        """Should fail to add duplicate tile."""
        player = Player("p1", "Alice")
        tile = Tile(1, "A")
        assert player.add_tile(tile) is True
        assert player.add_tile(tile) is False
        assert player.hand_size == 1

    def test_remove_tile_success(self):
        """Should successfully remove tile from hand."""
        player = Player("p1", "Alice")
        tile = Tile(1, "A")
        player.add_tile(tile)
        assert player.remove_tile(tile) is True
        assert player.hand_size == 0
        assert player.has_tile(tile) is False

    def test_remove_tile_not_in_hand(self):
        """Should fail to remove tile not in hand."""
        player = Player("p1", "Alice")
        tile = Tile(1, "A")
        assert player.remove_tile(tile) is False

    def test_hand_returns_copy(self):
        """Hand property should return a copy, not the internal list."""
        player = Player("p1", "Alice")
        tile = Tile(1, "A")
        player.add_tile(tile)
        hand = player.hand
        hand.clear()
        assert player.hand_size == 1


class TestStockPurchase:
    """Tests for buying stock."""

    def test_buy_stock_success(self):
        """Should successfully buy stock with sufficient funds."""
        player = Player("p1", "Alice")
        assert player.buy_stock("Luxor", 3, 200) is True
        assert player.get_stock_count("Luxor") == 3
        assert player.money == 6000 - 600

    def test_buy_stock_insufficient_funds(self):
        """Should fail to buy stock with insufficient funds."""
        player = Player("p1", "Alice")
        # Try to buy stock worth more than $6000
        assert player.buy_stock("Continental", 10, 1000) is False
        assert player.get_stock_count("Continental") == 0
        assert player.money == 6000

    def test_buy_stock_exact_funds(self):
        """Should succeed with exact amount of money."""
        player = Player("p1", "Alice")
        assert player.buy_stock("Luxor", 20, 300) is True  # $6000 exactly
        assert player.get_stock_count("Luxor") == 20
        assert player.money == 0

    def test_buy_stock_exceeds_max(self):
        """Should fail when purchase would exceed 25 stocks per chain."""
        player = Player("p1", "Alice")
        player._stocks["Luxor"] = 23
        assert player.buy_stock("Luxor", 3, 100) is False
        assert player.get_stock_count("Luxor") == 23

    def test_buy_stock_at_max(self):
        """Should succeed when purchasing up to exactly 25 stocks."""
        player = Player("p1", "Alice")
        player._stocks["Luxor"] = 20
        assert player.buy_stock("Luxor", 5, 100) is True
        assert player.get_stock_count("Luxor") == 25

    def test_buy_stock_invalid_chain(self):
        """Should fail for invalid chain name."""
        player = Player("p1", "Alice")
        assert player.buy_stock("InvalidChain", 1, 100) is False
        assert player.money == 6000


class TestStockSale:
    """Tests for selling stock."""

    def test_sell_stock_success(self):
        """Should successfully sell owned stock."""
        player = Player("p1", "Alice")
        player._stocks["Luxor"] = 5
        assert player.sell_stock("Luxor", 3, 300) is True
        assert player.get_stock_count("Luxor") == 2
        assert player.money == 6000 + 900

    def test_sell_stock_all(self):
        """Should successfully sell all stock."""
        player = Player("p1", "Alice")
        player._stocks["Tower"] = 10
        assert player.sell_stock("Tower", 10, 200) is True
        assert player.get_stock_count("Tower") == 0
        assert player.money == 6000 + 2000

    def test_sell_stock_insufficient(self):
        """Should fail when selling more stock than owned."""
        player = Player("p1", "Alice")
        player._stocks["Luxor"] = 2
        assert player.sell_stock("Luxor", 5, 100) is False
        assert player.get_stock_count("Luxor") == 2
        assert player.money == 6000

    def test_sell_stock_none_owned(self):
        """Should fail when selling stock not owned."""
        player = Player("p1", "Alice")
        assert player.sell_stock("Luxor", 1, 100) is False
        assert player.money == 6000

    def test_sell_stock_invalid_chain(self):
        """Should fail for invalid chain name."""
        player = Player("p1", "Alice")
        assert player.sell_stock("InvalidChain", 1, 100) is False


class TestStockTrade:
    """Tests for trading stocks (2 defunct for 1 surviving)."""

    def test_trade_stock_success(self):
        """Should successfully trade 2 defunct for 1 surviving."""
        player = Player("p1", "Alice")
        player._stocks["Luxor"] = 10  # defunct
        player._stocks["American"] = 5  # surviving
        assert player.trade_stock("Luxor", "American", 6) is True
        assert player.get_stock_count("Luxor") == 4
        assert player.get_stock_count("American") == 8

    def test_trade_stock_odd_quantity_fails(self):
        """Should fail when trading odd number (not divisible by 2)."""
        player = Player("p1", "Alice")
        player._stocks["Luxor"] = 10
        player._stocks["American"] = 5
        assert player.trade_stock("Luxor", "American", 5) is False
        assert player.get_stock_count("Luxor") == 10
        assert player.get_stock_count("American") == 5

    def test_trade_stock_insufficient_defunct(self):
        """Should fail when not enough defunct stock."""
        player = Player("p1", "Alice")
        player._stocks["Luxor"] = 2
        player._stocks["American"] = 5
        assert player.trade_stock("Luxor", "American", 4) is False
        assert player.get_stock_count("Luxor") == 2

    def test_trade_stock_exceeds_max_surviving(self):
        """Should fail when trade would exceed max surviving stock."""
        player = Player("p1", "Alice")
        player._stocks["Luxor"] = 20
        player._stocks["American"] = 20
        # Trading 12 Luxor would give 6 American, total 26 > 25
        assert player.trade_stock("Luxor", "American", 12) is False
        assert player.get_stock_count("Luxor") == 20
        assert player.get_stock_count("American") == 20

    def test_trade_stock_to_max_surviving(self):
        """Should succeed when trade results in exactly max surviving."""
        player = Player("p1", "Alice")
        player._stocks["Luxor"] = 20
        player._stocks["American"] = 20
        # Trading 10 Luxor gives 5 American, total 25 = max
        assert player.trade_stock("Luxor", "American", 10) is True
        assert player.get_stock_count("Luxor") == 10
        assert player.get_stock_count("American") == 25

    def test_trade_stock_invalid_defunct_chain(self):
        """Should fail for invalid defunct chain."""
        player = Player("p1", "Alice")
        player._stocks["American"] = 5
        assert player.trade_stock("InvalidChain", "American", 2) is False

    def test_trade_stock_invalid_surviving_chain(self):
        """Should fail for invalid surviving chain."""
        player = Player("p1", "Alice")
        player._stocks["Luxor"] = 10
        assert player.trade_stock("Luxor", "InvalidChain", 2) is False


class TestMoneyManagement:
    """Tests for adding and removing money."""

    def test_add_money_success(self):
        """Should successfully add money."""
        player = Player("p1", "Alice")
        assert player.add_money(1000) is True
        assert player.money == 7000

    def test_add_money_zero(self):
        """Should successfully add zero money."""
        player = Player("p1", "Alice")
        assert player.add_money(0) is True
        assert player.money == 6000

    def test_add_money_negative_fails(self):
        """Should fail to add negative amount."""
        player = Player("p1", "Alice")
        assert player.add_money(-100) is False
        assert player.money == 6000

    def test_remove_money_success(self):
        """Should successfully remove money."""
        player = Player("p1", "Alice")
        assert player.remove_money(1000) is True
        assert player.money == 5000

    def test_remove_money_exact(self):
        """Should successfully remove exact balance."""
        player = Player("p1", "Alice")
        assert player.remove_money(6000) is True
        assert player.money == 0

    def test_remove_money_insufficient(self):
        """Should fail to remove more than balance."""
        player = Player("p1", "Alice")
        assert player.remove_money(7000) is False
        assert player.money == 6000

    def test_remove_money_negative_fails(self):
        """Should fail to remove negative amount."""
        player = Player("p1", "Alice")
        assert player.remove_money(-100) is False
        assert player.money == 6000

    def test_remove_money_zero(self):
        """Should successfully remove zero money."""
        player = Player("p1", "Alice")
        assert player.remove_money(0) is True
        assert player.money == 6000


class TestStockValueCalculation:
    """Tests for calculating stock value."""

    def test_stock_value_single_chain(self):
        """Should calculate value for single chain."""
        player = Player("p1", "Alice")
        player._stocks["Luxor"] = 5
        prices = {"Luxor": 200}
        assert player.get_stock_value(prices) == 1000

    def test_stock_value_multiple_chains(self):
        """Should calculate value for multiple chains."""
        player = Player("p1", "Alice")
        player._stocks["Luxor"] = 5
        player._stocks["American"] = 3
        player._stocks["Continental"] = 2
        prices = {"Luxor": 200, "American": 400, "Continental": 600}
        # 5*200 + 3*400 + 2*600 = 1000 + 1200 + 1200 = 3400
        assert player.get_stock_value(prices) == 3400

    def test_stock_value_no_stocks(self):
        """Should return zero when no stocks owned."""
        player = Player("p1", "Alice")
        prices = {"Luxor": 200, "American": 400}
        assert player.get_stock_value(prices) == 0

    def test_stock_value_missing_price(self):
        """Should ignore chains without prices."""
        player = Player("p1", "Alice")
        player._stocks["Luxor"] = 5
        player._stocks["American"] = 3
        prices = {"Luxor": 200}  # No price for American
        assert player.get_stock_value(prices) == 1000

    def test_net_worth_calculation(self):
        """Should calculate total net worth correctly."""
        player = Player("p1", "Alice")
        player._stocks["Luxor"] = 10
        prices = {"Luxor": 300}
        # Money: 6000, Stock value: 10*300 = 3000
        assert player.get_net_worth(prices) == 9000


class TestStateSerialization:
    """Tests for get_state and from_state methods."""

    def test_get_state_initial(self):
        """Should serialize initial player state."""
        player = Player("p1", "Alice")
        state = player.get_state()
        assert state["player_id"] == "p1"
        assert state["name"] == "Alice"
        assert state["money"] == 6000
        assert state["hand"] == []
        assert all(count == 0 for count in state["stocks"].values())

    def test_get_state_with_data(self):
        """Should serialize player state with tiles and stocks."""
        player = Player("p1", "Alice")
        player.add_tile(Tile(1, "A"))
        player.add_tile(Tile(5, "C"))
        player._stocks["Luxor"] = 5
        player._stocks["American"] = 3
        player._money = 4500

        state = player.get_state()
        assert state["money"] == 4500
        assert "1A" in state["hand"]
        assert "5C" in state["hand"]
        assert state["stocks"]["Luxor"] == 5
        assert state["stocks"]["American"] == 3

    def test_from_state_roundtrip(self):
        """Should recreate player from serialized state."""
        original = Player("p1", "Alice")
        original.add_tile(Tile(1, "A"))
        original.add_tile(Tile(5, "C"))
        original._stocks["Luxor"] = 5
        original._stocks["American"] = 3
        original._money = 4500

        state = original.get_state()
        restored = Player.from_state(state)

        assert restored.player_id == original.player_id
        assert restored.name == original.name
        assert restored.money == original.money
        assert restored.hand_size == original.hand_size
        assert restored.has_tile(Tile(1, "A"))
        assert restored.has_tile(Tile(5, "C"))
        assert restored.get_stock_count("Luxor") == 5
        assert restored.get_stock_count("American") == 3


class TestPlayerRepr:
    """Tests for player string representation."""

    def test_repr(self):
        """Should return readable representation."""
        player = Player("p1", "Alice")
        repr_str = repr(player)
        assert "p1" in repr_str
        assert "Alice" in repr_str
        assert "6000" in repr_str
