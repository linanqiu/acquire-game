"""Wire protocol: pydantic models validating client -> server action messages.

The validated message is turned into the engine's action dict
(``game.decisions`` wire format) with ``to_action``. These models are a first,
shape-only filter that produces friendly errors; ``apply_action`` does the
authoritative legality checks.
"""

import re
from typing import Literal, Optional, Union

from pydantic import BaseModel, ValidationError, field_validator

# =============================================================================
# Pydantic Models for WebSocket Message Validation
# =============================================================================

VALID_CHAINS = [
    "Luxor",
    "Tower",
    "American",
    "Worldwide",
    "Festival",
    "Imperial",
    "Continental",
]


def _validate_chain_name(v: str) -> str:
    """Shared validator for chain names."""
    if v not in VALID_CHAINS:
        raise ValueError(f"Invalid chain: {v}. Must be one of {VALID_CHAINS}")
    return v


class PlaceTileMessage(BaseModel):
    """Validate place_tile action messages."""

    action: Literal["place_tile"]
    tile: str

    @field_validator("tile")
    @classmethod
    def validate_tile(cls, v: str) -> str:
        """Validate tile format (e.g., '1A', '12I')."""
        if not isinstance(v, str):
            raise ValueError("Tile must be a string")
        v = v.upper().strip()
        if not re.match(r"^1?[0-9][A-I]$", v):
            raise ValueError("Invalid tile format. Expected format like 1A, 5E, 12I")
        return v


class FoundChainMessage(BaseModel):
    """Validate found_chain action messages."""

    action: Literal["found_chain"]
    chain: str

    @field_validator("chain")
    @classmethod
    def validate_chain(cls, v: str) -> str:
        """Validate chain name."""
        return _validate_chain_name(v)


class MergerChoiceMessage(BaseModel):
    """Validate merger_choice action messages."""

    action: Literal["merger_choice"]
    surviving_chain: str

    @field_validator("surviving_chain")
    @classmethod
    def validate_chain(cls, v: str) -> str:
        """Validate chain name."""
        return _validate_chain_name(v)


class DispositionData(BaseModel):
    """Validate disposition data within merger_disposition."""

    sell: int = 0
    trade: int = 0
    hold: int = 0

    @field_validator("sell", "trade", "hold")
    @classmethod
    def validate_non_negative(cls, v: int) -> int:
        """Ensure values are non-negative."""
        if v < 0:
            raise ValueError("Value must be non-negative")
        return v


class MergerDispositionMessage(BaseModel):
    """Validate merger_disposition action messages."""

    action: Literal["merger_disposition"]
    defunct_chain: str
    disposition: DispositionData

    @field_validator("defunct_chain")
    @classmethod
    def validate_chain(cls, v: str) -> str:
        """Validate chain name."""
        return _validate_chain_name(v)


class BuyStocksMessage(BaseModel):
    """Validate buy_stocks action messages."""

    action: Literal["buy_stocks"]
    purchases: dict[str, int]

    @field_validator("purchases")
    @classmethod
    def validate_purchases(cls, v: dict) -> dict:
        """Validate purchases dictionary."""
        if not isinstance(v, dict):
            raise ValueError("Purchases must be a dictionary")
        total = 0
        for chain, quantity in v.items():
            if chain not in VALID_CHAINS:
                raise ValueError(f"Invalid chain: {chain}")
            if not isinstance(quantity, int) or quantity < 0:
                raise ValueError(
                    f"Invalid quantity for {chain}: must be non-negative integer"
                )
            total += quantity
        if total > 3:
            raise ValueError("Cannot buy more than 3 stocks per turn")
        return v


class EndTurnMessage(BaseModel):
    """Validate end_turn action messages."""

    action: Literal["end_turn"]


class DeclareEndGameMessage(BaseModel):
    """Validate declare_end_game action messages."""

    action: Literal["declare_end_game"]


class ProposeTradeMessage(BaseModel):
    """Validate propose_trade action messages."""

    action: Literal["propose_trade"]
    to_player_id: str
    offering_stocks: dict[str, int] = {}
    offering_money: int = 0
    requesting_stocks: dict[str, int] = {}
    requesting_money: int = 0

    @field_validator("offering_stocks", "requesting_stocks")
    @classmethod
    def validate_stocks(cls, v: dict) -> dict:
        """Validate stock dictionaries."""
        for chain, quantity in v.items():
            if chain not in VALID_CHAINS:
                raise ValueError(f"Invalid chain: {chain}")
            if not isinstance(quantity, int) or quantity < 0:
                raise ValueError(
                    f"Stock quantity for {chain} must be non-negative integer"
                )
        return v

    @field_validator("offering_money", "requesting_money")
    @classmethod
    def validate_money(cls, v: int) -> int:
        """Validate money amounts."""
        if v < 0:
            raise ValueError("Money amount must be non-negative")
        return v


class AcceptTradeMessage(BaseModel):
    """Validate accept_trade action messages."""

    action: Literal["accept_trade"]
    trade_id: str


class RejectTradeMessage(BaseModel):
    """Validate reject_trade action messages."""

    action: Literal["reject_trade"]
    trade_id: str


class CancelTradeMessage(BaseModel):
    """Validate cancel_trade action messages."""

    action: Literal["cancel_trade"]
    trade_id: str


# Union type for all valid message types
WebSocketMessage = Union[
    PlaceTileMessage,
    FoundChainMessage,
    MergerChoiceMessage,
    MergerDispositionMessage,
    BuyStocksMessage,
    EndTurnMessage,
    DeclareEndGameMessage,
    ProposeTradeMessage,
    AcceptTradeMessage,
    RejectTradeMessage,
    CancelTradeMessage,
]


def validate_websocket_message(
    data: dict,
) -> tuple[Optional[WebSocketMessage], Optional[str]]:
    """Validate incoming WebSocket message data.

    Args:
        data: Raw message data dictionary

    Returns:
        Tuple of (validated_message, error_message)
        If validation succeeds, error_message is None
        If validation fails, validated_message is None
    """
    action = data.get("action")

    message_types = {
        "place_tile": PlaceTileMessage,
        "found_chain": FoundChainMessage,
        "merger_choice": MergerChoiceMessage,
        "merger_disposition": MergerDispositionMessage,
        "buy_stocks": BuyStocksMessage,
        "end_turn": EndTurnMessage,
        "declare_end_game": DeclareEndGameMessage,
        "propose_trade": ProposeTradeMessage,
        "accept_trade": AcceptTradeMessage,
        "reject_trade": RejectTradeMessage,
        "cancel_trade": CancelTradeMessage,
    }

    if action not in message_types:
        return None, f"Unknown action: {action}"

    try:
        validated = message_types[action](**data)
        return validated, None
    except ValidationError as e:
        # Extract first error message
        errors = e.errors()
        if errors:
            return None, f"Validation error: {errors[0]['msg']}"
        return None, "Validation error"


def to_action(msg: BaseModel) -> dict:
    """Engine action dict for a validated message (normalised values)."""
    return msg.model_dump()
