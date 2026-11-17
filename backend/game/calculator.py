"""Calculator pack: every figure a precise human with a calculator could derive.

``build_calculator_pack(game, viewer_id)`` returns a JSON-serialisable dict built
only from PUBLIC information (board, chain sizes, cash, share counts, bank stock,
bag *count*) plus the viewer's own hand.  It never reads other players' hands or
the tile bag contents.  All money maths is delegated to the engine
(``Rules.calculate_bonuses``, ``Hotel`` pricing, ``Rules.get_*`` placement and
playability helpers) so the numbers cannot disagree with the game.

Top-level shape::

    {
      "phase": str,                    # game phase string
      "current_player_id": str|None,
      "viewer_id": str,
      "viewer_is_current": bool,
      "chains":  {chain_name: ChainInfo},   # every chain of the ruleset, stable keys
      "players": [PlayerInfo, ...],         # in seating order
      "viewer":  ViewerInfo,
      "bank":    BankInfo,
      "buy_options": {chain_name: BuyOption},  # active chains with stock left
      "disposition": DispositionInfo | None,   # the viewer's pending merger choice
      "trades": {trade_id: TradeValuation},    # open offers the viewer is a party to
    }

ChainInfo (every chain; inactive chains only fill the first few keys)::

    active, size, safe, price, available_stock, price_if_founded (price at 2 tiles),
    tiles_to_safe, next_price_size, next_price (None at top bracket),
    majority_bonus, minority_bonus   (at current size),
    holders: [{player_id, name, shares}]   sorted by shares desc, then seat order
    payouts: {player_id: {majority, minority, total}}   what Rules.calculate_bonuses
             pays at current size (ties split + rounded up by the engine)
    majority_receivers / minority_receivers: [player_id]
    viewer: {shares, sell_value, standing, shares_to_tie_majority,
             shares_to_take_majority, shares_to_reach_minority,
             shares_to_take_minority, best_rival_shares, lead,
             rival_shares_to_pass, majority_locked}   (see ``_race``)
        standing is one of: none, minority_tied, minority_sole, majority_tied,
        majority_sole.  The shares_to_* values are the smallest number of extra
        shares the viewer must buy (bounded by bank stock and the per-chain cap)
        to reach that status holding everyone else constant, 0 if already there,
        None if not reachable.

PlayerInfo::

    player_id, name, is_bot, cash, tile_count, shares {chain: n} (every chain),
    stock_value (current prices), net_worth (cash + stock_value),
    projected_bonuses {chain: total} (active chains, nonzero only),
    projected_bonus_income, projected_stock_sale,
    projected_final_score  (== money after ``Game.end_game()`` right now),
    projected_rank         (1 = winning, ties broken by seating like end_game)

ViewerInfo::

    cash, hand: [tile str], tiles: [TileInfo]
    TileInfo = {tile, effect: nothing|expand|found|merge, playable, unplayable_reason,
                permanent, chain (expand), new_size/new_price (expand),
                chains_available_to_found + new_size/new_price/founder_free_share
                (found), chains + survivor_candidates + scenarios (merge)}
    merge scenario (one per candidate survivor; several only on a tie):
        {survivor, defunct: [{chain, size, price, bonus_payouts, viewer_bonus,
         viewer_shares, sell_all_value, trade: {shares_traded, survivor_shares_received,
         value_at_survivor_post_merger_price, leftover_shares_sold,
         leftover_sale_value, total_value}, trade_minus_sell}],
         survivor_size_after, survivor_price_after, survivor_safe_after,
         viewer_total_bonus, bonus_by_player {player_id: total}}
        Defunct chains appear in the engine's processing order (largest first).
        Trading uses the survivor's bank stock as it is now; earlier trades in a
        multi-chain merger can reduce it.

BankInfo::

    tiles_remaining (count only), chains_available_to_found, chains_active,
    can_end_game, can_end_game_reason, viewer_can_declare_now

BuyOption::

    price, available, max_affordable (limited by cash, bank stock, per-turn limit),
    can_buy_now (viewer's buy phase), standing_now, payout_now,
    purchases: {"1".."n": {cost, cash_after, standing_after, payout_after,
                           payout_change}}   (only counts the viewer can afford)
    payout_* is what the viewer would receive for that chain's bonuses if it were
    liquidated/acquired at its current size.

TradeValuation: see ``game.trade_value.trade_valuation`` (what an offer does to
both sides' positions: cash, shares and bonus positions, not just list prices).

DispositionInfo: see ``_disposition_section`` (sell vs trade with the survivor's
post-merger price and the viewer's survivor standing after trading).
"""

