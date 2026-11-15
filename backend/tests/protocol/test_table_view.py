"""Tier 2: ``game_state`` carries net worth, chain holders and the merger record
(BL-007) to the host and the players, as the engine computes them."""

from __future__ import annotations

import json
from pathlib import Path

from tests.protocol.helpers import add_seat, create_room, join_room, recv_until

SNAPSHOTS = (
    Path(__file__).resolve().parents[3]
    / "frontend"
    / "tests"
    / "e2e"
    / "fixtures"
    / "snapshots"
)


def _remap(value, ids: dict):
    """Replace snapshot player ids (keys and values) by room ids."""
    if isinstance(value, dict):
        return {ids.get(k, k): _remap(v, ids) for k, v in value.items()}
    if isinstance(value, list):
        return [_remap(v, ids) for v in value]
    if isinstance(value, str):
        return ids.get(value, value)
    return value


def test_game_state_carries_the_table_view(app_client):
    client = app_client
    fixture = json.loads((SNAPSHOTS / "disposition-waiting-on-other.json").read_text())
    expect = fixture["expect"]
    code, me = create_room(client, "Alice")
    # Idle humans: nobody answers, so the merger stays in progress while we look.
    others = [join_room(client, code, n) for n in ("Bob", "Cara", "Dev")]
    seat_map = {"p1": me, "p2": others[0], "p3": others[1], "p4": others[2]}
    with client.websocket_connect(f"/ws/host/{code}") as host:
        recv_until(host, lambda m: m.get("type") == "lobby_update")
        r = client.post(
            f"/test/room/{code}/load-snapshot",
            json={"snapshot": fixture["snapshot"], "seat_map": seat_map},
        )
        assert r.status_code == 200, r.text
        state = recv_until(host, lambda m: m.get("type") == "game_state")

    for seat, w in expect["net_worth"].items():
        p = state["players"][seat_map[seat]]
        assert p["money"] == w["cash"]
        assert (p["stock_value"], p["net_worth"], p["rank"]) == (
            w["stock_value"],
            w["net_worth"],
            w["rank"],
        )
    assert state["chain_holders"] == _remap(expect["chain_holders"], seat_map)
    assert state["mergers"] == _remap(expect["mergers"], seat_map)
    [merger] = state["mergers"]
    assert merger["complete"] is False
    assert merger["defunct"][0]["bonuses"], "bonuses are paid when the merger starts"
    assert (
        merger["defunct"][0]["waiting_on"][0]
        == seat_map[expect["flow_decision"]["player_id"]]
    )


def test_player_state_has_the_same_table_view(app_client):
    client = app_client
    code, me = create_room(client, "Alice")
    add_seat(client, code, "scripted")
    add_seat(client, code, "scripted")
    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        recv_until(ws, lambda m: m.get("type") == "lobby_update")
        r = client.post(f"/room/{code}/start")
        assert r.status_code == 200, r.text
        state = recv_until(ws, lambda m: m.get("type") == "game_state")
    start = state["ruleset"]["starting_cash"]
    for p in state["players"].values():
        assert (p["stock_value"], p["net_worth"], p["rank"]) == (0, start, 1)
    assert state["chain_holders"] == {}
    assert state["mergers"] == []
