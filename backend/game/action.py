"""Unified action representation for Acquire game."""

from dataclasses import dataclass
from enum import Enum
from typing import Optional, List, Dict, Any


class ActionType(Enum):
    """Types of actions that can be taken in the game."""
    PLAY_TILE = "play_tile"
    FOUND_CHAIN = "found_chain"
    CHOOSE_MERGER_SURVIVOR = "choose_merger_survivor"
    STOCK_DISPOSITION = "stock_disposition"
    BUY_STOCKS = "buy_stocks"
    END_TURN = "end_turn"
    END_GAME = "end_game"


@dataclass
class Action:
    """Represents a single action in the Acquire game.

    This unified representation simplifies the RL action space by providing
    a single class that can represent any game action.
    """
    action_type: ActionType
    tile: Optional[str] = None  # For PLAY_TILE: tile string like "1A"
    chain: Optional[str] = None  # For FOUND_CHAIN, CHOOSE_MERGER_SURVIVOR
    stocks: Optional[List[str]] = None  # For BUY_STOCKS: list of chain names
    disposition: Optional[Dict[str, int]] = None  # For STOCK_DISPOSITION: {"sell": n, "trade": n, "keep": n}

    def to_dict(self) -> Dict[str, Any]:
        """Convert action to dictionary representation."""
        result = {"action_type": self.action_type.value}
        if self.tile is not None:
            result["tile"] = self.tile
        if self.chain is not None:
            result["chain"] = self.chain
        if self.stocks is not None:
            result["stocks"] = self.stocks
        if self.disposition is not None:
            result["disposition"] = self.disposition
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Action":
        """Create action from dictionary representation."""
        return cls(
            action_type=ActionType(data["action_type"]),
            tile=data.get("tile"),
            chain=data.get("chain"),
            stocks=data.get("stocks"),
            disposition=data.get("disposition")
        )

    @classmethod
    def play_tile(cls, tile: str) -> "Action":
        """Create a play tile action."""
        return cls(action_type=ActionType.PLAY_TILE, tile=tile)

    @classmethod
    def found_chain(cls, chain: str) -> "Action":
        """Create a found chain action."""
        return cls(action_type=ActionType.FOUND_CHAIN, chain=chain)

    @classmethod
    def choose_merger_survivor(cls, chain: str) -> "Action":
        """Create a choose merger survivor action."""
        return cls(action_type=ActionType.CHOOSE_MERGER_SURVIVOR, chain=chain)

    @classmethod
    def stock_disposition(cls, sell: int, trade: int, keep: int) -> "Action":
        """Create a stock disposition action."""
        return cls(
            action_type=ActionType.STOCK_DISPOSITION,
            disposition={"sell": sell, "trade": trade, "keep": keep}
        )

    @classmethod
    def buy_stocks(cls, stocks: List[str]) -> "Action":
        """Create a buy stocks action."""
        return cls(action_type=ActionType.BUY_STOCKS, stocks=stocks)

    @classmethod
    def end_turn(cls) -> "Action":
        """Create an end turn action."""
        return cls(action_type=ActionType.END_TURN)

    @classmethod
    def end_game(cls) -> "Action":
        """Create an end game action."""
        return cls(action_type=ActionType.END_GAME)

    def __repr__(self) -> str:
        parts = [f"Action({self.action_type.value}"]
        if self.tile:
            parts.append(f", tile={self.tile}")
        if self.chain:
            parts.append(f", chain={self.chain}")
        if self.stocks:
            parts.append(f", stocks={self.stocks}")
        if self.disposition:
            parts.append(f", disposition={self.disposition}")
        parts.append(")")
        return "".join(parts)
