"""Merger handling for ``Game``: survivor, bonuses, stock disposition.

``MergerMixin`` is mixed into ``game.game.Game`` and works on its state
(``board``, ``hotel``, ``players``, ``phase``, ``pending_action``,
``_merger``); see docs/rules/mergers.md.
"""

from dataclasses import dataclass, field
from typing import Optional

from game.board import Tile
from game.phase import GamePhase
from game.responses import ChooseMergerSurvivorResult, StockDispositionResult
from game.rules import Rules


@dataclass
class MergerState:
    """State of the merger in progress (``Game._merger``; reset when it ends)."""

    chains: list[str] = field(default_factory=list)  # All chains involved in merger
    survivor: Optional[str] = None  # The surviving chain
    defunct_queue: list[str] = field(default_factory=list)  # Defunct chains to process
    current_defunct: Optional[str] = None  # Currently processing defunct chain
    stock_players: list[str] = field(
        default_factory=list
    )  # Players handling disposition
    stock_index: int = 0  # Current player index in disposition queue
    tile: Optional[Tile] = None  # The tile that triggered the merger

    def reset(self) -> None:
        """Reset all merger state after completion."""
        self.chains = []
        self.survivor = None
        self.defunct_queue = []
        self.current_defunct = None
        self.stock_players = []
        self.stock_index = 0
        self.tile = None


def trade_multiple_error(ratio: int) -> str:
    """Error for a merger trade count that is not a multiple of the ratio."""
    if ratio == 2:
        return "Trade count must be even"
    return f"Trade count must be a multiple of {ratio}"


