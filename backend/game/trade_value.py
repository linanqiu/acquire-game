"""Position-aware value of a player-to-player trade.

``trade_valuation(game, trade, viewer_id)`` answers "what is this trade worth
to me?" by what it does to both sides' positions, not by list prices. It is
pure (reads the game, changes nothing), deterministic, built only from PUBLIC
information and returns a plain JSON-serialisable dict, so the same numbers
can go to the rules-based seat (``agents/heuristic.py``), into the LLM prompt
(``agents/llm/prompt.py``) and, later, to clients.

How a position is valued (for one player, with everyone's holdings given)::

    worth = cash
          + sum over chains:  shares * share_unit_value(chain)
          + sum over active chains:  bonus_weight(chain) * bonus(player, chain)

* ``share_unit_value``: the current price for an active chain, plus
  ``SCARCE_PREMIUM`` (10 %) when the bank has none left (the share cannot be
  bought back). A chain that is not on the board pays nothing now; its shares
  count ``INACTIVE_SHARE_FACTOR`` (10 %) of the price the chain would have if
  founded again.
* ``bonus``: the majority/minority bonus ``Rules.calculate_bonuses`` would pay
  the player if the chain were bought out now, ties split as the engine does.
* ``bonus_weight``: how likely the position is to be paid as it stands. A
  chain that can still be absorbed (not safe) counts ``BONUS_WEIGHT_UNSAFE``
  (0.9): it may pay at any moment. A safe chain pays only at the end of the
  game, and the race can still move until then, so it counts
  ``BONUS_WEIGHT_SAFE_MIN`` (0.5) at the start, rising in a straight line with
  game progress (share of the board's tiles already placed) to
  ``BONUS_WEIGHT_SAFE_MAX`` (0.9).

The trade's value to a side is its worth after the trade minus before, with
all holdings changed as the trade would change them. Losing a majority or
minority therefore costs that bonus; gaining one counts.

Counterparty effect: what the other side gains is a loss relative to that
rival. ``adjusted_gain = my change - rival_weight * max(0, their change)``.
``rival_weight`` is 1.0 when the counterparty is ahead of the viewer in net
worth (cash + shares at list prices) or the game has two players, otherwise
``RIVAL_WEIGHT`` (0.5): with several opponents a gain for one of them is only
partly a loss for the viewer.

Acceptance rule (used by the rules-based seat): ``acceptable`` is true when
the trade is valid and ``adjusted_gain`` is positive and at least ``margin``,
where ``margin`` is ``MARGIN`` (5 %) of the trade's size at list prices (the
larger side), ``MARGIN_AHEAD`` (10 %) when the counterparty is ahead.
"""

from __future__ import annotations

import math

from game.action import TradeOffer
from game.calculator import _fake_players, _payouts, _price, _standing
from game.rules import Rules
from game.ruleset import MIN_CHAIN_SIZE

BONUS_WEIGHT_UNSAFE = 0.9
BONUS_WEIGHT_SAFE_MIN = 0.5
BONUS_WEIGHT_SAFE_MAX = 0.9
SCARCE_PREMIUM = 0.10
INACTIVE_SHARE_FACTOR = 0.10
RIVAL_WEIGHT = 0.5
RIVAL_WEIGHT_AHEAD = 1.0
MARGIN = 0.05
MARGIN_AHEAD = 0.10


def game_progress(game) -> float:
    """Share of the board's tiles already placed (0.0 .. 1.0)."""
    tiles = game.board.all_tiles()
    if not tiles:
        return 0.0
    return sum(1 for t in tiles if game.board.is_tile_played(t)) / len(tiles)


def bonus_weight(game, chain: str, progress: float | None = None) -> float:
    """Weight of a chain's bonus position (see module docstring); 0 when the
    chain is not on the board."""
    if not game.hotel.is_chain_active(chain):
        return 0.0
    if not game.hotel.is_chain_safe(chain, game.board.get_chain_size(chain)):
        return BONUS_WEIGHT_UNSAFE
    if progress is None:
        progress = game_progress(game)
    span = BONUS_WEIGHT_SAFE_MAX - BONUS_WEIGHT_SAFE_MIN
    return round(BONUS_WEIGHT_SAFE_MIN + span * progress, 3)


def share_unit_value(game, chain: str) -> int:
    """What one share counts for in a position (see module docstring)."""
    if not game.hotel.is_chain_active(chain):
        founded = game.hotel.get_stock_price(chain, MIN_CHAIN_SIZE)
        return round(founded * INACTIVE_SHARE_FACTOR)
    price = _price(game, chain)
    if game.hotel.get_available_stocks(chain) <= 0:
        return round(price * (1 + SCARCE_PREMIUM))
    return price


def _as_offer(trade) -> TradeOffer:
    if isinstance(trade, TradeOffer):
        return trade
    return TradeOffer(
        from_player_id=trade.get("from_player_id"),
        to_player_id=trade.get("to_player_id"),
        offering_stocks={
            c: int(n) for c, n in (trade.get("offering_stocks") or {}).items()
        },
        offering_money=int(trade.get("offering_money") or 0),
        requesting_stocks={
            c: int(n) for c, n in (trade.get("requesting_stocks") or {}).items()
        },
        requesting_money=int(trade.get("requesting_money") or 0),
        trade_id=trade.get("trade_id") or "valuation",
    )


def _list_value(game, stocks: dict, cash: int) -> int:
    return int(cash) + sum(_price(game, c) * n for c, n in stocks.items())


