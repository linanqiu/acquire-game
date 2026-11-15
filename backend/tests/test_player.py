"""Tests for Player class."""

from game.board import Tile
from game.player import Player


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
        assert player.buy_stock("sandpiper", 3, 200) is True
        assert player.get_stock_count("sandpiper") == 3
        assert player.money == 6000 - 600

    def test_buy_stock_insufficient_funds(self):
        """Should fail to buy stock with insufficient funds."""
        player = Player("p1", "Alice")
        # Try to buy stock worth more than $6000
        assert player.buy_stock("aurelia", 10, 1000) is False
        assert player.get_stock_count("aurelia") == 0
        assert player.money == 6000

    def test_buy_stock_exact_funds(self):
        """Should succeed with exact amount of money."""
        player = Player("p1", "Alice")
        assert player.buy_stock("sandpiper", 20, 300) is True  # $6000 exactly
        assert player.get_stock_count("sandpiper") == 20
        assert player.money == 0

    def test_buy_stock_exceeds_max(self):
        """Should fail when purchase would exceed 25 stocks per chain."""
        player = Player("p1", "Alice")
        player._stocks["sandpiper"] = 23
        assert player.buy_stock("sandpiper", 3, 100) is False
        assert player.get_stock_count("sandpiper") == 23

    def test_buy_stock_at_max(self):
        """Should succeed when purchasing up to exactly 25 stocks."""
        player = Player("p1", "Alice")
        player._stocks["sandpiper"] = 20
        assert player.buy_stock("sandpiper", 5, 100) is True
        assert player.get_stock_count("sandpiper") == 25

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
        player._stocks["sandpiper"] = 5
        assert player.sell_stock("sandpiper", 3, 300) is True
        assert player.get_stock_count("sandpiper") == 2
        assert player.money == 6000 + 900

    def test_sell_stock_all(self):
        """Should successfully sell all stock."""
        player = Player("p1", "Alice")
        player._stocks["marlowe"] = 10
        assert player.sell_stock("marlowe", 10, 200) is True
        assert player.get_stock_count("marlowe") == 0
        assert player.money == 6000 + 2000

    def test_sell_stock_insufficient(self):
        """Should fail when selling more stock than owned."""
        player = Player("p1", "Alice")
        player._stocks["sandpiper"] = 2
        assert player.sell_stock("sandpiper", 5, 100) is False
        assert player.get_stock_count("sandpiper") == 2
        assert player.money == 6000

    def test_sell_stock_none_owned(self):
        """Should fail when selling stock not owned."""
        player = Player("p1", "Alice")
        assert player.sell_stock("sandpiper", 1, 100) is False
        assert player.money == 6000

    def test_sell_stock_invalid_chain(self):
        """Should fail for invalid chain name."""
        player = Player("p1", "Alice")
        assert player.sell_stock("InvalidChain", 1, 100) is False


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
        player._stocks["sandpiper"] = 5
        prices = {"sandpiper": 200}
        assert player.get_stock_value(prices) == 1000

    def test_stock_value_multiple_chains(self):
        """Should calculate value for multiple chains."""
        player = Player("p1", "Alice")
        player._stocks["sandpiper"] = 5
        player._stocks["halcyon"] = 3
        player._stocks["aurelia"] = 2
        prices = {"sandpiper": 200, "halcyon": 400, "aurelia": 600}
        # 5*200 + 3*400 + 2*600 = 1000 + 1200 + 1200 = 3400
        assert player.get_stock_value(prices) == 3400

    def test_stock_value_no_stocks(self):
        """Should return zero when no stocks owned."""
        player = Player("p1", "Alice")
        prices = {"sandpiper": 200, "halcyon": 400}
        assert player.get_stock_value(prices) == 0

    def test_stock_value_missing_price(self):
        """Should ignore chains without prices."""
        player = Player("p1", "Alice")
        player._stocks["sandpiper"] = 5
        player._stocks["halcyon"] = 3
        prices = {"sandpiper": 200}  # No price for halcyon
        assert player.get_stock_value(prices) == 1000

    def test_net_worth_calculation(self):
        """Should calculate total net worth correctly."""
        player = Player("p1", "Alice")
        player._stocks["sandpiper"] = 10
        prices = {"sandpiper": 300}
        # Money: 6000, Stock value: 10*300 = 3000
        assert player.get_net_worth(prices) == 9000


