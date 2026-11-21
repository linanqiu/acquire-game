"""The commentator's words: prompt, computed facts, rules-only lines.

The commentator (``backend/commentary.py``) is a non-playing voice for
spectators. This module holds everything about *what it says*:

* ``build_system_prompt(ruleset)``: the static system prompt (the game in
  brief, the register, what is forbidden). Identical for every call of a
  game, so the provider's prompt cache applies.
* ``table_facts(game)`` / ``history_facts(game)``: the table now and the game
  so far as plain text, computed by the engine's calculator from **public**
  state only (no hands, no private events, no seat notes).
* ``build_user_prompt(...)``: moments + table + history + its own last lines.
* ``rules_line(...)``: the templated line used when no model is configured,
  a cap is reached or a call fails (zero cost; also what tests see).
* ``clean_line`` / ``unsupported_amounts``: checks on a model's answer. An
  amount of money that is not in the prompt is a made-up number: the line is
  dropped and the rules line is used instead.
* ``resolve_model()`` / ``provider_for(entry)``: which catalog entry narrates
  (``GAME_COMMENTARY_MODEL``; default the catalog's Haiku entry when it has a
  key, else none = rules-only).

See docs/ai/commentary.md.
"""

from __future__ import annotations

import re
from typing import Any

from agents.llm.prompt import money as _money
from agents.llm.prompt import system_prompt_id as _sp_id
from game.calculator import public_chain_holders, public_net_worth
from game.rules import Rules
from game.ruleset import Ruleset, resolve

#: Longest line shown (the prompt asks for less; longer answers are refused).
MAX_LINE_CHARS = 220
#: What the prompt asks for.
ASK_LINE_CHARS = 170

LINE_SCHEMA = {
    "type": "object",
    "properties": {"line": {"type": "string"}},
    "required": ["line"],
    "additionalProperties": False,
}

#: How a tie for first is written in the facts: each tied holder's amount
#: is their part of both bonuses (not "the majority bonus split").
TIED_MAJORITY = "tied for the majority; this is each one's part of both bonuses"

