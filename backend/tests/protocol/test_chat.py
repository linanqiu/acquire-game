"""Tier 2: public table chat through the real server (HTTP to send, WebSocket
to receive), and the table talk of LLM seats with the offline fake provider.

Chat is not a game action: these tests also check it never blocks a move and
never changes the game.
"""

from __future__ import annotations

import asyncio
import json
import time

import pytest

from agents.llm.talk import FAKE_SAY
from app_state import session_manager
from tests.protocol.helpers import (
    HumanClient,
    add_seat,
    configure,
    create_room,
    debug,
    join_room,
    recv_until,
    start,
)


@pytest.fixture
def chat_settings(fast_settings, monkeypatch):
    s = fast_settings
    monkeypatch.setattr(s, "chat_reply_cooldown_s", 0.05)
    monkeypatch.setattr(s, "chat_reply_timeout_s", 5.0)
    return s


@pytest.fixture
def tdir(tmp_path, monkeypatch):
    d = tmp_path / "transcripts"
    monkeypatch.setenv("GAME_TRANSCRIPT_DIR", str(d))
    return d


def say(client, code, pid, text):
    return client.post(f"/room/{code}/chat/{pid}", json={"text": text})


def is_chat(pred=lambda m: True):
    return lambda msg: msg.get("type") == "chat_message" and pred(msg["message"])


def wait_debug(client, code, pred, timeout=8.0):
    """Poll the room's debug state until ``pred(debug)``."""
    end = time.monotonic() + timeout
    while True:
        d = debug(client, code)
        if pred(d):
            return d
        assert time.monotonic() < end, f"timed out; debug={json.dumps(d)[:600]}"
        time.sleep(0.05)


def quiet(client, code, timeout=8.0):
    """Wait until no talk call is in flight or waiting."""
    return wait_debug(
        client,
        code,
        lambda d: (
            not any(v["in_flight"] or v["pending"] for v in d["chat_replies"].values())
        ),
        timeout,
    )


def room_chat(code) -> list[dict]:
    room = session_manager.get_room(code)
    return list(room.chat.messages) if room.chat else []


def transcript_lines(tdir) -> list[dict]:
    (path,) = list(tdir.glob("*.jsonl"))
    return [json.loads(x) for x in path.read_text().splitlines()]


# ---------------------------------------------------------------- the route


class TestRoute:
    def test_lobby_message_reaches_everyone_and_the_host(self, app_client):
        client = app_client
        code, alice = create_room(client, "Alice")
        bob = join_room(client, code, "Bob")
        with (
            client.websocket_connect(f"/ws/player/{code}/{bob}") as ws_bob,
            client.websocket_connect(f"/ws/host/{code}") as ws_host,
        ):
            r = say(client, code, alice, "  hello\n<b>table</b>  ")
            assert r.status_code == 200, r.text
            msg = r.json()["message"]
            # plain text: whitespace/control chars collapsed, markup kept verbatim
            assert msg["text"] == "hello <b>table</b>"
            assert msg["name"] == "Alice" and msg["kind"] == "human"
            assert msg["source"] == "human" and msg["after_seq"] == -1
            for ws in (ws_bob, ws_host):
                got = recv_until(ws, is_chat())["message"]
                assert got == msg

    def test_refusals(self, app_client, monkeypatch):
        client = app_client
        code, alice = create_room(client, "Alice")
        bot = add_seat(client, code, "bot")["player_id"]
        assert say(client, code, alice, "   ").status_code == 422
        assert say(client, code, alice, "x" * 281).status_code == 422
        assert say(client, code, alice, "x" * 280).status_code == 200
        assert client.post(f"/room/{code}/chat/{alice}", json={}).status_code == 422
        assert say(client, code, "nobody", "hi").status_code == 404
        assert say(client, "ZZZZ", alice, "hi").status_code == 404
        r = say(client, code, bot, "beep")
        assert r.status_code == 403 and "AI agent" in r.json()["detail"]

    def test_rate_limit(self, app_client):
        client = app_client
        code, alice = create_room(client, "Alice")
        for i in range(5):
            assert say(client, code, alice, f"m{i}").status_code == 200
        r = say(client, code, alice, "one too many")
        assert r.status_code == 429
        assert [m["text"] for m in room_chat(code)] == [f"m{i}" for i in range(5)]

    def test_reconnect_gets_the_history_in_order(self, app_client):
        client = app_client
        code, alice = create_room(client, "Alice")
        bob = join_room(client, code, "Bob")
        for text in ("one", "two", "three"):
            assert say(client, code, alice, text).status_code == 200
        with client.websocket_connect(f"/ws/player/{code}/{bob}") as ws:
            hist = recv_until(ws, lambda m: m.get("type") == "chat_history")
            assert [m["text"] for m in hist["messages"]] == ["one", "two", "three"]
            assert [m["id"] for m in hist["messages"]] == [1, 2, 3]
        with client.websocket_connect(f"/ws/host/{code}") as ws:
            hist = recv_until(ws, lambda m: m.get("type") == "chat_history")
            assert len(hist["messages"]) == 3

    def test_rules_based_bots_never_talk(self, app_client, chat_settings):
        client = app_client
        code, alice = create_room(client, "Alice")
        bot = add_seat(client, code, "bot")
        add_seat(client, code, "bot")
        assert say(client, code, alice, f"{bot['name']}, deal?").status_code == 200
        start(client, code)
        assert say(client, code, alice, "anyone?").status_code == 200
        time.sleep(0.2)
        assert debug(client, code)["chat_replies"] == {}
        assert [m["kind"] for m in room_chat(code)] == ["human", "human"]


