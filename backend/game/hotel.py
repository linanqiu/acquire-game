"""The bank: active chains, available stock and price lookups.

Everything numeric comes from the game's ``Ruleset``.
"""

from typing import Optional

from game.ruleset import Ruleset, resolve


class Hotel:
    """Manages all hotel chains in the game (the bank's stock, active chains)."""

    def __init__(self, ruleset: Optional[Ruleset] = None):
        self.ruleset = resolve(ruleset)
        # Track available stocks for each chain
        self._available_stocks: dict[str, int] = {
            name: self.ruleset.stocks_per_chain for name in self.ruleset.chain_ids
        }
        # Track if chain is on the board
        self._active_chains: set[str] = set()

    def get_all_chain_names(self) -> list[str]:
        """All chain ids in ruleset order."""
        return list(self.ruleset.chain_ids)

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
        return [
            name for name in self.ruleset.chain_ids if name not in self._active_chains
        ]

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