from __future__ import annotations

import copy
from types import SimpleNamespace

from game.board import Board, Tile, TileState
from game.hotel import Hotel
from game.ranking import competition_ranks
from game.rules import PlacementResult, Rules
from game.ruleset import MIN_CHAIN_SIZE


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _price(game, chain: str) -> int:
    """Current price of a chain (0 when not on the board), as Game.end_game uses."""
    if not game.hotel.is_chain_active(chain):
        return 0
    return game.hotel.get_stock_price(chain, game.board.get_chain_size(chain))


def _fake_players(holdings: dict[str, int], chain: str) -> list:
    """Lightweight stand-ins so Rules.calculate_bonuses can run on hypotheticals."""
    return [
        SimpleNamespace(
            player_id=pid,
            get_stock_count=lambda c, n=n: n if c == chain else 0,
        )
        for pid, n in holdings.items()
    ]


def _payouts(players, chain: str, size: int, hotel: Hotel) -> dict[str, dict]:
    raw = Rules.calculate_bonuses(players, chain, size, hotel)
    out = {}
    for pid, b in raw.items():
        maj, mino = b.get("majority", 0), b.get("minority", 0)
        out[pid] = {"majority": maj, "minority": mino, "total": maj + mino}
    return out


def _standing(holdings: dict[str, int], me: str) -> str:
    """Viewer's bonus standing derived from share counts (mirrors the engine)."""
    mine = holdings.get(me, 0)
    if mine <= 0:
        return "none"
    counts = [n for n in holdings.values() if n > 0]
    top = max(counts)
    n_top = counts.count(top)
    if mine == top:
        return "majority_sole" if n_top == 1 else "majority_tied"
    if n_top > 1:
        return "none"  # tied majority swallows the minority bonus
    rest = [n for n in counts if n != top]
    second = max(rest)
    if mine == second:
        return "minority_sole" if rest.count(second) == 1 else "minority_tied"
    return "none"


def _shares_needed(
    holdings: dict[str, int], me: str, wanted: set[str], cap: int, max_held: int
) -> int | None:
    base = holdings.get(me, 0)
    for k in range(cap + 1):
        if base + k > max_held:
            break
        h = dict(holdings)
        h[me] = base + k
        if _standing(h, me) in wanted:
            return k
    return None


def _race(holdings: dict[str, int], me: str, available: int) -> dict:
    """The share race in one chain from the viewer's side.

    ``best_rival_shares``: most shares any other player holds. ``lead``: the
    viewer's shares minus that (negative when behind). ``rival_shares_to_pass``
    (only when the viewer holds the most, alone or tied): the fewest shares the
    best-placed rival must buy from the bank to hold strictly more than the
    viewer, ``None`` when the bank no longer has that many, i.e. no rival can
    pass the viewer by buying (``majority_locked``)."""
    mine = holdings.get(me, 0)
    best = max((n for pid, n in holdings.items() if pid != me), default=0)
    lead = mine - best
    to_pass = None
    if mine > 0 and lead >= 0 and lead + 1 <= available:
        to_pass = lead + 1
    return {
        "best_rival_shares": best,
        "lead": lead,
        "rival_shares_to_pass": to_pass,
        "majority_locked": bool(mine > 0 and lead > 0 and to_pass is None),
    }


def _prices(game) -> dict[str, int]:
    """Current price of every chain (0 for chains not on the board)."""
    return {c: _price(game, c) for c in game.hotel.get_all_chain_names()}


def _holders(game, chain: str) -> list[dict]:
    """Players holding ``chain``: ``{player_id, name, shares}``, most shares first
    (seat order breaks ties)."""
    seat = {p.player_id: i for i, p in enumerate(game.players)}
    holders = [
        {"player_id": p.player_id, "name": p.name, "shares": p.get_stock_count(chain)}
        for p in game.players
        if p.get_stock_count(chain) > 0
    ]
    return sorted(holders, key=lambda h: (-h["shares"], seat[h["player_id"]]))


def _holdings(game, chain: str) -> dict[str, int]:
    return {p.player_id: p.get_stock_count(chain) for p in game.players}


