"""Game event system for activity logging in Acquire."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


class EventType(Enum):
    """Types of game events that can be logged."""

    TILE_PLACED = "tile_placed"
    CHAIN_FOUNDED = "chain_founded"
    CHAIN_EXPANDED = "chain_expanded"
    MERGER_STARTED = "merger_started"
    MERGER_COMPLETED = "merger_completed"
    BONUSES_PAID = "bonuses_paid"
    STOCK_DISPOSED = "stock_disposed"
    STOCK_PURCHASED = "stock_purchased"
    TRADE_PROPOSED = "trade_proposed"
    TRADE_ACCEPTED = "trade_accepted"
    TRADE_REJECTED = "trade_rejected"
    TRADE_CANCELED = "trade_canceled"
    TURN_ENDED = "turn_ended"
    GAME_STARTED = "game_started"
    GAME_ENDED = "game_ended"
    END_GAME_DECLARED = "end_game_declared"


@dataclass
class GameEvent:
    """Represents a single game event for the activity log.

    Attributes:
        timestamp: When the event occurred (UTC)
        event_type: The type of event
        player_id: ID of the player who triggered the event (if applicable)
        message: Human-readable description of the event
        details: Machine-readable data about the event
    """

    timestamp: datetime
    event_type: EventType
    player_id: str | None
    message: str
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert the event to a dictionary for serialization.

        Returns:
            Dict representation of the event
        """
        return {
            "timestamp": self.timestamp.isoformat(),
            "type": self.event_type.value,
            "player_id": self.player_id,
            "message": self.message,
            "details": self.details,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "GameEvent":
        """Create a GameEvent from a dictionary.

        Args:
            data: Dict representation of an event

        Returns:
            GameEvent instance
        """
        return cls(
            timestamp=datetime.fromisoformat(data["timestamp"]),
            event_type=EventType(data["type"]),
            player_id=data.get("player_id"),
            message=data["message"],
            details=data.get("details", {}),
        )


def create_event(
    event_type: EventType,
    player_id: str | None,
    message: str,
    details: dict[str, Any] | None = None,
) -> GameEvent:
    """Helper function to create a GameEvent with current timestamp.

    Args:
        event_type: The type of event
        player_id: ID of the player who triggered the event (if applicable)
        message: Human-readable description of the event
        details: Machine-readable data about the event

    Returns:
        GameEvent instance with current UTC timestamp
    """
    return GameEvent(
        timestamp=datetime.now(timezone.utc),
        event_type=event_type,
        player_id=player_id,
        message=message,
        details=details or {},
    )
