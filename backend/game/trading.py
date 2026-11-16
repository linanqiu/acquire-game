"""Player-to-player trades for ``Game`` (allowed out of turn).

``TradingMixin`` is mixed into ``game.game.Game`` and works on its
``pending_trades`` and players; validation is ``Rules.validate_trade``.

Offers are public: every trade event (proposed, accepted, rejected,
cancelled) is a public event that carries the full offer, so the whole table
can follow it and anyone may make a competing offer. Only the recipient can
accept or reject, and only the proposer can cancel.
"""

from typing import List

from game.action import TradeOffer
from game.phase import GamePhase
from game.responses import (
    AcceptTradeResult,
    CancelTradeResult,
    ProposeTradeResult,
    RejectTradeResult,
)
from game.rules import Rules


class TradingMixin:
    """Trading methods of ``Game``."""

    def _count_pending_trades_for_player(self, player_id: str) -> int:
        """Count the number of pending trades initiated by a player.

        Args:
            player_id: ID of the player to count trades for

        Returns:
            Number of pending trades where this player is the proposer
        """
        count = 0
        for trade in self.pending_trades.values():
            if trade.from_player_id == player_id:
                count += 1
        return count

    def propose_trade(self, trade: TradeOffer) -> ProposeTradeResult:
        """Propose a trade to another player.

        Players can propose trades at any time during the game (not just their turn).
        The trade will be validated and added to pending trades if valid.

        Args:
            trade: The TradeOffer containing the trade details

        Returns:
            ProposeTradeResult with result
        """
        # Check game is in progress
        if self.phase == GamePhase.LOBBY:
            return ProposeTradeResult(success=False, error="Game has not started yet")

        if self.phase == GamePhase.GAME_OVER:
            return ProposeTradeResult(success=False, error="Game is already over")

        # Check pending trade limit for the proposer
        current_count = self._count_pending_trades_for_player(trade.from_player_id)
        max_pending = self.ruleset.max_pending_trades_per_player
        if current_count >= max_pending:
            return ProposeTradeResult(
                success=False,
                error=f"Maximum of {max_pending} pending trades per player",
            )

        # Validate the trade
        is_valid, error_msg = Rules.validate_trade(self, trade)
        if not is_valid:
            return ProposeTradeResult(success=False, error=error_msg)

        # Add to pending trades
        self.pending_trades[trade.trade_id] = trade
        self._emit("trade_proposed", trade.from_player_id, trade=trade.to_dict())

        return ProposeTradeResult(
            success=True,
            trade_id=trade.trade_id,
            from_player=trade.from_player_id,
            to_player=trade.to_player_id,
        )

    def accept_trade(self, player_id: str, trade_id: str) -> AcceptTradeResult:
        """Accept a pending trade offer.

        Only the recipient of the trade can accept it. The trade will be
        re-validated before execution to ensure both players still have
        the required resources.

        Args:
            player_id: ID of the player accepting the trade
            trade_id: Unique ID of the trade to accept

        Returns:
            AcceptTradeResult with result
        """
        # Check that the trade exists
        if trade_id not in self.pending_trades:
            return AcceptTradeResult(success=False, error="Trade not found")

        trade = self.pending_trades[trade_id]

        # Check that the accepting player is the recipient
        if trade.to_player_id != player_id:
            return AcceptTradeResult(
                success=False, error="Only the trade recipient can accept"
            )

        # Re-validate the trade (resources may have changed)
        is_valid, error_msg = Rules.validate_trade(self, trade)
        if not is_valid:
            # Trade is no longer valid, remove it
            del self.pending_trades[trade_id]
            self._emit(
                "trade_cancelled",
                player_id,
                trade_id=trade_id,
                reason="no_longer_valid",
                trade=trade.to_dict(),
            )
            return AcceptTradeResult(
                success=False, error=f"Trade is no longer valid: {error_msg}"
            )

        # Get the players
        from_player = self.get_player(trade.from_player_id)
        to_player = self.get_player(trade.to_player_id)

        # Execute the trade atomically
        # First, remove resources from both players
        from_player.execute_trade_give(trade.offering_stocks, trade.offering_money)
        to_player.execute_trade_give(trade.requesting_stocks, trade.requesting_money)

        # Then, add resources to both players
        to_player.execute_trade_receive(trade.offering_stocks, trade.offering_money)
        from_player.execute_trade_receive(
            trade.requesting_stocks, trade.requesting_money
        )

        # Remove the trade from pending
        del self.pending_trades[trade_id]
        self._emit("trade_accepted", player_id, trade=trade.to_dict())

        return AcceptTradeResult(
            success=True,
            trade_id=trade_id,
            from_player=trade.from_player_id,
            to_player=trade.to_player_id,
            offered_stocks=dict(trade.offering_stocks),
            offered_money=trade.offering_money,
            requested_stocks=dict(trade.requesting_stocks),
            requested_money=trade.requesting_money,
        )

    def reject_trade(self, player_id: str, trade_id: str) -> RejectTradeResult:
        """Reject a pending trade offer.

        Only the recipient of the trade can reject it.

        Args:
            player_id: ID of the player rejecting the trade
            trade_id: Unique ID of the trade to reject

        Returns:
            RejectTradeResult with result
        """
        # Check that the trade exists
        if trade_id not in self.pending_trades:
            return RejectTradeResult(success=False, error="Trade not found")

        trade = self.pending_trades[trade_id]

        # Check that the rejecting player is the recipient
        if trade.to_player_id != player_id:
            return RejectTradeResult(
                success=False, error="Only the trade recipient can reject"
            )

        # Remove the trade
        del self.pending_trades[trade_id]
        self._emit(
            "trade_rejected", player_id, trade_id=trade_id, trade=trade.to_dict()
        )

        return RejectTradeResult(success=True, trade_id=trade_id, rejected_by=player_id)

    def cancel_trade(self, player_id: str, trade_id: str) -> CancelTradeResult:
        """Cancel a pending trade offer.

        Only the proposer of the trade can cancel it.

        Args:
            player_id: ID of the player canceling the trade
            trade_id: Unique ID of the trade to cancel

        Returns:
            CancelTradeResult with result
        """
        # Check that the trade exists
        if trade_id not in self.pending_trades:
            return CancelTradeResult(success=False, error="Trade not found")

        trade = self.pending_trades[trade_id]

        # Check that the canceling player is the proposer
        if trade.from_player_id != player_id:
            return CancelTradeResult(
                success=False, error="Only the trade proposer can cancel"
            )

        # Remove the trade
        del self.pending_trades[trade_id]
        self._emit(
            "trade_cancelled",
            player_id,
            trade_id=trade_id,
            reason="cancelled",
            trade=trade.to_dict(),
        )

        return CancelTradeResult(success=True, trade_id=trade_id, canceled_by=player_id)

    def get_incoming_trades_for_player(self, player_id: str) -> List[TradeOffer]:
        """Get pending trades where the player is the recipient.

        Args:
            player_id: ID of the player to get incoming trades for

        Returns:
            List of TradeOffer objects where this player is the recipient
        """
        return [
            trade
            for trade in self.pending_trades.values()
            if trade.to_player_id == player_id
        ]

    def get_outgoing_trades_for_player(self, player_id: str) -> List[TradeOffer]:
        """Get pending trades where the player is the proposer.

        Args:
            player_id: ID of the player to get outgoing trades for

        Returns:
            List of TradeOffer objects where this player is the proposer
        """
        return [
            trade
            for trade in self.pending_trades.values()
            if trade.from_player_id == player_id
        ]