def _end_game_reason(game) -> tuple[bool, str]:
    can = Rules.check_end_game(game.board, game.hotel)
    rs = game.ruleset
    end_size = rs.end_game_chain_size
    active = game.hotel.get_active_chains()
    if not active:
        return can, "no chains on the board"
    big = [c for c in active if game.board.get_chain_size(c) >= end_size]
    if big:
        return can, f"chain with {end_size}+ tiles: {', '.join(big)}"
    unsafe = [c for c in active if game.board.get_chain_size(c) < rs.safe_chain_size]
    if not unsafe:
        return can, "all active chains are safe"
    return can, (
        "not met: no chain has "
        f"{end_size}+ tiles and these active chains are not safe: "
        f"{', '.join(unsafe)}"
    )


def _simulate(board: Board, tile: Tile, chain: str, defunct: list[str] | None = None):
    """Copy the board, place ``tile`` and assign chain membership like the engine."""
    b = copy.deepcopy(board)
    b.place_tile(tile)
    for d in defunct or []:
        b.merge_chains(chain, d)
    # Engine: placed tile and connected unchained tiles join the chain
    # (_expand_chain / _finalize_merger / found_chain).
    for t in b.get_connected_tiles(tile):
        cell = b.get_cell(t.column, t.row)
        if cell.chain is None and cell.state != TileState.EMPTY:
            b.set_chain(t, chain)
    return b


# ---------------------------------------------------------------------------
# Sections
# ---------------------------------------------------------------------------


def _chains_section(game, viewer_id: str) -> dict:
    rs = game.ruleset
    max_held = rs.stocks_per_chain
    out = {}
    for chain in game.hotel.get_all_chain_names():
        active = game.hotel.is_chain_active(chain)
        size = game.board.get_chain_size(chain)
        info = {
            "active": active,
            "size": size,
            "safe": bool(active and game.hotel.is_chain_safe(chain, size)),
            "price": _price(game, chain),
            "available_stock": game.hotel.get_available_stocks(chain),
            "price_if_founded": game.hotel.get_stock_price(chain, MIN_CHAIN_SIZE),
        }
        if active:
            nsize, nprice = rs.next_price(chain, size)
            holdings = _holdings(game, chain)
            holders = _holders(game, chain)
            payouts = _payouts(game.players, chain, size, game.hotel)
            mine = holdings.get(viewer_id, 0)
            cap = min(game.hotel.get_available_stocks(chain), max_held - mine)
            race = _race(holdings, viewer_id, game.hotel.get_available_stocks(chain))
            info.update(
                tiles_to_safe=max(0, rs.safe_chain_size - size),
                next_price_size=nsize,
                next_price=nprice,
                majority_bonus=game.hotel.get_majority_bonus(chain, size),
                minority_bonus=game.hotel.get_minority_bonus(chain, size),
                holders=holders,
                payouts=payouts,
                majority_receivers=sorted(
                    pid for pid, b in payouts.items() if b["majority"] > 0
                ),
                minority_receivers=sorted(
                    pid for pid, b in payouts.items() if b["minority"] > 0
                ),
                viewer={
                    "shares": mine,
                    "sell_value": mine * info["price"],
                    "standing": _standing(holdings, viewer_id),
                    "shares_to_tie_majority": _shares_needed(
                        holdings,
                        viewer_id,
                        {"majority_tied", "majority_sole"},
                        cap,
                        max_held,
                    ),
                    "shares_to_take_majority": _shares_needed(
                        holdings, viewer_id, {"majority_sole"}, cap, max_held
                    ),
                    "shares_to_reach_minority": _shares_needed(
                        holdings,
                        viewer_id,
                        {
                            "minority_tied",
                            "minority_sole",
                            "majority_tied",
                            "majority_sole",
                        },
                        cap,
                        max_held,
                    ),
                    "shares_to_take_minority": _shares_needed(
                        holdings, viewer_id, {"minority_sole"}, cap, max_held
                    ),
                    **race,
                },
            )
        out[chain] = info
    return out


