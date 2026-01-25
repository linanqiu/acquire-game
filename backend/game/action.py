"""Trade offer representation for Acquire game."""

from dataclasses import dataclass, field
from typing import Optional, Dict, Any
import uuid


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
