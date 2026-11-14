"""Scripted seat strictness (TP-002): by default an illegal script entry is
silently dropped; with ``strict`` it is surfaced (recorded, ``decide`` raises,
the driver reports a fallback with the distinct reason ``script``)."""

from __future__ import annotations

import asyncio

import pytest

from agents.base import build_context
from agents.driving import category, describe_fallback
from agents.scripted import ScriptedAgent, ScriptViolation
from game.decisions import pending_decisions
from game.game import Game
from tests.protocol.helpers import (
    HumanClient,
    add_seat,
    configure,
    create_room,
    debug,
    start,
)


def place_tile_ctx():
    g = Game(seed=1)
    for i in range(3):
        g.add_player(f"p{i + 1}", f"P{i + 1}")
    g.start_game()
    d = pending_decisions(g)[0]
    assert d.kind == "place_tile"
    return g, d, build_context(g, d)


def decide(agent, ctx):
    return asyncio.run(agent.decide(ctx))


ILLEGAL = {"action": "place_tile", "tile": "9Z"}  # right type, impossible tile


def test_lenient_default_silently_drops_an_illegal_entry():
    _, _, ctx = place_tile_ctx()
    agent = ScriptedAgent([ILLEGAL])
    action = decide(agent, ctx)
    assert action["action"] == "place_tile" and action["tile"] != "9Z"
    assert agent.violations == [] and agent.script == []


def test_strict_illegal_entry_raises_and_is_recorded():
    _, d, ctx = place_tile_ctx()
    agent = ScriptedAgent([ILLEGAL], strict=True)
    with pytest.raises(ScriptViolation) as ei:
        decide(agent, ctx)
    assert ei.value.reason == "script" and "9Z" in str(ei.value)
    assert agent.violations == [
        {
            "kind": "illegal_entry",
            "entry": ILLEGAL,
            "decision": "place_tile",
            "player_id": d.player_id,
        }
    ]
    assert agent.played == []
    # the bad entry is consumed: the next decision plays the default again
    assert decide(agent, ctx)["action"] == "place_tile"
    with pytest.raises(ScriptViolation, match="illegal script entries"):
        agent.assert_consumed()


def test_strict_legal_entries_and_waiting_entries_are_fine():
    g, d, ctx = place_tile_ctx()
    tile = ctx.legal["tiles"][0]["tile"]
    agent = ScriptedAgent(
        [{"action": "place_tile", "tile": tile}, {"action": "buy_stocks"}],
        strict=True,
    )
    assert decide(agent, ctx) == {"action": "place_tile", "tile": tile}
    # a buy_stocks entry while a tile is asked stays queued (not a violation)
    assert decide(agent, ctx)["action"] == "place_tile"
    assert agent.violations == []
    # ...but if it is never played, the end-of-game check says so
    assert agent.unconsumed() == [{"action": "buy_stocks"}]
    with pytest.raises(ScriptViolation, match="never consumed"):
        agent.assert_consumed()
    assert ScriptedAgent([], strict=True).assert_consumed() is None


def test_driver_category_and_message_for_script_failures():
    assert category("script: illegal script entry {...}") == "script"
    assert category("error: ValueError: x") == "error"
    assert "broke its test script" in describe_fallback("Bot", "script", 1, 0.1)


# ------------------------------------------------------ through the server


def play_with_script(client, script, strict):
    code, me = create_room(client, "Human")
    extra = {"script": script}
    if strict is not None:
        extra["strict"] = strict
    scripted = add_seat(client, code, "scripted", **extra)
    add_seat(client, code, "bot")
    configure(client, code, 3)
    return code, me, scripted


def test_add_seat_strict_validation(app_client):
    code, _ = create_room(app_client, "Human")
    r = app_client.post(
        f"/room/{code}/add-seat", json={"agent_id": "bot", "strict": True}
    )
    assert r.status_code == 400
    r = app_client.post(
        f"/room/{code}/add-seat", json={"agent_id": "scripted", "strict": "yes"}
    )
    assert r.status_code == 422


def test_server_reports_strict_script_violation_in_room_debug(app_client):
    code, me, scripted = play_with_script(app_client, [ILLEGAL], strict=True)
    with app_client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        start(app_client, code)
        human = HumanClient(ws, me)
        human.play(
            deadline_s=15,
            stop=lambda m: debug(app_client, code)["fallback_kinds"].get("script"),
        )
    d = debug(app_client, code)
    pid = scripted["player_id"]
    assert d["fallback_kinds"]["script"] == 1
    fb = next(f for f in d["fallbacks"] if f["category"] == "script")
    assert fb["player_id"] == pid and fb["reason"].startswith("script:")
    info = d["scripted"][pid]
    assert info["strict"] is True
    assert info["violations"][0]["entry"] == ILLEGAL
    assert d["script_problems"] == [pid]


def test_server_lenient_scripted_seat_drops_silently(app_client):
    code, me, scripted = play_with_script(app_client, [ILLEGAL], strict=None)
    pid = scripted["player_id"]
    with app_client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        start(app_client, code)
        human = HumanClient(ws, me)
        human.play(
            deadline_s=15,
            stop=lambda m: not debug(app_client, code)["scripted"][pid]["unconsumed"],
        )
    d = debug(app_client, code)
    assert d["fallback_kinds"].get("script", 0) == 0
    info = d["scripted"][scripted["player_id"]]
    assert info["strict"] is False and info["violations"] == []
    assert d["script_problems"] == []
