"""Hotel chain logic for Acquire."""

from enum import Enum
from dataclasses import dataclass
from typing import ClassVar


class HotelTier(Enum):
    """Hotel chain pricing tiers."""

    CHEAP = "cheap"
    MEDIUM = "medium"
    EXPENSIVE = "expensive"


@dataclass
class HotelChain:
    """Represents a hotel chain."""

    name: str
    tier: HotelTier
    color: str

    # Price tables by tier (size -> price)
    # Based on classic Acquire rules
    PRICE_TABLE: ClassVar[dict[HotelTier, dict[int, int]]] = {
        HotelTier.CHEAP: {
            2: 200,
            3: 300,
            4: 400,
            5: 500,
            6: 600,
            11: 700,
            21: 800,
            31: 900,
            41: 1000,
        },
        HotelTier.MEDIUM: {
            2: 300,
            3: 400,
            4: 500,
            5: 600,
            6: 700,
            11: 800,
            21: 900,
            31: 1000,
            41: 1100,
        },
        HotelTier.EXPENSIVE: {
            2: 400,
            3: 500,
            4: 600,
            5: 700,
            6: 800,
            11: 900,
            21: 1000,
            31: 1100,
            41: 1200,
        },
    }

    SAFE_SIZE: ClassVar[int] = 11

    def get_stock_price(self, size: int) -> int:
        """Get stock price based on chain size."""
        if size < 2:
            return 0

        price_table = self.PRICE_TABLE[self.tier]
        # Find the appropriate price bracket
        price = 0
        for threshold, bracket_price in sorted(price_table.items()):
            if size >= threshold:
                price = bracket_price
            else:
                break
        return price

    def get_majority_bonus(self, size: int) -> int:
        """Get majority stockholder bonus (10x stock price)."""
        return self.get_stock_price(size) * 10

    def get_minority_bonus(self, size: int) -> int:
        """Get minority stockholder bonus (5x stock price)."""
        return self.get_stock_price(size) * 5

    def is_safe(self, size: int) -> bool:
        """Check if chain is safe (cannot be acquired)."""
        return size >= self.SAFE_SIZE


class Hotel:
    """Manages all hotel chains in the game."""

    # Define the 7 chains
    CHAINS: ClassVar[dict[str, HotelChain]] = {
        "Luxor": HotelChain("Luxor", HotelTier.CHEAP, "#FFD700"),  # Gold
        "Tower": HotelChain("Tower", HotelTier.CHEAP, "#8B4513"),  # Brown
        "American": HotelChain("American", HotelTier.MEDIUM, "#0000FF"),  # Blue
        "Worldwide": HotelChain("Worldwide", HotelTier.MEDIUM, "#800080"),  # Purple
        "Festival": HotelChain("Festival", HotelTier.MEDIUM, "#008000"),  # Green
        "Imperial": HotelChain("Imperial", HotelTier.EXPENSIVE, "#FF0000"),  # Red
        "Continental": HotelChain(
            "Continental", HotelTier.EXPENSIVE, "#00FFFF"
        ),  # Cyan
    }

    TOTAL_STOCKS_PER_CHAIN: ClassVar[int] = 25

    def __init__(self):
        # Track available stocks for each chain
        self._available_stocks: dict[str, int] = {
            name: self.TOTAL_STOCKS_PER_CHAIN for name in self.CHAINS
        }
        # Track if chain is on the board
        self._active_chains: set[str] = set()

    @classmethod
    def get_chain(cls, name: str) -> HotelChain:
        """Get a hotel chain by name."""
        return cls.CHAINS[name]

    @classmethod
    def get_all_chain_names(cls) -> list[str]:
        """Get all chain names."""
        return list(cls.CHAINS.keys())

    def activate_chain(self, name: str):
        """Mark a chain as active on the board."""
        self._active_chains.add(name)

    def deactivate_chain(self, name: str):
        """Mark a chain as no longer on the board (merged)."""
        self._active_chains.discard(name)

    def is_chain_active(self, name: str) -> bool:
        """Check if a chain is currently on the board."""
        return name in self._active_chains

    def get_active_chains(self) -> list[str]:
        """Get list of chains currently on the board."""
        return list(self._active_chains)

    def get_inactive_chains(self) -> list[str]:
        """Get list of chains not on the board (available to found)."""
        return [name for name in self.CHAINS if name not in self._active_chains]

    def get_available_stocks(self, chain_name: str) -> int:
        """Get number of stocks available to purchase."""
        return self._available_stocks[chain_name]

    def buy_stock(self, chain_name: str, quantity: int = 1) -> bool:
        """Remove stocks from available pool. Returns True if successful."""
        if self._available_stocks[chain_name] >= quantity:
            self._available_stocks[chain_name] -= quantity
            return True
        return False

    def return_stock(self, chain_name: str, quantity: int = 1):
        """Return stocks to the available pool."""
        self._available_stocks[chain_name] = min(
            self.TOTAL_STOCKS_PER_CHAIN, self._available_stocks[chain_name] + quantity
        )

    def get_stock_price(self, chain_name: str, size: int) -> int:
        """Get current stock price for a chain."""
        return self.CHAINS[chain_name].get_stock_price(size)

    def get_majority_bonus(self, chain_name: str, size: int) -> int:
        """Get majority bonus for a chain."""
        return self.CHAINS[chain_name].get_majority_bonus(size)

    def get_minority_bonus(self, chain_name: str, size: int) -> int:
        """Get minority bonus for a chain."""
        return self.CHAINS[chain_name].get_minority_bonus(size)

    def is_chain_safe(self, chain_name: str, size: int) -> bool:
        """Check if a chain is safe."""
        return self.CHAINS[chain_name].is_safe(size)

    def get_state(self) -> dict:
        """Get serializable state."""
        return {
            "available_stocks": dict(self._available_stocks),
            "active_chains": list(self._active_chains),
        }

    def load_state(self, state: dict):
        """Load state from dict."""
        self._available_stocks = dict(state["available_stocks"])
        self._active_chains = set(state["active_chains"])
