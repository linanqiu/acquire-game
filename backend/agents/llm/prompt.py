"""Context synthesis: turn a ``DecisionContext`` into prompts.

``build_system_prompt(ruleset)`` is static per ruleset (identical for every
decision, so it can be prompt-cached): the rules AS IMPLEMENTED by this engine,
with every number, name and theme word generated from the ruleset, the answer
format and the instruction to trust the calculator data.

``build_user_prompt(ctx, notes)`` renders only what is in ``ctx`` (public
information plus the seat's own hand): the position, the relevant slice of the
calculator pack, a bounded event log, the seat's private notes, and finally the
decision with the engine's legal options verbatim. The board size and chain
glyphs come from ``ctx.state["ruleset"]`` (the public game state).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

from game.ruleset import MIN_CHAIN_SIZE, Ruleset, default_ruleset, ruleset_from_state

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


# Currency symbol used by ``money`` when a caller passes none: set for the
# duration of ``build_user_prompt`` from the game's ruleset theme.
_SYMBOL: ContextVar[str] = ContextVar("prompt_currency_symbol", default="$")


def money(n: Any, symbol: str | None = None) -> str:
    if symbol is None:
        symbol = _SYMBOL.get()
    try:
        return f"{symbol}{int(n):,}"
    except (TypeError, ValueError):
        return str(n)


def _compact(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

_NUMBER_WORDS = (
    "zero one two three four five six seven eight nine ten eleven twelve "
    "thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty"
).split()


def _num_word(n: int) -> str:
    return _NUMBER_WORDS[n] if 0 <= n < len(_NUMBER_WORDS) else str(n)


def _article(noun: str) -> str:
    return "an" if noun[:1].lower() in "aeiou" else "a"


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def _chain_label(rs: Ruleset, chain_id: str) -> str:
    """Display name, with the id the answer must use when they differ."""
    c = rs.chain(chain_id)
    return c.name if c.name == c.id else f"{c.name} (id {c.id})"


def _price_table_text(rs: Ruleset) -> str:
    sym = rs.theme.currency_symbol
    b = rs.bonuses
    thresholds = sorted({start for t in rs.tiers for start, _ in t.prices})
    head = " | ".join(t.label for t in rs.tiers)
    lines = [
        f"Tiles in chain | {head}   (price per {rs.theme.share_noun}; majority "
        f"bonus = {b.majority_multiplier}x price, minority = "
        f"{b.minority_multiplier}x price)"
    ]
    for i, t in enumerate(thresholds):
        if i + 1 < len(thresholds):
            nxt = thresholds[i + 1] - 1
            label = str(t) if nxt == t else f"{t}-{nxt}"
        else:
            label = f"{t}+"
        cells = " | ".join(f"{money(rs.tier_price(x.id, t), sym):>6}" for x in rs.tiers)
        lines.append(f"{label:>14} | {cells}")
    return "\n".join(lines)


def _chains_by_tier(rs: Ruleset) -> str:
    out = []
    for tier in rs.tiers:
        names = [_chain_label(rs, c.id) for c in rs.chains if c.tier == tier.id]
        if names:
            out.append(f"{tier.label}: {', '.join(names)}")
    return "; ".join(out)


_SYSTEM_TEMPLATE = """\
You are one seat at an online table playing {TITLE} ({description}), {min_players}-{max_players} players. The other seats may be humans or other AIs. Your objective: finish with the MOST MONEY. Final score = cash after the end-game payout (described below). Play to win, not merely to survive.

# Rules as implemented by this server

Board and setup
- {columns} columns (1-{columns}) x {rows} rows (A-{last_row}). A tile name is column then row, e.g. "{example_tile}". {area} tiles, each in the bag, in a hand, or on the board.
- Every player starts with {cash}, no {shares}, and a private hand of {hand} tiles.
- {Nchains} {chains}, {stocks} {shares} each in the bank at the start. Tiers: {tiers}.
- Tiles "touch" orthogonally (up, down, left, right; never diagonally).
- A "{chain}" is a connected group of {min_size}+ tiles belonging to a named company. A "lone tile" is a played tile touching no {chain} (shown "#" on the map).

