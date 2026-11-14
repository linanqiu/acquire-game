"""(f) Test-mode snapshot loading: restore mid-merger, a human finishes the
stock disposition, the game carries on with agent seats."""

from __future__ import annotations

from app_state import session_manager
from game.board import Tile
from game.decisions import apply_action, pending_decisions
from game.game import Game
from game.snapshot import to_snapshot
from tests.protocol.helpers import HumanClient, add_seat, create_room, recv_until


def disposition_snapshot() -> dict:
    """p1 (current) merges Tower into Luxor; p2 holds Tower stock -> p2 disposes."""
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
        game.board.set_chain(Tile(c, "A"), "Luxor")
    for c in (5, 6):
        game.board.place_tile(Tile(c, "A"))
        game.board.set_chain(Tile(c, "A"), "Tower")
    game.hotel.activate_chain("Luxor")
    game.hotel.activate_chain("Tower")
    game.players[1]._stocks["Tower"] = 3
    game.hotel._available_stocks["Tower"] -= 3
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
            "defunct_chain": "Tower",
            "surviving_chain": "Luxor",
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
        assert state["players"][me]["stocks"]["Tower"] == 3
        ws.send_json(
            {
                "action": "merger_disposition",
                "defunct_chain": "Tower",
                "disposition": {"sell": 1, "trade": 2, "hold": 0},
            }
        )
        # The bot (p1) resumes: buys, ends its turn; then it's my turn.
        state = recv_until(
            ws,
            lambda m: m["type"] == "game_state"
            and (m.get("awaiting") or {}).get("player_id") == me,
        )
        assert state["awaiting"]["decision"] == "place_tile"
        assert state["players"][me]["stocks"]["Tower"] == 0
        assert state["players"][me]["stocks"]["Luxor"] == 1
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
    r = client.post(f"/test/room/{code}/load-snapshot", json={"snapshot": disposition_snapshot()})
    assert r.status_code == 200
    assert r.json()["players"][0] == me
    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        state = recv_until(
            ws,
            lambda m: m["type"] == "game_state"
            and (m.get("awaiting") or {}).get("player_id") == me,
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
    code, me = create_room(client)
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
