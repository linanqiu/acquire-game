"""Table talk for LLM seats: the off-turn "do you want to say something?"
prompt and the offline fake.

A talk call uses the seat's normal system prompt (identical to its decision
calls, so the provider's prompt cache applies) and a user prompt with the same
context a decision gets -- own hand and holdings, public standings, chains
with majorities and bonuses, recent events with the chat interleaved, the
seat's private notes -- followed by what triggered the call (a chat message
or game events). The answer is ``{"reply": "<text>"}``; "" (or null) means
the seat stays silent, which is normal. Nothing said is binding.
"""

from __future__ import annotations

import re
from typing import Any

from agents.llm.prompt import (
    _STANDING,
    _SYMBOL,
    PromptBudget,
    _signed,
    _stock_text,
    chat_line,
    compact_event,
    money,
    render_board,
    render_chains,
    render_event,
    render_events,
    render_players,
    table_voice,
)
from agents.llm.providers import schema_first_answer
from agents.llm.schema import SAY_MAX_CHARS
from game.ruleset import ruleset_from_state
from session.seat_names import short_names

TALK_BUDGET = PromptBudget(detailed_events=16, milestone_lines=6)

TALK_INSTRUCTIONS = f"""\
# Table talk: do you want to say something?
This is NOT a decision: nothing you write changes the game. You may post one chat message to the whole table now, or stay silent.
Talk the way a real person does at a board game night: plain, short, natural. Your table voice (above) is a temperament, not a character to perform.
- A person wrote to you or asked you something: always answer them, directly and briefly.
- A person wrote to the table: reply only if you have something to add.
- Another AI player wrote: reply only if they addressed you or offered you a deal, and do not keep an exchange going; one reply is enough.
- Something happened in the game: say something only if it really matters to you (your chain was bought out, you lost a majority, a deal fell through). Usually stay silent.
- Deals: say plainly what you would trade, with whom, and what each side gives. A person who proposes a deal to you always gets an answer: yes, no, or what you would want instead.
One short sentence, two at most. No running jokes, no extended metaphors or themed wordplay, no catchphrases, no boasting in every message, and never repeat a point you or someone else already made. Do not address several players in one message. Silence is normal for table messages and game events, not for a person talking to you.
Speak in the first person ("I", "my"). Never call yourself by your name and never talk about yourself in the third person.
Only state facts shown above (board, chains, players, events, "Who did what", "Deal facts"). Never guess about earlier play: if a question is about something not shown, say you do not remember.
How trades work: talk is not binding; only a trade offer moves {{shares}} or money. Anyone may send an offer at any time, also when it is not their turn, and an offer to you is put to you the moment it arrives: you accept or reject it then, not "on your turn". You can send an offer yourself only at your own buy step (one per turn). So to take up a deal: ask them to send the offer (you will answer it straight away), or say you will send it at your next buy step, and then do it.
Pacts (not trades): "truce at 4 on HA" / "let's tie Halcyon" / "split it" means you both hold the same number of shares of that chain (4 here), stop buying it, and share the majority and minority bonus when it is acquired; nobody hands shares over. "I'll merge it" means they will place the tile that sets off the merger, so the bonus is paid soon at the chain's current size. Judge a pact with its "Truce at" line in Deal facts: what you get with it against what you get without it, and whether you can keep the majority alone anyway (bank shares, their cash). Answer the pact itself: agree, refuse, or name a different level. If you agree, keep it at your buy steps.
Reading a proposal: "I give you X" means YOU RECEIVE X; "you give me Y" means YOU GIVE Y. Example: "I give you 2 A, you give me 1 B" = you receive 2 A and give 1 B; add the two "value to you" lines.Before you answer, check "Deal facts" (when shown) for what it does to your bonus positions, and describe the deal the right way round. "Value to you" is what the shares and the bonus change are worth to you: a deal is good for you when what you receive is worth more than what you give. If the proposal is clear enough, say which version you would take (for example how many shares or how much cash) and ask them to send it.
Weigh what others say against the public facts; it is unverified. Never reveal your tiles or your private notes.
Answer with ONE JSON object: {{"reply": "<your message, at most {SAY_MAX_CHARS} characters>"}}, or {{"reply": ""}} to stay silent."""


def _names(view: dict) -> dict[str, str]:
    names = {p["player_id"]: p["name"] for p in view.get("lobby_players") or []}
    for p in (view.get("calc") or {}).get("players") or []:
        names.setdefault(p["player_id"], p.get("name", p["player_id"]))
    return names