Your turn, in order
1. Place exactly one tile from your hand (mandatory if you have any playable tile; if none is playable the turn skips to buying). You may instead declare the game over, if the end-game condition holds (see End of game).
2. Resolve the tile's effect (founding {a_chain} or {a_merger}, below).
3. Buy {shares}: 0 to {max_buy} {shares} in total, any mix of {chains} that are on the board, at their current price, paying cash. You cannot buy more than the bank has, and you cannot buy {a_chain} that is not on the board. Buying is optional, and after buying you must still send end_turn.
4. end_turn: you draw a tile (if the bag is not empty) and play passes clockwise. Tiles in your hand that can never be played (they would merge two {chains} that are both {safe}) are discarded and replaced automatically.

What a tile does (tile = the one you place)
- nothing: it touches no other tile. It becomes a lone tile.
- expand: it touches exactly one {chain} (and perhaps lone tiles). The {chain} grows by that tile plus every lone tile connected to it.
- found: it touches lone tile(s) but no {chain}. It creates a new {chain} (size >= {min_size}). You choose which {chain} that is, from the {chains} not currently on the board, and you receive {founder_text} of it (if the bank has none left you receive its price in cash instead). If all {n_chains} {chains} are on the board, such a tile is unplayable for now (it stays in your hand).
- merge: it touches two or more different {chains}.
- A tile that would merge two or more {chains} that are each {safe} can NEVER be played.

Size {safe_size}+: {a_chain} with {safe_size} or more tiles is {safe}. It can never be absorbed.

{Mergers} (resolved in this order)
1. The {chain} with the most tiles survives; the others are defunct. If exactly one touched {chain} is {safe} it survives whatever the sizes. If the largest {chains} tie, the player who placed the tile chooses the survivor.
2. Defunct {chains} are resolved one at a time, largest first. For each defunct {chain}:
   a. Bonuses are paid by the bank immediately, based on the defunct {chain}'s size before the {merger} (table below). The player with the most {shares} in it gets the majority bonus, the player with the second most gets the minority bonus. A sole shareholder gets both. If players tie for most {shares}, majority + minority are pooled and split equally among them (rounded UP to the next {round_to}) and no minority bonus is paid. If players tie for second most, the minority bonus is split equally among them (rounded up to {round_to}).
   b. Then every player holding {shares} of that defunct {chain} decides, starting with the player who placed the tile and continuing clockwise, how to split their {shares} among: SELL (bank pays the defunct {chain}'s price, from its size before the {merger}), TRADE ({ratio_word} defunct {shares} for one {share} of the survivor, {trade_multiple} only, limited by the survivor {shares} still in the bank) and HOLD (keep them; a defunct {chain}'s {shares} are worth nothing unless that {chain} is founded again later). sell + trade + hold must equal the number of {shares} held.
3. The surviving {chain} absorbs all tiles (including the {merger} tile and any lone tiles touching it), so its size and price jump. The defunct {chains} leave the board and can be founded again.

Prices and bonuses depend only on the number of tiles in the {chain}:
{price_table}

Player-to-player trading (a house feature of this server)
- Any player may propose a trade to another: any mix of {shares} and cash offered, any mix requested. The recipient may accept or reject (no counter-offers); on accept it executes immediately if both sides still hold what is listed. Offers can arrive during anyone's turn, so you may be asked to respond even when it is not your turn. Offers are public: every player sees each open offer and how it was answered, and anyone may make either side a competing offer of their own (an ordinary propose_trade).
- A trade moves money/{shares} between two players, so it only helps you if what you receive is worth more TO YOU than what you give (consider majority/minority positions, {merger} prospects and current prices), and it also helps the other side. You may propose at most one trade per turn here, and only during the buy step; "no trade" is the normal choice.

