"""Wire protocol: pydantic models validating client -> server action messages.

The validated message is turned into the engine's action dict
(``game.decisions`` wire format) with ``to_action``. These models are a first,
shape-only filter that produces friendly errors; ``apply_action`` does the
authoritative legality checks.

Chain ids, the tile pattern and the per-turn purchase limit come from the
server's configured ruleset (``config.get_ruleset()``, env ``GAME_RULESET``),
which is the ruleset every game on this server is created with.
"""

from typing import Literal, Union

from pydantic import BaseModel, ValidationError, field_validator

from config import get_ruleset
from game.ruleset import classic

# =============================================================================
# Pydantic Models for WebSocket Message Validation
# =============================================================================

# Classic alias kept for importers; validation uses the configured ruleset.
VALID_CHAINS = list(classic().chain_ids)


def _valid_chains() -> list[str]:
    return list(get_ruleset().chain_ids)


def _validate_chain_name(v: str) -> str:
    """Shared validator for chain names."""
    chains = _valid_chains()
    if v not in chains:
        raise ValueError(f"Invalid chain: {v}. Must be one of {chains}")
    return v


class PlaceTileMessage(BaseModel):
    """Validate place_tile action messages."""

    action: Literal["place_tile"]
    tile: str

    @field_validator("tile")
    @classmethod
    def validate_tile(cls, v: str) -> str:
        """Validate tile format and board bounds (e.g. '1A')."""
        if not isinstance(v, str):
            raise ValueError("Tile must be a string")  # noqa: TRY004 - pydantic
        v = v.upper().strip()
        board = get_ruleset().board
        if board.parse_tile_coords(v) is None:
            raise ValueError(
                f"Invalid tile format. Expected format like {board.tile_example()}"
            )
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
            raise ValueError("Purchases must be a dictionary")  # noqa: TRY004 - pydantic
        chains = _valid_chains()
        limit = get_ruleset().max_stock_purchases_per_turn
        total = 0
        for chain, quantity in v.items():
            if chain not in chains:
                raise ValueError(f"Invalid chain: {chain}")
            if not isinstance(quantity, int) or quantity < 0:
                raise ValueError(
                    f"Invalid quantity for {chain}: must be non-negative integer"
                )
            total += quantity
        if total > limit:
            raise ValueError(f"Cannot buy more than {limit} stocks per turn")
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
    trade_id: str | None = None  # client-chosen id (optional)
    offering_stocks: dict[str, int] = {}
    offering_money: int = 0
    requesting_stocks: dict[str, int] = {}
    requesting_money: int = 0

    @field_validator("offering_stocks", "requesting_stocks")
    @classmethod
    def validate_stocks(cls, v: dict) -> dict:
        """Validate stock dictionaries."""
        chains = _valid_chains()
        for chain, quantity in v.items():
            if chain not in chains:
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
WebSocketMessage = Union[  # noqa: UP007
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
) -> tuple[WebSocketMessage | None, str | None]:
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
    action = msg.model_dump()
    if action.get("action") == "propose_trade" and action.get("trade_id") is None:
        action.pop("trade_id")
    return action
