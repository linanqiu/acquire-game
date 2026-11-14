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
      "chains":  {chain_name: ChainInfo},   # all 7 chains, stable keys
      "players": [PlayerInfo, ...],         # in seating order
      "viewer":  ViewerInfo,
      "bank":    BankInfo,
      "buy_options": {chain_name: BuyOption},  # active chains with stock left
    }

ChainInfo (every chain; inactive chains only fill the first few keys)::

    active, size, safe, price, available_stock, price_if_founded (price at 2 tiles),
    tiles_to_safe, next_price_size, next_price (None at top bracket),
    majority_bonus, minority_bonus   (at current size),
    holders: [{player_id, name, shares}]   sorted by shares desc, then seat order
    payouts: {player_id: {majority, minority, total}}   what Rules.calculate_bonuses
             pays at current size (ties split + rounded up to $100 by the engine)
    majority_receivers / minority_receivers: [player_id]
    viewer: {shares, sell_value, standing, shares_to_tie_majority,
             shares_to_take_majority, shares_to_reach_minority,
             shares_to_take_minority}
        standing is one of: none, minority_tied, minority_sole, majority_tied,
        majority_sole.  The shares_to_* values are the smallest number of extra
        shares the viewer must buy (bounded by bank stock and the 25-share cap)
        to reach that status holding everyone else constant, 0 if already there,
        None if not reachable.

PlayerInfo::

    player_id, name, is_bot, cash, tile_count, shares {chain: n} (all 7 chains),
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
         survivor_size_after, survivor_price_after, viewer_total_bonus}
        Defunct chains appear in the engine's processing order (largest first).
        Trading uses the survivor's bank stock as it is now; earlier trades in a
        multi-chain merger can reduce it.

BankInfo::

    tiles_remaining (count only), chains_available_to_found, chains_active,
    can_end_game, can_end_game_reason, viewer_can_declare_now