End of game
- Either of these makes the game endable: any {chain} has {end_size}+ tiles, OR at least one {chain} is on the board and every {chain} on the board is {safe} ({safe_size}+).
- Ending is optional and only the player whose turn it is may declare (action declare_end_game, offered in the legal options when allowed). The game does not end by itself.
- On declaring, immediately: no more tiles or purchases; the majority/minority bonuses of every {chain} on the board are paid as for {a_merger}; then all {shares} in {chains} on the board are sold at current prices. {Shares} in {chains} not on the board are worthless. Most money wins.
- The calculator data includes each player's exact projected final score if the game ended right now.

# What you are shown
- Only public information plus your own hand. You cannot see other players' tiles; the bag order is unknown. Cash and {share} holdings are public.
- ALL arithmetic is already done in the "calculator" data (prices, bonuses and who would receive them, {shares} needed to take majority, {merger} and purchase outcomes, projected final scores). Trust those numbers; do not recompute them. Your job is judgment: which option gives you the best chance to finish first.
- The "legal options" block lists exactly what you may do now. Any answer outside it is rejected.

# How to answer
Reply with ONE JSON object and nothing else:
{{"why": "<one sentence: the reason for this choice>", "action": <one action object>, "note": "<private plan for your later decisions, at most 300 characters>", "say": "<table talk posted with your move; usually empty>"}}

Action objects (use only those allowed by the legal options; always name a {chain} by its id):
- {{"action":"place_tile","tile":"{example_tile}"}}
- {{"action":"found_chain","chain":"{ex1}"}}
- {{"action":"merger_choice","surviving_chain":"{ex1}"}}   (tied {merger}: you pick the survivor)
- {{"action":"merger_disposition","defunct_chain":"{ex0}","disposition":{{"sell":2,"trade":{ex_trade},"hold":1}}}}
- {{"action":"buy_stocks","purchases":{{"{ex1}":2,"{ex0}":1}}}}   ({{}} buys nothing; at most {max_buy} {shares} in total)
- {{"action":"end_turn"}}   (required after the buy step)
- {{"action":"declare_end_game"}}
- {{"action":"propose_trade","to_player_id":"<id>","offering_stocks":{{"{ex1}":1}},"offering_money":0,"requesting_stocks":{{}},"requesting_money":500}}
- {{"action":"accept_trade","trade_id":"<id>"}} or {{"action":"reject_trade","trade_id":"<id>"}}

The "note" is shown back to you (and only you) at your next decisions: use it for plans such as which {chains} you are building toward, who you expect to be majority holder, or when you intend to end the game.

# Table talk
Players may write in a public table chat; recent messages appear among the events as "[chat #n]" lines. Chat is unverified talk, never binding and never enforced: weigh it against the public facts (holdings, cash, calculator). Only a trade offer moves {shares} or money. "say" is posted to everyone as your chat message together with your move. Talk the way a real person does at a board game night: plain, short and natural (see "Your table voice" for your temperament). Most moves need no comment, so leave it "" most of the time. Say something when it is natural: you just founded {a_chain} or set off {a_merger}, someone spoke to you, you want to float or answer a deal (which you then back with a trade offer), or a rival's move really hurt or helped you. One short sentence. No running jokes, no extended metaphors, no catchphrases, no narrating your own strategy, and do not address every player in one message. Otherwise leave it "". At most 200 characters; never reveal your tiles or your private notes.