def _players_section(game) -> list[dict]:
    all_chains = game.hotel.get_all_chain_names()
    prices = _prices(game)
    # Bonuses per active chain, exactly as Game.end_game pays them.
    bonus_by_chain = {}
    for chain in game.hotel.get_active_chains():
        size = game.board.get_chain_size(chain)
        bonus_by_chain[chain] = Rules.calculate_bonuses(
            game.players, chain, size, game.hotel
        )

    rows = []
    for p in game.players:
        proj_bonuses = {}
        for chain, bonuses in bonus_by_chain.items():
            b = bonuses.get(p.player_id)
            if b:
                total = b.get("majority", 0) + b.get("minority", 0)
                if total:
                    proj_bonuses[chain] = total
        bonus_income = sum(proj_bonuses.values())
        stock_sale = sum(
            p.get_stock_count(c) * prices[c]
            for c in all_chains
            if game.hotel.is_chain_active(c)
        )
        rows.append(
            {
                "player_id": p.player_id,
                "name": p.name,
                "is_bot": p.player_id in game.bots,
                "cash": p.money,
                "tile_count": p.hand_size,
                "shares": {c: p.get_stock_count(c) for c in all_chains},
                "stock_value": p.get_stock_value(prices),
                "net_worth": p.get_net_worth(prices),
                "projected_bonuses": proj_bonuses,
                "projected_bonus_income": bonus_income,
                "projected_stock_sale": stock_sale,
                "projected_final_score": p.money + bonus_income + stock_sale,
            }
        )
    # Same competition ranking as Game.end_game: tied scores share a rank.
    ranks = competition_ranks([r["projected_final_score"] for r in rows])
    for rank, r in zip(ranks, rows, strict=True):
        r["projected_rank"] = rank
    return rows


def _merge_scenario(game, tile: Tile, chains: list[str], survivor: str, viewer_id):
    me = game.get_player(viewer_id)
    defunct = sorted(
        (c for c in chains if c != survivor),
        key=lambda c: game.board.get_chain_size(c),
        reverse=True,
    )
    after = _simulate(game.board, tile, survivor, defunct)
    size_after = after.get_chain_size(survivor)
    price_after = game.hotel.get_stock_price(survivor, size_after)
    bank_survivor = game.hotel.get_available_stocks(survivor)
    ratio = game.ruleset.merger_trade_ratio

    rows = []
    total_bonus = 0
    for d in defunct:
        size = game.board.get_chain_size(d)
        price = game.hotel.get_stock_price(d, size)
        payouts = _payouts(game.players, d, size, game.hotel)
        vb = payouts.get(viewer_id, {}).get("total", 0)
        total_bonus += vb
        shares = me.get_stock_count(d)
        # Mirrors handle_stock_disposition: a multiple of the ratio (2:1 in
        # default), limited by bank.
        tradable = min(shares - shares % ratio, bank_survivor * ratio)
        received = tradable // ratio
        leftover = shares - tradable
        trade_value = received * price_after
        total_trade = trade_value + leftover * price
        rows.append(
            {
                "chain": d,
                "size": size,
                "price": price,
                "bonus_payouts": payouts,
                "viewer_bonus": vb,
                "viewer_shares": shares,
                "sell_all_value": shares * price,
                "trade": {
                    "shares_traded": tradable,
                    "survivor_shares_received": received,
                    "value_at_survivor_post_merger_price": trade_value,
                    "leftover_shares_sold": leftover,
                    "leftover_sale_value": leftover * price,
                    "total_value": total_trade,
                },
                "trade_minus_sell": total_trade - shares * price,
            }
        )
    bonus_by_player: dict[str, int] = {}
    for row in rows:
        for pid, b in row["bonus_payouts"].items():
            bonus_by_player[pid] = bonus_by_player.get(pid, 0) + b["total"]
    return {
        "survivor": survivor,
        "defunct": rows,
        "survivor_size_after": size_after,
        "survivor_price_after": price_after,
        "survivor_safe_after": game.hotel.is_chain_safe(survivor, size_after),
        "viewer_total_bonus": total_bonus,
        # Every player's merger bonuses over all defunct chains (nonzero only),
        # largest first: who this merger pays, not only the mover.
        "bonus_by_player": dict(
            sorted(
                ((p, v) for p, v in bonus_by_player.items() if v),
                key=lambda kv: -kv[1],
            )
        ),
    }