class MergerMixin:
    """Merger methods of ``Game``."""

    def _start_merger_process(
        self, tile: Tile, survivor: str, defunct_chains: list[str]
    ):
        """Start processing a merger."""
        self.phase = GamePhase.MERGING
        self._merger.survivor = survivor
        self._merger.tile = tile  # Store tile for finalization
        self._merger.defunct_queue = sorted(
            defunct_chains, key=lambda c: self.board.get_chain_size(c), reverse=True
        )
        self._emit(
            "merger_started",
            self.get_current_player().player_id,
            tile=str(tile) if tile else None,
            survivor=survivor,
            defunct=list(self._merger.defunct_queue),
            sizes=self._chain_sizes([survivor] + self._merger.defunct_queue),
        )

        self._process_next_defunct_chain()

    def _pay_bonuses(self, chain: str, final: bool) -> None:
        """Pay a chain's majority/minority bonuses (merger or end of game)."""
        chain_size = self.board.get_chain_size(chain)
        bonuses = Rules.calculate_bonuses(self.players, chain, chain_size, self.hotel)
        for player_id, bonus in bonuses.items():
            player = self.get_player(player_id)
            if player:
                total = bonus.get("majority", 0) + bonus.get("minority", 0)
                player.add_money(total)
        self._emit(
            "bonuses_paid",
            chain=chain,
            chain_size=chain_size,
            final=final,
            bonuses={pid: dict(b) for pid, b in bonuses.items()},
        )

    def _process_next_defunct_chain(self):
        """Process the next defunct chain in the queue."""
        if not self._merger.defunct_queue:
            # All defunct chains processed, finalize merger
            self._finalize_merger()
            return

        defunct = self._merger.defunct_queue.pop(0)
        self._merger.current_defunct = defunct

        self._pay_bonuses(defunct, final=False)
        # Find players who need to handle stock disposition
        stockholders = []
        current_idx = self.current_player_index
        for i in range(len(self.players)):
            idx = (current_idx + i) % len(self.players)
            p = self.players[idx]
            if p.get_stock_count(defunct) > 0:
                stockholders.append(p.player_id)

        if stockholders:
            self._merger.stock_players = stockholders
            self._merger.stock_index = 0
            self._prompt_next_stock_disposition()
        else:
            # No stockholders, continue to next defunct chain
            self._process_next_defunct_chain()

    def _prompt_next_stock_disposition(self):
        """Prompt the next player for stock disposition."""
        if self._merger.stock_index >= len(self._merger.stock_players):
            # All players handled, process next defunct chain
            self._process_next_defunct_chain()
            return

        player_id = self._merger.stock_players[self._merger.stock_index]
        player = self.get_player(player_id)
        defunct = self._merger.current_defunct
        count = player.get_stock_count(defunct)

        self.pending_action = {
            "type": "stock_disposition",
            "player_id": player_id,
            "defunct_chain": defunct,
            "surviving_chain": self._merger.survivor,
            "stock_count": count,
            "available_to_trade": self.hotel.get_available_stocks(
                self._merger.survivor
            ),
        }

    def choose_merger_survivor(
        self, player_id: str, chain_name: str
    ) -> ChooseMergerSurvivorResult:
        """Choose which chain survives a tied merger.

        Args:
            player_id: ID of player making the choice
            chain_name: Name of chain that should survive

        Returns:
            ChooseMergerSurvivorResult with result
        """
        if self.phase != GamePhase.MERGING:
            return ChooseMergerSurvivorResult(
                success=False, error="Not in merging phase"
            )

        if (
            not self.pending_action
            or self.pending_action.get("type") != "choose_survivor"
        ):
            return ChooseMergerSurvivorResult(
                success=False, error="No pending survivor choice"
            )

        player = self.get_player(player_id)
        if not player or player.player_id != self.get_current_player().player_id:
            return ChooseMergerSurvivorResult(success=False, error="Not your turn")

        tied_chains = self.pending_action.get("tied_chains", [])
        if chain_name not in tied_chains:
            return ChooseMergerSurvivorResult(
                success=False, error=f"Chain {chain_name} not in tied chains"
            )

        tile = self.pending_action.get("tile")
        defunct = [c for c in self._merger.chains if c != chain_name]

        self._merger.survivor = chain_name
        self.pending_action = None
        self._emit(
            "survivor_chosen",
            player_id,
            survivor=chain_name,
            tied_chains=list(tied_chains),
        )

        self._start_merger_process(tile, chain_name, defunct)

        return ChooseMergerSurvivorResult(
            success=True,
            survivor=chain_name,
            defunct=defunct,
            next_action=self.pending_action.get("type")
            if self.pending_action
            else "buy_stocks",
        )

    def handle_stock_disposition(
        self, player_id: str, sell: int, trade: int, keep: int
    ) -> StockDispositionResult:
        """Handle a player's decision on defunct stock.

        Args:
            player_id: ID of player making the decision
            sell: Number of shares to sell
            trade: Number of shares to trade (must be even)
            keep: Number of shares to keep

        Returns:
            StockDispositionResult with result
        """
        if self.phase != GamePhase.MERGING:
            return StockDispositionResult(success=False, error="Not in merging phase")

        if (
            not self.pending_action
            or self.pending_action.get("type") != "stock_disposition"
        ):
            return StockDispositionResult(
                success=False, error="No pending stock disposition"
            )

        if player_id != self.pending_action.get("player_id"):
            return StockDispositionResult(
                success=False, error="Not your turn to handle stocks"
            )

        player = self.get_player(player_id)
        defunct = self.pending_action.get("defunct_chain")
        survivor = self.pending_action.get("surviving_chain")
        total_stock = self.pending_action.get("stock_count")

        # Validate
        if sell < 0 or trade < 0 or keep < 0:
            return StockDispositionResult(
                success=False, error="Stock counts must be non-negative"
            )

        if sell + trade + keep != total_stock:
            return StockDispositionResult(
                success=False, error="Stock counts don't add up"
            )

        ratio = self.ruleset.merger_trade_ratio
        if trade % ratio != 0:
            return StockDispositionResult(
                success=False, error=trade_multiple_error(ratio)
            )

        trade_for = trade // ratio
        available = self.hotel.get_available_stocks(survivor)
        if trade_for > available:
            return StockDispositionResult(
                success=False, error="Not enough survivor stock available to trade"
            )

        # Execute sell
        sale_proceeds = 0
        if sell > 0:
            defunct_size = self.board.get_chain_size(defunct)
            sell_price = self.hotel.get_stock_price(defunct, defunct_size)
            player.sell_stock(defunct, sell, sell_price)
            self.hotel.return_stock(defunct, sell)
            sale_proceeds = sell * sell_price

        # Execute trade
        if trade > 0:
            player.remove_stocks(defunct, trade)
            player.add_stocks(survivor, trade_for)
            self.hotel.return_stock(defunct, trade)
            self.hotel.buy_stock(survivor, trade_for)

        # Keep is automatic (just don't do anything with them)

        self._emit(
            "stock_disposition",
            player_id,
            defunct_chain=defunct,
            surviving_chain=survivor,
            sell=sell,
            trade=trade,
            hold=keep,
            sale_proceeds=sale_proceeds,
            survivor_shares_received=trade_for,
        )

        # Move to next player or next defunct chain
        self._merger.stock_index += 1
        self._prompt_next_stock_disposition()

        return StockDispositionResult(
            success=True,
            sold=sell,
            traded=trade,
            kept=keep,
            next_action=self.pending_action.get("type")
            if self.pending_action
            else "buy_stocks",
        )

    def _finalize_merger(self):
        """Finalize the merger by merging all defunct chains into survivor."""
        survivor = self._merger.survivor
        tile = self._merger.tile

        defunct_chains = [c for c in self._merger.chains if c != survivor]

        # Merge all defunct chains into survivor on the board, and absorb the
        # triggering tile and any connected lone tiles
        self.board.absorb_merger(survivor, defunct_chains, tile)
        for defunct in defunct_chains:
            self.hotel.deactivate_chain(defunct)

        self._emit(
            "merger_completed",
            self.get_current_player().player_id,
            survivor=survivor,
            defunct=defunct_chains,
            survivor_size=self.board.get_chain_size(survivor),
        )

        # Reset merger state
        self._merger.reset()

        self.phase = GamePhase.BUYING_STOCKS
        self.pending_action = None

    def _get_merger_state(self) -> dict | None:
        """Get current merger state for broadcasting.

        Returns merger disposition queue information during STOCK_DISPOSITION phase,
        or None if not in an active merger with stock disposition.
        """
        # Only return merger state during active stock disposition
        if self.phase != GamePhase.MERGING:
            return None

        if (
            not self.pending_action
            or self.pending_action.get("type") != "stock_disposition"
        ):
            return None

        survivor = self._merger.survivor
        current_defunct = self._merger.current_defunct

        if not survivor or not current_defunct:
            return None

        # Build queue with status
        queue = []
        for i, player_id in enumerate(self._merger.stock_players):
            player = self.get_player(player_id)
            if not player:
                continue

            if i < self._merger.stock_index:
                status = "completed"
            elif i == self._merger.stock_index:
                status = "current"
            else:
                status = "waiting"

            queue.append(
                {
                    "player_id": player_id,
                    "name": player.name,
                    "status": status,
                }
            )

        return {
            "survivor": survivor,
            "defunct": current_defunct,
            "disposition_queue": queue,
        }