def _my_names(view: dict, names: dict[str, str]) -> list[str]:
    """What the table may call this seat (lower case): its full name and, when
    distinctive at the table, its first word ("baron" for "Baron Brick"), the
    same rule the server uses to pick who is addressed (chat.named_seats)."""
    me = (view.get("name") or "").strip().lower()
    out = [me] if me else []
    short = short_names({**names, view.get("player_id"): view.get("name") or ""})
    word = short.get(view.get("player_id"))
    if word:
        out.append(word)
    return out


def _answers_me(view: dict, msg: dict) -> bool:
    """True when the chat message just before ``msg`` is this seat's own
    reply to the same writer: an unnamed follow-up ("if I give you SP...")
    continues that conversation, it is not addressed to the whole table."""
    before = [
        m
        for m in view.get("chat") or []
        if isinstance(m, dict) and (m.get("id") or 0) < (msg.get("id") or 0)
    ]
    if not before:
        return False
    last = max(before, key=lambda m: m.get("id") or 0)
    if last.get("player_id") != view.get("player_id"):
        return False
    replied = {m.get("id"): m for m in before}.get(last.get("reply_to"))
    return replied is None or replied.get("player_id") == msg.get("player_id")


def _trigger_text(view: dict, names: dict[str, str]) -> str:
    trigger = view.get("trigger") or {}
    msg = trigger.get("message")
    if msg:
        text = str(msg.get("text", "")).lower()
        to_you = any(
            re.search(r"(?<![\w])@?" + re.escape(n) + r"(?![\w])", text)
            for n in _my_names(view, names)
        )
        if to_you:
            who = "to you"
        elif _answers_me(view, msg):
            who = "to you, after your last message"
        else:
            who = "to the table"
        return f"{msg.get('name')} just wrote ({who}):\n{chat_line(msg)}"
    lines = []
    for e in trigger.get("events") or []:
        if e.get("type") == "majority_lost":
            top = ", ".join(names.get(p, p) for p in e.get("now_top") or [])
            lines.append(
                f"You are no longer the top holder of {e.get('chain')}: "
                f"now {top} (after a move by {names.get(e.get('player_id'), 'someone')})."
            )
        elif str(e.get("type", "")).startswith("trade_"):
            # who gives what, not the generic dict (cut off before the money)
            lines.append(compact_event(e, names, TALK_BUDGET.max_line_chars) or "")
        else:
            lines.append(render_event(e, names, TALK_BUDGET.max_line_chars))
    return "Something just happened:\n" + "\n".join(lines)


def render_history(
    events: list[Any], calc: dict, names: dict[str, str], me: str | None
) -> str:
    """Per player, from the whole event log: chains founded, mergers set
    off, trades done, and current bonus positions (calculator). Questions
    like "how many chains have you formed" are answered from this, not from
    the truncated event list."""
    founded: dict[str, list[str]] = {}
    mergers: dict[str, int] = {}
    trades: dict[str, int] = {}
    for e in events or []:
        if not isinstance(e, dict):
            continue
        who, typ = e.get("player_id"), e.get("type")
        if typ == "chain_founded":
            founded.setdefault(who, []).append(str(e.get("chain")))
        elif typ == "merger_started":
            mergers[who] = mergers.get(who, 0) + 1
        elif typ == "trade_accepted":
            t = e.get("trade") or {}
            for pid in (t.get("from_player_id"), t.get("to_player_id")):
                trades[pid] = trades.get(pid, 0) + 1
    major: dict[str, list[str]] = {}
    minor: dict[str, list[str]] = {}
    for chain, c in (calc.get("chains") or {}).items():
        if not c.get("active"):
            continue
        for pid in c.get("majority_receivers") or []:
            major.setdefault(pid, []).append(chain)
        for pid in c.get("minority_receivers") or []:
            minor.setdefault(pid, []).append(chain)
    lines = []
    for p in calc.get("players") or []:
        pid = p["player_id"]
        f = founded.get(pid, [])
        bits = [
            f"founded {len(f)} chain{'' if len(f) == 1 else 's'}"
            + (f" ({', '.join(f)})" if f else ""),
            f"set off {mergers.get(pid, 0)} merger"
            + ("" if mergers.get(pid, 0) == 1 else "s"),
        ]
        if trades.get(pid):
            bits.append(f"{trades[pid]} trade(s) done")
        bits.append(f"majority now in: {', '.join(major.get(pid, [])) or 'none'}")
        bits.append(f"minority now in: {', '.join(minor.get(pid, [])) or 'none'}")
        who = names.get(pid, pid) + (" (YOU)" if pid == me else "")
        lines.append(f"- {who}: " + "; ".join(bits))
    return "\n".join(lines) or "(nothing yet)"


