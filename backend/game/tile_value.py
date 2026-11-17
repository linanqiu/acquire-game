"""Position-aware value of placing a tile (docs/ai/bot-tiles.md).

``tile_valuation(game, tile, viewer_id)`` answers "what does placing this tile
do to me, and to everyone else?" in money. It is pure (reads the game, changes
nothing), deterministic and uses only PUBLIC information plus the viewer's
tile: the board, chain sizes, cash and share counts. ``game`` is anything with
``board``, ``hotel``, ``players`` (seat order) and ``ruleset``: the real
``Game`` or the table the rules-based seat rebuilds from its public state.

Every player's gain from the tile, by effect:

* merge: for each defunct chain, the bonuses ``Rules.calculate_bonuses`` pays
  at its size before the merger (ties split as the engine does), counted in
  full (cash in hand now); plus the trade surplus of every defunct holder who
  is better off trading into the survivor (post-merger price; the bank's
  survivor stock is used up in the engine's decision order: the merger's
  maker first, then clockwise, so the maker trades at the best moment); plus
  the survivor's growth (below). When the survivor is the placer's choice
  (tie), each candidate is valued and the best one for the viewer is taken.
* expand: the chain's growth (below).
* found: the founder (the viewer) gets the free share(s) at the new chain's
  price plus ``FOUND_POSITION_FACTOR`` of the bonuses a sole holder would
  have at that size (a new race the founder leads, but one rivals can still
  contest). The best chain still available is assumed.
* nothing: 0.

Growth of a chain from size s to s' (expand, and the survivor of a merger),
for a player holding h shares before and h' after (trades in the merger)::

    h * (price(s') - price(s)) + w * (bonus(h', s') - bonus(h, s))
      + SAFE_LOCK_FACTOR * bonus(h', s')   if the tile makes the chain safe

``w`` is ``trade_value.bonus_weight`` (how likely a bonus position is to be
paid as it stands). Making a chain safe locks its race: a plus for whoever
holds its bonus positions, so a minus for me when that is a rival.

The score compares my gain with my rivals' (in this game helping a rival more
than yourself loses ground)::

    score = my_gain - LAMBDA * sum over rivals of rival_weight * max(0, rival_gain)

``rival_weight`` is ``RIVAL_WEIGHT_BEHIND`` (0.5) for a rival behind me in
worth (cash + shares at current prices + bonuses if paid now),
``RIVAL_WEIGHT_AHEAD`` (0.75) for one ahead of me and ``RIVAL_WEIGHT_LEADER``
(1.0) for the table leader when that is not me; 1.0 for the only rival of a
two-player game. A merger that pays only rivals is therefore clearly negative,
one that pays me the majority while rivals get less stays clearly positive,
and an equal split with the leader is about neutral.
"""

from __future__ import annotations

import copy
from types import SimpleNamespace

from game.board import Tile
from game.calculator import _fake_players, _payouts, _price, _simulate
from game.rules import PlacementResult, Rules
from game.trade_value import bonus_weight, game_progress

LAMBDA = 1.0
RIVAL_WEIGHT_BEHIND = 0.5
RIVAL_WEIGHT_AHEAD = 0.75
RIVAL_WEIGHT_LEADER = 1.0
FOUND_POSITION_FACTOR = 0.25
SAFE_LOCK_FACTOR = 0.25


def _worth(game) -> dict[str, int]:
    """Each player's worth: cash + shares at current prices + the bonuses
    every chain on the board would pay now (the calculator's projected final
    score)."""
    prices = {c: _price(game, c) for c in game.hotel.get_all_chain_names()}
    out = {p.player_id: p.money for p in game.players}
    for p in game.players:
        out[p.player_id] += sum(
            p.get_stock_count(c) * prices[c] for c in game.hotel.get_active_chains()
        )
    for chain in game.hotel.get_active_chains():
        size = game.board.get_chain_size(chain)
        for pid, b in _payouts(game.players, chain, size, game.hotel).items():
            out[pid] = out.get(pid, 0) + b["total"]
    return out