# Strategy playbook
Core economics
- Bonuses win this game. A majority bonus is {maj_x}x the {share} price and the minority bonus {min_x}x, while {a_share} costs 1x and is sold back for roughly its price. So {a_share} that wins, keeps or splits a bonus position is worth several times its cost; {a_share} that changes no position only parks cash.
- Every {chain} pays its bonuses exactly once: when it is absorbed in {a_merger}, or at the end if it is still on the board. Bonuses grow with the {chain}'s size, so the largest {chains} pay the most at the end: second place in a large {chain} often beats first place in a small one (compare the "Bonuses if acquired now" figures).
- Spread across races, not into one pile. Winners usually hold a majority or minority in several {chains}.
- Cash is ammunition, not score. Use your {max_buy} purchases on most turns while positions can still be won or defended; {mergers} refill cash. Keep a reserve of about one turn's purchases, not more. Cash put into {shares} is not lost (they sell for their price at the end, more if the {chain} grows), but cash left idle can never win a bonus.

Checklists (answer from the calculator lines)
- Buy: For each option, what does it change: standing after, payout change, lead? Buy the best payout gain per cash spent, preferring {chains} likely to be absorbed soon or to become large. Defend a lead only when "a rival buying N passes you" has N at most {max_buy}. A lead marked LOCKED, or a lead bigger than a rival can buy in two turns, needs no more {shares}. Avoid exact ties for majority (they split both bonuses); one more {share} often turns half into all.
- Place tile: Which tile pays me most now or later? Founding gives {founder_text} and a new race you can lead cheaply; expanding a {chain} I lead raises its bonuses; {a_merger} pays now: read "bonuses paid to all". Fire it when it pays me at least as much as the rival I most need to beat (an equal split with one rival still gains on everyone else), or when it ends a race I would lose; a bonus in hand beats a bigger one a rival may take from me. Skip it when it mainly pays rivals. A lone tile is a fine waiting move. Do not grow a rival's {chain} to {safe} or hand a rival a big {merger} payout.
- Found: Pick a {chain} I can lead with my cash: a higher tier means bigger bonuses but dearer {shares}; with little cash pick a cheap one.
- Survivor (tie): Keep as survivor the {chain} where my stake matters longer; the defunct one pays its bonuses now: check who they pay.
- {Merger} {shares}: Compare the SELL / TRADE / HOLD lines. Trade when it is worth more at the post-{merger} price, or when the extra survivor {shares} win or protect a bonus position there. Sell when cash wins a race this turn. Hold only when that {chain} is likely to be founded again and you would lead it.
- Trade offer: Value a trade by what it does to majority/minority positions and coming {merger} payouts for BOTH sides, not by list price (read the "Counting bonus positions" line). Never sell {a_share} that holds a bonus position for its list price: the price must cover the bonus given up. Ask a premium when the trade hands the other side a position, most of all in {a_chain} about to be absorbed. A trade that helps the other side more than me is a bad trade, worst when they lead. {Shares} the bank has run out of are worth extra; a defunct {chain}'s far less. Rules-based opponents price this in too. Proposing is optional.
- Declare end: Am I projected rank 1 with a lead that the next round cannot erase? Then declare. If I am behind, play on and use the turns to win races.

Named blunders
- Piling {shares} into a {chain} I already lead comfortably, or into the cheapest {chain} because it is cheap.
- Buying {shares} that give no bonus position and will not reach one.
- Setting off {a_merger} that pays rivals and not me.
- Sitting on a large cash pile while bonus positions are still open.
- Ignoring the largest {chain} because a rival leads it: its minority bonus may be the richest one on the board.
- Ending the game while behind, or not ending it while comfortably ahead.