def _tile_info(game, tile: Tile, viewer_id: str) -> dict:
    board, hotel = game.board, game.hotel
    play = Rules.get_tile_playability(board, tile, hotel)
    res = Rules.get_placement_result(board, tile)
    info = {
        "tile": str(tile),
        "effect": res.result_type,
        "playable": play["playable"],
        "unplayable_reason": play["reason"],
        "permanent": play["permanent"],
    }
    if not play["playable"]:
        if res.result_type == PlacementResult.MERGE:
            info["chains"] = list(res.chains)
        return info

    if res.result_type == PlacementResult.EXPAND:
        b = _simulate(board, tile, res.chain)
        size = b.get_chain_size(res.chain)
        info.update(
            chain=res.chain,
            new_size=size,
            new_price=hotel.get_stock_price(res.chain, size),
        )
    elif res.result_type == PlacementResult.FOUND:
        placed = copy.deepcopy(board)
        placed.place_tile(tile)
        size = len(placed.get_connected_tiles(tile))
        available = hotel.get_inactive_chains()
        info.update(
            chains_available_to_found=available,
            new_size=size,
            new_price_by_chain={c: hotel.get_stock_price(c, size) for c in available},
            founder_free_share_available_by_chain={
                c: hotel.get_available_stocks(c) > 0 for c in available
            },
        )
    elif res.result_type == PlacementResult.MERGE:
        survivor = Rules.get_merger_survivor(board, res.chains)
        candidates = [survivor] if isinstance(survivor, str) else list(survivor)
        info.update(
            chains=list(res.chains),
            survivor_candidates=candidates,
            survivor_chosen_by_player=not isinstance(survivor, str),
            scenarios=[
                _merge_scenario(game, tile, res.chains, s, viewer_id)
                for s in candidates
            ],
        )
    return info


def _viewer_section(game, viewer) -> dict:
    return {
        "cash": viewer.money,
        "hand": [str(t) for t in viewer.hand],
        "tiles": [_tile_info(game, t, viewer.player_id) for t in viewer.hand],
    }


def _bank_section(game, viewer_id: str) -> dict:
    can, reason = _end_game_reason(game)
    current = game.get_current_player_id()
    return {
        "tiles_remaining": len(game.tile_bag),
        "chains_available_to_found": game.hotel.get_inactive_chains(),
        "chains_active": game.hotel.get_active_chains(),
        "can_end_game": can,
        "can_end_game_reason": reason,
        "viewer_can_declare_now": bool(
            current == viewer_id and game.can_declare_end_game()
        ),
    }


def _disposition_section(game, viewer) -> dict | None:
    """The viewer's pending merger disposition, with the survivor as it will
    be once the merger completes (``None`` unless the viewer must decide now).

    ``{defunct, survivor, shares, defunct_price, sell_all_value, survivor_size_after,
    survivor_price_after, survivor_safe_after, max_trade, trade_max: {shares_traded,
    survivor_shares_received, value, leftover_shares, leftover_sale_value, total_value},
    trade_minus_sell, survivor_shares_now, survivor_standing_now,
    survivor_standing_after_trade, survivor_payout_now, survivor_payout_after_trade}``

    Sale price is the defunct chain's price at its size before the merger (as
    ``handle_stock_disposition`` pays it). The survivor's size after the merger
    is what ``_finalize_merger`` builds (all merging chains, the merger tile
    and lone tiles touching it). ``value`` prices the received survivor shares
    at that post-merger price. The survivor payouts are what the viewer would
    receive in the survivor's bonuses at its post-merger size, holding everyone
    else's survivor shares as they are now."""
    pa = game.pending_action or {}
    if pa.get("type") != "stock_disposition" or pa.get("player_id") != (
        viewer.player_id
    ):
        return None
    merger = game._merger
    defunct, survivor = pa["defunct_chain"], pa["surviving_chain"]
    n = int(pa["stock_count"])
    ratio = game.ruleset.merger_trade_ratio
    d_price = game.hotel.get_stock_price(defunct, game.board.get_chain_size(defunct))
    others = [c for c in merger.chains if c != survivor]
    after = _simulate(game.board, merger.tile, survivor, others)
    size_after = after.get_chain_size(survivor)
    s_price = game.hotel.get_stock_price(survivor, size_after)
    bank = game.hotel.get_available_stocks(survivor)
    max_trade = min(n - n % ratio, bank * ratio)
    received = max_trade // ratio
    leftover = n - max_trade
    total = received * s_price + leftover * d_price
    holdings = _holdings(game, survivor)
    me = viewer.player_id
    after_h = dict(holdings)
    after_h[me] = holdings.get(me, 0) + received

    def pay(h):
        return (
            _payouts(_fake_players(h, survivor), survivor, size_after, game.hotel)
            .get(me, {})
            .get("total", 0)
        )

    return {
        "defunct": defunct,
        "survivor": survivor,
        "shares": n,
        "defunct_price": d_price,
        "sell_all_value": n * d_price,
        "survivor_size_after": size_after,
        "survivor_price_after": s_price,
        "survivor_safe_after": game.hotel.is_chain_safe(survivor, size_after),
        "max_trade": max_trade,
        "trade_max": {
            "shares_traded": max_trade,
            "survivor_shares_received": received,
            "value": received * s_price,
            "leftover_shares": leftover,
            "leftover_sale_value": leftover * d_price,
            "total_value": total,
        },
        "trade_minus_sell": total - n * d_price,
        "survivor_shares_now": holdings.get(me, 0),
        "survivor_standing_now": _standing(holdings, me),
        "survivor_standing_after_trade": _standing(after_h, me),
        "survivor_payout_now": pay(holdings),
        "survivor_payout_after_trade": pay(after_h),
    }