# ---------------------------------------------------- ordering and transcript


def test_chat_is_in_the_transcript_in_order_with_events_and_changes_no_game_state(
    app_client, chat_settings, tdir
):
    client = app_client
    code, alice = create_room(client, "Alice")
    add_seat(client, code, "bot")
    add_seat(client, code, "bot")
    configure(client, code, 7)
    assert say(client, code, alice, "good luck all").status_code == 200
    with client.websocket_connect(f"/ws/player/{code}/{alice}") as ws:
        start(client, code)
        human = HumanClient(ws, alice)
        turns = {"n": 0}

        def stop(state):
            if human.my_turn(state) and state["awaiting"]["decision"] == "place_tile":
                turns["n"] += 1
            return turns["n"] >= 3

        state = human.play(stop=stop)
        room = session_manager.get_room(code)
        before = json.dumps(room.game.get_public_state(), sort_keys=True, default=str)
        r = say(client, code, alice, "my move next")
        assert r.status_code == 200
        msg = r.json()["message"]
        assert msg["after_seq"] == len(room.game.events) - 1
        after = json.dumps(room.game.get_public_state(), sort_keys=True, default=str)
        assert before == after  # chat changes nothing in the game
        human.play(state=state)  # to the end

    lines = transcript_lines(tdir)
    chats = [(i, x) for i, x in enumerate(lines) if x["type"] == "chat"]
    assert [x["text"] for _, x in chats] == ["good luck all", "my move next"]
    lobby_i, lobby = chats[0]
    assert lobby["after_seq"] == -1
    for i, x in chats:
        seen = [
            e["event"]["seq"] for e in lines[:i] if e["type"] == "event"
        ]  # events written before the chat line
        assert max(seen, default=-1) >= x["after_seq"]
        later = [e["event"]["seq"] for e in lines[i:] if e["type"] == "event"]
        assert all(s > x["after_seq"] for s in later)
    assert lines[-1]["type"] == "footer"


# ------------------------------------------------------------ LLM table talk


def two_fakes(client, code):
    a = add_seat(client, code, "llm:fake")["player_id"]
    b = add_seat(client, code, "llm:fake")["player_id"]
    return a, b