Your note: keep it a plan, e.g. "racing X (lead by one) and Y minority; reserve one turn's buys; want the X+Y {merger}; end when ahead".
"""

_TIMES = {1: "equal to", 2: "twice", 3: "three times", 4: "four times"}


def build_system_prompt(ruleset: Ruleset | None = None) -> str:
    """The system prompt for ``ruleset`` (default: the default ruleset). Deterministic, so
    it is identical for every decision of a game (prompt-cacheable)."""
    rs = ruleset if ruleset is not None else default_ruleset()
    th = rs.theme
    letters = rs.board.row_letters
    ratio = rs.merger_trade_ratio
    founder = rs.founder_bonus_shares
    chain_ids = rs.chain_ids
    words = {
        "TITLE": rs.title.upper(),
        "description": th.game_description,
        "min_players": rs.min_players,
        "max_players": rs.max_players,
        "columns": rs.board.columns,
        "rows": rs.board.rows,
        "last_row": letters[-1],
        "example_tile": f"{min(5, rs.board.columns)}{letters[min(2, len(letters) - 1)]}",
        "area": rs.board.area,
        "cash": money(rs.starting_cash, th.currency_symbol),
        "hand": rs.hand_size,
        "Nchains": _cap(_num_word(len(chain_ids))),
        "n_chains": len(chain_ids),
        "stocks": rs.stocks_per_chain,
        "tiers": _chains_by_tier(rs),
        "chain": th.chain_noun,
        "chains": th.chain_noun_plural,
        "a_chain": f"{_article(th.chain_noun)} {th.chain_noun}",
        "share": th.share_noun,
        "shares": th.share_noun_plural,
        "a_share": f"{_article(th.share_noun)} {th.share_noun}",
        "Shares": _cap(th.share_noun_plural),
        "merger": th.merger_noun,
        "mergers": th.merger_noun_plural,
        "Mergers": _cap(th.merger_noun_plural),
        "Merger": _cap(th.merger_noun),
        "a_merger": f"{_article(th.merger_noun)} {th.merger_noun}",
        "safe": th.safe_phrase,
        "min_size": MIN_CHAIN_SIZE,
        "max_buy": rs.max_stock_purchases_per_turn,
        "founder_text": (
            f"{founder} free {th.share_noun if founder == 1 else th.share_noun_plural}"
        ),
        "safe_size": rs.safe_chain_size,
        "end_size": rs.end_game_chain_size,
        "round_to": money(rs.bonuses.tie_round_up_to, th.currency_symbol),
        "ratio_word": _num_word(ratio),
        "ratio_times": _TIMES.get(ratio, f"{ratio} times"),
        "trade_multiple": "even numbers" if ratio == 2 else f"multiples of {ratio}",
        "ex_trade": ratio,
        "ex0": chain_ids[0],
        "ex1": chain_ids[1],
        "price_table": _price_table_text(rs),
        "maj_x": rs.bonuses.majority_multiplier,
        "min_x": rs.bonuses.minority_multiplier,
    }
    return _SYSTEM_TEMPLATE.format(**words)


# Bump by hand whenever ``build_user_prompt`` (or anything else that shapes
# what the model sees, e.g. the retry message or the answer schema) changes
# in a way that could change play. The system prompt text is hashed in
# automatically. Benchmark results are only comparable within one
# ``prompt_version`` (see docs/ai/benchmarking.md).
PROMPT_BUILDER_VERSION = 7  # 2: table talk; 3: table voice; 4: natural, low-key talk;
# 5: strategy playbook + share race, merger payouts for all, disposition figures;
# 6: trade offers are public (rules text, open offers between other players)
# 7: position-aware trade numbers in the offer + trade paragraph in the playbook


def _sha(text: str) -> str:
    import hashlib

    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def system_prompt_id(text: str, ruleset: Ruleset | None = None) -> str:
    """Stable id of a system prompt text (``sp-`` + 12 hex digits).

    With ``ruleset`` given, its fingerprint is part of the hash, so the same
    text under two different rulesets can never share an id."""
    if ruleset is not None:
        text = f"{ruleset.fingerprint}\n{text}"
    return "sp-" + _sha(text)[:12]


def prompt_version(ruleset: Ruleset | None = None) -> str:
    """``v<builder version>-<10 hex>``: hash over the ruleset fingerprint, the
    system prompt text and ``PROMPT_BUILDER_VERSION``. Stable across processes
    and machines; different for every ruleset (default: the default ruleset)."""
    rs = ruleset if ruleset is not None else default_ruleset()
    digest = _sha(
        f"{PROMPT_BUILDER_VERSION}\n{rs.fingerprint}\n{build_system_prompt(rs)}"
    )[:10]
    return f"v{PROMPT_BUILDER_VERSION}-{digest}"


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


def chat_line(m: dict) -> str:
    """One table-chat message as prompts show it (decision and reply prompts)."""
    kind = m.get("kind") or "human"
    return f'[chat #{m.get("id")}] {m.get("name")} ({kind}): "{m.get("text")}"'


def _interleave_chat(
    recent: list[Any], chat: list[dict], names: dict[str, str], budget: PromptBudget
) -> list[str]:
    """Recent event lines with chat lines placed after the event they followed
    (``after_seq``); chat older than the recent window comes first."""
    seqs = [e.get("seq") for e in recent if isinstance(e, dict)]
    first = next((s for s in seqs if isinstance(s, int)), None)
    by_seq: dict[int, list[dict]] = {}
    lead: list[dict] = []
    for m in chat:
        at = m.get("after_seq")
        if isinstance(at, int) and at in seqs:
            by_seq.setdefault(at, []).append(m)
        elif first is None or not isinstance(at, int) or at < first:
            lead.append(m)
        else:  # after the last event shown
            by_seq.setdefault(seqs[-1], []).append(m)
    lines = [chat_line(m) for m in lead]
    for e in recent:
        lines.append(render_event(e, names, budget.max_line_chars))
        if isinstance(e, dict):
            lines += [chat_line(m) for m in by_seq.get(e.get("seq"), [])]
    return lines


def render_events(
    events: Iterable[Any],
    names: dict[str, str],
    budget: PromptBudget,
    chat: list[dict] | None = None,
) -> str:
    evs = list(events or [])
    if not evs and not chat:
        return "(no events yet)"
    if not evs:
        return "\n".join(chat_line(m) for m in chat or [])
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
    if chat:
        lines += _interleave_chat(recent, chat, names, budget)
    else:
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
    rs = ruleset_from_state(state)
    cells = (state.get("board") or {}).get("cells") or {}
    initial = {c.id: c.abbreviation for c in rs.chains}
    columns = rs.board.columns
    header = "    " + "".join(f"{c:>3}" for c in range(1, columns + 1))
    rows = [header]
    for r in rs.board.row_letters:
        glyphs = []
        for c in range(1, columns + 1):
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
    race = _race_text(v)
    if race:
        parts.append(race)
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


def _race_text(v: dict) -> str:
    """The share race from the viewer's side (calculator ``lead`` fields)."""
    if v.get("lead") is None:
        return ""
    lead, best = v["lead"], v.get("best_rival_shares", 0)
    if lead < 0:
        return f"top rival holds {best}, {-lead} more than you"
    if v.get("majority_locked"):
        return (
            f"lead {lead} over the next holder ({best}); LOCKED: the bank cannot "
            "supply a rival enough to pass you"
        )
    txt = (
        f"tied with the top rival at {best}"
        if lead == 0
        else f"lead {lead} over the next holder ({best})"
    )
    k = v.get("rival_shares_to_pass")
    if k is not None:
        txt += f"; a rival buying {k} passes you"
    return txt


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
                f"- {name}: FOUNDS a chain of {t.get('new_size')} tiles (you get the founder's free shares). "
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
                pays = sc.get("bonus_by_player") or {}
                pay_txt = ", ".join(
                    f"{'YOU' if pid == calc.get('viewer_id') else _pname(calc, pid)} {money(v)}"
                    for pid, v in pays.items()
                )
                out.append(
                    f"    survivor {sc['survivor']} (would be {sc['survivor_size_after']} tiles, "
                    f"{money(sc['survivor_price_after'])}/share"
                    + (", SAFE" if sc.get("survivor_safe_after") else "")
                    + f"); your bonuses total {money(sc['viewer_total_bonus'])}; "
                    f"bonuses paid to all: {pay_txt or 'nobody holds shares'}"
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
        + _trade_position_text(
            (calc.get("trades") or {}).get(trade.get("trade_id")), frm
        )
    )


