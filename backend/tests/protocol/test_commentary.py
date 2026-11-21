"""Tier 2: commentary through the real server (docs/ai/commentary.md).

A show ("Watch bots play") watched over the host WebSocket, with the
rules-only commentator and with a fake model: who gets lines, when the model
is called (never without a spectator, never when off), the rate limit and the
caps, the fallbacks, what the prompt may contain, the transcript and its
cost, and that a slow commentator never delays the game.
"""

from __future__ import annotations

import json
import re
import time
from types import SimpleNamespace

import pytest

import commentary
import seats
from agents.llm import commentary as words
from agents.llm.errors import ProviderError
from agents.llm.providers import FakeProvider
from app_state import session_manager
from tests.protocol.helpers import (
    HumanClient,
    add_seat,
    configure,
    create_room,
    debug,
    recv_until,
    start,
)


@pytest.fixture
def tdir(tmp_path, monkeypatch):
    d = tmp_path / "transcripts"
    monkeypatch.setenv("GAME_TRANSCRIPT_DIR", str(d))
    return d


@pytest.fixture
def fast(fast_settings, monkeypatch):
    """No gap between lines unless a test sets one."""
    monkeypatch.setattr(fast_settings, "test_mode_commentary_min_gap_s", 0.0)
    monkeypatch.setattr(fast_settings, "game_commentary_model", "")
    return fast_settings


def use_model(monkeypatch, responder=None, *, delay: float = 0.0) -> FakeProvider:
    """A fake narrator model (the provider records every call)."""
    provider = FakeProvider(responder or words.fake_commentary_responder, delay=delay)
    entry = SimpleNamespace(id="llm:test", model="fake", provider="fake")
    monkeypatch.setattr(words, "resolve_model", lambda setting=None: entry)
    monkeypatch.setattr(words, "provider_for", lambda e: provider)
    return provider


def new_show(client, seed: int = 5) -> str:
    r = client.post("/create-show")
    assert r.status_code == 200, r.text
    code = r.json()["room_code"]
    configure(client, code, seed)
    return code


def is_line(m: dict) -> bool:
    return m.get("type") == "commentary"


def is_final(m: dict) -> bool:
    return is_line(m) and "game_ended" in m["line"]["moments"]


def is_over(m: dict) -> bool:
    return m.get("type") == "game_state" and m.get("phase") == "game_over"


def watch(client, code: str, until=is_final) -> list[dict]:
    """Watch the room on the host socket until ``until``; every message."""
    log: list[dict] = []
    with client.websocket_connect(f"/ws/host/{code}") as ws:
        recv_until(ws, until, log)
    return log


def lines_of(log: list[dict]) -> list[dict]:
    return [m["line"] for m in log if is_line(m)]


def wait_debug(client, code, pred, timeout=10.0):
    end = time.monotonic() + timeout
    while True:
        d = debug(client, code)
        if pred(d):
            return d
        assert time.monotonic() < end, f"timed out; debug={json.dumps(d)[:600]}"
        time.sleep(0.05)


def transcript(tdir, game_id: str) -> list[dict]:
    return [json.loads(x) for x in (tdir / f"{game_id}.jsonl").read_text().splitlines()]


# ------------------------------------------------------------------ the show