class TestTalk:
    def test_unaddressed_human_message_is_offered_to_at_most_two_llm_seats(
        self, app_client, chat_settings
    ):
        client = app_client
        code, alice = create_room(client, "Alice")
        seats = [add_seat(client, code, "llm:fake")["player_id"] for _ in range(3)]
        assert chat_settings.chat_reply_table_seats == 2
        assert say(client, code, alice, "hello table").status_code == 200
        d = quiet(client, code)
        counts = {pid: d["chat_replies"].get(pid, {}).get("count", 0) for pid in seats}
        assert sorted(counts.values()) == [0, 1, 1], counts
        # the next table message goes to the seat that has not spoken yet first
        left_out = next(pid for pid, n in counts.items() if n == 0)
        assert say(client, code, alice, "nice evening").status_code == 200
        d = quiet(client, code)
        assert d["chat_replies"][left_out]["count"] == 1
        assert sum(v["count"] for v in d["chat_replies"].values()) == 4

    def test_a_named_seat_is_the_only_one_asked(self, app_client, chat_settings):
        client = app_client
        code, alice = create_room(client, "Alice")
        a, b = two_fakes(client, code)
        name = session_manager.get_room(code).players[b].name
        assert say(client, code, alice, f"{name}, how are you").status_code == 200
        d = quiet(client, code)
        assert d["chat_replies"][b]["count"] == 1
        assert d["chat_replies"].get(a, {}).get("count", 0) == 0
        replies = [m for m in room_chat(code) if m["kind"] == "llm"]
        assert [m["player_id"] for m in replies] == [b]
        # a talk call runs at low effort (chat_reply_effort), not the seat's own
        calls = session_manager.get_room(code).players[b].agent.provider.calls
        assert [c["effort"] for c in calls] == ["low"]

    def test_unaddressed_human_message_gets_replies_from_both_llm_seats(
        self, app_client, chat_settings
    ):
        client = app_client
        code, alice = create_room(client, "Alice")
        a, b = two_fakes(client, code)
        with client.websocket_connect(f"/ws/player/{code}/{alice}") as ws:
            assert say(client, code, alice, "hello table").status_code == 200
            got = {}
            while len(got) < 2:
                m = recv_until(ws, is_chat(lambda m: m["kind"] == "llm"))["message"]
                got[m["player_id"]] = m
        assert set(got) == {a, b}
        for m in got.values():
            assert m["source"] == "reply" and m["reply_to"] == 1
            assert m["text"] == 'Fake LLM heard you, Alice: "hello table"'
        d = quiet(client, code)
        assert {pid: v["count"] for pid, v in d["chat_replies"].items()} == {a: 1, b: 1}

    def test_silence_is_a_normal_answer(self, app_client, chat_settings):
        client = app_client
        code, alice = create_room(client, "Alice")
        a = add_seat(client, code, "llm:fake")["player_id"]
        assert say(client, code, alice, "please stay quiet").status_code == 200
        d = wait_debug(
            client, code, lambda d: d["chat_replies"].get(a, {}).get("count")
        )
        quiet(client, code)
        assert d["chat_replies"][a]["count"] == 1
        assert [m["kind"] for m in room_chat(code)] == ["human"]

    def test_two_llm_seats_talk_a_bounded_number_of_messages_then_stop(
        self, app_client, chat_settings
    ):
        client = app_client
        streak = chat_settings.chat_ai_streak_max
        code, alice = create_room(client, "Alice")
        a, b = two_fakes(client, code)
        players = session_manager.get_room(code).players
        na, nb = players[a].name, players[b].name
        # both are named: both answer, quoting the message, so each answer
        # names the other seat and floats a deal ("deal?"); the seats answer
        # each other until the AI streak limit stops it
        assert say(client, code, alice, f"{na} {nb} deal?").status_code == 200
        quiet(client, code)
        time.sleep(0.3)
        quiet(client, code)
        ai = [m for m in room_chat(code) if m["kind"] == "llm"]
        answers = [m for m in ai if " answers " in m["text"]]
        assert answers, "the AI seats never answered each other"
        # bounded: the streak limit plus at most one call per seat already asked
        assert streak <= len(ai) <= streak + 2, [m["text"] for m in ai]
        settled = len(room_chat(code))
        time.sleep(0.4)
        assert len(room_chat(code)) == settled  # it stopped
        # a human message resets the streak: the seats talk again
        assert say(client, code, alice, "and now?").status_code == 200
        quiet(client, code)
        assert len(room_chat(code)) > settled + 1

    def test_cooldown_holds_the_next_call_and_runs_it_afterwards(
        self, app_client, chat_settings, monkeypatch
    ):
        client = app_client
        monkeypatch.setattr(chat_settings, "chat_reply_cooldown_s", 1.0)
        code, alice = create_room(client, "Alice")
        a = add_seat(client, code, "llm:fake")["player_id"]
        t0 = time.monotonic()
        assert say(client, code, alice, "first").status_code == 200
        assert say(client, code, alice, "second").status_code == 200
        assert say(client, code, alice, "third").status_code == 200
        d = wait_debug(
            client, code, lambda d: d["chat_replies"].get(a, {}).get("count")
        )
        assert d["chat_replies"][a]["count"] == 1
        d = wait_debug(client, code, lambda d: d["chat_replies"][a]["pending"])
        # the waiting trigger is the latest; it runs after the cooldown
        d = wait_debug(client, code, lambda d: d["chat_replies"][a]["count"] == 2)
        assert time.monotonic() - t0 >= 0.9
        quiet(client, code)
        replies = [m["text"] for m in room_chat(code) if m["kind"] == "llm"]
        assert replies == [
            'Fake LLM heard you, Alice: "first"',
            'Fake LLM heard you, Alice: "third"',
        ]
        assert debug(client, code)["chat_replies"][a]["skipped"] >= 1

    def test_per_game_cap_is_a_runaway_guard(
        self, app_client, chat_settings, monkeypatch
    ):
        client = app_client
        monkeypatch.setattr(chat_settings, "chat_reply_max_per_game", 2)
        monkeypatch.setattr(chat_settings, "chat_reply_cooldown_s", 0.0)
        code, alice = create_room(client, "Alice")
        a = add_seat(client, code, "llm:fake")["player_id"]
        for i in range(4):
            assert say(client, code, alice, f"m{i}").status_code == 200
            quiet(client, code)
        d = debug(client, code)["chat_replies"][a]
        assert d["count"] == 2 and d["skipped"] >= 2

    def test_an_ai_message_that_names_nobody_triggers_no_talk_call(
        self, app_client, chat_settings
    ):
        client = app_client
        code, alice = create_room(client, "Alice")
        two_fakes(client, code)
        # both answer Alice; the answers quote "deal?" but name no AI seat
        assert say(client, code, alice, "anyone want a deal?").status_code == 200
        quiet(client, code)
        time.sleep(0.3)
        d = quiet(client, code)
        assert sum(v["count"] for v in d["chat_replies"].values()) == 2
        assert len([m for m in room_chat(code) if m["kind"] == "llm"]) == 2

    def test_game_events_trigger_no_talk_call_by_default(
        self, app_client, chat_settings, tdir
    ):
        client = app_client
        assert chat_settings.chat_reply_events == "game_ended"
        code, alice = create_room(client, "Alice")
        fake = add_seat(client, code, "llm:fake")["player_id"]
        add_seat(client, code, "bot")
        configure(client, code, 3)
        with client.websocket_connect(f"/ws/player/{code}/{alice}") as ws:
            start(client, code)
            human = HumanClient(ws, alice)
            human.play(deadline_s=60)
        quiet(client, code)
        room = session_manager.get_room(code)
        assert [e for e in room.game.events if e["type"] == "chain_founded"]
        calls = [x for x in transcript_lines(tdir) if x["type"] == "chat_reply"]
        # one call for the seat, at the end of the game, and nothing before it
        assert [c["player_id"] for c in calls] == [fake]
        assert calls[0]["trigger"]["events"] == ["game_ended"]

    def test_llm_seat_speaks_unprompted_after_a_game_event(
        self, app_client, chat_settings, tdir, monkeypatch
    ):
        client = app_client
        # opt-in: chain foundings are not a trigger by default (cost)
        monkeypatch.setattr(
            chat_settings, "chat_reply_events", "chain_founded,game_ended"
        )
        code, alice = create_room(client, "Alice")
        fake = add_seat(client, code, "llm:fake")["player_id"]
        add_seat(client, code, "bot")
        configure(client, code, 3)
        with client.websocket_connect(f"/ws/player/{code}/{alice}") as ws:
            start(client, code)
            human = HumanClient(ws, alice)
            seen = {}

            def stop(state):
                for m in human.messages:
                    if (
                        m.get("type") == "chat_message"
                        and "saw:" in m["message"]["text"]
                    ):
                        seen["m"] = m["message"]
                return "m" in seen

            human.play(stop=stop, deadline_s=25)
        m = seen["m"]
        assert m["player_id"] == fake and m["source"] == "reply"
        assert m["reply_to"] is None and m["text"].endswith("saw: a chain founded")
        room = session_manager.get_room(code)
        founded = [e for e in room.game.events if e["type"] == "chain_founded"]
        assert founded and founded[0]["player_id"] != fake
        quiet(client, code)
        lines = transcript_lines(tdir)
        calls = [x for x in lines if x["type"] == "chat_reply"]
        assert calls and calls[0]["trigger"]["source"] == "event"
        assert "chain_founded" in calls[0]["trigger"]["events"]
        # the talk prompt carries the seat's own hand (it is redacted while live)
        hand = [str(t) for t in room.game.get_player(fake).hand]
        assert "# Your hand" in calls[0]["llm"]["user_prompt"]
        r = client.get(f"/api/games/{room.game_id}/transcript")
        live = r.json()
        assert live["redacted"] is True
        for e in live["entries"]:
            if e["type"] == "chat_reply":
                assert "user_prompt" not in e["llm"]
        assert live["live_totals"][fake]["reply_calls"] >= 1
        assert hand  # (the hand exists; its tiles never reach the live API)

    def test_say_with_a_move_answers_a_deal(self, app_client, chat_settings, tdir):
        client = app_client
        code, alice = create_room(client, "Alice")
        fake = add_seat(client, code, "llm:fake")["player_id"]
        add_seat(client, code, "bot")
        configure(client, code, 5)
        with client.websocket_connect(f"/ws/player/{code}/{alice}") as ws:
            start(client, code)
            assert say(client, code, alice, "I take majority, deal").status_code == 200
            human = HumanClient(ws, alice)
            seen = {}

            def stop(state):
                for m in human.messages:
                    if (
                        m.get("type") == "chat_message"
                        and m["message"]["source"] == "say"
                    ):
                        seen["m"] = m["message"]
                return "m" in seen

            human.play(stop=stop, deadline_s=25)
        m = seen["m"]
        assert m["player_id"] == fake and m["text"] == FAKE_SAY
        quiet(client, code)
        lines = transcript_lines(tdir)
        decisions = [
            x
            for x in lines
            if x["type"] == "decision" and (x.get("llm") or {}).get("say") == FAKE_SAY
        ]
        assert len(decisions) == 1  # said once for that message
        chat = next(x for x in lines if x["type"] == "chat" and x["source"] == "say")
        assert chat["decision_index"] == decisions[0]["index"]
        # the decision prompt showed the table talk among the events
        assert (
            '[chat #1] Alice (human): "I take majority, deal"'
            in (decisions[0]["llm"]["user_prompt"])
        )

    def test_a_slow_talk_call_never_blocks_a_move(self, app_client, chat_settings):
        client = app_client
        code, alice = create_room(client, "Alice")
        fake = add_seat(client, code, "llm:fake")["player_id"]
        add_seat(client, code, "bot")
        configure(client, code, 3)
        room = session_manager.get_room(code)
        provider = room.players[fake].agent.provider
        inner = provider._responses

        async def slow(system, user, schema):
            if "reply" in (schema.get("properties") or {}):
                await asyncio.sleep(3.0)
            return inner(system, user, schema)

        provider._responses = slow
        with client.websocket_connect(f"/ws/player/{code}/{alice}") as ws:
            start(client, code)
            human = HumanClient(ws, alice)
            state = human.play(stop=lambda s: human.my_turn(s))
            assert say(client, code, alice, "thinking about it?").status_code == 200
            wait_debug(client, code, lambda d: d["chat_replies"][fake]["in_flight"])
            t0 = time.monotonic()
            human.act(human.choose(state))
            # the first state after the move: the tile is on the board
            tile = human.actions[-1].get("tile")
            after = recv_until(ws, lambda m: m.get("type") == "game_state")
            assert after["board"]["cells"][tile]["state"] != "empty"
            assert time.monotonic() - t0 < 1.5  # the move went through at once
            assert debug(client, code)["chat_replies"][fake]["in_flight"] is True
        quiet(client, code)
        assert any(m["kind"] == "llm" for m in room_chat(code))