def _signed(n: int) -> str:
    return ("+" if n >= 0 else "-") + money(abs(n))


def _trade_position_text(v: dict | None, frm: str) -> str:
    """The position-aware line of an offer (game.trade_value.trade_valuation
    for the deciding player); "" when the pack has no valuation for it."""
    if not v or not v.get("valid"):
        return ""
    me, them = v["viewer"], v["counterparty"]
    ranks = "; ".join(
        f"{'you' if r['player_id'] == v['viewer_id'] else frm} in {r['chain']}: "
        f"{_STANDING.get(r['before'], r['before'])} -> "
        f"{_STANDING.get(r['after'], r['after'])}"
        for r in v.get("rank_changes") or []
    )
    return (
        f"\nAt list prices: give {money(v['list']['give'])}, get "
        f"{money(v['list']['get'])}. Counting bonus positions (bonuses if bought "
        f"out now, weighted by how likely they are to be paid as they stand): net "
        f"{_signed(me['change'])} for you (bonuses {_signed(me['bonus_change'])}), "
        f"{_signed(them['change'])} for {frm} (bonuses "
        f"{_signed(them['bonus_change'])}). Bonus positions that change: "
        f"{ranks or 'none'}."
        + (
            f" {frm} is ahead of you in net worth."
            if v.get("counterparty_ahead")
            else ""
        )
    )


