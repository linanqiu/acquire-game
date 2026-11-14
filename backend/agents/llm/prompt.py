"""Context synthesis: turn a ``DecisionContext`` into prompts.

``build_system_prompt()`` is static (identical for every decision, so it can be
prompt-cached): the rules AS IMPLEMENTED by this engine, the answer format and
the instruction to trust the calculator data.

``build_user_prompt(ctx, notes)`` renders only what is in ``ctx`` (public
information plus the seat's own hand): the position, the relevant slice of the
calculator pack, a bounded event log, the seat's private notes, and finally the
decision with the engine's legal options verbatim.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from game.hotel import Hotel, HotelChain, HotelTier

ROWS = "ABCDEFGHI"
COLUMNS = 12

_STANDING = {
    "none": "no bonus position",
    "minority_tied": "tied for minority",
    "minority_sole": "sole minority",
    "majority_tied": "tied for majority",
    "majority_sole": "sole majority",
}


@dataclass(frozen=True)
class PromptBudget:
    """Bounds on the event-log section so prompts stay small late in a game."""

    detailed_events: int = 60  # most recent events rendered one per line
    milestone_lines: int = 20  # key older events kept as one-liners
    max_line_chars: int = 220  # per rendered event line


def money(n: Any) -> str:
    try:
        return f"${int(n):,}"
    except (TypeError, ValueError):
        return str(n)


def _compact(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------


def _price_table_text() -> str:
    table = HotelChain.PRICE_TABLE
    thresholds = sorted(table[HotelTier.CHEAP])
    lines = [
        "Tiles in chain | cheap | medium | expensive   (price per share; majority bonus = 10x price, minority = 5x price)"
    ]
    for i, t in enumerate(thresholds):
        if i + 1 < len(thresholds):
            nxt = thresholds[i + 1] - 1
            label = str(t) if nxt == t else f"{t}-{nxt}"
        else:
            label = f"{t}+"
        lines.append(
            f"{label:>14} | {money(table[HotelTier.CHEAP][t]):>6} | "
            f"{money(table[HotelTier.MEDIUM][t]):>6} | {money(table[HotelTier.EXPENSIVE][t]):>6}"
        )
    return "\n".join(lines)


def _chains_by_tier() -> str:
    out = []
    for tier in HotelTier:
        names = [n for n, c in Hotel.CHAINS.items() if c.tier == tier]
        out.append(f"{tier.value}: {', '.join(names)}")
    return "; ".join(out)


_SYSTEM_TEMPLATE = """\
You are one seat at an online table playing ACQUIRE (Sid Sackson's hotel-chain board game), 3-6 players. The other seats may be humans or other AIs. Your objective: finish with the MOST MONEY. Final score = cash after the end-game payout (described below). Play to win, not merely to survive.

# Rules as implemented by this server

Board and setup
- 12 columns (1-12) x 9 rows (A-I). A tile name is column then row, e.g. "5C". 108 tiles, each in the bag, in a hand, or on the board.
- Every player starts with $6,000, no shares, and a private hand of 6 tiles.
- Seven chains, 25 shares each in the bank at the start. Tiers: {tiers}.
- Tiles "touch" orthogonally (up, down, left, right; never diagonally).
- A "chain" is a connected group of 2+ tiles belonging to a named company. A "lone tile" is a played tile touching no chain (shown "#" on the map).

Your turn, in order
1. Place exactly one tile from your hand (mandatory if you have any playable tile; if none is playable the turn skips to buying). You may instead declare the game over, if the end-game condition holds (see End of game).
2. Resolve the tile's effect (a chain-founding choice or a merger, below).
3. Buy shares: 0 to 3 shares in total, any mix of chains that are on the board, at their current price, paying cash. You cannot buy more than the bank has, and you cannot buy a chain that is not on the board. Buying is optional, and after buying you must still send end_turn.
4. end_turn: you draw a tile (if the bag is not empty) and play passes clockwise. Tiles in your hand that can never be played (they would merge two safe chains) are discarded and replaced automatically.

What a tile does (tile = the one you place)
- nothing: it touches no other tile. It becomes a lone tile.
- expand: it touches exactly one chain (and perhaps lone tiles). The chain grows by that tile plus every lone tile connected to it.
- found: it touches lone tile(s) but no chain. It creates a new chain (size >= 2). You choose which chain that is, from the chains not currently on the board, and you receive 1 free share of it (if the bank has none left you receive its price in cash instead). If all 7 chains are on the board, such a tile is unplayable for now (it stays in your hand).
- merge: it touches two or more different chains.
- A tile that would merge two or more SAFE chains can never be played.

Safe chains: a chain with 11 or more tiles is safe. It can never be absorbed.

Mergers (resolved in this order)
1. The chain with the most tiles survives; the others are defunct. If exactly one touched chain is safe it survives whatever the sizes. If the largest chains tie, the player who placed the tile chooses the survivor.
2. Defunct chains are resolved one at a time, largest first. For each defunct chain:
   a. Bonuses are paid by the bank immediately, based on the defunct chain's size before the merger (table below). The player with the most shares in it gets the majority bonus, the player with the second most gets the minority bonus. A sole shareholder gets both. If players tie for most shares, majority + minority are pooled and split equally among them (rounded UP to the next $100) and no minority bonus is paid. If players tie for second most, the minority bonus is split equally among them (rounded up to $100).
   b. Then every player holding shares of that defunct chain decides, starting with the player who placed the tile and continuing clockwise, how to split their shares among: SELL (bank pays the defunct chain's price, from its size before the merger), TRADE (two defunct shares for one share of the survivor, even numbers only, limited by the survivor shares still in the bank) and HOLD (keep them; a defunct chain's shares are worth nothing unless that chain is founded again later). sell + trade + hold must equal the number of shares held.
3. The surviving chain absorbs all tiles (including the merger tile and any lone tiles touching it), so its size and price jump. The defunct chains leave the board and can be founded again.

Prices and bonuses depend only on the number of tiles in the chain:
{price_table}

Player-to-player trading (a house feature of this server)
- Any player may propose a trade to another: any mix of shares and cash offered, any mix requested. The recipient may accept or reject (no counter-offers); on accept it executes immediately if both sides still hold what is listed. Offers can arrive during anyone's turn, so you may be asked to respond even when it is not your turn.
- A trade moves money/shares between two players, so it only helps you if what you receive is worth more TO YOU than what you give (consider majority/minority positions, merger prospects and current prices), and it also helps the other side. You may propose at most one trade per turn here, and only during the buy step; "no trade" is the normal choice.

End of game
- Either of these makes the game endable: any chain has 41+ tiles, OR at least one chain is on the board and every chain on the board is safe (11+).
- Ending is optional and only the player whose turn it is may declare (action declare_end_game, offered in the legal options when allowed). The game does not end by itself.
- On declaring, immediately: no more tiles or purchases; the majority/minority bonuses of every chain on the board are paid as for a merger; then all shares in chains on the board are sold at current prices. Shares in chains not on the board are worthless. Most money wins.
- The calculator data includes each player's exact projected final score if the game ended right now.

# What you are shown
- Only public information plus your own hand. You cannot see other players' tiles; the bag order is unknown. Cash and share holdings are public.
- ALL arithmetic is already done in the "calculator" data (prices, bonuses and who would receive them, shares needed to take majority, merger and purchase outcomes, projected final scores). Trust those numbers; do not recompute them. Your job is judgment: which option gives you the best chance to finish first.
- The "legal options" block lists exactly what you may do now. Any answer outside it is rejected.

# How to answer
Reply with ONE JSON object and nothing else:
{{"why": "<one sentence: the reason for this choice>", "action": <one action object>, "note": "<private plan for your later decisions, at most 300 characters>"}}

Action objects (use only those allowed by the legal options):
- {{"action":"place_tile","tile":"5C"}}
- {{"action":"found_chain","chain":"Tower"}}
- {{"action":"merger_choice","surviving_chain":"Tower"}}   (tied merger: you pick the survivor)
- {{"action":"merger_disposition","defunct_chain":"Luxor","disposition":{{"sell":2,"trade":2,"hold":1}}}}
- {{"action":"buy_stocks","purchases":{{"Tower":2,"Luxor":1}}}}   ({{}} buys nothing; at most 3 shares in total)
- {{"action":"end_turn"}}   (required after the buy step)
- {{"action":"declare_end_game"}}
- {{"action":"propose_trade","to_player_id":"<id>","offering_stocks":{{"Tower":1}},"offering_money":0,"requesting_stocks":{{}},"requesting_money":500}}
- {{"action":"accept_trade","trade_id":"<id>"}} or {{"action":"reject_trade","trade_id":"<id>"}}

The "note" is shown back to you (and only you) at your next decisions: use it for plans such as which chains you are building toward, who you expect to be majority holder, or when you intend to end the game.

# Strategy guidance
- Money comes from bonuses and share appreciation far more than from cash on hand. Hold shares in chains that will grow and be acquired, and fight for majority or minority positions where it is affordable (the calculator tells you how many shares each takes).
- Small chains are merger targets (their bonuses pay when they are absorbed); safe chains cannot be acquired, so their bonuses pay at game end.
- Founding a chain gives a free share and often the first majority position; extending or merging chains you hold majority in raises your wealth.
- At a merger, compare sell, trade and hold using the numbers provided: trade beats selling only when the survivor's price after the merger is more than twice the defunct chain's price; hold only pays if the chain is likely to be founded again.
- Idle cash counts toward your final score, but shares in growing chains usually earn more; keep enough cash to cover opportunities and mergers.
- Before ending the game, compare projected final scores: declare when you are ahead and unlikely to be overtaken, and avoid declaring when you are behind.
"""


def build_system_prompt() -> str:
    return _SYSTEM_TEMPLATE.format(
        tiers=_chains_by_tier(), price_table=_price_table_text()
    )


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

_MILESTONES = {
    "game_started",
    "chain_founded",
    "merger_started",
    "bonuses_paid",
    "trade_accepted",
    "end_game_declared",
}
_SKIP_KEYS = {"seq", "type", "player_id", "private_to"}


def _fmt_value(v: Any, names: dict[str, str]) -> str:
    if isinstance(v, str):
        return names.get(v, v)
    if isinstance(v, dict):
        return (
            "{"
            + ", ".join(
                f"{names.get(str(k), k)}: {_fmt_value(x, names)}" for k, x in v.items()
            )
            + "}"
        )
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(_fmt_value(x, names) for x in v) + "]"
    return str(v)


def render_event(e: Any, names: dict[str, str], max_chars: int = 220) -> str:
    """One compact line for any event. Unknown shapes render generically."""
    if not isinstance(e, dict):
        return str(e)[:max_chars]
    typ = str(e.get("type", "event"))
    who = e.get("player_id")
    head = f"[{e['seq']}] " if "seq" in e else ""
    if who is not None:
        head += f"{names.get(str(who), who)} "
    body = ", ".join(
        f"{k}={_fmt_value(v, names)}" for k, v in e.items() if k not in _SKIP_KEYS
    )
    line = f"{head}{typ.replace('_', ' ')}" + (f": {body}" if body else "")
    return line if len(line) <= max_chars else line[: max_chars - 1] + "…"


def render_events(
    events: Iterable[Any], names: dict[str, str], budget: PromptBudget
) -> str:
    evs = list(events or [])
    if not evs:
        return "(no events yet)"
    n = max(0, budget.detailed_events)
    older, recent = (evs[:-n], evs[-n:]) if n and len(evs) > n else ([], evs)
    if n == 0:
        older, recent = evs, []
    lines: list[str] = []
    if older:
        counts: dict[str, int] = {}
        for e in older:
            t = str(e.get("type", "event")) if isinstance(e, dict) else "event"
            counts[t] = counts.get(t, 0) + 1
        summary = ", ".join(f"{c} x {t}" for t, c in sorted(counts.items()))
        lines.append(f"Earlier history, summarised ({len(older)} events): {summary}.")
        marks = [
            e for e in older if isinstance(e, dict) and e.get("type") in _MILESTONES
        ]
        if len(marks) > budget.milestone_lines:
            lines.append(
                f"Key earlier events (latest {budget.milestone_lines} of {len(marks)}):"
            )
            marks = marks[-budget.milestone_lines :]
        elif marks:
            lines.append("Key earlier events:")
        lines += ["  " + render_event(e, names, budget.max_line_chars) for e in marks]
        lines.append(f"Most recent {len(recent)} events, oldest first:")
    lines += [render_event(e, names, budget.max_line_chars) for e in recent]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Position rendering
# ---------------------------------------------------------------------------


def _names(ctx) -> dict[str, str]:
    names: dict[str, str] = {}
    for src in (ctx.state.get("players") or [], (ctx.calc or {}).get("players") or []):
        for p in src:
            if isinstance(p, dict) and "player_id" in p:
                names.setdefault(p["player_id"], p.get("name", p["player_id"]))
    return names


def _tile_key(t: str) -> tuple[int, str]:
    return int(t[:-1]), t[-1]


def render_board(state: dict) -> str:
    cells = (state.get("board") or {}).get("cells") or {}
    initial = {n: n[0] for n in Hotel.get_all_chain_names()}
    header = "    " + "".join(f"{c:>3}" for c in range(1, COLUMNS + 1))
    rows = [header]
    for r in ROWS:
        glyphs = []
        for c in range(1, COLUMNS + 1):
            cell = cells.get(f"{c}{r}")
            if not cell:
                g = "."
            elif cell.get("chain"):
                g = initial.get(cell["chain"], "?")
            else:
                g = "#"
            glyphs.append(f"{g:>3}")
        rows.append(f"  {r} " + "".join(glyphs))
    legend = ", ".join(f"{i}={n}" for n, i in initial.items())
    rows.append(f"Legend: {legend}; #=tile in no chain; .=empty")
    return "\n".join(rows)


def _holders(info: dict) -> str:
    h = info.get("holders") or []
    return ", ".join(f"{x['name']} {x['shares']}" for x in h) if h else "nobody"


def _viewer_chain_line(v: dict) -> str:
    if not v or not v.get("shares"):
        return ""
    parts = [
        (
            f"YOU hold {v['shares']} (sale value {money(v.get('sell_value', 0))}), "
            f"{_STANDING.get(v.get('standing'), v.get('standing'))}"
        )
    ]
    st = v.get("standing")
    if st != "majority_sole":
        bits = []
        if v.get("shares_to_take_majority") is not None:
            bits.append(f"+{v['shares_to_take_majority']} to take majority")
        if v.get("shares_to_tie_majority") not in (
            None,
            v.get("shares_to_take_majority"),
        ):
            bits.append(f"+{v['shares_to_tie_majority']} to tie it")
        if (
            st in ("none", "minority_tied")
            and v.get("shares_to_take_minority") is not None
        ):
            bits.append(f"+{v['shares_to_take_minority']} to hold sole minority")
        if bits:
            parts.append("; ".join(bits))
    return "; ".join(parts)


def render_chains(calc: dict) -> str:
    lines = []
    for name, c in (calc.get("chains") or {}).items():
        if not c.get("active"):
            lines.append(
                f"- {name}: NOT on the board (a new chain would start at "
                f"{money(c.get('price_if_founded'))}/share; {c.get('available_stock')} in bank)"
            )
            continue
        safe = (
            "SAFE"
            if c.get("safe")
            else f"not safe ({c.get('tiles_to_safe')} more tiles to safe)"
        )
        nxt = (
            f"; at {c['next_price_size']} tiles price becomes {money(c['next_price'])}"
            if c.get("next_price_size")
            else ""
        )
        pay = c.get("payouts") or {}
        pay_txt = ", ".join(
            f"{_pname(calc, pid)} {money(b['total'])}" for pid, b in pay.items()
        )
        lines.append(
            f"- {name}: {c['size']} tiles, {money(c['price'])}/share, {c['available_stock']} shares "
            f"in bank, {safe}{nxt}.\n"
            f"    Bonuses if acquired now: majority {money(c.get('majority_bonus'))} / "
            f"minority {money(c.get('minority_bonus'))}. Holders: {_holders(c)}."
            + (f" Payout now: {pay_txt}." if pay_txt else "")
        )
        vl = _viewer_chain_line(c.get("viewer") or {})
        if vl:
            lines.append(f"    {vl}.")
    return "\n".join(lines)


def _pname(calc: dict, pid: str) -> str:
    for p in calc.get("players") or []:
        if p.get("player_id") == pid:
            return p.get("name", pid)
    return pid


def render_players(calc: dict, viewer_id: str, current_id: str | None) -> str:
    live = {n for n, c in (calc.get("chains") or {}).items() if c.get("active")}
    lines = []
    for p in calc.get("players") or []:
        tags = []
        if p["player_id"] == viewer_id:
            tags.append("YOU")
        if p["player_id"] == current_id:
            tags.append("to move")
        tag = f" ({', '.join(tags)})" if tags else ""
        sh = []
        for chain, n in (p.get("shares") or {}).items():
            if n:
                sh.append(
                    f"{chain} {n}"
                    + (
                        ""
                        if chain in live
                        else " [not on board: worthless unless re-founded]"
                    )
                )
        bon = p.get("projected_bonuses") or {}
        lines.append(
            f"- {p['name']}{tag} [id {p['player_id']}]: cash {money(p['cash'])}, "
            f"{p['tile_count']} tiles in hand, shares: {', '.join(sh) or 'none'}; "
            f"stock value {money(p.get('stock_value'))}, net worth {money(p.get('net_worth'))}; "
            f"projected final score if game ended now {money(p.get('projected_final_score'))} "
            f"(rank {p.get('projected_rank')}"
            + (
                f"; bonus income {money(p.get('projected_bonus_income'))}"
                if bon
                else ""
            )
            + ")"
        )
    return "\n".join(lines)


def render_tile_analysis(calc: dict) -> str:
    tiles = ((calc.get("viewer") or {}).get("tiles")) or []
    out = []
    for t in sorted(tiles, key=lambda x: _tile_key(x["tile"])):
        name, eff = t["tile"], t.get("effect")
        if not t.get("playable", True):
            kind = "never playable" if t.get("permanent") else "not playable for now"
            out.append(f"- {name}: UNPLAYABLE ({t.get('unplayable_reason')}; {kind})")
        elif eff == "nothing":
            out.append(f"- {name}: no effect (becomes a lone tile)")
        elif eff == "expand":
            out.append(
                f"- {name}: expands {t.get('chain')} to {t.get('new_size')} tiles "
                f"(price becomes {money(t.get('new_price'))})"
            )
        elif eff == "found":
            prices = t.get("new_price_by_chain") or {}
            free = t.get("founder_free_share_available_by_chain") or {}
            opts = ", ".join(
                f"{c} {money(p)}"
                + ("" if free.get(c, True) else " (no free share left: cash instead)")
                for c, p in prices.items()
            )
            out.append(
                f"- {name}: FOUNDS a chain of {t.get('new_size')} tiles (you get 1 free share). "
                f"You would choose from: {opts}"
            )
        elif eff == "merge":
            out.append(
                f"- {name}: MERGER of {' + '.join(t.get('chains', []))}"
                + (
                    "; you choose the survivor (tie)"
                    if t.get("survivor_chosen_by_player")
                    else ""
                )
            )
            for sc in t.get("scenarios") or []:
                out.append(
                    f"    survivor {sc['survivor']} (would be {sc['survivor_size_after']} tiles, "
                    f"{money(sc['survivor_price_after'])}/share); your bonuses total {money(sc['viewer_total_bonus'])}"
                )
                for d in sc.get("defunct") or []:
                    tr = d.get("trade") or {}
                    held = d.get("viewer_shares", 0)
                    if not held:
                        hold_txt = "you hold none"
                    elif not tr.get("shares_traded"):
                        hold_txt = (
                            f"you hold {held}: sell all {money(d['sell_all_value'])} "
                            f"(trading not possible)"
                        )
                    else:
                        diff = d.get("trade_minus_sell", 0)
                        hold_txt = (
                            f"you hold {held}: sell all {money(d['sell_all_value'])}; or trade "
                            f"{tr['shares_traded']} for {tr['survivor_shares_received']} "
                            f"{sc['survivor']} and sell the other {tr.get('leftover_shares_sold')}"
                            f" = {money(tr.get('total_value'))} (trade vs sell-all "
                            f"{'+' if diff >= 0 else '-'}{money(abs(diff))})"
                        )
                    out.append(
                        f"      defunct {d['chain']} ({d['size']} tiles, {money(d['price'])}/share): "
                        f"your bonus {money(d['viewer_bonus'])}; {hold_txt}"
                    )
        else:
            out.append(f"- {name}: {eff}")
    return "\n".join(out) if out else "(no tiles)"


def render_buy_options(calc: dict) -> str:
    opts = calc.get("buy_options") or {}
    if not opts:
        return "(no chain has shares you could buy)"
    lines = []
    for chain, o in opts.items():
        head = (
            f"- {chain}: {money(o['price'])}/share, {o['available']} in bank, you can buy up to "
            f"{o['max_affordable']}; now {_STANDING.get(o.get('standing_now'), o.get('standing_now'))}, "
            f"bonus payout if acquired now {money(o.get('payout_now'))}"
        )
        buys = []
        for n, p in (o.get("purchases") or {}).items():
            buys.append(
                f"buy {n}: cost {money(p['cost'])}, cash after {money(p['cash_after'])}, "
                f"{_STANDING.get(p['standing_after'], p['standing_after'])}, bonus payout "
                f"{money(p['payout_after'])} ({'+' if p['payout_change'] >= 0 else '-'}{money(abs(p['payout_change']))})"
            )
        lines.append(head + ("\n    " + "\n    ".join(buys) if buys else ""))
    return "\n".join(lines)


def render_bank(calc: dict) -> str:
    b = calc.get("bank") or {}
    return (
        f"Tiles left in the bag: {b.get('tiles_remaining')}. "
        f"Chains on board: {', '.join(b.get('chains_active') or []) or 'none'}; "
        f"available to found: {', '.join(b.get('chains_available_to_found') or []) or 'none'}. "
        f"End-game condition: {'MET' if b.get('can_end_game') else 'not met'} "
        f"({b.get('can_end_game_reason')}). "
        f"You {'can' if b.get('viewer_can_declare_now') else 'cannot'} declare the game over right now."
    )


def _trade_value(stocks: dict, cash: int, calc: dict) -> int:
    chains = calc.get("chains") or {}
    return int(cash or 0) + sum(
        n * (chains.get(c, {}).get("price", 0) or 0) for c, n in (stocks or {}).items()
    )


def _stock_text(stocks: dict, cash: int, names: dict) -> str:
    parts = [f"{n} {c}" for c, n in (stocks or {}).items() if n]
    if cash:
        parts.append(money(cash))
    return " + ".join(parts) or "nothing"


def render_trade(trade: dict, calc: dict, names: dict[str, str]) -> str:
    give = _trade_value(
        trade.get("requesting_stocks"), trade.get("requesting_money"), calc
    )
    get = _trade_value(trade.get("offering_stocks"), trade.get("offering_money"), calc)
    frm = names.get(trade.get("from_player_id"), trade.get("from_player_id"))
    return (
        f"{frm} [id {trade.get('from_player_id')}] offers you: "
        f"{_stock_text(trade.get('offering_stocks'), trade.get('offering_money'), names)} "
        f"(worth {money(get)} at current prices) in exchange for: "
        f"{_stock_text(trade.get('requesting_stocks'), trade.get('requesting_money'), names)} "
        f"(worth {money(give)} at current prices). trade_id = {trade.get('trade_id')}."
    )


def render_disposition(ctx, calc: dict) -> str:
    lg = ctx.legal
    d, s, n = lg.get("defunct_chain"), lg.get("surviving_chain"), lg.get("stock_count")
    chains = calc.get("chains") or {}
    pd = (chains.get(d) or {}).get("price", 0)
    ps = (chains.get(s) or {}).get("price", 0)
    lines = [
        (
            f"Merger: {d} is absorbed by {s}. Bonuses for {d} have ALREADY been paid. "
            f"You hold {n} {d} shares; each sells for {money(pd)} (its price before the merger), "
            f"so selling all {n} gives {money(n * pd)}."
        )
    ]
    lines.append(
        f"Trading gives 1 {s} share per 2 {d} shares, at most {lg.get('max_trade')} {d} shares "
        f"(survivor shares left in bank limit this). {s} is {money(ps)}/share now and will be worth "
        f"more once the merged tiles join it; trading beats selling only if {s}'s price after the "
        f"merger is more than {money(2 * pd)} (twice {d}'s price). Holding {d} shares is worth "
        f"nothing unless {d} is founded again."
    )
    return "\n".join(lines)


_DECISION_TEXT = {
    "place_tile": "Choose which tile from your hand to place (or take another action if the legal options offer one).",
    "found_chain": "Your tile founded a new chain. Choose which available chain to found (you receive one free share).",
    "choose_survivor": "Your tile merged chains of equal size. Choose which chain survives.",
    "stock_disposition": "Decide what to do with your shares in the defunct chain.",
    "buy_stocks": "Buy step. Buy up to 3 shares (or none), then you must end your turn "
    "(or declare the game over, if allowed).",
    "trade_response": "Another player proposed a trade to you. Accept or reject it.",
}


def _notes_block(notes: Any) -> str:
    if not notes:
        return "(none yet)"
    if isinstance(notes, str):
        return notes
    return "\n".join(f"- {n}" for n in notes)


def build_user_prompt(
    ctx, notes: Any = None, *, budget: PromptBudget | None = None
) -> str:
    """Render the full user prompt for ``ctx`` (see module docstring)."""
    budget = budget or PromptBudget()
    kind = ctx.decision.kind
    state, calc = ctx.state or {}, ctx.calc or {}
    names = _names(ctx)
    me = ctx.player_id
    current = state.get("current_player") or calc.get("current_player_id")

    parts: list[str] = []
    parts.append(
        f"# Your seat\nYou are {names.get(me, me)} (player id {me}). "
        f"Phase: {state.get('phase') or calc.get('phase')}. "
        f"Player to move: {names.get(current, current)}"
        f"{' (you)' if current == me else ''}. "
        f"Players in turn order: "
        + ", ".join(
            f"{names.get(p['player_id'], p['player_id'])} [{p['player_id']}]"
            for p in state.get("players", [])
        )
        + "."
    )
    parts.append("# Board\n" + render_board(state))
    parts.append("# Chains (calculator)\n" + render_chains(calc))
    parts.append("# Players (calculator)\n" + render_players(calc, me, current))
    hand = sorted(
        state.get("hand") or (calc.get("viewer") or {}).get("hand") or [], key=_tile_key
    )
    parts.append(
        f"# Your hand\nTiles: {', '.join(hand) or '(empty)'}. Cash: {money(calc.get('viewer', {}).get('cash'))}."
    )
    if kind == "place_tile":
        parts.append(
            "# What each of your tiles would do (calculator)\n"
            + render_tile_analysis(calc)
        )
        parts.append("# Bank and end game\n" + render_bank(calc))
    elif kind == "buy_stocks":
        parts.append("# Purchase options (calculator)\n" + render_buy_options(calc))
        parts.append("# Bank and end game\n" + render_bank(calc))
        out = state.get("outgoing_trades") or []
        if out:
            parts.append(
                "# Your open trade offers (awaiting a reply)\n"
                + "\n".join(
                    f"- to {names.get(t.get('to_player_id'), t.get('to_player_id'))}: gives "
                    f"{_stock_text(t.get('offering_stocks'), t.get('offering_money'), names)}, wants "
                    f"{_stock_text(t.get('requesting_stocks'), t.get('requesting_money'), names)}"
                    for t in out
                )
            )
    elif kind == "stock_disposition":
        parts.append("# Merger numbers\n" + render_disposition(ctx, calc))
    elif kind == "trade_response":
        parts.append(
            "# The offer\n" + render_trade(ctx.legal.get("trade") or {}, calc, names)
        )

    # ctx.events is already viewer-filtered; drop anything private to someone
    # else anyway so a driver bug can never leak another seat's information.
    visible = [
        e
        for e in (ctx.events or [])
        if not (isinstance(e, dict) and e.get("private_to") not in (None, me))
    ]
    parts.append("# Recent public events\n" + render_events(visible, names, budget))
    parts.append("# Your private notes from earlier decisions\n" + _notes_block(notes))

    ctx_extra = getattr(ctx.decision, "context", None)
    decision = [
        f"# Decision: {kind}",
        _DECISION_TEXT.get(kind, "Make the decision."),
    ]
    if ctx_extra:
        decision.append("Engine context: " + _compact(ctx_extra))
    decision.append("Legal options (exactly these are allowed): " + _compact(ctx.legal))
    parts.append("\n".join(decision))
    return "\n\n".join(parts) + "\n"
