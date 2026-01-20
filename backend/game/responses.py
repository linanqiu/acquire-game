"""Typed response classes for Game method returns.

These dataclasses provide type safety, IDE autocomplete, and self-documenting
interfaces for all Game method responses.
"""

from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any


@dataclass
class GameResponse:
    """Base class for all game responses.

    Supports dict-like access for backward compatibility:
    - result["success"] works like result.success
    - result.get("success") works like dict.get()
    """

    success: bool
    error: Optional[str] = None

    def to_dict(self) -> dict:
        """Convert to dict for WebSocket serialization."""
        result = {"success": self.success}
        if self.error:
            result["error"] = self.error
        return result

    def __getitem__(self, key: str) -> Any:
        """Support dict-like access: result['success']."""
        # Map 'result' key to 'result_type' for PlayTileResult compatibility
        if key == "result" and hasattr(self, "result_type"):
            return getattr(self, "result_type")
        if hasattr(self, key):
            return getattr(self, key)
        raise KeyError(key)

    def get(self, key: str, default: Any = None) -> Any:
        """Support dict-like get(): result.get('success', False)."""
        # Map 'result' key to 'result_type' for PlayTileResult compatibility
        if key == "result" and hasattr(self, "result_type"):
            return getattr(self, "result_type", default)
        return getattr(self, key, default)

    def __contains__(self, key: str) -> bool:
        """Support 'in' operator: 'success' in result."""
        # Map 'result' key to 'result_type' for PlayTileResult compatibility
        if key == "result":
            return hasattr(self, "result_type")
        return hasattr(self, key)

    def keys(self):
        """Support dict-like keys() for ** unpacking."""
        return self.to_dict().keys()

    def __iter__(self):
        """Support iteration for ** unpacking."""
        return iter(self.to_dict())


# =============================================================================
# Play Tile Responses
# =============================================================================


@dataclass
class PlayTileResult(GameResponse):
    """Result of playing a tile.

    Attributes:
        tile: The tile that was played (e.g., "5E")
        result_type: What happened - "nothing", "expand", "found", "merge", "merge_tie"
        chain: For expand - which chain grew
        available_chains: For found - chains player can choose to found
        survivor: For merge - the surviving chain
        defunct: For merge - list of defunct chains
        tied_chains: For merge_tie - chains tied for largest
        next_action: What action is needed next
    """

    tile: Optional[str] = None
    result_type: Optional[str] = (
        None  # "nothing", "expand", "found", "merge", "merge_tie"
    )
    chain: Optional[str] = None  # For expand
    available_chains: Optional[List[str]] = None  # For found
    survivor: Optional[str] = None  # For merge
    defunct: Optional[List[str]] = None  # For merge
    tied_chains: Optional[List[str]] = None  # For merge_tie
    next_action: Optional[str] = (
        None  # "buy_stocks", "found_chain", "choose_merger_survivor", "stock_disposition"
    )

    def to_dict(self) -> dict:
        d = super().to_dict()
        if self.tile:
            d["tile"] = self.tile
        if self.result_type:
            d["result"] = self.result_type
        if self.chain:
            d["chain"] = self.chain
        if self.available_chains:
            d["available_chains"] = self.available_chains
        if self.survivor:
            d["survivor"] = self.survivor
        if self.defunct:
            d["defunct"] = self.defunct
        if self.tied_chains:
            d["tied_chains"] = self.tied_chains
        if self.next_action:
            d["next_action"] = self.next_action
        return d


# =============================================================================
# Found Chain Response
# =============================================================================