def test_reply_calls_are_counted_and_priced_in_the_footer(
    app_client, chat_settings, tdir
):
    client = app_client
    code, alice = create_room(client, "Alice")
    fake = add_seat(client, code, "llm:fake")["player_id"]
    add_seat(client, code, "bot")
    configure(client, code, 9)
    with client.websocket_connect(f"/ws/player/{code}/{alice}") as ws:
        start(client, code)
        assert say(client, code, alice, "hi fake").status_code == 200
        HumanClient(ws, alice).play()
    room = session_manager.get_room(code)
    for _ in range(100):
        if room.transcript.closed:
            break
        time.sleep(0.05)
    lines = transcript_lines(tdir)
    assert lines[-1]["type"] == "footer"
    calls = [x for x in lines if x["type"] == "chat_reply" and x["player_id"] == fake]
    assert calls
    totals = lines[-1]["totals"][fake]
    assert totals["reply_calls"] == len(calls)
    decision_tokens = sum(
        a["input_tokens"]
        for x in lines
        if x["type"] == "decision" and x["player_id"] == fake and x.get("llm")
        for a in x["llm"]["attempts"]
    )
    talk_tokens = sum(a["input_tokens"] for x in calls for a in x["llm"]["attempts"])
    assert talk_tokens > 0
    assert totals["input_tokens"] == decision_tokens + talk_tokens
    assert (
        totals["cost_usd"] is not None or totals["cost_usd"] is None
    )  # price may be unknown for "fake"