def _buy_options(game, viewer) -> dict:
    out = {}
    buying_now = (
        game.phase.value == "buying_stocks"
        and game.get_current_player_id() == viewer.player_id
    )
    for chain in game.hotel.get_active_chains():
        avail = game.hotel.get_available_stocks(chain)
        if avail <= 0:
            continue
        size = game.board.get_chain_size(chain)
        price = game.hotel.get_stock_price(chain, size)
        holdings = _holdings(game, chain)
        mine = holdings[viewer.player_id]
        now_pay = (
            _payouts(game.players, chain, size, game.hotel)
            .get(viewer.player_id, {})
            .get("total", 0)
        )
        max_aff = min(
            viewer.money // price,
            avail,
            game.ruleset.max_stock_purchases_per_turn,
            game.ruleset.stocks_per_chain - mine,
        )
        purchases = {}
        for n in range(1, max_aff + 1):
            h = dict(holdings)
            h[viewer.player_id] = mine + n
            pay = (
                _payouts(_fake_players(h, chain), chain, size, game.hotel)
                .get(viewer.player_id, {})
                .get("total", 0)
            )
            purchases[str(n)] = {
                "cost": n * price,
                "cash_after": viewer.money - n * price,
                "standing_after": _standing(h, viewer.player_id),
                "payout_after": pay,
                "payout_change": pay - now_pay,
            }
        out[chain] = {
            "price": price,
            "available": avail,
            "max_affordable": max_aff,
            "can_buy_now": buying_now,
            "standing_now": _standing(holdings, viewer.player_id),
            "payout_now": now_pay,
            "purchases": purchases,
        }
    return out


# ---------------------------------------------------------------------------
# Public table view (sent to every client in ``game_state``)
# ---------------------------------------------------------------------------


def public_net_worth(game) -> dict[str, dict]:
    """Every player's wealth right now, from public information only.

    ``{player_id: {cash, stock_value, net_worth, rank}}``: ``stock_value`` is the
    shares at current prices (``Player.get_stock_value``; a defunct chain's
    shares are worth 0 until it is founded again), ``net_worth`` is cash plus
    that, and ``rank`` is the competition rank by net worth (ties share a
    rank: 1, 1, 3), the same ranking the final standings use.
    """
    prices = _prices(game)
    rows = [
        (p.player_id, p.money, p.get_stock_value(prices), p.get_net_worth(prices))
        for p in game.players
    ]
    ranks = competition_ranks([r[3] for r in rows])
    return {
        pid: {"cash": cash, "stock_value": value, "net_worth": worth, "rank": rank}
        for rank, (pid, cash, value, worth) in zip(ranks, rows, strict=True)
    }


def public_chain_holders(game) -> dict[str, dict]:
    """Majority and minority holders of every active chain, with the bonuses
    ``Rules.calculate_bonuses`` would pay if the chain were bought out now.

    ``{chain: {size, price, majority_bonus, minority_bonus, holders: [...]}}``;
    each holder is ``{player_id, shares, role, tied, majority, minority,
    bonus}``, most shares first (seat order breaks ties). ``role`` is
    ``majority`` / ``minority`` / ``null`` as the engine pays it: a sole
    holder takes both bonuses (role ``majority``), a tie for the majority
    splits both bonuses among the tied holders (no minority is paid), a tie
    for the minority splits the minority bonus. ``tied`` is true when another
    holder shares the role. ``majority`` / ``minority`` / ``bonus`` are the
    amounts paid (``bonus`` = their sum).
    """
    out = {}
    for chain in game.hotel.get_all_chain_names():
        if not game.hotel.is_chain_active(chain):
            continue
        size = game.board.get_chain_size(chain)
        payouts = _payouts(game.players, chain, size, game.hotel)
        holders = []
        for h in _holders(game, chain):
            pay = payouts.get(
                h["player_id"], {"majority": 0, "minority": 0, "total": 0}
            )
            role = (
                "majority"
                if pay["majority"] > 0
                else "minority"
                if pay["minority"] > 0
                else None
            )
            holders.append(
                {
                    "player_id": h["player_id"],
                    "shares": h["shares"],
                    "role": role,
                    "majority": pay["majority"],
                    "minority": pay["minority"],
                    "bonus": pay["total"],
                }
            )
        for h in holders:
            h["tied"] = h["role"] is not None and (
                sum(1 for o in holders if o["role"] == h["role"]) > 1
            )
        out[chain] = {
            "size": size,
            "price": _price(game, chain),
            "majority_bonus": game.hotel.get_majority_bonus(chain, size),
            "minority_bonus": game.hotel.get_minority_bonus(chain, size),
            "holders": holders,
        }
    return out