def _move_line(m: dict, chain: str, head: str, names: dict[str, str]) -> str:
    """One hypothetical move: "Linan gives you 2 sandpiper: you 12, top
    rival lilJohnSummNothing 11; you sole minority -> sole majority, your
    bonus +$1,500"."""
    a, b = (_STANDING.get(x, x) for x in m["me"])
    rid, rn = m.get("top_rival") or (None, 0)
    rival = f", top rival {names.get(rid, rid)} {rn}" if rid else ""
    pos = f"you stay {a}" if a == b else f"you go {a} -> {b}"
    return (
        f"    {head} {m['n']} {chain}: you {m.get('my_shares')}{rival}; {pos}, "
        f"your bonus {_signed(m['my_bonus'])}; value to you {_signed(m['value'])}"
    )


def _no_change(m: dict) -> bool:
    return (
        m["me"][0] == m["me"][1]
        and m["other"][0] == m["other"][1]
        and not m["my_bonus"]
    )


def _other_change(m: dict, other: str) -> str:
    a, b = (_STANDING.get(x, x) for x in m["other"])
    return "" if a == b else f" ({other}: {a} -> {b})"


def _sides(t: dict, me: Any, names: dict[str, str]) -> tuple[str, str]:
    """(what ``me`` gives, what ``me`` gets) in a trade dict."""
    offered = _stock_text(t.get("offering_stocks"), t.get("offering_money"), names)
    asked = _stock_text(t.get("requesting_stocks"), t.get("requesting_money"), names)
    return (asked, offered) if t.get("to_player_id") == me else (offered, asked)


def _offer_value(v: dict | None, other: str) -> str:
    if not v:
        return ""
    if not v.get("valid"):
        return f" It cannot go through now: {v.get('error')}." if v.get("error") else ""
    ranks = "; ".join(
        f"{'you' if r['player_id'] == v['viewer_id'] else other} in {r['chain']}: "
        f"{_STANDING.get(r['before'], r['before'])} -> "
        f"{_STANDING.get(r['after'], r['after'])}"
        for r in v.get("rank_changes") or []
    )
    return (
        f" Positions: {ranks or 'no change'}. Net counting bonus positions: "
        f"{_signed(v['viewer']['change'])} for you, "
        f"{_signed(v['counterparty']['change'])} for {other}."
    )


def render_deal_facts(facts: dict | None, names: dict[str, str], me: Any) -> str:
    """The "Deal facts" block (agents/llm/deal_facts.py), "" when none."""
    if not facts or not (
        facts.get("chains")
        or facts.get("offers")
        or facts.get("last_offer")
        or facts.get("pacts")
    ):
        return ""
    oid = facts.get("other_id")
    other = names.get(oid, oid)
    lines = [
        f"# Deal facts (calculator: you and {other})",
        f'If {other} says "I give you X", YOU RECEIVE X; "you give me Y" means YOU '
        "GIVE Y. Positions and bonuses are as if the chain were acquired now.",
    ]
    if facts.get("chains") and not facts.get("named"):
        lines.append(
            "No chain was named; these are the chains where 1-3 shares between "
            f"you and {other} would change a bonus position:"
        )
    for c in facts.get("chains") or []:
        chain = c["chain"]
        held = sorted(
            ((n, pid) for pid, n in (c.get("holdings") or {}).items() if n),
            key=lambda x: -x[0],
        )
        holders = ", ".join(
            f"{'you' if pid == me else names.get(pid, pid)} {n}" for n, pid in held
        )
        lines.append(f"- {chain} now: {holders or 'nobody'}; {c.get('bank')} in bank.")
        for way, head in (
            ("receive", f"{other} gives you"),
            ("give", f"you give {other}"),
        ):
            moves = c.get(way) or []
            if not moves:
                who = f"{other} holds" if way == "receive" else "you hold"
                lines.append(f"    {head} {chain}: not possible ({who} none)")
            quiet = [m for m in moves if _no_change(m)]
            if quiet:  # one line for the moves that change nothing
                st = _STANDING.get(quiet[0]["me"][0], quiet[0]["me"][0])
                ns = [m["n"] for m in quiet]
                n_txt = str(ns[0]) if len(ns) == 1 else f"{ns[0]}-{ns[-1]}"
                vals = [_signed(m["value"]) for m in quiet]
                v_txt = vals[0] if len(vals) == 1 else f"{vals[0]} to {vals[-1]}"
                lines.append(
                    f"    {head} {n_txt} {chain}: no position changes "
                    f"(you stay {st}, your bonus +{money(0)}); value to you {v_txt}"
                )
            for m in moves:
                if not _no_change(m):
                    lines.append(
                        _move_line(m, chain, head, names) + _other_change(m, other)
                    )
    for pa in facts.get("pacts") or []:
        lines.append(_pact_line(pa, me, oid, other, names))
    last = facts.get("last_offer")
    if last:
        t = last.get("trade") or {}
        give, get = _sides(t, me, names)
        frm = "you" if t.get("from_player_id") == me else other
        outcome = {
            "trade_accepted": "accepted, done",
            "trade_rejected": "rejected",
            "trade_cancelled": "cancelled",
        }.get(last.get("outcome"), last.get("outcome"))
        lines.append(
            f"- Last offer between you (from {frm}, {outcome}): you GIVE {give}, "
            f"you GET {get}." + _offer_value(last.get("valuation"), other)
        )
    for o in facts.get("offers") or []:
        t = o.get("trade") or {}
        give, get = _sides(t, me, names)
        head = (
            f"- Open offer from {other} to you"
            if t.get("to_player_id") == me
            else f"- Your open offer to {other}"
        )
        lines.append(
            f"{head}: you GIVE {give}, you GET {get}."
            + _offer_value(o.get("valuation"), other)
        )
    return "\n".join(lines)