def trade_valuation(game, trade, viewer_id: str) -> dict:
    """Value ``trade`` (a ``TradeOffer`` or its dict) for ``viewer_id``, who
    must be one of its two parties. See the module docstring for the formula.

    Returns (all money values are ints)::

        {
          "trade_id", "viewer_id", "counterparty_id",
          "valid": bool, "error": str,       # Rules.validate_trade
          "list": {"give", "get", "net"},    # the viewer's sides at list prices
          "viewer":       Side,
          "counterparty": Side,
          "rank_changes": [{chain, player_id, before, after}],  # both parties,
                          # standings as in the calculator pack (none,
                          # minority_tied, minority_sole, majority_tied,
                          # majority_sole)
          "chains": {chain: {bonus_weight, share_unit_value, safe, active}},
                          # the chains the trade moves
          "counterparty_ahead": bool, "rival_weight": float,
          "adjusted_gain": int, "margin": int, "acceptable": bool,
        }
        Side = {"cash_change", "share_value_change",
                "bonus_change_now",   # bonuses if every chain were bought out now
                "bonus_change",       # the same, weighted by bonus_weight
                "change"}             # cash + share value + weighted bonus

    For an invalid trade only the first two lines are filled and
    ``acceptable`` is false.
    """
    offer = _as_offer(trade)
    if viewer_id not in (offer.from_player_id, offer.to_player_id):
        raise ValueError(f"{viewer_id} is not a party to this trade")
    other_id = (
        offer.to_player_id
        if viewer_id == offer.from_player_id
        else offer.from_player_id
    )
    valid, error = Rules.validate_trade(game, offer)
    out = {
        "trade_id": offer.trade_id,
        "viewer_id": viewer_id,
        "counterparty_id": other_id,
        "valid": bool(valid),
        "error": error or "",
        "acceptable": False,
    }
    if not valid:
        return out

    # What each party gives, as {chain: n} and cash.
    gives = {
        offer.from_player_id: (offer.offering_stocks, offer.offering_money),
        offer.to_player_id: (offer.requesting_stocks, offer.requesting_money),
    }
    my_stocks, my_cash = gives[viewer_id]
    their_stocks, their_cash = gives[other_id]
    moved = sorted(
        {c for c, n in my_stocks.items() if n}
        | {c for c, n in their_stocks.items() if n}
    )

    progress = game_progress(game)
    parties = (viewer_id, other_id)
    sides = {
        viewer_id: {"cash_change": their_cash - my_cash},
        other_id: {"cash_change": my_cash - their_cash},
    }
    for s in sides.values():
        s.update(share_value_change=0, bonus_change_now=0, bonus_change=0.0)
    rank_changes = []
    chain_info = {}

    for chain in moved:
        delta = their_stocks.get(chain, 0) - my_stocks.get(chain, 0)  # viewer's
        unit = share_unit_value(game, chain)
        active = game.hotel.is_chain_active(chain)
        size = game.board.get_chain_size(chain)
        weight = bonus_weight(game, chain, progress)
        chain_info[chain] = {
            "active": active,
            "safe": bool(active and game.hotel.is_chain_safe(chain, size)),
            "bonus_weight": weight,
            "share_unit_value": unit,
        }
        sides[viewer_id]["share_value_change"] += delta * unit
        sides[other_id]["share_value_change"] -= delta * unit
        if not active or delta == 0:
            continue
        before = {p.player_id: p.get_stock_count(chain) for p in game.players}
        after = dict(before)
        after[viewer_id] += delta
        after[other_id] -= delta
        pay_before = _payouts(game.players, chain, size, game.hotel)
        pay_after = _payouts(_fake_players(after, chain), chain, size, game.hotel)
        for pid in parties:
            diff = pay_after.get(pid, {}).get("total", 0) - pay_before.get(pid, {}).get(
                "total", 0
            )
            sides[pid]["bonus_change_now"] += diff
            sides[pid]["bonus_change"] += diff * weight
            was, now = _standing(before, pid), _standing(after, pid)
            if was != now:
                rank_changes.append(
                    {"chain": chain, "player_id": pid, "before": was, "after": now}
                )

    for s in sides.values():
        s["bonus_change"] = round(s["bonus_change"])
        s["change"] = s["cash_change"] + s["share_value_change"] + s["bonus_change"]

    prices = {c: _price(game, c) for c in game.hotel.get_all_chain_names()}
    worth = {pid: game.get_player(pid).get_net_worth(prices) for pid in parties}
    ahead = worth[other_id] > worth[viewer_id]
    rival_weight = (
        RIVAL_WEIGHT_AHEAD if ahead or len(game.players) <= 2 else RIVAL_WEIGHT
    )
    give = _list_value(game, my_stocks, my_cash)
    get = _list_value(game, their_stocks, their_cash)
    adjusted = round(
        sides[viewer_id]["change"] - rival_weight * max(0, sides[other_id]["change"])
    )
    margin = math.ceil((MARGIN_AHEAD if ahead else MARGIN) * max(give, get))
    out.update(
        {
            "list": {"give": give, "get": get, "net": get - give},
            "viewer": sides[viewer_id],
            "counterparty": sides[other_id],
            "rank_changes": rank_changes,
            "chains": chain_info,
            "counterparty_ahead": ahead,
            "rival_weight": rival_weight,
            "adjusted_gain": adjusted,
            "margin": margin,
            "acceptable": bool(adjusted > 0 and adjusted >= margin),
        }
    )
    return out


def trades_section(game, viewer_id: str) -> dict[str, dict]:
    """Valuations of every open offer the viewer is a party to, by trade id
    (the ``trades`` section of the calculator pack)."""
    return {
        t.trade_id: trade_valuation(game, t, viewer_id)
        for t in game.pending_trades.values()
        if viewer_id in (t.from_player_id, t.to_player_id)
    }


__all__ = ["bonus_weight", "game_progress", "share_unit_value", "trade_valuation"]