def render_open_offers(
    trades: list[dict], calc: dict, names: dict[str, str], me: str
) -> str:
    """Open offers between OTHER players (offers are public), one line each
    with both sides valued at current prices; "" when there are none."""
    lines = []
    for t in trades or []:
        frm, to = t.get("from_player_id"), t.get("to_player_id")
        if me in (frm, to):
            continue
        give = _trade_value(t.get("offering_stocks"), t.get("offering_money"), calc)
        want = _trade_value(t.get("requesting_stocks"), t.get("requesting_money"), calc)
        lines.append(
            f"- {names.get(frm, frm)} [id {frm}] offers {names.get(to, to)} [id {to}]: "
            f"{_stock_text(t.get('offering_stocks'), t.get('offering_money'), names)} "
            f"(worth {money(give)}) for "
            f"{_stock_text(t.get('requesting_stocks'), t.get('requesting_money'), names)} "
            f"(worth {money(want)})."
        )
    return "\n".join(lines)


def render_disposition(ctx, calc: dict) -> str:
    ratio = ruleset_from_state(ctx.state).merger_trade_ratio
    times = _TIMES.get(ratio, f"{ratio} times")
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
        f"Trading gives 1 {s} share per {ratio} {d} shares, at most {lg.get('max_trade')} {d} shares "
        f"(survivor shares left in bank limit this). {s} is {money(ps)}/share now and will be worth "
        f"more once the merged tiles join it; trading beats selling only if {s}'s price after the "
        f"merger is more than {money(ratio * pd)} ({times} {d}'s price). Holding {d} shares is worth "
        f"nothing unless {d} is founded again."
    )
    x = calc.get("disposition")
    if x:
        tm = x["trade_max"]
        diff = x["trade_minus_sell"]
        lines.append(
            f"After the merger {s} will have {x['survivor_size_after']} tiles at "
            f"{money(x['survivor_price_after'])}/share"
            + (" (SAFE)" if x.get("survivor_safe_after") else "")
            + "."
        )
        lines.append(f"- SELL all {n}: {money(x['sell_all_value'])} cash now.")
        if tm["shares_traded"]:
            lines.append(
                f"- TRADE {tm['shares_traded']} for {tm['survivor_shares_received']} {s}"
                + (
                    f" and sell the other {tm['leftover_shares']}"
                    if tm["leftover_shares"]
                    else ""
                )
                + f": worth {money(tm['total_value'])} at the post-merger price "
                f"({'+' if diff >= 0 else '-'}{money(abs(diff))} vs selling all). "
                f"Your {s} stake goes {x['survivor_shares_now']} -> "
                f"{x['survivor_shares_now'] + tm['survivor_shares_received']}: "
                f"{_STANDING.get(x['survivor_standing_now'])} -> "
                f"{_STANDING.get(x['survivor_standing_after_trade'])}, your {s} bonus if it "
                f"were acquired at that size {money(x['survivor_payout_now'])} -> "
                f"{money(x['survivor_payout_after_trade'])}."
            )
        else:
            lines.append(
                "- TRADE: not possible (too few shares or none left in the bank)."
            )
        lines.append(
            f"- HOLD: {money(0)} now; pays only if {d} is founded again before the end."
        )
    return "\n".join(lines)


