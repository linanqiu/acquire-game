"""Rules that later bot generations add (agents/bot_versions.py).

Each function is pure: it reads a game view (``board``, ``hotel``,
``players`` in seat order, ``ruleset``: the real ``Game`` or the table the
heuristic seat rebuilds from public state) and returns an answer built from
the legal options it is given. Weights come from the version's ``BotPolicy``.
"""

from __future__ import annotations

import itertools

from game.calculator import _fake_players, _payouts
from game.tile_value import rival_weights
from game.trade_value import bonus_weight, game_progress


def _holdings(table, chain: str) -> dict[str, int]:
    return {p.player_id: p.get_stock_count(chain) for p in table.players}


def _pay(holdings: dict[str, int], chain: str, size: int, hotel) -> dict[str, int]:
    pay = _payouts(_fake_players(holdings, chain), chain, size, hotel)
    return {pid: pay.get(pid, {}).get("total", 0) for pid in holdings}


def buy_position_value(
    table,
    me: str,
    chain: str,
    k: int,
    weights=None,
    defend: float = 0.0,
    available: int | None = None,
    size_ahead: int = 0,
) -> float:
    """What buying ``k`` shares of ``chain`` does to bonus positions: my
    weighted bonus gain plus the weighted bonus my rivals lose (rival weights
    as in the tile value).

    ``defend`` (0..1) blends my gain "if bought out now" with my gain after
    the strongest rival's reply: the rival holding the most shares buys as
    many as one turn allows (``max_stock_purchases_per_turn``, bounded by the
    bank's ``available`` stock left after my purchase). A one-share lead then
    counts for less, and widening a lead a rival could overtake counts.

    ``size_ahead`` values the bonuses at the chain's size plus that many tiles
    (bonuses grow with size; a position in a chain that will grow is worth
    more than its bonus now)."""
    if k <= 0:
        return 0.0
    hotel = table.hotel
    size = table.board.get_chain_size(chain) + max(0, size_ahead)
    before = _holdings(table, chain)
    after = dict(before)
    after[me] = before.get(me, 0) + k
    pay0 = _pay(before, chain, size, hotel)
    pay1 = _pay(after, chain, size, hotel)
    w = bonus_weight(table, chain, game_progress(table))
    rw = weights if weights is not None else rival_weights(table, me)
    mine = pay1[me] - pay0[me]
    if defend > 0:
        rivals = [pid for pid in before if pid != me]
        if rivals:
            best = max(rivals, key=lambda pid: before[pid])
            bank = (
                available
                if available is not None
                else hotel.get_available_stocks(chain)
            )
            reply = max(0, min(table.ruleset.max_stock_purchases_per_turn, bank - k))
            t0, t1 = dict(before), dict(after)
            t0[best] += reply
            t1[best] += reply
            threat = _pay(t1, chain, size, hotel)[me] - _pay(t0, chain, size, hotel)[me]
            mine = (1 - defend) * mine + defend * threat
    value = w * mine
    for r, x in rw.items():
        value += w * x * (pay0.get(r, 0) - pay1.get(r, 0))
    return value


def choose_buys_position(
    table,
    me: str,
    options: dict[str, dict],
    money: int,
    max_total: int,
    cash_cost: float = 0.0,
    defend: float = 0.0,
    size_ahead: int = 0,
) -> tuple[dict[str, int], float]:
    """The purchase (``{chain: n}``) with the best bonus-position value (see
    ``buy_position_value``) minus ``cash_cost`` x the cash spent, over every
    affordable combination of up to ``max_total`` shares. Returns the purchase
    and its value (an empty purchase is worth 0)."""
    chains = sorted(options)
    weights = rival_weights(table, me)
    cache: dict[tuple[str, int], float] = {}

    def val(c: str, k: int) -> float:
        if (c, k) not in cache:
            cache[(c, k)] = buy_position_value(
                table, me, c, k, weights, defend, options[c]["available"], size_ahead
            )
        return cache[(c, k)]

    best: tuple[float, dict[str, int]] = (0.0, {})
    for n in range(1, max_total + 1):
        for combo in itertools.combinations_with_replacement(chains, n):
            counts: dict[str, int] = {}
            for c in combo:
                counts[c] = counts.get(c, 0) + 1
            if any(k > options[c]["available"] for c, k in counts.items()):
                continue
            cost = sum(options[c]["price"] * k for c, k in counts.items())
            if cost > money:
                continue
            v = sum(val(c, k) for c, k in counts.items()) - cash_cost * cost
            if v > best[0] + 1e-9:
                best = (v, counts)
    return best[1], best[0]


def choose_disposition_position(
    table, me: str, info: dict, ratio: int
) -> dict[str, int]:
    """Sell / trade / hold for a defunct chain by post-merger position math.

    ``info`` is the calculator's disposition section (``calc["disposition"]``:
    shares, defunct price, survivor size and price after the merger,
    max_trade). For each tradeable amount (a multiple of ``ratio``), the value
    is: survivor shares received at the post-merger price, plus the change in
    my weighted survivor bonus at the post-merger size, plus the weighted bonus
    my rivals lose there (rival weights as in the tile value); the rest is
    sold at the defunct price (held shares are worth nothing unless the chain
    is founded again). The best amount wins."""
    n = int(info["shares"])
    survivor = info["survivor"]
    p_def = int(info["defunct_price"])
    p_surv = int(info["survivor_price_after"])
    size_after = int(info["survivor_size_after"])
    max_trade = int(info["max_trade"])
    hotel = table.hotel
    before = _holdings(table, survivor)
    pay0 = _pay(before, survivor, size_after, hotel)
    w = bonus_weight(table, survivor, game_progress(table))
    rw = rival_weights(table, me)
    best = None
    for t in range(0, max_trade + 1, ratio):
        got = t // ratio
        after = dict(before)
        after[me] = before.get(me, 0) + got
        pay1 = _pay(after, survivor, size_after, hotel)
        v = got * p_surv + w * (pay1[me] - pay0[me])
        for r, x in rw.items():
            v += w * x * (pay0.get(r, 0) - pay1.get(r, 0))
        v += (n - t) * p_def
        if best is None or v > best[0] + 1e-9:
            best = (v, t)
    trade = best[1] if best else 0
    return {"sell": n - trade, "trade": trade, "hold": 0}


__all__ = [
    "buy_position_value",
    "choose_buys_position",
    "choose_disposition_position",
]
