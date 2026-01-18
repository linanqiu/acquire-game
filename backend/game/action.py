"""Unified action representation for Acquire game."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, List, Dict, Any
import uuid


class ActionType(Enum):
    """Types of actions that can be taken in the game."""

    PLAY_TILE = "play_tile"
    FOUND_CHAIN = "found_chain"
    CHOOSE_MERGER_SURVIVOR = "choose_merger_survivor"
    STOCK_DISPOSITION = "stock_disposition"
    BUY_STOCKS = "buy_stocks"
    END_TURN = "end_turn"
    END_GAME = "end_game"
    # Trading actions
    PROPOSE_TRADE = "propose_trade"
    ACCEPT_TRADE = "accept_trade"
    REJECT_TRADE = "reject_trade"
    CANCEL_TRADE = "cancel_trade"


@dataclass
class TradeOffer:
    """Represents a trade offer between two players.

    A trade offer specifies what one player is offering (stocks and/or money)
    and what they are requesting in return from another player.

    Attributes:
        from_player_id: ID of the player proposing the trade
        to_player_id: ID of the player receiving the trade offer
        offering_stocks: Dict mapping chain name to quantity being offered
        offering_money: Amount of money being offered
        requesting_stocks: Dict mapping chain name to quantity being requested
        requesting_money: Amount of money being requested
        trade_id: Unique identifier for tracking this trade offer
    """

    from_player_id: str
    to_player_id: str
    offering_stocks: Dict[str, int] = field(default_factory=dict)
    offering_money: int = 0
    requesting_stocks: Dict[str, int] = field(default_factory=dict)
    requesting_money: int = 0
    trade_id: Optional[str] = None

    def __post_init__(self):
        """Generate a unique trade_id if not provided."""
        if self.trade_id is None:
            self.trade_id = str(uuid.uuid4())

    def to_dict(self) -> Dict[str, Any]:
        """Convert trade offer to dictionary representation."""
        return {
            "trade_id": self.trade_id,
            "from_player_id": self.from_player_id,
            "to_player_id": self.to_player_id,
            "offering_stocks": dict(self.offering_stocks),
            "offering_money": self.offering_money,
            "requesting_stocks": dict(self.requesting_stocks),
            "requesting_money": self.requesting_money,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TradeOffer":
        """Create a TradeOffer from dictionary representation."""
        return cls(
            from_player_id=data["from_player_id"],
            to_player_id=data["to_player_id"],
            offering_stocks=dict(data.get("offering_stocks", {})),
            offering_money=data.get("offering_money", 0),
            requesting_stocks=dict(data.get("requesting_stocks", {})),
            requesting_money=data.get("requesting_money", 0),
            trade_id=data.get("trade_id"),
        )


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
    disposition: Optional[Dict[str, int]] = (
        None  # For STOCK_DISPOSITION: {"sell": n, "trade": n, "keep": n}
    )
    trade: Optional[TradeOffer] = None  # For PROPOSE_TRADE
    trade_id: Optional[str] = None  # For ACCEPT_TRADE, REJECT_TRADE, CANCEL_TRADE

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
        if self.trade is not None:
            result["trade"] = self.trade.to_dict()
        if self.trade_id is not None:
            result["trade_id"] = self.trade_id
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Action":
        """Create action from dictionary representation."""
        trade_data = data.get("trade")
        trade = TradeOffer.from_dict(trade_data) if trade_data else None
        return cls(
            action_type=ActionType(data["action_type"]),
            tile=data.get("tile"),
            chain=data.get("chain"),
            stocks=data.get("stocks"),
            disposition=data.get("disposition"),
            trade=trade,
            trade_id=data.get("trade_id"),
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
            disposition={"sell": sell, "trade": trade, "keep": keep},
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

    @classmethod
    def propose_trade(cls, trade: TradeOffer) -> "Action":
        """Create a propose trade action.

        Args:
            trade: The TradeOffer containing the trade details

        Returns:
            Action with PROPOSE_TRADE type
        """
        return cls(action_type=ActionType.PROPOSE_TRADE, trade=trade)

    @classmethod
    def accept_trade(cls, trade_id: str) -> "Action":
        """Create an accept trade action.

        Args:
            trade_id: The unique ID of the trade to accept

        Returns:
            Action with ACCEPT_TRADE type
        """
        return cls(action_type=ActionType.ACCEPT_TRADE, trade_id=trade_id)

    @classmethod
    def reject_trade(cls, trade_id: str) -> "Action":
        """Create a reject trade action.

        Args:
            trade_id: The unique ID of the trade to reject

        Returns:
            Action with REJECT_TRADE type
        """
        return cls(action_type=ActionType.REJECT_TRADE, trade_id=trade_id)

    @classmethod
    def cancel_trade(cls, trade_id: str) -> "Action":
        """Create a cancel trade action.

        Args:
            trade_id: The unique ID of the trade to cancel

        Returns:
            Action with CANCEL_TRADE type
        """
        return cls(action_type=ActionType.CANCEL_TRADE, trade_id=trade_id)

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
        if self.trade:
            parts.append(f", trade_id={self.trade.trade_id}")
        if self.trade_id:
            parts.append(f", trade_id={self.trade_id}")
        parts.append(")")
        return "".join(parts)