@dataclass
class FoundChainResult(GameResponse):
    """Result of founding a chain.

    Attributes:
        chain: Name of the chain that was founded
        founder_bonus: Whether a founder bonus was awarded
        founder_bonus_type: "stock" or "cash"
        founder_bonus_value: 1 (stock) or price (cash)
        next_action: Always "buy_stocks" on success
    """

    chain: Optional[str] = None
    founder_bonus: bool = False
    founder_bonus_type: Optional[str] = None  # "stock" or "cash"
    founder_bonus_value: int = 0
    next_action: Optional[str] = None

    def to_dict(self) -> dict:
        d = super().to_dict()
        if self.chain:
            d["chain"] = self.chain
        if self.success:
            d["founder_bonus"] = self.founder_bonus
            if self.founder_bonus_type:
                d["founder_bonus_type"] = self.founder_bonus_type
            d["founder_bonus_value"] = self.founder_bonus_value
        if self.next_action:
            d["next_action"] = self.next_action
        return d


# =============================================================================
# Merger Responses
# =============================================================================


@dataclass
class ChooseMergerSurvivorResult(GameResponse):
    """Result of choosing which chain survives a merger.

    Attributes:
        survivor: The chain that was chosen to survive
        defunct: List of chains that will be absorbed
        next_action: Next action needed (stock_disposition or buy_stocks)
    """

    survivor: Optional[str] = None
    defunct: Optional[List[str]] = None
    next_action: Optional[str] = None

    def to_dict(self) -> dict:
        d = super().to_dict()
        if self.survivor:
            d["survivor"] = self.survivor
        if self.defunct:
            d["defunct"] = self.defunct
        if self.next_action:
            d["next_action"] = self.next_action
        return d


@dataclass
class StockDispositionResult(GameResponse):
    """Result of handling stock disposition during a merger.

    Attributes:
        sold: Number of shares sold
        traded: Number of shares traded (2:1)
        kept: Number of shares kept
        next_action: Next action needed
    """

    sold: int = 0
    traded: int = 0
    kept: int = 0
    next_action: Optional[str] = None

    def to_dict(self) -> dict:
        d = super().to_dict()
        if self.success:
            d["sold"] = self.sold
            d["traded"] = self.traded
            d["kept"] = self.kept
        if self.next_action:
            d["next_action"] = self.next_action
        return d


# =============================================================================
# Buy Stocks Response
# =============================================================================


@dataclass
class StockPurchase:
    """A single stock purchase."""

    chain: str
    price: int

    def to_dict(self) -> dict:
        return {"chain": self.chain, "price": self.price}


@dataclass
class BuyStocksResult(GameResponse):
    """Result of buying stocks.

    Attributes:
        purchased: List of stocks purchased with their prices
        total_cost: Total amount spent
        next_action: Always "end_turn" on success
    """

    purchased: List[StockPurchase] = field(default_factory=list)
    total_cost: int = 0
    next_action: Optional[str] = None

    def to_dict(self) -> dict:
        d = super().to_dict()
        if self.success:
            d["purchased"] = [p.to_dict() for p in self.purchased]
            d["total_cost"] = self.total_cost
        if self.next_action:
            d["next_action"] = self.next_action
        return d


# =============================================================================
# End Turn Response
# =============================================================================


@dataclass
class EndTurnResult(GameResponse):
    """Result of ending a turn.

    Attributes:
        drew_tile: The tile drawn (if any)
        replaced_tiles: List of unplayable tiles that were replaced
        can_end_game: Whether the game can now be ended
        next_player: ID of the next player
    """

    drew_tile: Optional[str] = None
    replaced_tiles: List[str] = field(default_factory=list)
    can_end_game: bool = False
    next_player: Optional[str] = None

    def to_dict(self) -> dict:
        d = super().to_dict()
        if self.success:
            d["drew_tile"] = self.drew_tile
            d["replaced_tiles"] = self.replaced_tiles
            d["can_end_game"] = self.can_end_game
            d["next_player"] = self.next_player
        return d


# =============================================================================
# End Game Response
# =============================================================================