def _pact_line(pa: dict, me: Any, oid: Any, other: str, names: dict[str, str]) -> str:
    """One "truce" line of the Deal facts block."""
    chain, n = pa["chain"], pa["level"]
    need = pa.get("need") or {}
    over = pa.get("over") or {}

    def steps(pid, who: str, verb: str) -> str:
        k = need.get(pid, 0)
        if over.get(pid):
            return f"{who} already {verb} more than {n}"
        if not k:
            return f"{who} {verb} {n} already"
        return f"{who} {'need' if who == 'you' else 'needs'} {k} more"

    now, pact = pa.get("now") or {}, pa.get("pact") or {}
    third = [names.get(p, p) for p in pa.get("third_above") or []]
    out = (
        f"- Truce at {n} on {chain} (you and {other} both hold {n} and stop buying "
        f"it; a tie for 1st shares majority + minority, "
        f"{money(pa.get('majority'))} + {money(pa.get('minority'))} at "
        f"{pa.get('size')} tiles): {steps(me, 'you', 'hold')}, "
        f"{steps(oid, other, 'holds')} ({pa.get('bank')} in bank at "
        f"{money(pa.get('price'))}). If {chain} were acquired now: you "
        f"{money(pact.get(me, 0))} (without the truce, as things stand: "
        f"{money(now.get(me, 0))}), {other} {money(pact.get(oid, 0))} (now "
        f"{money(now.get(oid, 0))})."
    )
    if third:
        out += f" {', '.join(third)} hold(s) more than {n}: you would not tie for 1st."
    short = sum(need.values()) - int(pa.get("bank") or 0)
    if short > 0:
        out += (
            f" The bank lacks {short} of the shares needed: the level can only be "
            "reached by a trade between players, and nobody can buy more from the bank."
        )
    return out


def build_talk_prompt(view: dict, notes: Any = None) -> str:
    """The user prompt of a talk call (see module docstring)."""
    state = view.get("state") or {}
    rs = ruleset_from_state(state)
    token = _SYMBOL.set(rs.theme.currency_symbol)
    try:
        return _build(view, notes)
    finally:
        _SYMBOL.reset(token)


