"""Hotel chain logic: chain definitions, prices and the bank's stock.

Everything numeric comes from the game's ``Ruleset``. ``Hotel.CHAINS`` and
``HotelTier`` are aliases of the default ruleset kept for older callers; the
engine itself uses ``hotel.ruleset`` / instance methods.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import ClassVar, Optional, Union

from game.board import hybridmethod
from game.ruleset import Ruleset, default_ruleset, resolve


class HotelTier(Enum):
    """The default ruleset's pricing tiers (alias; other rulesets use tier ids)."""

    CHEAP = "cheap"
    MEDIUM = "medium"
    EXPENSIVE = "expensive"


@dataclass
class HotelChain:
    """A chain: display data plus price lookups from its ruleset's tier."""

    name: str
    tier: Union[HotelTier, str]
    color: str
    ruleset: Optional[Ruleset] = field(default=None, compare=False, repr=False)

    @property
    def tier_id(self) -> str:
        return self.tier.value if isinstance(self.tier, HotelTier) else self.tier

    @property
    def _rs(self) -> Ruleset:
        return resolve(self.ruleset)

    def get_stock_price(self, size: int) -> int:
        """Get stock price based on chain size."""
        return self._rs.tier_price(self.tier_id, size)

    def get_majority_bonus(self, size: int) -> int:
        """Get majority stockholder bonus (multiplier x stock price)."""
        return self.get_stock_price(size) * self._rs.bonuses.majority_multiplier

    def get_minority_bonus(self, size: int) -> int:
        """Get minority stockholder bonus (multiplier x stock price)."""
        return self.get_stock_price(size) * self._rs.bonuses.minority_multiplier

    def is_safe(self, size: int) -> bool:
        """Check if chain is safe (cannot be acquired)."""
        return self._rs.is_safe_size(size)


def _chains_for(ruleset: Ruleset) -> dict[str, HotelChain]:
    return {c.id: HotelChain(c.id, c.tier, c.color, ruleset) for c in ruleset.chains}


def _default_chains() -> dict[str, HotelChain]:
    rs = default_ruleset()
    return {c.id: HotelChain(c.id, HotelTier(c.tier), c.color, rs) for c in rs.chains}


class Hotel:
    """Manages all hotel chains in the game (the bank's stock, active chains)."""

    # Default aliases (class-level); instances use their ruleset.
    ruleset: ClassVar[Ruleset] = default_ruleset()
    CHAINS: ClassVar[dict[str, HotelChain]] = _default_chains()
    TOTAL_STOCKS_PER_CHAIN: ClassVar[int] = default_ruleset().stocks_per_chain

    def __init__(self, ruleset: Optional[Ruleset] = None):
        self.ruleset = resolve(ruleset)
        self._chains = _chains_for(self.ruleset)
        # Track available stocks for each chain
        self._available_stocks: dict[str, int] = {
            name: self.ruleset.stocks_per_chain for name in self._chains
        }
        # Track if chain is on the board
        self._active_chains: set[str] = set()

    @hybridmethod
    def get_chain(target, name: str) -> HotelChain:
        """Get a hotel chain by id (on the class: default chains)."""
        if isinstance(target, Hotel):
            return target._chains[name]
        return target.CHAINS[name]

    @hybridmethod
    def get_all_chain_names(target) -> list[str]:
        """All chain ids in ruleset order (on the class: default chains)."""
        return list(target.ruleset.chain_ids)

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
        """Get list of chains currently on the board (sorted for determinism)."""
        return sorted(self._active_chains)

    def get_inactive_chains(self) -> list[str]:
        """Get list of chains not on the board (available to found)."""
        return [name for name in self._chains if name not in self._active_chains]

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
            self.ruleset.stocks_per_chain,
            self._available_stocks[chain_name] + quantity,
        )

    def get_stock_price(self, chain_name: str, size: int) -> int:
        """Get current stock price for a chain."""
        return self.ruleset.price(chain_name, size)

    def get_majority_bonus(self, chain_name: str, size: int) -> int:
        """Get majority bonus for a chain."""
        return self.ruleset.majority_bonus(chain_name, size)

    def get_minority_bonus(self, chain_name: str, size: int) -> int:
        """Get minority bonus for a chain."""
        return self.ruleset.minority_bonus(chain_name, size)

    def is_chain_safe(self, chain_name: str, size: int) -> bool:
        """Check if a chain is safe."""
        return self.ruleset.is_safe_size(size)

    def get_state(self) -> dict:
        """Get serializable state."""
        return {
            "available_stocks": dict(self._available_stocks),
            "active_chains": list(self._active_chains),
        }