@dataclass
class PlayerStanding:
    """Final standing for a player."""

    player_id: str
    name: str
    money: int
    rank: int = 0
    is_bot: bool = False

    def to_dict(self) -> dict:
        return {
            "player_id": self.player_id,
            "name": self.name,
            "money": self.money,
            "rank": self.rank,
            "is_bot": self.is_bot,
        }

    def __getitem__(self, key: str) -> Any:
        """Support dict-like access."""
        if hasattr(self, key):
            return getattr(self, key)
        raise KeyError(key)

    def get(self, key: str, default: Any = None) -> Any:
        """Support dict-like get()."""
        return getattr(self, key, default)

    def __contains__(self, key: str) -> bool:
        """Support 'in' operator."""
        return hasattr(self, key)

    def keys(self):
        """Support dict-like keys()."""
        return self.to_dict().keys()

    def __iter__(self):
        """Support iteration."""
        return iter(self.to_dict())


@dataclass
class EndGameResult(GameResponse):
    """Result of ending the game.

    Attributes:
        standings: List of players in final order
        winner: The winning player
    """

    standings: List[PlayerStanding] = field(default_factory=list)
    winner: Optional[PlayerStanding] = None

    def to_dict(self) -> dict:
        d = super().to_dict()
        if self.success:
            d["standings"] = [s.to_dict() for s in self.standings]
            d["winner"] = self.winner.to_dict() if self.winner else None
        return d


# =============================================================================
# Trade Responses
# =============================================================================


@dataclass
class ProposeTradeResult(GameResponse):
    """Result of proposing a trade.

    Attributes:
        trade_id: Unique ID for the trade
        from_player: ID of the proposing player
        to_player: ID of the recipient player
    """

    trade_id: Optional[str] = None
    from_player: Optional[str] = None
    to_player: Optional[str] = None

    def to_dict(self) -> dict:
        d = super().to_dict()
        if self.trade_id:
            d["trade_id"] = self.trade_id
        if self.from_player:
            d["from_player"] = self.from_player
        if self.to_player:
            d["to_player"] = self.to_player
        return d


@dataclass
class AcceptTradeResult(GameResponse):
    """Result of accepting a trade.

    Attributes:
        trade_id: ID of the accepted trade
        from_player: ID of the proposing player
        to_player: ID of the accepting player
        offered_stocks: Stocks that were offered
        offered_money: Money that was offered
        requested_stocks: Stocks that were requested
        requested_money: Money that was requested
    """

    trade_id: Optional[str] = None
    from_player: Optional[str] = None
    to_player: Optional[str] = None
    offered_stocks: Dict[str, int] = field(default_factory=dict)
    offered_money: int = 0
    requested_stocks: Dict[str, int] = field(default_factory=dict)
    requested_money: int = 0

    def to_dict(self) -> dict:
        d = super().to_dict()
        if self.trade_id:
            d["trade_id"] = self.trade_id
        if self.from_player:
            d["from_player"] = self.from_player
        if self.to_player:
            d["to_player"] = self.to_player
        if self.success:
            d["offered_stocks"] = self.offered_stocks
            d["offered_money"] = self.offered_money
            d["requested_stocks"] = self.requested_stocks
            d["requested_money"] = self.requested_money
        return d


@dataclass
class RejectTradeResult(GameResponse):
    """Result of rejecting a trade.

    Attributes:
        trade_id: ID of the rejected trade
        rejected_by: ID of the rejecting player
    """

    trade_id: Optional[str] = None
    rejected_by: Optional[str] = None

    def to_dict(self) -> dict:
        d = super().to_dict()
        if self.trade_id:
            d["trade_id"] = self.trade_id
        if self.rejected_by:
            d["rejected_by"] = self.rejected_by
        return d


@dataclass
class CancelTradeResult(GameResponse):
    """Result of canceling a trade.

    Attributes:
        trade_id: ID of the canceled trade
        canceled_by: ID of the canceling player
    """

    trade_id: Optional[str] = None
    canceled_by: Optional[str] = None

    def to_dict(self) -> dict:
        d = super().to_dict()
        if self.trade_id:
            d["trade_id"] = self.trade_id
        if self.canceled_by:
            d["canceled_by"] = self.canceled_by
        return d