def test_show_starts_with_its_first_spectator_and_is_narrated(app_client, fast, tdir):
    client = app_client
    code = new_show(client)
    state = client.get(f"/room/{code}/state").json()
    assert state["started"] is False  # nothing is played for an empty room
    assert [p["kind"] for p in state["players"]] == ["bot"] * 4
    assert debug(client, code)["commentary"] == {"enabled": True}

    log = watch(client, code)
    first = next(m for m in log if m["type"] == "commentary_history")
    assert first == {
        "type": "commentary_history",
        "enabled": True,
        "mode": "rules",
        "lines": [],
    }
    lines = lines_of(log)
    assert len(lines) >= 8
    assert [x["id"] for x in lines] == sorted(x["id"] for x in lines)
    assert all(x["source"] == "rules" and x["text"] for x in lines)
    kinds = {k for x in lines for k in x["moments"]}
    assert {"chain_founded", "merger", "game_ended"} <= kinds
    # the final result names the winner and the winning total
    over = next(m for m in log if m["type"] == "game_over")
    winner = over["scores"][over["winner"]]
    final = lines[-1]["text"]
    assert winner["name"] in final and f"${winner['money']:,}" in final
    assert len({x["text"] for x in lines}) == len(lines)  # nothing said twice

    # reconnect: the lines so far come back as history (like chat_history)
    with client.websocket_connect(f"/ws/host/{code}") as ws:
        again = recv_until(ws, lambda m: m["type"] == "commentary_history")
    assert again["lines"] == lines[-100:]

    # the transcript holds every line at its step, and a (zero) cost summary
    game_id = next(m["game_id"] for m in log if m["type"] == "game_state")
    entries = transcript(tdir, game_id)
    written = [e for e in entries if e["type"] == "commentary"]
    assert [e["text"] for e in written] == [x["text"] for x in lines]
    assert all(e["llm"] is None and e["outcome"] == "rules" for e in written)
    seqs = [e["after_seq"] for e in written]
    assert seqs == sorted(seqs)
    footer = entries[-1]
    assert footer["type"] == "footer"
    assert footer["commentary"]["lines"] == len(lines)
    assert footer["commentary"]["llm_calls"] == 0
    assert footer["commentary"]["cost_usd"] == 0.0
    served = client.get(f"/games/{game_id}/transcript").json()
    assert [e["text"] for e in served["entries"] if e["type"] == "commentary"] == [
        x["text"] for x in lines
    ]


def test_unavailable_show_seat_becomes_a_bot(app_client, fast, monkeypatch):
    monkeypatch.setattr(fast, "show_seats", "bot,llm:no-such-model,llm:fake")
    code = new_show(app_client)
    players = app_client.get(f"/room/{code}/state").json()["players"]
    assert [p["kind"] for p in players] == ["bot", "bot", "llm"]


def test_players_do_not_get_commentary(app_client, fast):
    """Commentary goes to the host/watch connection only."""
    client = app_client
    code, me = create_room(client, "Alice")
    add_seat(client, code, "bot")
    add_seat(client, code, "bot")
    configure(client, code, 5)
    assert client.post(f"/room/{code}/commentary", json={"enabled": True}).json() == {
        "enabled": True,
        "mode": "rules",
        "pace": "broadcast",
    }
    host_log: list[dict] = []
    with (
        client.websocket_connect(f"/ws/host/{code}") as host,
        client.websocket_connect(f"/ws/player/{code}/{me}") as ws,
    ):
        human = HumanClient(ws, me)
        start(client, code)
        human.play()
        recv_until(host, is_final, host_log)
    assert len(lines_of(host_log)) >= 5
    assert not [m for m in human.messages if m["type"].startswith("commentary")]


# ------------------------------------------------- when nothing is produced


def test_no_commentary_in_an_ordinary_room(app_client, fast, monkeypatch):
    """Commentary is opt-in: a watched all-AI room without it makes no line
    and no model call."""
    provider = use_model(monkeypatch)
    client = app_client
    code = client.post("/create-spectator").json()["room_code"]
    for _ in range(3):
        add_seat(client, code, "bot")
    configure(client, code, 5)
    log: list[dict] = []
    with client.websocket_connect(f"/ws/host/{code}") as ws:
        start(client, code)
        recv_until(ws, is_over, log)
    assert not lines_of(log)
    assert provider.calls == []
    assert next(m for m in log if m["type"] == "commentary_history")["enabled"] is False
    d = debug(client, code)["commentary"]
    assert (d["enabled"], d["calls"], d["lines"]) == (False, 0, 0)


