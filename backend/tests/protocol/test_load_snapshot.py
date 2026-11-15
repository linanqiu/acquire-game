"""(f) Test-mode snapshot loading: restore mid-merger, a human finishes the
stock disposition, the game carries on with agent seats."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app_state import session_manager
from game.board import Tile
from game.decisions import apply_action, pending_decisions
from game.game import Game
from game.ruleset import load_ruleset
from game.snapshot import to_snapshot
from tests.protocol.helpers import HumanClient, add_seat, create_room, recv_until


def disposition_snapshot() -> dict:
    """p1 (current) merges marlowe into sandpiper; p2 holds marlowe stock -> p2 disposes."""
    game = Game(seed=1)
    for pid, name in (("p1", "One"), ("p2", "Two"), ("p3", "Three")):
        game.add_player(pid, name)
    game.start_game()
    reserved = {Tile(c, "A") for c in range(1, 7)}
    for p in game.players:
        for t in list(p.hand):
            if t in reserved:
                p.remove_tile(t)
    game.tile_bag = [t for t in game.tile_bag if t not in reserved]
    for p in game.players:
        while p.hand_size < 6:
            p.add_tile(game.tile_bag.pop())
    for c in (1, 2, 3):
        game.board.place_tile(Tile(c, "A"))
        game.board.set_chain(Tile(c, "A"), "sandpiper")
    for c in (5, 6):
        game.board.place_tile(Tile(c, "A"))
        game.board.set_chain(Tile(c, "A"), "marlowe")
    game.hotel.activate_chain("sandpiper")
    game.hotel.activate_chain("marlowe")
    game.players[1]._stocks["marlowe"] = 3
    game.hotel._available_stocks["marlowe"] -= 3
    p1 = game.players[0]
    p1.remove_tile(p1.hand[0])
    p1.add_tile(Tile(4, "A"))
    game.resolve_unplayable_turn()
    assert game.get_current_player_id() == "p1"
    res = apply_action(game, "p1", {"action": "place_tile", "tile": "4A"})
    assert res["success"], res
    flow = pending_decisions(game)[0]
    assert (flow.kind, flow.player_id) == ("stock_disposition", "p2")
    return to_snapshot(game)


def test_load_snapshot_human_completes_disposition(app_client):
    client = app_client
    code, me = create_room(client, "Human")
    bot = add_seat(client, code, "bot")
    scripted = add_seat(client, code, "scripted")
    snap = disposition_snapshot()
    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        human = HumanClient(ws, me)
        human.recv()  # lobby
        r = client.post(
            f"/test/room/{code}/load-snapshot",
            json={
                "snapshot": snap,
                "seat_map": {
                    "p1": bot["player_id"],
                    "p2": me,
                    "p3": scripted["player_id"],
                },
            },
        )
        assert r.status_code == 200, r.text
        prompt = recv_until(ws, lambda m: m["type"] == "stock_disposition_required")
        assert prompt == {
            "type": "stock_disposition_required",
            "defunct_chain": "marlowe",
            "surviving_chain": "sandpiper",
            "stock_count": 3,
            "available_to_trade": 25,
        }
        state = recv_until(ws, lambda m: m["type"] == "game_state")
        assert state["awaiting"] == {
            "player_id": me,
            "kind": "human",
            "decision": "stock_disposition",
        }
        assert state["players"][me]["name"] == "Human"
        assert state["players"][me]["stocks"]["marlowe"] == 3
        ws.send_json(
            {
                "action": "merger_disposition",
                "defunct_chain": "marlowe",
                "disposition": {"sell": 1, "trade": 2, "hold": 0},
            }
        )
        # The bot (p1) resumes: buys, ends its turn; then it's my turn.
        state = recv_until(
            ws,
            lambda m: (
                m["type"] == "game_state"
                and (m.get("awaiting") or {}).get("player_id") == me
            ),
        )
        assert state["awaiting"]["decision"] == "place_tile"
        assert state["players"][me]["stocks"]["marlowe"] == 0
        assert state["players"][me]["stocks"]["sandpiper"] == 1
        # and the game keeps going under the human's control
        human.play(stop=lambda m: m["current_player"] != me, state=state)
    game = session_manager.get_room(code).game
    assert any(e["type"] == "merger_completed" for e in game.events)


def test_load_snapshot_default_seat_order(app_client):
    """No seat_map: snapshot players map onto the room's seats in order."""
    client = app_client
    code, me = create_room(client, "Human")
    add_seat(client, code, "scripted")
    add_seat(client, code, "scripted")
    # p1 -> me (first seat), p2 -> scripted 1 (disposes automatically)
    r = client.post(
        f"/test/room/{code}/load-snapshot", json={"snapshot": disposition_snapshot()}
    )
    assert r.status_code == 200
    assert r.json()["players"][0] == me
    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        state = recv_until(
            ws,
            lambda m: (
                m["type"] == "game_state"
                and (m.get("awaiting") or {}).get("player_id") == me
            ),
        )
        # The scripted seat sold its stock; I (the merger maker) now buy.
        assert state["awaiting"]["decision"] == "buy_stocks"


