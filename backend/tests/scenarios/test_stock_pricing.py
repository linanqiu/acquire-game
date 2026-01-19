"""Tests for stock pricing based on chain tiers and sizes."""

from game.hotel import Hotel, HotelTier


class TestPriceTiers:
    """Tests for pricing tiers of different chains."""

    def test_cheap_tier_luxor_tower(self):
        """Luxor and Tower are cheap tier chains."""
        hotel = Hotel()

        luxor = Hotel.get_chain("Luxor")
        tower = Hotel.get_chain("Tower")

        assert luxor.tier == HotelTier.CHEAP
        assert tower.tier == HotelTier.CHEAP

        # At size 2, cheap tier = $200
        assert hotel.get_stock_price("Luxor", 2) == 200
        assert hotel.get_stock_price("Tower", 2) == 200

    def test_medium_tier_american_worldwide_festival(self):
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

    def test_expensive_tier_imperial_continental(self):
        """Imperial and Continental are expensive tier chains."""
        hotel = Hotel()

        imperial = Hotel.get_chain("Imperial")
        continental = Hotel.get_chain("Continental")

        assert imperial.tier == HotelTier.EXPENSIVE
        assert continental.tier == HotelTier.EXPENSIVE

        # At size 2, expensive tier = $400
        assert hotel.get_stock_price("Imperial", 2) == 400
        assert hotel.get_stock_price("Continental", 2) == 400


class TestPriceBrackets:
    """Tests for price brackets based on chain size."""

    def test_price_increases_with_size(self):
        """Stock price should increase with chain size."""
        hotel = Hotel()

        # Cheap tier (Luxor) price progression
        assert hotel.get_stock_price("Luxor", 2) == 200
        assert hotel.get_stock_price("Luxor", 3) == 300
        assert hotel.get_stock_price("Luxor", 4) == 400
        assert hotel.get_stock_price("Luxor", 5) == 500
        assert hotel.get_stock_price("Luxor", 6) == 600

        # Medium tier (American) price progression
        assert hotel.get_stock_price("American", 2) == 300
        assert hotel.get_stock_price("American", 3) == 400
        assert hotel.get_stock_price("American", 4) == 500
        assert hotel.get_stock_price("American", 5) == 600
        assert hotel.get_stock_price("American", 6) == 700

        # Expensive tier (Imperial) price progression
        assert hotel.get_stock_price("Imperial", 2) == 400
        assert hotel.get_stock_price("Imperial", 3) == 500
        assert hotel.get_stock_price("Imperial", 4) == 600
        assert hotel.get_stock_price("Imperial", 5) == 700
        assert hotel.get_stock_price("Imperial", 6) == 800

    def test_size_11_safety_threshold(self):
        """Size 11 is the safety threshold and triggers price increase."""
        hotel = Hotel()

        # At size 10, still in 6-10 bracket
        assert hotel.get_stock_price("Luxor", 10) == 600
        # At size 11, moves to 11-20 bracket
        assert hotel.get_stock_price("Luxor", 11) == 700

        assert hotel.get_stock_price("American", 10) == 700
        assert hotel.get_stock_price("American", 11) == 800

        assert hotel.get_stock_price("Imperial", 10) == 800
        assert hotel.get_stock_price("Imperial", 11) == 900

    def test_size_41_max_price(self):
        """Size 41+ is the maximum price bracket."""
        hotel = Hotel()

        # Maximum prices
        assert hotel.get_stock_price("Luxor", 41) == 1000
        assert hotel.get_stock_price("Luxor", 50) == 1000  # Still max

        assert hotel.get_stock_price("American", 41) == 1100
        assert hotel.get_stock_price("American", 100) == 1100

        assert hotel.get_stock_price("Imperial", 41) == 1200
        assert hotel.get_stock_price("Imperial", 108) == 1200  # Max tiles on board

    def test_all_price_brackets(self):
        """Test all price brackets for each tier."""
        hotel = Hotel()

        # Cheap tier brackets
        cheap_expected = {
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
        for size, expected_price in cheap_expected.items():
            assert hotel.get_stock_price("Luxor", size) == expected_price, (
                f"Luxor size {size}"
            )

        # Medium tier brackets (+$100 from cheap)
        for size, cheap_price in cheap_expected.items():
            assert hotel.get_stock_price("American", size) == cheap_price + 100, (
                f"American size {size}"
            )

        # Expensive tier brackets (+$200 from cheap)
        for size, cheap_price in cheap_expected.items():
            assert hotel.get_stock_price("Imperial", size) == cheap_price + 200, (
                f"Imperial size {size}"
            )


class TestBonusPricing:
    """Tests for majority/minority bonus pricing."""

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
    """Tests for chain safety status."""

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
