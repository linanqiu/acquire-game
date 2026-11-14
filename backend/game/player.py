"""Player state and actions for Acquire."""

from typing import Optional

from game.board import Tile
from game.ruleset import Ruleset, classic, resolve


class Player:
    """Represents a player in the Acquire game.

    Limits come from the ruleset; the class constants are classic aliases.
    """

    STARTING_MONEY = classic().starting_cash
    MAX_HAND_SIZE = classic().hand_size
    MAX_STOCKS_PER_CHAIN = classic().stocks_per_chain

    def __init__(self, player_id: str, name: str, ruleset: Optional[Ruleset] = None):
        """Initialize a new player.

        Args:
            player_id: Unique identifier for the player
            name: Display name for the player
            ruleset: Game parameters (default: classic)
        """
        self.ruleset = resolve(ruleset)
        self.player_id = player_id
        self.name = name
        self._money = self.ruleset.starting_cash
        self._hand: list[Tile] = []
        self._stocks: dict[str, int] = {chain: 0 for chain in self.ruleset.chain_ids}

    @property
    def max_stocks_per_chain(self) -> int:
        """A player can hold at most every share of a chain."""
        return self.ruleset.stocks_per_chain

    @property
    def money(self) -> int:
        """Get current money."""
        return self._money

    @property
    def hand(self) -> list[Tile]:
        """Get current hand of tiles."""
        return list(self._hand)

    @property
    def hand_size(self) -> int:
        """Get number of tiles in hand."""
        return len(self._hand)

    @property
    def stocks(self) -> dict[str, int]:
        """Get stock holdings."""
        return dict(self._stocks)

    def add_tile(self, tile: Tile) -> bool:
        """Add a tile to the player's hand.

        Args:
            tile: The tile to add

        Returns:
            True if tile was added, False if hand is full
        """
        if len(self._hand) >= self.ruleset.hand_size:
            return False
        if tile in self._hand:
            return False
        self._hand.append(tile)
        return True

    def remove_tile(self, tile: Tile) -> bool:
        """Remove a tile from the player's hand.

        Args:
            tile: The tile to remove

        Returns:
            True if tile was removed, False if not in hand
        """
        if tile not in self._hand:
            return False
        self._hand.remove(tile)
        return True

    def has_tile(self, tile: Tile) -> bool:
        """Check if player has a specific tile."""
        return tile in self._hand

    def buy_stock(self, chain_name: str, quantity: int, price_per_share: int) -> bool:
        """Buy stock in a hotel chain.

        Args:
            chain_name: Name of the hotel chain
            quantity: Number of shares to buy
            price_per_share: Price per share

        Returns:
            True if purchase successful, False otherwise
        """
        if chain_name not in self._stocks:
            return False

        total_cost = quantity * price_per_share

        # Check if player has enough money
        if total_cost > self._money:
            return False

        # Check if purchase would exceed max stocks per chain
        if self._stocks[chain_name] + quantity > self.max_stocks_per_chain:
            return False

        self._money -= total_cost
        self._stocks[chain_name] += quantity
        return True

    def sell_stock(self, chain_name: str, quantity: int, price_per_share: int) -> bool:
        """Sell stock in a hotel chain.

        Args:
            chain_name: Name of the hotel chain
            quantity: Number of shares to sell
            price_per_share: Price per share

        Returns:
            True if sale successful, False otherwise
        """
        if chain_name not in self._stocks:
            return False

        # Check if player has enough stock
        if self._stocks[chain_name] < quantity:
            return False

        self._stocks[chain_name] -= quantity
        self._money += quantity * price_per_share
        return True

    def trade_stock(
        self, defunct_chain: str, surviving_chain: str, defunct_quantity: int
    ) -> bool:
        """Trade defunct stock for surviving stock at the ruleset's ratio (2:1).

        Args:
            defunct_chain: Name of the defunct chain (being traded away)
            surviving_chain: Name of the surviving chain (being received)
            defunct_quantity: Defunct shares to trade (a multiple of the ratio)

        Returns:
            True if trade successful, False otherwise
        """
        # Validate chains exist
        if defunct_chain not in self._stocks or surviving_chain not in self._stocks:
            return False

        ratio = self.ruleset.merger_trade_ratio
        if defunct_quantity % ratio != 0:
            return False

        # Check if player has enough defunct stock
        if self._stocks[defunct_chain] < defunct_quantity:
            return False

        surviving_quantity = defunct_quantity // ratio

        # Check if receiving stock would exceed max
        if (
            self._stocks[surviving_chain] + surviving_quantity
            > self.max_stocks_per_chain
        ):
            return False

        self._stocks[defunct_chain] -= defunct_quantity
        self._stocks[surviving_chain] += surviving_quantity
        return True

    def add_stocks(self, chain_name: str, quantity: int) -> bool:
        """Add stocks with validation (respects the per-chain share limit).

        Args:
            chain_name: Name of the hotel chain
            quantity: Number of shares to add (must be positive)

        Returns:
            True if successful, False if invalid chain, negative quantity,
            or would exceed max stocks per chain
        """
        if chain_name not in self._stocks:
            return False
        if quantity < 0:
            return False
        if quantity == 0:
            return True
        if self._stocks[chain_name] + quantity > self.max_stocks_per_chain:
            return False
        self._stocks[chain_name] += quantity
        return True

    def remove_stocks(self, chain_name: str, quantity: int) -> bool:
        """Remove stocks with validation.

        Args:
            chain_name: Name of the hotel chain
            quantity: Number of shares to remove (must be positive)

        Returns:
            True if successful, False if invalid chain, negative quantity,
            or insufficient stocks
        """
        if chain_name not in self._stocks:
            return False
        if quantity < 0:
            return False
        if quantity == 0:
            return True
        if self._stocks[chain_name] < quantity:
            return False
        self._stocks[chain_name] -= quantity
        return True

    def set_stocks(self, chain_name: str, quantity: int) -> bool:
        """Set stocks to specific value with validation.

        Args:
            chain_name: Name of the hotel chain
            quantity: Number of shares to set (0..the per-chain share limit)

        Returns:
            True if successful, False if invalid chain or quantity out of range
        """
        if chain_name not in self._stocks:
            return False
        if quantity < 0:
            return False
        if quantity > self.max_stocks_per_chain:
            return False
        self._stocks[chain_name] = quantity
        return True

    def add_money(self, amount: int) -> bool:
        """Add money to the player's balance.

        Args:
            amount: Amount to add (must be positive)

        Returns:
            True if successful, False if amount is negative
        """
        if amount < 0:
            return False
        self._money += amount
        return True

    def remove_money(self, amount: int) -> bool:
        """Remove money from the player's balance.

        Args:
            amount: Amount to remove (must be positive)

        Returns:
            True if successful, False if insufficient funds or negative amount
        """
        if amount < 0:
            return False
        if amount > self._money:
            return False
        self._money -= amount
        return True

    def get_stock_count(self, chain_name: str) -> int:
        """Get number of stocks held in a specific chain."""
        return self._stocks.get(chain_name, 0)

    def get_stock_value(self, chain_prices: dict[str, int]) -> int:
        """Calculate total value of all stock holdings.

        Args:
            chain_prices: Dict mapping chain names to current stock prices

        Returns:
            Total value of all stocks
        """
        total = 0
        for chain_name, quantity in self._stocks.items():
            if quantity > 0 and chain_name in chain_prices:
                total += quantity * chain_prices[chain_name]
        return total

    def get_net_worth(self, chain_prices: dict[str, int]) -> int:
        """Calculate total net worth (money + stock value).

        Args:
            chain_prices: Dict mapping chain names to current stock prices

        Returns:
            Total net worth
        """
        return self._money + self.get_stock_value(chain_prices)

    def can_afford_trade(
        self, offering_stocks: dict[str, int], offering_money: int
    ) -> bool:
        """Check if player has the resources to fulfill a trade offer.

        Args:
            offering_stocks: Dict mapping chain names to quantities being offered
            offering_money: Amount of money being offered

        Returns:
            True if player has all required resources, False otherwise
        """
        # Check if player has enough money
        if offering_money > self._money:
            return False

        # Check if player has enough of each stock
        for chain_name, quantity in offering_stocks.items():
            if quantity < 0:
                return False
            if chain_name not in self._stocks:
                if quantity > 0:
                    return False
            elif self._stocks[chain_name] < quantity:
                return False

        return True

    def execute_trade_give(self, stocks: dict[str, int], money: int) -> bool:
        """Remove resources from player as part of a trade.

        This method should be called atomically with execute_trade_receive
        on the other player to complete a trade.

        Args:
            stocks: Dict mapping chain names to quantities to give away
            money: Amount of money to give away

        Returns:
            True if resources were successfully removed, False otherwise
        """
        # First verify we can afford this
        if not self.can_afford_trade(stocks, money):
            return False

        # Remove money
        self._money -= money

        # Remove stocks
        for chain_name, quantity in stocks.items():
            if quantity > 0:
                self._stocks[chain_name] -= quantity

        return True

    def execute_trade_receive(self, stocks: dict[str, int], money: int) -> bool:
        """Add resources to player as part of a trade.

        This method should be called atomically with execute_trade_give
        on the other player to complete a trade.

        Args:
            stocks: Dict mapping chain names to quantities to receive
            money: Amount of money to receive

        Returns:
            True if resources were successfully added, False otherwise
        """
        # Validate inputs
        if money < 0:
            return False

        for chain_name, quantity in stocks.items():
            if quantity < 0:
                return False
            if chain_name not in self._stocks:
                return False
            # Check if receiving would exceed max stocks per chain
            if self._stocks[chain_name] + quantity > self.max_stocks_per_chain:
                return False

        # Add money
        self._money += money

        # Add stocks
        for chain_name, quantity in stocks.items():
            if quantity > 0:
                self._stocks[chain_name] += quantity

        return True

    def get_state(self) -> dict:
        """Get serializable player state.

        Returns:
            Dict containing player state
        """
        return {
            "player_id": self.player_id,
            "name": self.name,
            "money": self._money,
            "hand": [str(tile) for tile in self._hand],
            "stocks": dict(self._stocks),
        }

    @classmethod
    def from_state(cls, state: dict, ruleset: Optional[Ruleset] = None) -> "Player":
        """Create a player from serialized state.

        Args:
            state: Dict containing player state
            ruleset: Game parameters (default: classic)

        Returns:
            Player instance
        """
        player = cls(state["player_id"], state["name"], ruleset)
        player._money = state["money"]
        player._hand = [
            Tile.from_string(s, player.ruleset.board) for s in state["hand"]
        ]
        player._stocks = dict(state["stocks"])
        return player

    def __repr__(self) -> str:
        return f"Player(id={self.player_id}, name={self.name}, money=${self._money})"