def test_turned_off_means_no_model_call(app_client, fast, monkeypatch):
    provider = use_model(monkeypatch)
    client = app_client
    code = new_show(client)
    r = client.post(f"/room/{code}/commentary", json={"enabled": False})
    assert r.json()["enabled"] is False
    log = watch(client, code, until=is_over)
    assert not lines_of(log)
    assert provider.calls == []
    d = debug(client, code)["commentary"]
    assert d["enabled"] is False and d["calls"] == 0 and d["lines"] == 0


def test_no_model_call_without_a_spectator(app_client, fast, monkeypatch):
    """The spectator leaves mid-game: the game goes on, the commentator stops."""
    monkeypatch.setattr(fast, "test_mode_agent_action_delay", 0.01)
    provider = use_model(monkeypatch)
    client = app_client
    code = new_show(client)
    with client.websocket_connect(f"/ws/host/{code}") as ws:
        recv_until(ws, is_line)
    room = session_manager.get_room(code)
    left = wait_debug(client, code, lambda d: not d["commentary"]["spectator"])
    assert room.host_websocket is None
    assert left["driver_running"] and room.game.phase.value != "game_over"
    at_leave = len(provider.calls)
    wait_debug(client, code, lambda d: not d["driver_running"], timeout=25)
    assert room.game.phase.value == "game_over"
    # at most the call that was in flight when the socket closed
    assert len(provider.calls) <= at_leave + 1
    d = debug(client, code)["commentary"]
    assert d["calls"] == len(provider.calls) and d["pending"] == 0
    assert d["lines"] <= left["commentary"]["lines"] + 1
    assert d["lines"] < 8  # a whole game makes far more


def test_toggle_mid_game(app_client, fast, monkeypatch):
    monkeypatch.setattr(fast, "test_mode_agent_action_delay", 0.01)
    client = app_client
    code = new_show(client)
    log: list[dict] = []
    with client.websocket_connect(f"/ws/host/{code}") as ws:
        recv_until(ws, is_line, log)
        assert (
            client.post(f"/room/{code}/commentary", json={"enabled": False}).status_code
            == 200
        )
        off = recv_until(
            ws, lambda m: m["type"] == "commentary_history" and not m["enabled"], log
        )
        seen = len(off["lines"])
        assert seen >= 1
        # play goes on in silence
        before = len(log)
        recv_until(
            ws,
            lambda m: m["type"] == "game_state" and m["tiles_remaining"] < 60,
            log,
        )
        assert not [m for m in log[before:] if is_line(m)]
        assert (
            client.post(f"/room/{code}/commentary", json={"enabled": True}).status_code
            == 200
        )
        on = recv_until(
            ws, lambda m: m["type"] == "commentary_history" and m["enabled"], log
        )
        assert len(on["lines"]) == seen
        recv_until(ws, is_final, log)
    r = client.post(f"/room/{code}/commentary", json={"enabled": "yes"})
    assert r.status_code == 422
    assert (
        client.post("/room/ZZZZ/commentary", json={"enabled": True}).status_code == 404
    )


# ------------------------------------------------------------ rate and caps


def test_at_most_one_line_per_gap_but_the_result_is_always_said(
    app_client, fast, monkeypatch
):
    """With a gap longer than the game: the first line, then everything that
    happens waits in one batch, and the final result is said at once."""
    monkeypatch.setattr(fast, "test_mode_commentary_min_gap_s", 600.0)
    client = app_client
    code = new_show(client)
    lines = lines_of(watch(client, code))
    assert len(lines) == 2
    assert lines[1]["moments"][0] == "game_ended"
    assert debug(client, code)["commentary"]["pending"] == 0