def rival_weights(game, viewer_id: str) -> dict[str, float]:
    """``{rival_id: weight}`` (see module docstring)."""
    worth = _worth(game)
    rivals = [p.player_id for p in game.players if p.player_id != viewer_id]
    if len(rivals) <= 1:
        return {r: RIVAL_WEIGHT_LEADER for r in rivals}
    top = max(worth.values())
    out = {}
    for r in rivals:
        if worth[r] <= worth[viewer_id]:
            out[r] = RIVAL_WEIGHT_BEHIND
        elif worth[r] == top:
            out[r] = RIVAL_WEIGHT_LEADER
        else:
            out[r] = RIVAL_WEIGHT_AHEAD
    return out


def _bonus(holdings: dict[str, int], chain: str, size: int, hotel) -> dict[str, int]:
    pay = _payouts(_fake_players(holdings, chain), chain, size, hotel)
    return {pid: pay.get(pid, {}).get("total", 0) for pid in holdings}


def _growth(
    game,
    chain: str,
    size_after: int,
    received: dict[str, int] | None = None,
    progress: float | None = None,
    safe_lock: float = SAFE_LOCK_FACTOR,
) -> dict[str, float]:
    """Every player's gain from ``chain`` growing to ``size_after`` (with
    ``received`` extra shares from merger trades); see module docstring."""
    hotel = game.hotel
    size = game.board.get_chain_size(chain)
    before = {p.player_id: p.get_stock_count(chain) for p in game.players}
    after = {pid: n + (received or {}).get(pid, 0) for pid, n in before.items()}
    price_now = hotel.get_stock_price(chain, size)
    price_after = hotel.get_stock_price(chain, size_after)
    w = bonus_weight(game, chain, progress)
    pay_now = _bonus(before, chain, size, hotel)
    pay_after = _bonus(after, chain, size_after, hotel)
    locks = not hotel.is_chain_safe(chain, size) and hotel.is_chain_safe(
        chain, size_after
    )
    out = {}
    for pid, n in before.items():
        gain = n * (price_after - price_now) + w * (pay_after[pid] - pay_now[pid])
        if locks:
            gain += safe_lock * pay_after[pid]
        out[pid] = gain
    return out


def _merge_gains(
    game,
    tile: Tile,
    chains: list[str],
    survivor: str,
    maker: str,
    safe_lock: float = SAFE_LOCK_FACTOR,
):
    """Every player's gain from the merger with ``survivor``, and the detail."""
    board, hotel = game.board, game.hotel
    ratio = game.ruleset.merger_trade_ratio
    defunct = sorted(
        (c for c in chains if c != survivor),
        key=lambda c: board.get_chain_size(c),
        reverse=True,
    )
    after = _simulate(board, tile, survivor, defunct)
    size_after = after.get_chain_size(survivor)
    price_after = hotel.get_stock_price(survivor, size_after)
    ids = [p.player_id for p in game.players]
    start = ids.index(maker) if maker in ids else 0
    order = ids[start:] + ids[:start]
    gains = dict.fromkeys(ids, 0.0)
    bonuses = dict.fromkeys(ids, 0)
    received = dict.fromkeys(ids, 0)
    bank = hotel.get_available_stocks(survivor)
    for d in defunct:
        size = board.get_chain_size(d)
        price = hotel.get_stock_price(d, size)
        for pid, b in _payouts(game.players, d, size, hotel).items():
            bonuses[pid] += b["total"]
            gains[pid] += b["total"]
        if price_after <= ratio * price:
            continue  # selling is at least as good: no surplus for anyone
        for pid in order:
            n = _player(game, pid).get_stock_count(d)
            traded = min(n - n % ratio, bank * ratio)
            if traded <= 0:
                continue
            got = traded // ratio
            bank -= got
            received[pid] += got
            gains[pid] += got * price_after - traded * price
    for pid, g in _growth(
        game, survivor, size_after, received, None, safe_lock
    ).items():
        gains[pid] += g
    detail = {
        "survivor": survivor,
        "defunct": defunct,
        "survivor_size_after": size_after,
        "bonus_by_player": {pid: v for pid, v in bonuses.items() if v},
    }
    return gains, detail


def _player(game, pid: str):
    return next(p for p in game.players if p.player_id == pid)


