"""Full games over the real protocol: humans + agents, all-agent games."""

from __future__ import annotations

import pytest

from app_state import session_manager
from session.seat_names import SEAT_NAMES
from tests.protocol.helpers import (
    HumanClient,
    add_seat,
    configure,
    create_room,
    debug,
    start,
    watch_until_game_over,
)


@pytest.mark.slow
def test_human_vs_two_scripted_to_game_over(app_client):
    """(a) One human over WebSocket + 2 scripted seats play to game over."""
    client = app_client
    code, me = create_room(client, "Alice")
    s1 = add_seat(client, code, "scripted")
    s2 = add_seat(client, code, "scripted")
    assert s1["kind"] == s2["kind"] == "scripted"
    assert {s1["name"], s2["name"]} == {"Scripted 1", "Scripted 2"}
    configure(client, code, 7)

    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        human = HumanClient(ws, me)
        lobby = human.recv()
        assert lobby["type"] == "lobby_update"
        start(client, code)
        final = human.play()

    assert final["phase"] == "game_over"
    assert any(m["type"] == "game_over" for m in human.messages)
    # All seats are reported with their kind.
    kinds = {pid: p["kind"] for pid, p in final["players"].items()}
    assert kinds[me] == "human"
    assert kinds[s1["player_id"]] == "scripted"
    assert final["players"][s1["player_id"]]["is_bot"] is True
    assert final["awaiting"] is None
    # The human played several turns and never got an error.
    assert sum(1 for a in human.actions if a["action"] == "place_tile") >= 5
    assert human.errors == []
    assert debug(client, code)["fallback_count"] == 0


class FakeLLM:
    """Stand-in LLM agent: plays the first legal option."""

    kind = "llm"

    def __init__(self, name):
        self.name = name
        self.calls = 0

    async def decide(self, ctx):
        from agents.scripted import default_action

        self.calls += 1
        return default_action(ctx)


@pytest.mark.slow
def test_all_agent_game_runs_to_completion(app_client, monkeypatch):
    """(b) bot + scripted + fake LLM from `start`; spectator socket sees it all."""
    from agents.llm import config as llm_config

    created = []

    def fake_catalog():
        return [
            {
                "id": "llm:test",
                "kind": "llm",
                "label": "Test LLM",
                "description": "fake",
                "available": True,
            }
        ]

    def fake_create(agent_id, *, name):
        agent = FakeLLM(name)
        created.append(agent)
        return agent

    monkeypatch.setattr(llm_config, "catalog_entries", fake_catalog)
    monkeypatch.setattr(llm_config, "create_agent", fake_create)

    client = app_client
    code = client.post("/create-spectator").json()["room_code"]
    bot = add_seat(client, code, "bot")
    add_seat(client, code, "scripted")
    llm = add_seat(client, code, "llm:test")
    assert bot == {"player_id": bot["player_id"], "name": bot["name"], "kind": "bot"}
    # Character names (session.seat_names), never the model's label.
    assert bot["name"] in SEAT_NAMES and llm["name"] in SEAT_NAMES
    assert llm["name"] != "Test LLM" and llm["kind"] == "llm"
    configure(client, code, 11)

    log: list[dict] = []
    with client.websocket_connect(f"/ws/host/{code}") as host:
        start(client, code)
        final = watch_until_game_over(host, log)

    states = [m for m in log if m["type"] == "game_state"]
    assert len(states) > 20
    # The spectator saw each AI seat being awaited.
    awaited = {s["awaiting"]["kind"] for s in states if s.get("awaiting")}
    assert {"bot", "scripted", "llm"} <= awaited
    assert final["players"][llm["player_id"]]["agent_label"] == "Test LLM"
    assert any(m["type"] == "game_over" for m in log)
    assert created and created[0].calls > 0
    assert debug(client, code)["fallback_count"] == 0
    room = session_manager.get_room(code)
    assert room.game.phase.value == "game_over"


@pytest.mark.slow
def test_all_heuristic_game_is_deterministic_for_a_seed(app_client):
    """Same seed + same seats -> same final standings (driver adds no randomness)."""

    def run():
        code = app_client.post("/create-spectator").json()["room_code"]
        ids = [add_seat(app_client, code, "bot")["player_id"] for _ in range(3)]
        configure(app_client, code, 3)
        with app_client.websocket_connect(f"/ws/host/{code}") as host:
            start(app_client, code)
            final = watch_until_game_over(host)
        # By seat order: the bots' character names are random here (the seed is
        # configured after they joined); their play is not (seeded "Bot N").
        return [final["players"][pid]["money"] for pid in ids]

    assert run() == run()
