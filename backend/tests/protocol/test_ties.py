"""A tie for first place through the real server: the human declares the end
of a game in which two players have equal cash. ``game_over`` lists both as
winners, the transcript footer and the ``/games`` routes agree."""

from __future__ import annotations

import pytest

from app_state import session_manager
from game.board import Tile
from game.game import Game
from game.ruleset import load_ruleset
from game.snapshot import to_snapshot
from tests.protocol.helpers import HumanClient, add_seat, create_room, recv_until

MINI = load_ruleset("mini")


def tie_snapshot() -> dict:
    """Mini game, p1 to move, a chain at the end-game size (declarable); nobody
    holds stock, so final scores are the cash: p1 = p2 = 7000, p3 = 5000."""
    g = Game(seed=1, ruleset=MINI)
    for pid in ("p1", "p2", "p3"):
        g.add_player(pid, pid.upper())
    g.start_game()
    cells = [Tile(c, r) for r in "ABC" for c in range(1, 10)][
        : MINI.end_game_chain_size
    ]
    reserved = set(cells)
    for p in g.players:
        for t in list(p.hand):
            if t in reserved:
                p.remove_tile(t)
    g.tile_bag = [t for t in g.tile_bag if t not in reserved]
    for p in g.players:
        while p.hand_size < MINI.hand_size:
            p.add_tile(g.tile_bag.pop())
    for t in cells:
        g.board.place_tile(t)
        g.board.set_chain(t, "harbor")
    g.hotel.activate_chain("harbor")
    for p, money in zip(g.players, (7000, 7000, 5000), strict=True):
        p._money = money
    g.resolve_unplayable_turn()
    assert g.get_current_player_id() == "p1" and g.can_declare_end_game()
    return to_snapshot(g)


@pytest.fixture
def tdir(tmp_path, monkeypatch):
    monkeypatch.setenv("ACQUIRE_TRANSCRIPT_DIR", str(tmp_path / "t"))
    monkeypatch.setenv("ACQUIRE_BENCH_DIR", str(tmp_path / "b"))


def test_tie_for_first_is_reported_consistently_everywhere(app_client, tdir):
    client = app_client
    code, me = create_room(client, "Human")
    bot = add_seat(client, code, "bot")
    other = add_seat(client, code, "bot")
    ids = {"p1": me, "p2": bot["player_id"], "p3": other["player_id"]}
    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        HumanClient(ws, me).recv()  # lobby
        r = client.post(
            f"/test/room/{code}/load-snapshot",
            json={"snapshot": tie_snapshot(), "seat_map": ids},
        )
        assert r.status_code == 200, r.text
        recv_until(
            ws, lambda m: m["type"] == "game_state" and m.get("end_game_available")
        )
        ws.send_json({"action": "declare_end_game"})
        over = recv_until(ws, lambda m: m["type"] == "game_over")

    # broadcast
    assert sorted(over["winners"]) == sorted([ids["p1"], ids["p2"]])
    assert over["winner"] in over["winners"]
    assert over["scores"][ids["p1"]]["money"] == over["scores"][ids["p2"]]["money"]

    # engine event
    game = session_manager.get_room(code).game
    ended = [e for e in game.events if e["type"] == "game_ended"][-1]
    assert sorted(ended["winners"]) == sorted([ids["p1"], ids["p2"]])
    ranks = {s["player_id"]: s["rank"] for s in ended["standings"]}
    assert ranks == {ids["p1"]: 1, ids["p2"]: 1, ids["p3"]: 3}

    # transcript footer and the HTTP routes
    gid = over["game_id"]
    t = client.get(f"/api/games/{gid}/transcript").json()
    assert not t["redacted"]
    assert {s["player_id"]: s["rank"] for s in t["footer"]["standings"]} == ranks
    detail = client.get(f"/api/games/{gid}").json()
    assert sorted(detail["winners"]) == sorted([ids["p1"], ids["p2"]])
    assert detail["ruleset_id"] == "mini"
    row = next(
        g
        for g in client.get("/api/games?source=live").json()["games"]
        if g["game_id"] == gid
    )
    assert sorted(row["winners"]) == sorted(detail["winners"])