class TestStateSerialization:
    """Tests for get_state and from_state methods."""

    def test_get_state_with_data(self):
        """Should serialize player state with tiles and stocks."""
        player = Player("p1", "Alice")
        player.add_tile(Tile(1, "A"))
        player.add_tile(Tile(5, "C"))
        player._stocks["sandpiper"] = 5
        player._stocks["halcyon"] = 3
        player._money = 4500

        state = player.get_state()
        assert state["money"] == 4500
        assert "1A" in state["hand"]
        assert "5C" in state["hand"]
        assert state["stocks"]["sandpiper"] == 5
        assert state["stocks"]["halcyon"] == 3

    def test_from_state_roundtrip(self):
        """Should recreate player from serialized state."""
        original = Player("p1", "Alice")
        original.add_tile(Tile(1, "A"))
        original.add_tile(Tile(5, "C"))
        original._stocks["sandpiper"] = 5
        original._stocks["halcyon"] = 3
        original._money = 4500

        state = original.get_state()
        restored = Player.from_state(state)

        assert restored.player_id == original.player_id
        assert restored.name == original.name
        assert restored.money == original.money
        assert restored.hand_size == original.hand_size
        assert restored.has_tile(Tile(1, "A"))
        assert restored.has_tile(Tile(5, "C"))
        assert restored.get_stock_count("sandpiper") == 5
        assert restored.get_stock_count("halcyon") == 3


class TestHoldingsGuards:
    """A player's share holdings never go negative, never pass the per-chain
    limit, and a refused change leaves them untouched (the engine relies on
    these guards when it moves shares in mergers and trades)."""

    def test_add_remove_and_set_shares(self):
        p = Player("p1", "A")
        assert (
            p.add_stocks("sandpiper", 0) is True and p.get_stock_count("sandpiper") == 0
        )
        assert p.add_stocks("sandpiper", 24) is True
        assert p.add_stocks("sandpiper", 1) is True  # exactly the limit
        assert p.get_stock_count("sandpiper") == 25
        assert p.add_stocks("sandpiper", 1) is False  # one past it
        assert p.add_stocks("sandpiper", -1) is False
        assert p.add_stocks("Nowhere", 1) is False
        assert p.get_stock_count("sandpiper") == 25

        assert p.remove_stocks("sandpiper", 0) is True
        assert p.remove_stocks("sandpiper", 26) is False
        assert p.remove_stocks("sandpiper", -1) is False
        assert p.remove_stocks("Nowhere", 1) is False
        assert p.remove_stocks("sandpiper", 25) is True
        assert p.get_stock_count("sandpiper") == 0

        assert p.set_stocks("marlowe", 25) is True
        assert p.set_stocks("marlowe", 26) is False
        assert p.set_stocks("marlowe", -1) is False
        assert p.set_stocks("Nowhere", 1) is False
        assert p.get_stock_count("marlowe") == 25
        assert p.get_stock_count("Nowhere") == 0

    def test_trade_resources_are_checked_and_moved_atomically(self):
        p = Player("p1", "A")
        p.add_stocks("sandpiper", 3)
        assert p.can_afford_trade({"sandpiper": 3}, 6000) is True
        assert p.can_afford_trade({"sandpiper": 4}, 0) is False
        assert p.can_afford_trade({"sandpiper": -1}, 0) is False
        assert p.can_afford_trade({"Nowhere": 1}, 0) is False
        assert p.can_afford_trade({"Nowhere": 0}, 0) is True
        assert p.can_afford_trade({}, 6001) is False

        assert p.execute_trade_give({"sandpiper": 4}, 0) is False
        assert (p.money, p.get_stock_count("sandpiper")) == (6000, 3)
        assert p.execute_trade_give({"sandpiper": 2, "marlowe": 0}, 500) is True
        assert (p.money, p.get_stock_count("sandpiper")) == (5500, 1)

        assert p.execute_trade_receive({"sandpiper": -1}, 0) is False
        assert p.execute_trade_receive({"Nowhere": 1}, 0) is False
        assert p.execute_trade_receive({"sandpiper": 25}, 0) is False  # 1 + 25 > 25
        assert p.execute_trade_receive({}, -5) is False
        assert (p.money, p.get_stock_count("sandpiper")) == (5500, 1)
        assert p.execute_trade_receive({"sandpiper": 24, "marlowe": 0}, 100) is True
        assert (p.money, p.get_stock_count("sandpiper")) == (5600, 25)

    def test_share_value_counts_only_priced_holdings(self):
        p = Player("p1", "A")
        p.add_stocks("sandpiper", 2)
        assert p.get_stock_value({"sandpiper": 300, "marlowe": 900}) == 600
        assert p.get_stock_value({"marlowe": 900}) == 0
