"""Tier 1: table talk in LLM prompts and answers (no server).

Chat lines in the decision prompt's event timeline, the optional ``say`` of
an answer, the off-turn talk prompt, its answer, and the offline fake.
"""

from __future__ import annotations

import asyncio

import pytest

from agents.llm.agent import LLMAgent
from agents.llm.prompt import build_system_prompt, build_user_prompt, chat_line
from agents.llm.providers import FakeProvider
from agents.llm.schema import (
    REPLY_SCHEMA,
    SAY_MAX_CHARS,
    build_schema,
    parse_answer,
    parse_reply,
    parse_say,
)
from agents.llm.talk import FAKE_SAY, build_talk_prompt, fake_talk_responder
from game.calculator import build_calculator_pack
from game.decisions import public_events
from tests.llm_support import bot_game, place_ctx


@pytest.fixture(scope="module")
def game():
    return bot_game(seed=39, min_turns=30)


def msg(i, name, text, kind="human", after_seq=-1, pid=None):
    return {
        "id": i,
        "player_id": pid or name.lower(),
        "name": name,
        "kind": kind,
        "source": "human" if kind == "human" else "reply",
        "text": text,
        "after_seq": after_seq,
        "reply_to": None,
    }


def test_system_prompt_explains_table_talk_and_say():
    s = build_system_prompt()
    assert "# Table talk" in s and '"say"' in s
    assert "never binding" in s and "Only a trade offer moves" in s


def test_decision_prompt_interleaves_chat_with_events_by_after_seq(game):
    events = public_events(game, "p1")
    ctx = place_ctx(game, events=events)
    last, prev = events[-1]["seq"], events[-2]["seq"]
    ctx.chat = [
        msg(
            1,
            "Bob",
            "I take majority in the cheap one, you take the other",
            after_seq=-1,
        ),
        msg(2, "Cara", "deal?", after_seq=prev),
    ]
    p = build_user_prompt(ctx, [])
    assert "unverified and not binding" in p
    a, b = chat_line(ctx.chat[0]), chat_line(ctx.chat[1])
    assert a in p and b in p
    # chat #2 sits right after the event it followed, before the last event
    lines = p.splitlines()
    i = lines.index(b)
    assert lines[i - 1].startswith(f"[{prev}] ")
    assert lines[i + 1].startswith(f"[{last}] ")
    assert lines.index(a) < i


def test_decision_prompt_without_chat_is_unchanged(game):
    ctx = place_ctx(game)
    p = build_user_prompt(ctx, [])
    assert "[chat #" not in p and "unverified" not in p


def test_answer_schema_has_say_and_it_is_parsed():
    legal = {"action_types": ["end_turn"]}
    s = build_schema(legal)
    assert s["properties"]["say"] == {"type": "string"}
    data = {
        "why": "w",
        "action": {"action": "end_turn"},
        "note": "",
        "say": "  hi  all ",
    }
    assert parse_answer(data)[0] == {"action": "end_turn"}
    assert parse_say(data) == "hi all"
    assert parse_say({"say": "x" * 500}) == "x" * SAY_MAX_CHARS
    assert parse_say({"say": None}) == "" and parse_say("nope") == ""
    # a bare action object with a say is still parsed as the action
    bare = {"action": "end_turn", "say": "gg"}
    assert parse_answer(bare)[0] == {"action": "end_turn"}


def test_reply_answer_silence_and_text():
    assert REPLY_SCHEMA["required"] == ["reply"]
    assert parse_reply({"reply": ""}) is None
    assert parse_reply({"reply": None}) is None
    assert parse_reply({}) is None
    assert parse_reply({"reply": " ok,  deal "}) == "ok, deal"


def talk_view(game, pid="p1", trigger=None, chat=None):
    names = {p.player_id: p.name for p in game.players}
    return {
        "player_id": pid,
        "name": names[pid],
        "trigger": trigger
        or {
            "source": "human",
            "message": msg(9, "Bob", "Alice, sell me 2?"),
            "events": [],
        },
        "chat": chat or [],
        "lobby_players": [
            {"player_id": p.player_id, "name": p.name, "kind": "human"}
            for p in game.players
        ],
        "kinds": {},
        "state": game.get_player_state(pid),
        "events": public_events(game, pid),
        "calc": build_calculator_pack(game, pid),
    }


def test_talk_prompt_has_hand_standings_events_chat_and_the_trigger(game):
    view = talk_view(game, chat=[msg(8, "Cara", "hello", after_seq=-1)])
    p = build_talk_prompt(view, ["plan: marlowe majority"])
    for tile in view["state"]["hand"]:
        assert tile in p
    assert "# Players (calculator)" in p and "# Chains (calculator)" in p
    assert "# Recent public events (with table talk)" in p
    assert chat_line(view["chat"][0]) in p
    assert "plan: marlowe majority" in p
    assert "Bob just wrote (to you)" in p  # names Alice (p1)
    assert "This is NOT a decision" in p and '{"reply": ""}' in p