def test_lines_are_spaced_by_the_gap(app_client, fast, monkeypatch):
    monkeypatch.setattr(fast, "test_mode_commentary_min_gap_s", 0.25)
    monkeypatch.setattr(fast, "test_mode_agent_action_delay", 0.002)
    stamps: list[tuple[float, bool]] = []  # when the server made each line
    publish = commentary._publish

    def stamped(room_code, room, st, snap, text, **kw):
        if text:
            final = any(m["type"] == "game_ended" for m in snap["moments"])
            stamps.append((time.monotonic(), final))
        return publish(room_code, room, st, snap, text, **kw)

    monkeypatch.setattr(commentary, "_publish", stamped)
    client = app_client
    code = new_show(client)
    lines = lines_of(watch(client, code))
    assert len(lines) == len(stamps) >= 4
    assert stamps[-1][1] and not any(final for _t, final in stamps[:-1])
    # the result may follow the line before it at once; every other line waits
    gaps = [b[0] - a[0] for a, b in zip(stamps, stamps[1:-1])]
    assert min(gaps) >= 0.25 - 0.01, gaps
    # batching: more happened than was said (several moments share a line)
    assert any(len(x["moments"]) > 1 for x in lines)


def test_line_cap_per_game(app_client, fast, monkeypatch):
    monkeypatch.setattr(fast, "commentary_max_lines_per_game", 3)
    client = app_client
    code = new_show(client)
    lines = lines_of(watch(client, code))
    assert len(lines) == 4  # three, then silence, then the result
    assert lines[-1]["moments"] == ["game_ended"]
    assert debug(client, code)["commentary"]["skipped"] > 0


def test_call_cap_then_rules_only(app_client, fast, monkeypatch, tdir):
    provider = use_model(monkeypatch)
    monkeypatch.setattr(fast, "commentary_max_calls_per_game", 2)
    client = app_client
    code = new_show(client)
    log = watch(client, code)
    lines = lines_of(log)
    assert len(provider.calls) == 2
    assert [x["source"] for x in lines[:2]] == ["model", "model"]
    assert all(x["source"] == "rules" for x in lines[2:]) and len(lines) > 4
    # the mode the page shows follows
    modes = [m["mode"] for m in log if is_line(m)]
    assert modes[0] == "model" and modes[-1] == "rules"
    d = debug(client, code)["commentary"]
    assert d["calls"] == 2 and d["model_lines"] == 2 and d["mode"] == "rules"


def test_spend_cap_then_rules_only(app_client, fast, monkeypatch):
    provider = use_model(monkeypatch)
    monkeypatch.setattr(commentary, "_cost", lambda model, attempt: 0.01)
    monkeypatch.setattr(fast, "commentary_max_spend_usd", 0.025)
    client = app_client
    code = new_show(client)
    lines = lines_of(watch(client, code))
    assert len(provider.calls) == 3  # $0.03 spent: the cap is passed, no more
    assert sum(x["source"] == "model" for x in lines) == 3
    assert debug(client, code)["commentary"]["spend_usd"] == pytest.approx(0.03)


# ------------------------------------------------------------- the model call


