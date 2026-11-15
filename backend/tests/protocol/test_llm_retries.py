"""LLM seats: an illegal answer is sent back to the model; only an exhausted
retry budget, a timeout or a provider error hands the move to the rules-based
bot, and then everyone at the table is told (``agent_fallback``)."""

from __future__ import annotations

import time

import seats
from agents.llm.agent import LLMAgent
from agents.llm.providers import FakeProvider

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
from tests.protocol.test_driver import install_fake_llms

ILLEGAL = {"why": "x", "action": {"action": "found_chain", "chain": "Nope"}, "note": ""}


def rejected_count(user: str) -> int:
    return user.count("Rejected because")


def make_agent(provider, **kw):
    made = {}

    def factory(name):
        made["agent"] = LLMAgent(provider, name=name, agent_id="llm:t", **kw)
        return made["agent"]

    return factory, made


def spectator_room(client, agent_id: str):
    code = client.post("/create-spectator").json()["room_code"]
    seat = add_seat(client, code, agent_id)
    add_seat(client, code, "bot")
    add_seat(client, code, "bot")
    configure(client, code, 5)
    return code, seat["player_id"]


def wait_for(fn, what: str, timeout: float = 10.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        value = fn()
        if value:
            return value
        time.sleep(0.02)
    raise AssertionError(f"timed out waiting for {what}")


def test_illegal_twice_then_legal_means_no_fallback(app_client, monkeypatch):
    def answer(system, user, schema):
        return ILLEGAL if rejected_count(user) < 2 else None  # None: first legal

    prov = FakeProvider(answer)
    factory, made = make_agent(prov)
    install_fake_llms(monkeypatch, {"llm:t": factory})
    code, _ = spectator_room(app_client, "llm:t")
    start(app_client, code)
    wait_for(lambda: len(prov.calls) >= 9, "three LLM decisions")  # 3 calls each
    info = debug(app_client, code)
    assert info["fallback_count"] == 0 and info["stalled"] is None
    assert info["agent_actions"] >= 3
    assert made["agent"].totals["illegal_answers"] >= 4
    assert made["agent"].totals["failures"] == 0


def test_engine_rejection_is_sent_back_to_the_agent(app_client, monkeypatch):
    prov = FakeProvider()  # always the first legal action
    factory, _ = make_agent(prov)
    install_fake_llms(monkeypatch, {"llm:t": factory})
    code, llm_pid = spectator_room(app_client, "llm:t")
    real = seats.validate_action
    state = {"refused": 0}

    def picky(game, player_id, action):
        if player_id == llm_pid and state["refused"] < 2:
            state["refused"] += 1
            return f"engine refuses #{state['refused']}"
        return real(game, player_id, action)

    monkeypatch.setattr(seats, "validate_action", picky)
    start(app_client, code)
    wait_for(lambda: state["refused"] == 2 and len(prov.calls) >= 4, "retries")
    third = prov.calls[2]["user"]
    assert "engine refuses #1" in third and "engine refuses #2" in third
    assert "engine refuses" not in prov.calls[0]["user"]
    wait_for(lambda: debug(app_client, code)["agent_actions"] >= 3, "progress")
    info = debug(app_client, code)
    assert info["fallback_count"] == 0 and info["stalled"] is None


def fallback_table(client, monkeypatch, provider, **agent_kw):
    factory, made = make_agent(provider, **agent_kw)
    install_fake_llms(monkeypatch, {"llm:t": factory})
    code, alice = create_room(client, "Alice")
    llm_pid = add_seat(client, code, "llm:t")["player_id"]
    add_seat(client, code, "bot")
    configure(client, code, 5)
    return code, alice, llm_pid, made


def run_to_first_fallback(client, code, alice, llm_pid):
    with (
        client.websocket_connect(f"/ws/host/{code}") as host,
        client.websocket_connect(f"/ws/player/{code}/{alice}") as ws,
    ):
        start(client, code)
        human = HumanClient(ws, alice)
        final = human.play(
            stop=lambda s: s["players"][llm_pid]["fallbacks"]["count"] > 0
        )
        host_msgs: list[dict] = []
        got = recv_until(host, lambda m: m["type"] == "agent_fallback", host_msgs)
        return human, final, got


def test_always_illegal_falls_back_after_the_budget_and_tells_everyone(
    app_client, monkeypatch, caplog
):
    prov = FakeProvider([ILLEGAL])  # repeats forever
    code, alice, llm_pid, made = fallback_table(
        app_client, monkeypatch, prov, max_illegal_retries=3
    )
    with caplog.at_level("WARNING", logger="llm"):
        human, state, host_msg = run_to_first_fallback(app_client, code, alice, llm_pid)
    n = debug(app_client, code)["fallback_count"]
    assert 4 * n <= len(prov.calls) <= 4 * n + 4  # 1 answer + 3 retries, then the bot
    msgs = [m for m in human.messages if m["type"] == "agent_fallback"]
    assert msgs and msgs[0] == host_msg
    m = msgs[0]
    assert m["player_id"] == llm_pid and m["reason"] == "illegal"
    assert m["agent_label"] == "llm:t" and m["player_name"]
    assert m["decision"] in ("place_tile", "found_chain", "buy_stocks")
    assert "kept answering illegally after 4 tries" in m["message"]
    assert "rules-based" in m["message"]
    assert state["players"][llm_pid]["fallbacks"] == {
        "count": 1,
        "last_reason": "illegal",
    }
    assert state["players"][alice]["fallbacks"] == {"count": 0, "last_reason": None}
    info = debug(app_client, code)
    assert info["fallback_kinds"]["illegal"] >= 1
    assert made["agent"].totals["failures"] >= 1
    assert any(
        r.name == "llm" and r.levelname == "WARNING" and "illegal" in r.message
        for r in caplog.records
    )


def test_timeout_falls_back_at_once_without_retry(app_client, monkeypatch):
    from config import get_settings

    monkeypatch.setattr(get_settings(), "llm_decision_timeout", 0.2)
    prov = FakeProvider([None], delay=5.0)  # would answer, but far too late
    code, alice, llm_pid, _ = fallback_table(app_client, monkeypatch, prov)
    human, state, host_msg = run_to_first_fallback(app_client, code, alice, llm_pid)
    m = next(x for x in human.messages if x["type"] == "agent_fallback")
    assert m == host_msg
    assert m["reason"] == "timeout" and m["player_id"] == llm_pid
    assert "timed out after" in m["message"]
    assert state["players"][llm_pid]["fallbacks"]["last_reason"] == "timeout"
    info = debug(app_client, code)
    assert info["fallback_kinds"]["timeout"] >= 1
    n = info["fallback_count"]
    assert n <= len(prov.calls) <= n + 1  # one call per decision: no retry


def test_provider_error_falls_back_with_reason_error(app_client, monkeypatch):
    from agents.llm.errors import ProviderError

    prov = FakeProvider([ProviderError("HTTP 500")])
    code, alice, llm_pid, _ = fallback_table(app_client, monkeypatch, prov)
    human, _, _ = run_to_first_fallback(app_client, code, alice, llm_pid)
    m = next(x for x in human.messages if x["type"] == "agent_fallback")
    assert m["reason"] == "error" and "provider error" in m["message"]
    n = debug(app_client, code)["fallback_count"]
    assert n <= len(prov.calls) <= n + 1  # one call per decision: no retry


def test_game_state_has_zero_fallbacks_for_everyone_by_default(app_client):
    code, _ = create_room(app_client, "Alice")
    join_room(app_client, code, "Bob")
    add_seat(app_client, code, "bot")
    with app_client.websocket_connect(f"/ws/host/{code}") as host:
        start(app_client, code)
        state = recv_until(host, lambda m: m["type"] == "game_state")
    assert all(
        p["fallbacks"] == {"count": 0, "last_reason": None}
        for p in state["players"].values()
    )
