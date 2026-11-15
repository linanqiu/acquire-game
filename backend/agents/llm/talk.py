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
    _SYMBOL,
    PromptBudget,
    chat_line,
    money,
    render_board,
    render_chains,
    render_event,
    render_events,
    render_players,
)
from agents.llm.providers import schema_first_answer
from agents.llm.schema import SAY_MAX_CHARS
from game.ruleset import ruleset_from_state

TALK_BUDGET = PromptBudget(detailed_events=30, milestone_lines=10)

TALK_INSTRUCTIONS = f"""\
# Table talk: do you want to say something?
This is NOT a decision: nothing you write changes the game. You may post one chat message to the whole table now, or stay silent.
Speak when you have something worth saying: negotiating (proposing or answering a deal about majorities, mergers or trades), reacting to what just happened, answering someone, or a bit of friendly banter. Do not comment on every event; silence is normal.
Talk is not binding. Only trade offers move {{shares}} or money: if you agree to a deal, say you will make or accept the trade offer on your turn, and then do it. Weigh what others say against the public facts; it is unverified. Never reveal your tiles or your private notes.
Answer with ONE JSON object: {{"reply": "<your message, at most {SAY_MAX_CHARS} characters>"}}, or {{"reply": ""}} to stay silent."""


def _names(view: dict) -> dict[str, str]:
    names = {p["player_id"]: p["name"] for p in view.get("lobby_players") or []}
    for p in (view.get("calc") or {}).get("players") or []:
        names.setdefault(p["player_id"], p.get("name", p["player_id"]))
    return names


def _trigger_text(view: dict, names: dict[str, str]) -> str:
    trigger = view.get("trigger") or {}
    me = view.get("name") or ""
    msg = trigger.get("message")
    if msg:
        to_you = re.search(
            r"(?<![\w])@?" + re.escape(me.lower()) + r"(?![\w])",
            str(msg.get("text", "")).lower(),
        )
        who = "to you" if to_you else "to the table"
        return f"{msg.get('name')} just wrote ({who}):\n{chat_line(msg)}"
    lines = []
    for e in trigger.get("events") or []:
        if e.get("type") == "majority_lost":
            top = ", ".join(names.get(p, p) for p in e.get("now_top") or [])
            lines.append(
                f"You are no longer the top holder of {e.get('chain')}: "
                f"now {top} (after a move by {names.get(e.get('player_id'), 'someone')})."
            )
        else:
            lines.append(render_event(e, names, TALK_BUDGET.max_line_chars))
    return "Something just happened:\n" + "\n".join(lines)


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