def _found_gain(
    game, tile: Tile, factor: float = FOUND_POSITION_FACTOR
) -> tuple[float, dict]:
    placed = copy.deepcopy(game.board)
    placed.place_tile(tile)
    size = len(placed.get_connected_tiles(tile))
    free = game.ruleset.founder_bonus_shares
    best, best_chain = 0.0, None
    for chain in game.hotel.get_inactive_chains():
        shares = min(free, game.hotel.get_available_stocks(chain))
        value = shares * game.hotel.get_stock_price(chain, size)
        if shares:
            sole = game.hotel.get_majority_bonus(
                chain, size
            ) + game.hotel.get_minority_bonus(chain, size)
            value += factor * sole
        if best_chain is None or value > best:
            best, best_chain = value, chain
    return best, {"chain": best_chain, "new_size": size}


def tile_valuation(
    game, tile: Tile | str, viewer_id: str, params: dict | None = None
) -> dict:
    """Value placing ``tile`` for ``viewer_id`` (see module docstring).

    Returns ``{tile, effect, score, my_gain, rival_cost, gains {pid: gain},
    rival_weights {pid: w}, ...}`` with money values rounded to ints; a merge
    adds ``survivor``, ``defunct``, ``survivor_size_after`` and
    ``bonus_by_player``, a found adds ``chain`` and ``new_size``.

    ``params`` overrides the weights for one bot generation: ``lambda``
    (``LAMBDA``), ``found_factor`` (``FOUND_POSITION_FACTOR``), ``safe_lock``
    (``SAFE_LOCK_FACTOR``)."""
    params = params or {}
    lam = float(params.get("lambda", LAMBDA))
    found_factor = float(params.get("found_factor", FOUND_POSITION_FACTOR))
    safe_lock = float(params.get("safe_lock", SAFE_LOCK_FACTOR))
    board = game.board
    if isinstance(tile, str):
        tile = board.tile_from_string(tile)
    res = Rules.get_placement_result(board, tile)
    ids = [p.player_id for p in game.players]
    gains = dict.fromkeys(ids, 0.0)
    extra: dict = {}
    weights = rival_weights(game, viewer_id)

    def score_of(g: dict[str, float]) -> tuple[float, float]:
        cost = sum(weights[r] * max(0.0, g.get(r, 0.0)) for r in weights)
        return g.get(viewer_id, 0.0) - lam * cost, cost

    if res.result_type == PlacementResult.FOUND:
        value, extra = _found_gain(game, tile, found_factor)
        gains[viewer_id] = value
    elif res.result_type == PlacementResult.EXPAND:
        size_after = _simulate(board, tile, res.chain).get_chain_size(res.chain)
        gains.update(
            _growth(game, res.chain, size_after, None, game_progress(game), safe_lock)
        )
        extra = {"chain": res.chain, "new_size": size_after}
    elif res.result_type == PlacementResult.MERGE:
        survivor = Rules.get_merger_survivor(board, res.chains)
        candidates = [survivor] if isinstance(survivor, str) else list(survivor)
        best = None
        for s in candidates:
            g, detail = _merge_gains(
                game, tile, list(res.chains), s, viewer_id, safe_lock
            )
            sc = score_of(g)[0]
            if best is None or sc > best[0]:
                best = (sc, g, detail)
        gains, extra = best[1], best[2]
        extra["survivor_chosen_by_player"] = len(candidates) > 1
    score, cost = score_of(gains)
    return {
        "tile": str(tile),
        "effect": res.result_type,
        "score": round(score),
        "my_gain": round(gains.get(viewer_id, 0.0)),
        "rival_cost": round(cost),
        "gains": {pid: round(v) for pid, v in gains.items()},
        "rival_weights": weights,
        **extra,
    }


def table_from_parts(board, hotel, players, ruleset) -> SimpleNamespace:
    """The minimal game view ``tile_valuation`` reads (for seats that rebuild
    the table from public state)."""
    return SimpleNamespace(board=board, hotel=hotel, players=players, ruleset=ruleset)


__all__ = [
    "FOUND_POSITION_FACTOR",
    "LAMBDA",
    "RIVAL_WEIGHT_AHEAD",
    "RIVAL_WEIGHT_BEHIND",
    "RIVAL_WEIGHT_LEADER",
    "SAFE_LOCK_FACTOR",
    "rival_weights",
    "table_from_parts",
    "tile_valuation",
]
