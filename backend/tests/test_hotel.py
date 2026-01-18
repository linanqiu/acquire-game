"""Tests for hotel.py - Hotel chain logic."""

from game.hotel import Hotel, HotelChain, HotelTier


class TestHotelChain:
    """Tests for HotelChain class."""

    def test_cheap_tier_price_size_2(self):
        chain = HotelChain("Luxor", HotelTier.CHEAP, "#FFD700")
        assert chain.get_stock_price(2) == 200

    def test_cheap_tier_price_size_5(self):
        chain = HotelChain("Luxor", HotelTier.CHEAP, "#FFD700")
        assert chain.get_stock_price(5) == 500

    def test_cheap_tier_price_size_6(self):
        chain = HotelChain("Tower", HotelTier.CHEAP, "#8B4513")
        assert chain.get_stock_price(6) == 600

    def test_cheap_tier_price_size_10(self):
        chain = HotelChain("Luxor", HotelTier.CHEAP, "#FFD700")
        assert chain.get_stock_price(10) == 600

    def test_cheap_tier_price_size_11(self):
        chain = HotelChain("Luxor", HotelTier.CHEAP, "#FFD700")
        assert chain.get_stock_price(11) == 700

    def test_cheap_tier_price_size_41(self):
        chain = HotelChain("Luxor", HotelTier.CHEAP, "#FFD700")
        assert chain.get_stock_price(41) == 1000

    def test_medium_tier_price_size_2(self):
        chain = HotelChain("American", HotelTier.MEDIUM, "#0000FF")
        assert chain.get_stock_price(2) == 300

    def test_medium_tier_price_size_11(self):
        chain = HotelChain("American", HotelTier.MEDIUM, "#0000FF")
        assert chain.get_stock_price(11) == 800

    def test_expensive_tier_price_size_2(self):
        chain = HotelChain("Imperial", HotelTier.EXPENSIVE, "#FF0000")
        assert chain.get_stock_price(2) == 400

    def test_expensive_tier_price_size_41(self):
        chain = HotelChain("Continental", HotelTier.EXPENSIVE, "#00FFFF")
        assert chain.get_stock_price(41) == 1200

    def test_price_size_0(self):
        chain = HotelChain("Luxor", HotelTier.CHEAP, "#FFD700")
        assert chain.get_stock_price(0) == 0

    def test_price_size_1(self):
        chain = HotelChain("Luxor", HotelTier.CHEAP, "#FFD700")
        assert chain.get_stock_price(1) == 0

    def test_majority_bonus(self):
        chain = HotelChain("Luxor", HotelTier.CHEAP, "#FFD700")
        # Price at size 5 is $500, majority bonus is 10x
        assert chain.get_majority_bonus(5) == 5000

    def test_minority_bonus(self):
        chain = HotelChain("Luxor", HotelTier.CHEAP, "#FFD700")
        # Price at size 5 is $500, minority bonus is 5x
        assert chain.get_minority_bonus(5) == 2500

    def test_is_safe_below_threshold(self):
        chain = HotelChain("Luxor", HotelTier.CHEAP, "#FFD700")
        assert chain.is_safe(10) is False

    def test_is_safe_at_threshold(self):
        chain = HotelChain("Luxor", HotelTier.CHEAP, "#FFD700")
        assert chain.is_safe(11) is True

    def test_is_safe_above_threshold(self):
        chain = HotelChain("Luxor", HotelTier.CHEAP, "#FFD700")
        assert chain.is_safe(20) is True


