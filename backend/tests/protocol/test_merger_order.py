"""Merger order through the real server: the seat that placed the merging tile
picks which same-size defunct chain is resolved first.

A human gets the ``choose_merger_order`` prompt over the WebSocket and answers
with ``merger_order``; a bot in the same seat answers by itself. The position
is reached by real moves (``tests.gameplay.test_merger_order.three_twos``)."""

from __future__ import annotations

from app_state import session_manager
from game.snapshot import to_snapshot
from tests.gameplay.test_merger_order import three_twos
from tests.protocol.helpers import HumanClient, add_seat, create_room, recv_until


def order_snapshot() -> dict:
    """p1 merged three 2-tile chains and chose halcyon as survivor; marlowe
    (p1 holds 1) and sandpiper (p2 holds 1) are tied: p1 picks the order."""
    t = three_twos()
    t.place("5E")
    t.act("p1", action="merger_choice", surviving_chain="halcyon")
    assert t.game.pending_action["type"] == "choose_defunct_order"
    return to_snapshot(t.game)


def _load(client, code, seat_map):
    r = client.post(
        f"/test/room/{code}/load-snapshot",
        json={"snapshot": order_snapshot(), "seat_map": seat_map},
    )
    assert r.status_code == 200, r.text


def test_human_placer_is_prompted_and_answers_over_the_websocket(app_client):
    client = app_client
    code, me = create_room(client, "Human")
    bot = add_seat(client, code, "bot")
    scripted = add_seat(client, code, "scripted")
    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        HumanClient(ws, me).recv()  # lobby
        _load(
            client,
            code,
            {"p1": me, "p2": bot["player_id"], "p3": scripted["player_id"]},
        )
        prompt = recv_until(ws, lambda m: m["type"] == "choose_merger_order")
        assert prompt == {
            "type": "choose_merger_order",
            "tied_chains": ["marlowe", "sandpiper"],
            "surviving_chain": "halcyon",
        }
        state = recv_until(ws, lambda m: m["type"] == "game_state")
        assert state["awaiting"]["player_id"] == me
        assert state["awaiting"]["decision"] == "choose_defunct_order"
        # Both tied chains are still on the board with their holders (the
        # panel reads size, price and bonuses from here).
        assert {"marlowe", "sandpiper"} <= set(state["chain_holders"])

        # A chain that is not tied is refused and the decision stays open.
        ws.send_json({"action": "merger_order", "defunct_chain": "halcyon"})
        err = recv_until(ws, lambda m: m["type"] == "error")
        assert "tied" in err["message"]

        ws.send_json({"action": "merger_order", "defunct_chain": "sandpiper"})
        # The bot (p2) disposes its sandpiper share by itself; then the human
        # is asked about marlowe, the chain it put second.
        disp = recv_until(ws, lambda m: m["type"] == "stock_disposition_required")
        assert disp["defunct_chain"] == "marlowe"

    game = session_manager.get_room(code).game
    chosen = [e for e in game.events if e["type"] == "defunct_order_chosen"]
    assert [(e["player_id"], e["chain"]) for e in chosen] == [(me, "sandpiper")]
    paid = [e["chain"] for e in game.events if e["type"] == "bonuses_paid"]
    assert paid == ["sandpiper", "marlowe"]


def test_bot_placer_answers_by_itself(app_client):
    client = app_client
    code, me = create_room(client, "Human")
    bot = add_seat(client, code, "bot")
    scripted = add_seat(client, code, "scripted")
    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        HumanClient(ws, me).recv()  # lobby
        _load(
            client,
            code,
            {"p1": bot["player_id"], "p2": me, "p3": scripted["player_id"]},
        )
        # The bot holds marlowe (1 share) and no sandpiper: it resolves marlowe
        # first, disposes of it, and only then is the human asked.
        log: list[dict] = []
        disp = recv_until(ws, lambda m: m["type"] == "stock_disposition_required", log)
        assert disp["defunct_chain"] == "sandpiper"
        # The order prompt goes to the deciding human only: never to this one.
        assert not [m for m in log if m["type"] == "choose_merger_order"]

    game = session_manager.get_room(code).game
    chosen = [e for e in game.events if e["type"] == "defunct_order_chosen"]
    assert [(e["player_id"], e["chain"]) for e in chosen] == [
        (bot["player_id"], "marlowe")
    ]
    paid = [e["chain"] for e in game.events if e["type"] == "bonuses_paid"]
    assert paid == ["marlowe", "sandpiper"]