_ORDINAL = {1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth"}


def ordinal(n: int) -> str:
    return _ORDINAL.get(n, f"{n}th")


def money(rs: Ruleset, n: Any) -> str:
    return _money(n, rs.theme.currency_symbol)


def count(rs: Ruleset, n: int) -> str:
    """ "1 share" / "4 shares" in the ruleset's words."""
    t = rs.theme
    return f"{n} {t.share_noun if n == 1 else t.share_noun_plural}"


def chain_name(rs: Ruleset, chain: str) -> str:
    """Display name of a chain ("Sandpiper"); the id when unknown."""
    try:
        return rs.chain(chain).name
    except Exception:  # noqa: BLE001 - a name is never worth a crash
        return str(chain)


def player_names(game) -> dict[str, str]:
    return {p.player_id: p.name for p in game.players}


def turn_number(game) -> int:
    return 1 + sum(1 for e in game.events if e.get("type") == "turn_ended")


# ---------------------------------------------------------------------------
# System prompt (static per ruleset)
# ---------------------------------------------------------------------------


def build_system_prompt(ruleset: Ruleset | None = None) -> str:
    rs = resolve(ruleset)
    t = rs.theme
    chain, chains = t.chain_noun, t.chain_noun_plural
    share, shares = t.share_noun, t.share_noun_plural
    b = rs.bonuses
    tiers = "; ".join(
        f"{tier.label}: "
        + ", ".join(chain_name(rs, c.id) for c in rs.chains if c.tier == tier.id)
        for tier in rs.tiers
    )
    founder = rs.founder_bonus_shares
    ex = [c.name for c in rs.chains][:3]
    ex = (ex + ["the chain"] * 3)[:3]
    ex_m1, ex_m2, ex_m3 = money(rs, 6100), money(rs, 5100), money(rs, 2550)
    return f"""\
You are the commentator of a live game of {rs.title}, {t.game_description}. Spectators watch the board on a screen; you add one line at a time, the way a good sports commentator who knows this game well would. You are not a player and nothing you say changes the game.

# The game in brief
- Players take turns placing one tile on a {rs.board.columns} by {rs.board.rows} board. A tile next to a lone tile founds a {chain}; the founder gets {founder} free {share if founder == 1 else shares}. A tile that joins two {chains} is a {t.merger_noun}: the larger one survives and the smaller one is acquired (it leaves the board).
- After placing a tile a player may buy up to {rs.max_stock_purchases_per_turn} {shares} of {chains} on the board. There are {rs.stocks_per_chain} {shares} per {chain}. The {share} price rises with the size of the {chain} and with its tier ({tiers}).
- When a {chain} is acquired, the holder of the most {shares} is paid the majority bonus ({b.majority_multiplier} times the {share} price) and the second largest holder the minority bonus ({b.minority_multiplier} times). A sole holder gets both. Holders tied for the majority split both bonuses and no minority bonus is paid; holders tied for second split the minority bonus. Then each holder sells the defunct {shares} at the old price, trades {rs.merger_trade_ratio} of them for one {share} of the survivor, or keeps them in case the {chain} is founded again.
- A {chain} of {rs.safe_chain_size} or more tiles is {t.safe_phrase}: it can never be acquired. Its bonuses are paid only when the game ends.
- The player on turn may end the game once a {chain} has {rs.end_game_chain_size} or more tiles, or once every {chain} on the board is {t.safe_phrase}. Then the bonuses of every {chain} on the board are paid, all {shares} are sold at their price, and the most cash wins.
- "Net worth" is cash plus {shares} at their current price. It leaves out bonuses still to come, so the net-worth leader is not always the favourite.

# What you are given
Each request lists the moments that just happened (the most important first, already chosen for you by the rules), the table as it is now, the game so far, and your own latest lines. All of it is computed by the game engine and is correct.

# What to write
One line for the screen, at most {ASK_LINE_CHARS} characters. Sentence one, at most 22 words: what happened in the first moment. A second sentence, at most 12 words, only when the request holds a fact for it (a bonus amount, a net-worth figure, a share count, a callback): why it matters for the money, or what to watch next. Otherwise stop after the first sentence; never add a clause just to fill the line.
- Say one thing. The first moment is the one to tell; a second moment, when listed, may get a few words or be left out. Do not hang another topic on the sentence with "while", "with", "and", "but" or a semicolon.
- Be specific: name the players and the {chains}, and use the numbers you are given ({shares}, tiles, money).
- Dry and plain, like someone who has watched many of these games. No hype words (huge, massive, incredible, stunning, bold, dramatic, crucial, "what a"), no exclamation marks, no emoji, no catchphrases, no rhetorical questions, no greeting, no "folks", and never speak to the players or to the audience.
- Vary the shape of your lines. Do not open a line the way one of your latest lines opens and do not reuse their verbs or turns of phrase: if a latest line says "folds ... into" or "a buyout now would pay", say it another way or leave it out. Never say again what a latest line already said.
- A callback to earlier play is welcome when "The game so far" supports it (for example the second {t.merger_noun} a player has set off).
- For a "state of the table" moment simply say where things stand. Never say that the game is quiet, that nothing happened, or how many turns have passed.
- Every statement must come from this request. State nothing that is not written in it: no tiles in hand, no intentions or plans, no feelings, no guess about earlier play, no prediction of what a player will do, and no reason for anything unless the request gives the reason. Do not do arithmetic or comparisons of your own (no sums, differences, "twice", "more than", "combined", no counting): use the amounts and counts as written. Figures marked "if acquired now" are conditional and must be said that way.
- Write the {chain} names exactly as written and money as it is written in the request. Give a player's full name the first time in a line; after that the first word of the name is enough. Never call a player he, she, him, her, his, it or its: repeat the name or use "they" and "their".

Examples of the register only (A, B, C and the numbers are placeholders, not this game):
- "A takes the {ex[0]} majority with that buy. If {ex[1]} swallows it, that is {ex_m1} to A and nothing for B."
- "Second {t.merger_noun} C has set off, and again the bonuses go elsewhere: {ex_m2} to A, {ex_m3} to B."
- "{ex[2]} is {t.safe_phrase} at 11 tiles, so A's 8 {shares} stay put until the end."

Answer with one JSON object and nothing else: {{"line": "<your line>"}}"""


def system_prompt_id(text: str, ruleset: Ruleset | None = None) -> str:
    return _sp_id("commentary\n" + text, ruleset)


# ---------------------------------------------------------------------------
# Facts (public information only)
# ---------------------------------------------------------------------------


def holders_text(rs: Ruleset, info: dict, names: dict[str, str]) -> str:
    """ "Fitz 6, Tilly 4, Max 1" (most first); "nobody" when none."""
    hs = info.get("holders") or []
    return (
        ", ".join(
            f"{names.get(h['player_id'], h['player_id'])} {h['shares']}" for h in hs
        )
        or "nobody"
    )


def payout_text(rs: Ruleset, info: dict, names: dict[str, str]) -> str:
    """Who is paid what if the chain is bought out (or the game ends) now:
    "Fitz $5,000 (majority), Tilly $2,500 (minority)"; holders tied for a
    position are named together: "Fitz and Tilly $3,800 each (tied for the
    majority)"."""
    groups: dict[tuple[int, str], list[str]] = {}
    for h in info.get("holders") or []:
        if not h.get("bonus"):
            continue
        if h.get("majority") and h.get("minority"):
            role = "majority and minority, the only holder"
        elif h.get("majority"):
            role = TIED_MAJORITY if h.get("tied") else "majority"
        else:
            role = "tied for second" if h.get("tied") else "minority"
        groups.setdefault((h["bonus"], role), []).append(
            names.get(h["player_id"], h["player_id"])
        )
    parts = []
    for (bonus, role), who in groups.items():
        people = who[0] if len(who) == 1 else ", ".join(who[:-1]) + " and " + who[-1]
        each = " each" if len(who) > 1 else ""
        parts.append(f"{people} {money(rs, bonus)}{each} ({role})")
    return ", ".join(parts) or "nobody"


def chain_line(
    rs: Ruleset, chain: str, info: dict, names: dict[str, str], bank: int | None
) -> str:
    size = info.get("size", 0)
    safe = rs.is_safe_size(size)
    when = "paid at the end of the game, at its size now" if safe else "if acquired now"
    bank_text = "" if bank is None else f", {bank} in the bank"
    return (
        f"- {chain_name(rs, chain)}: {size} tiles"
        f"{' (' + rs.theme.safe_phrase + ')' if safe else ''}, "
        f"{money(rs, info.get('price'))} a {rs.theme.share_noun}{bank_text}. "
        f"Holders: {holders_text(rs, info, names)}. "
        f"Bonuses {when}: {payout_text(rs, info, names)}."
    )


def standings(game) -> list[dict]:
    """Players by net worth, best first: ``{player_id, name, cash, stock_value,
    net_worth, rank}`` (seat order breaks ties)."""
    worth = public_net_worth(game)
    rows = [
        {"player_id": p.player_id, "name": p.name, **worth[p.player_id]}
        for p in game.players
    ]
    return sorted(rows, key=lambda r: r["rank"])


def closest_race(game) -> dict | None:
    """The chain (not safe first) whose two largest holders are closest:
    ``{chain, first: (pid, n), second: (pid, n), gap}``; None when no chain
    has two holders."""
    rs = game.ruleset
    best = None
    for chain, info in public_chain_holders(game).items():
        hs = info.get("holders") or []
        if len(hs) < 2:
            continue
        gap = hs[0]["shares"] - hs[1]["shares"]
        key = (rs.is_safe_size(info["size"]), gap, -info["price"])
        if best is None or key < best[0]:
            best = (
                key,
                {
                    "chain": chain,
                    "first": (hs[0]["player_id"], hs[0]["shares"]),
                    "second": (hs[1]["player_id"], hs[1]["shares"]),
                    "gap": gap,
                },
            )
    return best[1] if best else None


def end_reason(game) -> tuple[bool, str]:
    """(may the game be ended now, why) in the ruleset's own names."""
    rs = game.ruleset
    can = bool(Rules.check_end_game(game.board, game.hotel))
    active = game.hotel.get_active_chains()
    big = [c for c in active if game.board.get_chain_size(c) >= rs.end_game_chain_size]
    if big:
        c = big[0]
        return can, (
            f"{chain_name(rs, c)} has {game.board.get_chain_size(c)} tiles, and "
            f"{rs.end_game_chain_size} or more is enough"
        )
    if active and all(rs.is_safe_size(game.board.get_chain_size(c)) for c in active):
        return can, (
            f"every {rs.theme.chain_noun} on the board is {rs.theme.safe_phrase}"
        )
    return can, "not yet"


def table_facts(game) -> str:
    """The "Table now" block: turn, bag, standings, chains with holders and
    bonuses. Public information only."""
    rs = game.ruleset
    names = player_names(game)
    public = game.get_public_state()
    current = public.get("current_player")
    can_end, reason = end_reason(game)
    if str(public.get("phase")) == "game_over":
        # everything is cash now; the result is in the moment
        return "The game is over (see the final result above)."
    lines = [
        f"Turn {turn_number(game)}, {names.get(current, current)}'s turn. "
        f"Tiles left in the bag: {public.get('tiles_remaining')}.",
        (
            f"The player on turn may end the game ({reason})."
            if can_end
            else "The game cannot be ended yet."
        ),
        "Players by net worth (cash + shares at current prices):",
    ]
    for r in standings(game):
        lines.append(
            f"{r['rank']}. {r['name']}: {money(rs, r['net_worth'])} "
            f"(cash {money(rs, r['cash'])}, {rs.theme.share_noun_plural} "
            f"{money(rs, r['stock_value'])})"
        )
    chains = public_chain_holders(game)
    if chains:
        lines.append(f"{rs.theme.chain_noun_plural.capitalize()} on the board:")
        for chain in rs.chain_ids:
            if chain in chains:
                lines.append(
                    chain_line(
                        rs,
                        chain,
                        chains[chain],
                        names,
                        game.hotel.get_available_stocks(chain),
                    )
                )
    else:
        lines.append(f"No {rs.theme.chain_noun_plural} on the board yet.")
    return "\n".join(lines)


def history_counts(game) -> dict[str, dict]:
    """Per player, from the whole public event log: chains founded, mergers
    set off (and the bonus money those paid that player), bonus money
    collected in all mergers, trades done."""
    out = {
        p.player_id: {
            "founded": [],
            "mergers": 0,
            "own_merger_bonus": 0,
            "bonus": 0,
            "trades": 0,
        }
        for p in game.players
    }
    merger_by = None
    for e in game.events:
        if e.get("private_to"):
            continue
        t, pid = e.get("type"), e.get("player_id")
        if t == "chain_founded" and pid in out:
            out[pid]["founded"].append(e.get("chain"))
        elif t == "merger_started" and pid in out:
            out[pid]["mergers"] += 1
            merger_by = pid
        elif t == "bonuses_paid" and not e.get("final"):
            for who, b in (e.get("bonuses") or {}).items():
                got = int(b.get("majority", 0)) + int(b.get("minority", 0))
                if who in out:
                    out[who]["bonus"] += got
                    if who == merger_by:
                        out[who]["own_merger_bonus"] += got
        elif t == "trade_accepted":
            tr = e.get("trade") or {}
            for who in (tr.get("from_player_id"), tr.get("to_player_id")):
                if who in out:
                    out[who]["trades"] += 1
    return out


def history_facts(game) -> str:
    """The "game so far" block (see ``history_counts``)."""
    rs = game.ruleset
    names = player_names(game)
    counts = history_counts(game)
    mergers = sum(c["mergers"] for c in counts.values())
    noun = rs.theme.merger_noun if mergers == 1 else rs.theme.merger_noun_plural
    lines = [f"{mergers} {noun} so far."]
    for pid, c in counts.items():
        bits = []
        if c["founded"]:
            seen = list(dict.fromkeys(c["founded"]))
            bits.append(
                "founded "
                + ", ".join(
                    chain_name(rs, ch)
                    + (" (twice)" if c["founded"].count(ch) == 2 else "")
                    + (
                        f" ({c['founded'].count(ch)} times)"
                        if c["founded"].count(ch) > 2
                        else ""
                    )
                    for ch in seen
                )
            )
        if c["mergers"]:
            bits.append(
                f"set off {c['mergers']} "
                f"{rs.theme.merger_noun if c['mergers'] == 1 else rs.theme.merger_noun_plural}"
                f" (and collected {money(rs, c['own_merger_bonus'])} from "
                f"{'it' if c['mergers'] == 1 else 'them together'})"
            )
        if c["bonus"]:
            bits.append(
                f"{money(rs, c['bonus'])} in bonuses from all "
                f"{rs.theme.merger_noun_plural} of the game"
            )
        if c["trades"]:
            bits.append(f"{c['trades']} trade{'' if c['trades'] == 1 else 's'} done")
        lines.append(f"- {names.get(pid, pid)}: " + ("; ".join(bits) or "nothing yet"))
    return "\n".join(lines)


def build_user_prompt(
    moments: list[dict], table: str, history: str, memory: list[str]
) -> str:
    """The user prompt of one commentary call. ``moments``: dicts with
    ``turn`` and ``fact`` (oldest first)."""
    parts = [
        "# Moments (what just happened, the most important first)\n"
        + "\n".join(f"- Turn {m['turn']}: {m['fact']}" for m in moments),
        "# Table now\n" + table,
        "# The game so far\n" + history,
        "# Your latest lines (oldest first; do not repeat them)\n"
        + ("\n".join(f"- {line}" for line in memory) or "(none yet)"),
        'Write the next line now: {"line": "..."}',
    ]
    return "\n\n".join(parts) + "\n"


# ---------------------------------------------------------------------------
# Checking a model's answer; the rules-only line
# ---------------------------------------------------------------------------

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_SPACES = re.compile(r"\s+")
_AMOUNT = re.compile(r"\d[\d,]*(?:\.\d+)?")


def clean_line(text: Any) -> str | None:
    """Plain one-line text, or None when unusable (not a string or empty).
    A line longer than ``MAX_LINE_CHARS`` keeps its leading sentences that
    fit; None when not even the first one does."""
    if not isinstance(text, str):
        return None
    text = _SPACES.sub(" ", _CONTROL.sub(" ", text)).strip().strip('"').strip()
    if not text:
        return None
    if len(text) <= MAX_LINE_CHARS:
        return text
    kept = ""
    for sentence in _SENTENCE.split(text):
        nxt = f"{kept} {sentence}".strip()
        if len(nxt) > MAX_LINE_CHARS:
            break
        kept = nxt
    return kept or None


_SENTENCE = re.compile(r"(?<=[.?])\s+(?=[A-Z])")
_HYPE = re.compile(
    r"\b(huge|massive|incredible|stunning|dramatic|unbelievable|amazing|folks|"
    r"what a)\b",
    re.IGNORECASE,
)
_EMOJI = re.compile("[\u2600-\u27bf\U0001f000-\U0001faff]")


def style_problems(line: str) -> list[str]:
    """What the register forbids and a line still has (it is then refused):
    an exclamation mark, an emoji, a hype word."""
    out = []
    if "!" in line:
        out.append("exclamation mark")
    if _EMOJI.search(line):
        out.append("emoji")
    out += [m.lower() for m in _HYPE.findall(line)]
    return out


def unsupported_amounts(line: str, prompt: str, symbol: str = "$") -> list[str]:
    """Amounts of money in ``line`` that are not written in ``prompt``: the
    model made them up (or did arithmetic of its own). Compared as numbers,
    so "$6000" matches "$6,000"."""
    pattern = re.compile(re.escape(symbol) + r"\s?(" + _AMOUNT.pattern + ")")

    def numbers(text: str) -> set[str]:
        return {m.replace(",", "") for m in pattern.findall(text)}

    known = numbers(prompt)
    return sorted(n for n in numbers(line) if n not in known)


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


#: A line that shares this many consecutive words with a latest line is the
#: same sentence again with other names in it.
REPEAT_WORDS = 10


def repeats(line: str, memory: list[str]) -> bool:
    """True when ``line`` is (nearly) one of the latest lines: the same text,
    or ``REPEAT_WORDS`` consecutive words in common with one of them."""
    n = _norm(line)
    words_ = n.split()
    grams = {
        " ".join(words_[i : i + REPEAT_WORDS])
        for i in range(len(words_) - REPEAT_WORDS + 1)
    }
    for m in memory:
        other = _norm(m)
        if n == other or any(g in f" {other} " for g in grams):
            return True
    return False


def rules_line(moments: list[dict], memory: list[str]) -> str | None:
    """The templated line for a batch of moments: the most important
    moment's sentence, plus the next one when both fit. None when every
    candidate repeats a latest line."""
    ranked = sorted(moments, key=lambda m: (-m.get("priority", 0), m.get("seq", 0)))
    # a second sentence only for something worth saying (not a passing change)
    ranked = ranked[:1] + [m for m in ranked[1:] if m.get("priority", 0) >= 5]
    said = [m["say"] for m in ranked if m.get("say") and not repeats(m["say"], memory)]
    if not said:
        return None
    line = said[0]
    if len(said) > 1 and len(line) + 1 + len(said[1]) <= ASK_LINE_CHARS:
        line = f"{line} {said[1]}"
    return line[:MAX_LINE_CHARS]


# ---------------------------------------------------------------------------
# Which model narrates
# ---------------------------------------------------------------------------

OFF_VALUES = {"off", "none", "rules", "rules-only", "0", "false"}
_providers: dict[str, Any] = {}


def resolve_model(setting: str | None = None):
    """The catalog entry that narrates, or None for rules-only.

    ``GAME_COMMENTARY_MODEL`` (``setting``): a catalog id ("llm:claude-haiku-5-5")
    or model name; "off" / "rules" for rules-only. Unset: the first catalog
    entry whose id or model contains "haiku", when it is available (has a
    key). An entry that is not available never narrates.
    """
    from agents.llm.config import load_entries

    if setting is None:
        from config import get_settings

        setting = get_settings().game_commentary_model
    setting = (setting or "").strip()
    if setting.lower() in OFF_VALUES:
        return None
    entries = load_entries()
    if setting:
        chosen = next((e for e in entries if setting in (e.id, e.model)), None)
    else:
        chosen = next(
            (e for e in entries if "haiku" in f"{e.id} {e.model}".lower()), None
        )
    if chosen is None or not chosen.available():
        return None
    return chosen


def provider_for(entry) -> Any:
    """The provider of a catalog entry (one per entry, kept: the HTTP client
    and the provider's prompt cache are reused across games)."""
    key = f"{entry.id}|{entry.model}|{entry.provider}"
    provider = _providers.get(key)
    if provider is None:
        if entry.provider == "fake":
            from agents.llm.providers import FakeProvider
            from config import get_settings

            provider = FakeProvider(
                fake_commentary_responder,
                model="fake",
                delay=get_settings().fake_llm_delay,
            )
        else:
            from agents.llm.config import _build_provider

            provider = _build_provider(entry)
        _providers[key] = provider
    return provider


def fake_commentary_responder(system: str, user: str, schema: dict) -> dict:
    """Offline narrator (``GAME_COMMENTARY_MODEL=llm:fake`` in test mode):
    the start of the first moment of the prompt, so its line is made of
    prompt facts and is different for every batch."""
    first = re.search(r"^- Turn (\d+): (.*)$", user, re.MULTILINE)
    if first is None:
        return {"line": "Fake commentary: nothing to report."}
    # whole words (no amount is cut), and few enough that two lines never
    # share ``REPEAT_WORDS`` words in a row
    head = " ".join(first.group(2).split()[: REPEAT_WORDS - 1])
    return {"line": f"Fake commentary, turn {first.group(1)}: {head}"}