BuyOption::

    price, available, max_affordable (limited by cash, bank stock, 3 per turn),
    can_buy_now (viewer's buy phase), standing_now, payout_now,
    purchases: {"1"|"2"|"3": {cost, cash_after, standing_after, payout_after,
                              payout_change}}   (only counts the viewer can afford)
    payout_* is what the viewer would receive for that chain's bonuses if it were
    liquidated/acquired at its current size.
"""

from __future__ import annotations

import copy
from types import SimpleNamespace

from game.board import Board, Tile, TileState
from game.hotel import Hotel
from game.rules import PlacementResult, Rules

MAX_BUY_PER_TURN = 3
MAX_STOCKS = 25  # Player.MAX_STOCKS_PER_CHAIN / Hotel.TOTAL_STOCKS_PER_CHAIN


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
    holdings: dict[str, int], me: str, wanted: set[str], cap: int
) -> int | None:
    base = holdings.get(me, 0)
    for k in range(cap + 1):
        if base + k > MAX_STOCKS:
            break
        h = dict(holdings)
        h[me] = base + k
        if _standing(h, me) in wanted:
            return k
    return None


def _holdings(game, chain: str) -> dict[str, int]:
    return {p.player_id: p.get_stock_count(chain) for p in game.players}


def _next_price(chain: str, size: int):
    table = Hotel.CHAINS[chain].PRICE_TABLE[Hotel.CHAINS[chain].tier]
    for threshold in sorted(table):
        if threshold > size:
            return threshold, table[threshold]
    return None, None


def _end_game_reason(game) -> tuple[bool, str]:
    can = Rules.check_end_game(game.board, game.hotel)
    active = game.hotel.get_active_chains()
    if not active:
        return can, "no chains on the board"
    big = [c for c in active if game.board.get_chain_size(c) >= Rules.END_GAME_SIZE]
    if big:
        return can, f"chain with {Rules.END_GAME_SIZE}+ tiles: {', '.join(big)}"
    unsafe = [c for c in active if game.board.get_chain_size(c) < Rules.SAFE_SIZE]
    if not unsafe:
        return can, "all active chains are safe"
    return can, (
        "not met: no chain has "
        f"{Rules.END_GAME_SIZE}+ tiles and these active chains are not safe: "
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
    names = {p.player_id: p.name for p in game.players}
    seat = {p.player_id: i for i, p in enumerate(game.players)}
    out = {}
    for chain in Hotel.get_all_chain_names():
        active = game.hotel.is_chain_active(chain)
        size = game.board.get_chain_size(chain)
        info = {
            "active": active,
            "size": size,
            "safe": bool(active and game.hotel.is_chain_safe(chain, size)),
            "price": _price(game, chain),
            "available_stock": game.hotel.get_available_stocks(chain),
            "price_if_founded": game.hotel.get_stock_price(chain, 2),
        }
        if active:
            nsize, nprice = _next_price(chain, size)
            holdings = _holdings(game, chain)
            holders = sorted(
                (
                    {"player_id": pid, "name": names[pid], "shares": n}
                    for pid, n in holdings.items()
                    if n > 0
                ),
                key=lambda h: (-h["shares"], seat[h["player_id"]]),
            )
            payouts = _payouts(game.players, chain, size, game.hotel)
            mine = holdings.get(viewer_id, 0)
            cap = min(game.hotel.get_available_stocks(chain), MAX_STOCKS - mine)
            info.update(
                tiles_to_safe=max(0, Rules.SAFE_SIZE - size),
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
                        holdings, viewer_id, {"majority_tied", "majority_sole"}, cap
                    ),
                    "shares_to_take_majority": _shares_needed(
                        holdings, viewer_id, {"majority_sole"}, cap
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
                    ),
                    "shares_to_take_minority": _shares_needed(
                        holdings, viewer_id, {"minority_sole"}, cap
                    ),
                },
            )
        out[chain] = info
    return out


def _players_section(game) -> list[dict]:
    prices = {c: _price(game, c) for c in Hotel.get_all_chain_names()}
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
            for c in Hotel.get_all_chain_names()
            if game.hotel.is_chain_active(c)
        )
        rows.append(
            {
                "player_id": p.player_id,
                "name": p.name,
                "is_bot": p.player_id in game.bots,
                "cash": p.money,
                "tile_count": p.hand_size,
                "shares": {
                    c: p.get_stock_count(c) for c in Hotel.get_all_chain_names()
                },
                "stock_value": p.get_stock_value(prices),
                "net_worth": p.get_net_worth(prices),
                "projected_bonuses": proj_bonuses,
                "projected_bonus_income": bonus_income,
                "projected_stock_sale": stock_sale,
                "projected_final_score": p.money + bonus_income + stock_sale,
            }
        )
    # end_game sorts by money descending with a stable sort (seating order ties)
    order = sorted(rows, key=lambda r: r["projected_final_score"], reverse=True)
    for rank, r in enumerate(order, start=1):
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

    rows = []
    total_bonus = 0
    for d in defunct:
        size = game.board.get_chain_size(d)
        price = game.hotel.get_stock_price(d, size)
        payouts = _payouts(game.players, d, size, game.hotel)
        vb = payouts.get(viewer_id, {}).get("total", 0)
        total_bonus += vb
        shares = me.get_stock_count(d)
        # Mirrors handle_stock_disposition: trade is even, 2:1, limited by bank.
        tradable = min(shares - shares % 2, bank_survivor * 2)
        received = tradable // 2
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
    return {
        "survivor": survivor,
        "defunct": rows,
        "survivor_size_after": size_after,
        "survivor_price_after": price_after,
        "viewer_total_bonus": total_bonus,
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
        max_aff = min(viewer.money // price, avail, MAX_BUY_PER_TURN, MAX_STOCKS - mine)
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
# Public entry point
# ---------------------------------------------------------------------------


def build_calculator_pack(game, viewer_id: str) -> dict:
    """Build the calculator pack for ``viewer_id`` (see module docstring)."""
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
    }


__all__ = ["build_calculator_pack"]