def test_model_lines_prompt_and_cost(app_client, fast, monkeypatch, tdir):
    """One small call per line: the same system prompt every time (cacheable),
    low effort, a small output cap; the prompt never holds a hand or a note;
    tokens and cost are in the transcript."""
    leaks: list[str] = []

    def responder(system: str, user: str, schema: dict):
        room = next(iter(session_manager._rooms.values()))
        for p in room.game.players:
            for tile in p.hand:
                if re.search(rf"(?<![0-9A-Za-z]){tile}(?![0-9A-Za-z])", user):
                    leaks.append(f"{p.name}:{tile}")
        for marker in ("# Your hand", "private notes", "# Your seat"):
            if marker in user or marker in system:
                leaks.append(marker)
        return words.fake_commentary_responder(system, user, schema)

    provider = use_model(monkeypatch, responder)
    client = app_client
    code = new_show(client)
    log = watch(client, code)
    lines = lines_of(log)
    calls = provider.calls
    assert leaks == []
    assert len(calls) == len(lines) >= 8
    assert all(x["source"] == "model" for x in lines)
    assert all(x["text"].startswith("Fake commentary, turn ") for x in lines)
    assert len({c["system"] for c in calls}) == 1
    assert calls[0]["system"] == words.build_system_prompt()
    assert {c["effort"] for c in calls} == {"low"}
    assert {c["max_tokens"] for c in calls} == {fast.commentary_max_tokens}
    assert calls[0]["schema"] == words.LINE_SCHEMA
    # its own latest lines are in the next prompt (memory against repetition)
    assert lines[0]["text"] in calls[1]["user"]
    assert "# Table now" in calls[0]["user"] and "# The game so far" in calls[0]["user"]

    game_id = next(m["game_id"] for m in log if m["type"] == "game_state")
    entries = transcript(tdir, game_id)
    written = [e for e in entries if e["type"] == "commentary"]
    assert len(written) == len(lines)
    assert all(e["outcome"] == "model" for e in written)
    first = written[0]["llm"]
    assert first["model"] == "fake" and first["user_prompt"] == calls[0]["user"]
    assert first["system_prompt"] == calls[0]["system"]  # stored once ...
    assert "system_prompt" not in written[1]["llm"]  # ... then by id
    assert written[1]["llm"]["system_prompt_id"] == first["system_prompt_id"]
    att = first["attempts"][0]
    assert att["input_tokens"] > 0 and att["output_tokens"] > 0
    footer = entries[-1]["commentary"]
    assert footer["llm_calls"] == len(calls)
    assert footer["model_lines"] == footer["lines"] == len(lines)
    assert footer["input_tokens"] == sum(
        e["llm"]["attempts"][0]["input_tokens"] for e in written
    )
    assert footer["model"] == "fake"
    assert footer["cost_usd"] == 0.0  # the fake model is free (bench/prices.json)
    # seats' totals are untouched: the commentator is not a seat
    assert all(t["llm_calls"] == 0 for t in entries[-1]["totals"].values())


def test_failed_calls_fall_back_to_rules_and_then_stop(app_client, fast, monkeypatch):
    provider = use_model(monkeypatch, lambda s, u, sch: ProviderError("boom"))
    client = app_client
    code = new_show(client)
    lines = lines_of(watch(client, code))
    assert len(provider.calls) == commentary.MAX_FAILURES  # then rules-only
    assert all(x["source"] == "rules" for x in lines) and len(lines) > 5
    d = debug(client, code)["commentary"]
    assert d["failures"] == commentary.MAX_FAILURES and d["mode"] == "rules"


def test_a_made_up_amount_is_refused(app_client, fast, monkeypatch, tdir):
    """A line with money that is not in the prompt is not shown: the rules
    line is, and the transcript says why."""
    n = {"calls": 0}

    def responder(system, user, schema):
        n["calls"] += 1
        if n["calls"] == 1:
            return {"line": "Ann collects $987,654 for nothing."}
        if n["calls"] == 2:
            return {"line": "What a massive move!"}
        return words.fake_commentary_responder(system, user, schema)

    use_model(monkeypatch, responder)
    client = app_client
    code = new_show(client)
    log = watch(client, code)
    lines = lines_of(log)
    assert not [x for x in lines if "987,654" in x["text"] or "massive" in x["text"]]
    assert lines[0]["source"] == "rules" and lines[-1]["source"] == "model"
    game_id = next(m["game_id"] for m in log if m["type"] == "game_state")
    written = [e for e in transcript(tdir, game_id) if e["type"] == "commentary"]
    errors = [e["llm"]["attempts"][0]["error"] for e in written]
    assert errors[0] == "amounts not in the prompt: 987654"
    assert errors[1] == "style: exclamation mark, what a, massive"
    assert not any(errors[2:])
    # the refused answers are in the transcript, the rules lines were shown
    assert written[0]["llm"]["attempts"][0]["raw"].count("987,654") == 1
    assert written[0]["outcome"] == "rules" and written[0]["text"] == lines[0]["text"]
    assert written[1]["outcome"] in ("rules", "silent")
    assert [e["text"] for e in written if e["text"]] == [x["text"] for x in lines]