def test_connecting_later_receives_pending_prompt(app_client):
    """(h) A player who (re)connects while their disposition is pending gets the
    full state and the stock_disposition_required prompt again."""
    client = app_client
    code, me = create_room(client, "Human")
    s1 = add_seat(client, code, "scripted")
    s2 = add_seat(client, code, "scripted")
    r = client.post(
        f"/test/room/{code}/load-snapshot",
        json={
            "snapshot": disposition_snapshot(),
            "seat_map": {"p1": s1["player_id"], "p2": me, "p3": s2["player_id"]},
        },
    )
    assert r.status_code == 200
    for _ in range(2):  # connect, disconnect, reconnect
        with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
            state = recv_until(ws, lambda m: m["type"] == "game_state")
            assert state["awaiting"]["decision"] == "stock_disposition"
            assert len(state["your_hand"]) == 6
            prompt = recv_until(ws, lambda m: m["type"] == "stock_disposition_required")
            assert prompt["stock_count"] == 3


def test_bad_snapshot_rejected_and_game_untouched(app_client):
    client = app_client
    code, _me = create_room(client)
    add_seat(client, code, "bot")
    add_seat(client, code, "bot")
    client.post(f"/room/{code}/start")
    before = client.get(f"/test/room/{code}/snapshot").json()
    bad = disposition_snapshot()
    bad["version"] = 99
    r = client.post(f"/test/room/{code}/load-snapshot", json={"snapshot": bad})
    assert r.status_code == 400
    r = client.post(
        f"/test/room/{code}/load-snapshot",
        json={"snapshot": disposition_snapshot(), "seat_map": {"p1": "nobody"}},
    )
    assert r.status_code == 400
    after = client.get(f"/test/room/{code}/snapshot").json()
    assert after == before  # the human is up first, so nothing moved


FIXTURES = Path(__file__).resolve().parents[3] / "frontend/tests/e2e/fixtures/snapshots"


@pytest.mark.parametrize(
    "name",
    sorted(p.stem for p in FIXTURES.glob("*.json") if p.stem != "index"),
)
def test_every_frontend_fixture_loads(app_client, name):
    """Each generated fixture loads into a room (human = p1 = room creator,
    scripted seats for the rest); the human gets a coherent state."""
    fixture = json.loads((FIXTURES / f"{name}.json").read_text())
    snap = fixture["snapshot"]
    code, me = create_room(app_client, "Alice")
    for _ in snap["players"][1:]:
        add_seat(app_client, code, "scripted")
    r = app_client.post(f"/test/room/{code}/load-snapshot", json={"snapshot": snap})
    assert r.status_code == 200, r.text
    with app_client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        state = recv_until(ws, lambda m: m["type"] == "game_state")
    assert state["players"][me]["name"] == "Alice"
    assert isinstance(state["your_hand"], list)
    assert isinstance(state["incoming_trades"], list)


def mini_snapshot() -> dict:
    """A game created under the ``mini`` ruleset: p1 holds 2A next to a lone 1A,
    so placing it founds a chain (ids ``sandpiper``, ``marlowe``, ...)."""
    mini = load_ruleset("mini")
    game = Game(seed=1, ruleset=mini)
    for pid, name in (("p1", "One"), ("p2", "Two"), ("p3", "Three")):
        game.add_player(pid, name)
    game.start_game()
    reserved = {Tile(1, "A"), Tile(2, "A")}
    for p in game.players:
        for t in list(p.hand):
            if t in reserved:
                p.remove_tile(t)
    game.tile_bag = [t for t in game.tile_bag if t not in reserved]
    for p in game.players:
        while p.hand_size < mini.hand_size:
            p.add_tile(game.tile_bag.pop())
    game.board.place_tile(Tile(1, "A"))
    p1 = game.players[0]
    p1.remove_tile(p1.hand[0])
    p1.add_tile(Tile(2, "A"))
    game.resolve_unplayable_turn()
    assert game.get_current_player_id() == "p1"
    return to_snapshot(game)


def test_snapshot_of_another_ruleset_is_validated_against_its_own_game(app_client):
    """Server default is default; the loaded game is ``mini``. A human's legal
    mini moves (its own chain ids, 4 shares per buy) must not be refused by the
    default chain list / purchase limit."""
    from config import get_ruleset

    assert get_ruleset().id == "default"
    client = app_client
    code, me = create_room(client, "Human")
    bot = add_seat(client, code, "bot")
    other = add_seat(client, code, "bot")
    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        human = HumanClient(ws, me)
        human.recv()  # lobby
        r = client.post(
            f"/test/room/{code}/load-snapshot",
            json={
                "snapshot": mini_snapshot(),
                "seat_map": {
                    "p1": me,
                    "p2": bot["player_id"],
                    "p3": other["player_id"],
                },
            },
        )
        assert r.status_code == 200, r.text
        game = session_manager.get_room(code).game
        assert game.ruleset.id == "mini"

        def policy(h, state):
            if not h.actions:
                return {"action": "place_tile", "tile": "2A"}  # founds a chain
            if state["awaiting"]["decision"] == "buy_stocks":
                # 4 shares in one turn is legal on mini only (default: 3)
                founded = h.actions[1]["chain"]
                return {"action": "buy_stocks", "purchases": {founded: 4}}
            return None

        human.play(on_state=policy, stop=lambda m: m["current_player"] != me)
    assert not human.errors, human.errors
    kinds = [a["action"] for a in human.actions]
    assert kinds[:3] == ["place_tile", "found_chain", "buy_stocks"], kinds
    assert human.actions[1]["chain"] in load_ruleset("mini").chain_ids
    assert game.get_player(me).get_stock_count(human.actions[1]["chain"]) >= 4