_DECISION_TEXT = {
    "place_tile": "Choose which tile from your hand to place (or take another action if the legal options offer one).",
    "found_chain": "Your tile founded a new chain. Choose which available chain to found (you receive the founder's free shares).",
    "choose_survivor": "Your tile merged chains of equal size. Choose which chain survives.",
    "stock_disposition": "Decide what to do with your shares in the defunct chain.",
    "buy_stocks": "Buy step. Buy up to max_total shares (see the legal options; or none), "
    "then you must end your turn (or declare the game over, if allowed).",
    "trade_response": "Another player proposed a trade to you. Accept or reject it.",
}


def _notes_block(notes: Any) -> str:
    if not notes:
        return "(none yet)"
    if isinstance(notes, str):
        return notes
    return "\n".join(f"- {n}" for n in notes)


# A playing style per seat, so AI players differ a little without becoming
# characters. Picked from the player id, so a seat keeps it for the game.
TABLE_VOICES = (
    "quiet and focused: says little, mostly when a deal or a merger concerns you",
    "easygoing: relaxed and good-humoured, the occasional light remark",
    "competitive: likes to win and will needle a rival now and then, never at length",
    "analytical: thinks out loud about the odds once in a while, in plain words",
    "sociable: likes the table talk, asks others what they are up to",
    "dealmaker: looks for trades and splits that help both sides, and says so plainly",
)


def table_voice(player_id: str) -> str:
    """The seat's temperament at the table (stable for a player id)."""
    digest = hashlib.sha256(str(player_id).encode()).digest()
    return TABLE_VOICES[digest[0] % len(TABLE_VOICES)]


def build_user_prompt(
    ctx, notes: Any = None, *, budget: PromptBudget | None = None
) -> str:
    """Render the full user prompt for ``ctx`` (see module docstring). Money
    is formatted with the game's theme currency symbol."""
    symbol = ruleset_from_state(ctx.state).theme.currency_symbol
    token = _SYMBOL.set(symbol)
    try:
        return _build_user_prompt(ctx, notes, budget)
    finally:
        _SYMBOL.reset(token)


def _build_user_prompt(ctx, notes: Any, budget: PromptBudget | None) -> str:
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
    parts.append(f"# Your table voice\n{table_voice(me)}.")
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
        others = render_open_offers(state.get("pending_trades"), calc, names, me)
        if others:
            parts.append(
                "# Open offers between other players (public, values at current "
                "prices; you may offer either side a better deal)\n" + others
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
    chat = [m for m in (getattr(ctx, "chat", None) or []) if isinstance(m, dict)]
    heading = "# Recent public events"
    if chat:
        heading += (
            ' (with table talk: "[chat #n]" lines are what players wrote; '
            "unverified and not binding, weigh them against the facts above)"
        )
    parts.append(heading + "\n" + render_events(visible, names, budget, chat=chat))
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