def test_a_slow_commentator_never_delays_the_game(app_client, fast, monkeypatch, tdir):
    """The model takes seconds per line; the game is over long before the
    lines are, and the transcript is closed only once the result was said."""
    client = app_client
    t0 = time.monotonic()
    plain = client.post("/create-spectator").json()["room_code"]
    for _ in range(4):
        add_seat(client, plain, "bot")
    configure(client, plain, 5)
    with client.websocket_connect(f"/ws/host/{plain}") as ws:
        start(client, plain)
        recv_until(ws, is_over)
    baseline = time.monotonic() - t0

    delay = 2.5
    provider = use_model(monkeypatch, delay=delay)
    code = new_show(client)
    log: list[dict] = []
    t0 = time.monotonic()
    with client.websocket_connect(f"/ws/host/{code}") as ws:
        recv_until(ws, is_over, log)
        took = time.monotonic() - t0
        assert len(provider.calls) >= 1  # a call was made while the game ran
        # a commentator in the way would cost `delay` per line
        assert took < baseline + delay * 0.8, (took, baseline)
        assert len(lines_of(log)) <= 1 + int(took // delay)
        game_id = next(m["game_id"] for m in log if m["type"] == "game_state")
        entries = transcript(tdir, game_id)
        assert entries[-1]["type"] != "footer"  # waits for the final line
        final = recv_until(ws, is_final, log)
    assert final["line"]["source"] == "model"
    end = time.monotonic() + 5
    while (entries := transcript(tdir, game_id))[-1]["type"] != "footer":
        assert time.monotonic() < end, "transcript not closed after the final line"
        time.sleep(0.05)
    assert entries[-1]["commentary"]["llm_calls"] == len(provider.calls)
    assert [e["text"] for e in entries if e["type"] == "commentary"][-1] == (
        final["line"]["text"]
    )


# ------------------------------------------------------------------- pacing


def test_broadcast_pace_for_a_watched_all_ai_game(app_client, fast, monkeypatch):
    client = app_client
    code = new_show(client)
    room = session_manager.get_room(code)
    monkeypatch.setattr(seats, "test_mode", lambda: False)
    s = fast
    assert seats.broadcast_pace(room) is False  # nobody watches yet
    assert seats._pacing_delay(False, room) == s.agent_action_delay
    room.host_websocket = object()
    assert seats.broadcast_pace(room) is True
    assert seats._pacing_delay(False, room) == s.broadcast_action_delay == 1.2
    assert seats._pacing_delay(True, room) == s.broadcast_step_delay == 0.7
    r = client.post(f"/room/{code}/commentary", json={"pace": "fast"})
    assert r.json()["pace"] == "fast"
    assert seats._pacing_delay(False, room) == s.agent_action_delay
    assert (
        client.post(f"/room/{code}/commentary", json={"pace": "slow"}).status_code
        == 422
    )
    client.post(f"/room/{code}/commentary", json={"pace": "broadcast"})
    assert seats.broadcast_pace(room) is True
    room.host_websocket = None

    # a room with a human seat keeps the normal pace, watched or not
    code2, _me = create_room(client, "Alice")
    add_seat(client, code2, "bot")
    room2 = session_manager.get_room(code2)
    room2.host_websocket = object()
    assert seats.broadcast_pace(room2) is False
    assert seats._pacing_delay(True, room2) == s.agent_step_delay
    room2.host_websocket = None
    # test mode always uses its own (short) delay
    monkeypatch.setattr(seats, "test_mode", lambda: True)
    room.host_websocket = object()
    assert seats._pacing_delay(False, room) == s.test_mode_agent_action_delay
    room.host_websocket = None