def test_talk_prompt_for_events_and_lost_majority(game):
    ev = {"seq": 99, "type": "chain_founded", "player_id": "p2", "chain": "Marlowe"}
    lost = {
        "type": "majority_lost",
        "chain": "Marlowe",
        "player_id": "p2",
        "now_top": ["p2"],
    }
    view = talk_view(
        game, trigger={"source": "event", "message": None, "events": [ev, lost]}
    )
    p = build_talk_prompt(view)
    assert "Something just happened:" in p
    assert "chain founded" in p
    assert "You are no longer the top holder of Marlowe: now Bob" in p


def test_talk_prompt_in_the_lobby():
    view = {
        "player_id": "llm_1",
        "name": "Fake LLM (test)",
        "trigger": {
            "source": "human",
            "message": msg(1, "Alice", "hi all"),
            "events": [],
        },
        "chat": [msg(1, "Alice", "hi all")],
        "lobby_players": [
            {"player_id": "a", "name": "Alice", "kind": "human"},
            {"player_id": "llm_1", "name": "Fake LLM (test)", "kind": "llm"},
        ],
        "kinds": {"a": "human", "llm_1": "llm"},
    }
    p = build_talk_prompt(view)
    assert "lobby" in p and "- Alice (human)" in p
    assert "Alice just wrote (to the table)" in p


def test_agent_reply_records_the_call_and_never_touches_decisions(game):
    provider = FakeProvider([{"reply": "Fine by me."}])
    agent = LLMAgent(provider, name="Alice", table_talk=True)
    text, rec = asyncio.run(agent.reply(talk_view(game), max_tokens=300, timeout=5))
    assert text == "Fine by me."
    call = provider.calls[0]
    assert call["schema"] == REPLY_SCHEMA and call["max_tokens"] == 300
    assert call["effort"] is None  # the seat's normal effort
    assert call["system"] == build_system_prompt()  # same prompt as decisions (cached)
    (a,) = rec["attempts"]
    assert a["raw"] and a["input_tokens"] > 0 and a["error"] is None
    assert rec["user_prompt"] == call["user"]
    assert agent.last_decision_record() is None


def test_agent_reply_silence():
    agent = LLMAgent(FakeProvider([{"reply": ""}]), table_talk=True)
    view = {"player_id": "x", "name": "X", "trigger": {"message": msg(1, "A", "hi")}}
    text, rec = asyncio.run(agent.reply(view))
    assert text is None and rec["attempts"][0]["raw"]


def test_agents_built_directly_do_not_take_part_in_table_talk():
    assert LLMAgent(FakeProvider()).table_talk is False


def test_fake_responder_is_deterministic():
    r = fake_talk_responder()
    talk = "# Your seat\nYou are Fake LLM (test) (player id x).\n\n# Why you are asked now\n"
    human = talk + 'Alice just wrote (to the table):\n[chat #3] Alice (human): "hi"\n'
    assert r("", human, REPLY_SCHEMA) == {"reply": 'Fake LLM heard you, Alice: "hi"'}
    hush = human.replace('"hi"', '"be quiet"')
    assert r("", hush, REPLY_SCHEMA) == {"reply": ""}
    ai = talk + 'Bob just wrote (to you):\n[chat #4] Bob (llm): "deal?"\n'
    assert r("", ai, REPLY_SCHEMA) == {"reply": "Fake LLM (test) answers Bob: deal?"}
    ev = talk + "Something just happened:\n[3] Bob chain founded: chain=X\n"
    assert r("", ev, REPLY_SCHEMA) == {"reply": "Fake LLM (test) saw: a chain founded"}
    other = talk + "Something just happened:\n[3] Bob trade accepted\n"
    assert r("", other, REPLY_SCHEMA) == {"reply": ""}
    # a founding earlier in the event history is not what triggered this call
    history = "[1] Bob chain founded: chain=X\n" + other
    assert r("", history, REPLY_SCHEMA) == {"reply": ""}
    # decisions: say only once per human message containing "deal"
    schema = build_schema({"action_types": ["end_turn"]})
    prompt = '[chat #5] Alice (human): "big deal"'
    first = r("", prompt, schema)
    assert first["action"] == {"action": "end_turn"} and first["say"] == FAKE_SAY
    assert r("", prompt, schema)["say"] == ""
    assert r("", "no chat", schema)["say"] == ""