def merger_history(game) -> list[dict]:
    """Every merger of the game so far, oldest first, rebuilt from the event log.

    Each entry::

        {seq, player_id (who placed the tile), tile, survivor,
         sizes {chain: size before the merger},
         defunct: [{chain, size, price (share price at the merger),
                    bonuses: [{player_id, majority, minority}] | null (not paid yet;
                             largest payment first, then seat order),
                    dispositions: [{player_id, sell, trade, hold, sale_proceeds,
                                    survivor_shares_received}],
                    waiting_on: [player_id]}],
         survivor_size (after; null while in progress), complete,
         survivor_after: null once complete; while in progress
           {size, price, majority_bonus, minority_bonus (post-merger, engine),
            bank (survivor shares left in the bank now),
            holders: [{player_id, shares (now, incl. trades made in this merger),
                       received (survivor shares got by trading in this merger),
                       undecided (still holds defunct shares to dispose of),
                       role, tied, majority, minority, bonus
                       (at the post-merger size with today's holdings)}]}}

    Defunct chains are in the engine's processing order. ``waiting_on`` lists
    the stockholders of the chain being processed who have not decided yet
    (in decision order), empty otherwise. Amounts are the ones the engine
    paid (``bonuses_paid`` / ``stock_disposition`` events), never recomputed.
    """
    out: list[dict] = []
    current: dict | None = None
    seat = {p.player_id: i for i, p in enumerate(game.players)}
    for e in game.events:
        etype = e["type"]
        if etype == "merger_started":
            sizes = dict(e.get("sizes") or {})
            current = {
                "seq": e["seq"],
                "player_id": e.get("player_id"),
                "tile": e.get("tile"),
                "survivor": e["survivor"],
                "sizes": sizes,
                "defunct": [
                    {
                        "chain": d,
                        "size": sizes.get(d, 0),
                        "price": game.hotel.get_stock_price(d, sizes.get(d, 0)),
                        "bonuses": None,
                        "dispositions": [],
                        "waiting_on": [],
                    }
                    for d in e.get("defunct", [])
                ],
                "survivor_size": None,
                "complete": False,
            }
            out.append(current)
        elif current is None:
            continue
        elif etype == "bonuses_paid" and not e.get("final"):
            row = next(
                (d for d in current["defunct"] if d["chain"] == e["chain"]), None
            )
            if row is not None:
                # Keep the engine's processing order: among same-size chains
                # the tile placer picks it (``defunct_order_chosen``).
                rows = current["defunct"]
                done = sum(1 for d in rows if d["bonuses"] is not None)
                rows.remove(row)
                rows.insert(done, row)
                # Largest payment first, then seat order (the event's dict order
                # does not survive a snapshot round trip).
                row["bonuses"] = sorted(
                    (
                        {
                            "player_id": pid,
                            "majority": b.get("majority", 0),
                            "minority": b.get("minority", 0),
                        }
                        for pid, b in e.get("bonuses", {}).items()
                    ),
                    key=lambda b: (
                        -b["majority"],
                        -b["minority"],
                        seat.get(b["player_id"], 99),
                    ),
                )
        elif etype == "stock_disposition":
            row = next(
                (d for d in current["defunct"] if d["chain"] == e["defunct_chain"]),
                None,
            )
            if row is not None:
                row["dispositions"].append(
                    {
                        "player_id": e.get("player_id"),
                        "sell": e.get("sell", 0),
                        "trade": e.get("trade", 0),
                        "hold": e.get("hold", 0),
                        "sale_proceeds": e.get("sale_proceeds", 0),
                        "survivor_shares_received": e.get(
                            "survivor_shares_received", 0
                        ),
                    }
                )
        elif etype == "merger_completed":
            current["survivor_size"] = e.get("survivor_size")
            current["complete"] = True
            current = None
    merger = getattr(game, "_merger", None)
    if current is not None and merger is not None and merger.current_defunct:
        row = next(
            (d for d in current["defunct"] if d["chain"] == merger.current_defunct),
            None,
        )
        if row is not None:
            row["waiting_on"] = list(merger.stock_players[merger.stock_index :])
    for m in out:
        m["survivor_after"] = None
    if current is not None and merger is not None and merger.survivor:
        current["survivor_after"] = _survivor_after(game, current, merger)
    return out