class TestHotel:
    """Tests for Hotel class managing all chains."""

    def test_get_chain(self):
        chain = Hotel.get_chain("Luxor")
        assert chain.name == "Luxor"
        assert chain.tier == HotelTier.CHEAP

    def test_get_all_chain_names(self):
        names = Hotel.get_all_chain_names()
        assert len(names) == 7
        assert "Luxor" in names
        assert "Continental" in names

    def test_initial_available_stocks(self):
        hotel = Hotel()
        assert hotel.get_available_stocks("Luxor") == 25
        assert hotel.get_available_stocks("Imperial") == 25

    def test_activate_chain(self):
        hotel = Hotel()
        assert hotel.is_chain_active("Luxor") is False
        hotel.activate_chain("Luxor")
        assert hotel.is_chain_active("Luxor") is True

    def test_deactivate_chain(self):
        hotel = Hotel()
        hotel.activate_chain("Luxor")
        hotel.deactivate_chain("Luxor")
        assert hotel.is_chain_active("Luxor") is False

    def test_get_active_chains(self):
        hotel = Hotel()
        hotel.activate_chain("Luxor")
        hotel.activate_chain("Tower")
        active = hotel.get_active_chains()
        assert set(active) == {"Luxor", "Tower"}

    def test_get_inactive_chains(self):
        hotel = Hotel()
        hotel.activate_chain("Luxor")
        inactive = hotel.get_inactive_chains()
        assert "Luxor" not in inactive
        assert len(inactive) == 6

    def test_buy_stock_success(self):
        hotel = Hotel()
        result = hotel.buy_stock("Luxor", 3)
        assert result is True
        assert hotel.get_available_stocks("Luxor") == 22

    def test_buy_stock_insufficient(self):
        hotel = Hotel()
        # Buy all stocks
        hotel.buy_stock("Luxor", 25)
        result = hotel.buy_stock("Luxor", 1)
        assert result is False
        assert hotel.get_available_stocks("Luxor") == 0

    def test_return_stock(self):
        hotel = Hotel()
        hotel.buy_stock("Luxor", 5)
        hotel.return_stock("Luxor", 3)
        assert hotel.get_available_stocks("Luxor") == 23

    def test_return_stock_capped(self):
        hotel = Hotel()
        hotel.return_stock("Luxor", 10)
        assert hotel.get_available_stocks("Luxor") == 25

    def test_get_stock_price(self):
        hotel = Hotel()
        price = hotel.get_stock_price("Luxor", 5)
        assert price == 500

    def test_get_majority_bonus(self):
        hotel = Hotel()
        bonus = hotel.get_majority_bonus("Imperial", 11)
        assert bonus == 9000  # $900 price * 10

    def test_get_minority_bonus(self):
        hotel = Hotel()
        bonus = hotel.get_minority_bonus("Imperial", 11)
        assert bonus == 4500  # $900 price * 5

    def test_is_chain_safe(self):
        hotel = Hotel()
        assert hotel.is_chain_safe("Luxor", 10) is False
        assert hotel.is_chain_safe("Luxor", 11) is True

    def test_get_state(self):
        hotel = Hotel()
        hotel.activate_chain("Luxor")
        hotel.buy_stock("Tower", 5)
        state = hotel.get_state()
        assert "Luxor" in state["active_chains"]
        assert state["available_stocks"]["Tower"] == 20

    def test_load_state(self):
        hotel = Hotel()
        state = {
            "available_stocks": {
                "Luxor": 20,
                "Tower": 25,
                "American": 25,
                "Worldwide": 25,
                "Festival": 25,
                "Imperial": 25,
                "Continental": 25,
            },
            "active_chains": ["Luxor", "Tower"],
        }
        hotel.load_state(state)
        assert hotel.get_available_stocks("Luxor") == 20
        assert hotel.is_chain_active("Luxor") is True
        assert hotel.is_chain_active("Tower") is True


class TestHotelTierPricing:
    """Verify pricing across all tiers and sizes."""

    def test_all_tiers_size_progression(self):
        """Verify prices increase with size for all tiers."""
        for tier in HotelTier:
            chain = HotelChain("Test", tier, "#000")
            prev_price = 0
            for size in [2, 3, 4, 5, 6, 11, 21, 31, 41]:
                price = chain.get_stock_price(size)
                assert price >= prev_price, f"Price should increase: {tier} size {size}"
                prev_price = price

    def test_tier_ordering(self):
        """Cheap < Medium < Expensive at same size."""
        cheap = HotelChain("Cheap", HotelTier.CHEAP, "#000")
        medium = HotelChain("Medium", HotelTier.MEDIUM, "#000")
        expensive = HotelChain("Expensive", HotelTier.EXPENSIVE, "#000")

        for size in [2, 5, 11, 41]:
            assert cheap.get_stock_price(size) < medium.get_stock_price(size)
            assert medium.get_stock_price(size) < expensive.get_stock_price(size)