def _build(view: dict, notes: Any) -> str:
    names = _names(view)
    me, my_name = view.get("player_id"), view.get("name")
    parts = [f"# Your seat\nYou are {my_name} (player id {me})."]
    nick = _my_names(view, names)[1:]
    if nick:
        parts[0] += (
            f' Players may call you "{nick[0].capitalize()}"; that is you, so answer '
            "in the first person."
        )
    voice = f"# Your table voice\n{table_voice(me)}."
    calc = view.get("calc")
    if calc:
        state = view.get("state") or {}
        current = state.get("current_player")
        parts[0] += (
            f" Phase: {state.get('phase')}. Player to move: "
            f"{names.get(current, current)}{' (you)' if current == me else ''}."
        )
        parts.append("# Board\n" + render_board(state))
        parts.append("# Chains (calculator)\n" + render_chains(calc))
        parts.append("# Players (calculator)\n" + render_players(calc, me, current))
        hand = sorted(state.get("hand") or (calc.get("viewer") or {}).get("hand") or [])
        parts.append(
            f"# Your hand\nTiles: {', '.join(hand) or '(empty)'}. "
            f"Cash: {money((calc.get('viewer') or {}).get('cash'))}."
        )
        visible = [
            e
            for e in view.get("events") or []
            if not (isinstance(e, dict) and e.get("private_to") not in (None, me))
        ]
        parts.append(
            "# Recent public events (with table talk)\n"
            + render_events(visible, names, TALK_BUDGET, chat=view.get("chat") or [])
        )
        parts.append(
            "# Who did what this game (whole game)\n"
            + render_history(visible, calc, names, me)
        )
    else:
        kinds = view.get("kinds") or {}
        parts[0] += " The game has not started yet (lobby)."
        parts.append(
            "# Players at the table\n"
            + "\n".join(
                f"- {p['name']} ({kinds.get(p['player_id'], p.get('kind'))})"
                for p in view.get("lobby_players") or []
            )
        )
        chat = view.get("chat") or []
        if chat:
            parts.append("# Recent chat\n" + "\n".join(chat_line(m) for m in chat))
    if notes:
        parts.append(
            "# Your private notes from earlier decisions\n"
            + "\n".join(f"- {n}" for n in notes)
        )
    parts.append(voice)
    facts = render_deal_facts(view.get("deal_facts"), names, me)
    if facts:
        parts.append(facts)
    parts.append("# Why you are asked now\n" + _trigger_text(view, names))
    parts.append(TALK_INSTRUCTIONS.replace("{shares}", "shares"))
    return "\n\n".join(parts) + "\n"


# ---------------------------------------------------------------------------
# Offline fake (test mode "Fake LLM" seat)
# ---------------------------------------------------------------------------

_CHAT = re.compile(r'\[chat #(\d+)\] (.*?) \((\w+)\): "(.*)"')
_TRIGGER_MSG = re.compile(
    r'just wrote \((to you|to the table)\):\n\[chat #\d+\] (.*?) \((\w+)\): "(.*)"'
)

FAKE_SAY = "Fake LLM here: noted. Talk is cheap, I back deals with trade offers."


def fake_talk_responder() -> Any:
    """A deterministic FakeProvider responder for the test-mode "Fake LLM".

    Decisions: the first legal answer (as before); ``say`` stays "" except
    once per human chat message containing "deal" (seen in the decision
    prompt's table talk), answered with ``FAKE_SAY``.

    Talk calls:
    * human message: ``Fake LLM heard you, <name>: "<text>"``, or silence
      when it contains "quiet";
    * another AI's message: ``<my name> answers <name>: ...`` (two fakes go
      back and forth until the server's AI-streak limit stops them);
    * events: ``<my name> saw: a chain founded`` for a founded chain, silence
      for anything else.
    """
    answered: set[str] = set()

    def respond(system: str, user: str, schema: dict) -> Any:
        props = schema.get("properties") or {}
        if "reply" in props and "action" not in props:
            me = re.search(r"# Your seat\nYou are (.*?) \(player id", user)
            my_name = me.group(1) if me else "Fake LLM"
            m = _TRIGGER_MSG.search(user)
            if m is not None:
                _to, name, kind, text = m.groups()
                if kind == "human":
                    if "quiet" in text.lower():
                        return {"reply": ""}
                    return {"reply": f'Fake LLM heard you, {name}: "{text[:80]}"'}
                return {"reply": f"{my_name} answers {name}: deal?"}
            trigger = user.split("Something just happened:", 1)
            if (
                len(trigger) == 2
                and "chain founded" in trigger[1].split("# Table talk")[0]
            ):
                return {"reply": f"{my_name} saw: a chain founded"}
            return {"reply": ""}
        answer = schema_first_answer(schema)
        answer["say"] = ""
        for cid, _name, kind, text in _CHAT.findall(user):
            if kind == "human" and "deal" in text.lower() and cid not in answered:
                answered.add(cid)
                answer["say"] = FAKE_SAY
                break
        return answer

    return respond