def _survivor_after(game, record: dict, merger) -> dict:
    """The surviving chain as it will be once the merger in progress ends.

    ``size`` is what ``Board.absorb_merger`` (the engine's own finalisation)
    gives on a copy of the board; ``price`` and the bonuses are the engine's
    for that size. Holders are everyone's survivor shares *now*: trades already
    made in this merger are in them (``received`` says how many), and
    ``undecided`` marks players who still hold shares of a defunct chain and
    may trade more (listed with 0 shares if they hold none of the survivor).
    Roles and amounts are ``Rules.calculate_bonuses`` at the post-merger size
    with today's holdings.
    """
    survivor = merger.survivor
    board = copy.deepcopy(game.board)
    board.absorb_merger(survivor, list(merger.chains), merger.tile)
    size = board.get_chain_size(survivor)
    received: dict[str, int] = {}
    for d in record["defunct"]:
        for x in d["dispositions"]:
            pid = x["player_id"]
            received[pid] = received.get(pid, 0) + x["survivor_shares_received"]
    # Still to decide: the rest of the current chain's queue, and every holder
    # of a defunct chain not processed yet.
    undecided = set(merger.stock_players[merger.stock_index :])
    for chain in merger.defunct_queue:
        undecided |= {p.player_id for p in game.players if p.get_stock_count(chain)}
    rows = _holders(game, survivor) + [
        {"player_id": p.player_id, "shares": 0}
        for p in game.players
        if p.player_id in undecided and p.get_stock_count(survivor) == 0
    ]
    payouts = _payouts(game.players, survivor, size, game.hotel)
    holders = []
    for h in rows:
        pay = payouts.get(h["player_id"], {"majority": 0, "minority": 0, "total": 0})
        role = (
            "majority"
            if pay["majority"] > 0
            else "minority"
            if pay["minority"] > 0
            else None
        )
        holders.append(
            {
                "player_id": h["player_id"],
                "shares": h["shares"],
                "received": received.get(h["player_id"], 0),
                "undecided": h["player_id"] in undecided,
                "role": role,
                "majority": pay["majority"],
                "minority": pay["minority"],
                "bonus": pay["total"],
            }
        )
    for h in holders:
        h["tied"] = h["role"] is not None and (
            sum(1 for o in holders if o["role"] == h["role"]) > 1
        )
    return {
        "size": size,
        "price": game.hotel.get_stock_price(survivor, size),
        "majority_bonus": game.hotel.get_majority_bonus(survivor, size),
        "minority_bonus": game.hotel.get_minority_bonus(survivor, size),
        "bank": game.hotel.get_available_stocks(survivor),
        "holders": holders,
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def build_calculator_pack(game, viewer_id: str) -> dict:
    """Build the calculator pack for ``viewer_id`` (see module docstring)."""
    from game.trade_value import trades_section  # imports this module

    viewer = game.get_player(viewer_id)
    if viewer is None:
        raise ValueError(f"Unknown player: {viewer_id}")
    current = game.get_current_player_id()
    return {
        "phase": game.phase.value,
        "current_player_id": current,
        "viewer_id": viewer_id,
        "viewer_is_current": current == viewer_id,
        "chains": _chains_section(game, viewer_id),
        "players": _players_section(game),
        "viewer": _viewer_section(game, viewer),
        "bank": _bank_section(game, viewer_id),
        "buy_options": _buy_options(game, viewer),
        "disposition": _disposition_section(game, viewer),
        "trades": trades_section(game, viewer_id),
    }


__all__ = [
    "build_calculator_pack",
    "merger_history",
    "public_chain_holders",
    "public_net_worth",
]
