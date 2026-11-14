"""Record the REAL WebSocket messages the backend sends, for the frontend unit tests.

Usage (from the repo root):

    ACQUIRE_TEST_MODE=1 python3 frontend/tests/unit/fixtures/generate_wire_messages.py

Nothing is hand-written. Two sources, both through the FastAPI app (TestClient):

* every generated engine snapshot in ``frontend/tests/e2e/fixtures/snapshots/`` is loaded
  into a room (test-mode endpoint, as the screen tests do) and the human's player
  WebSocket and the host WebSocket are read when they connect: ``player`` is what the
  seat receives (prompt messages, the ``game_state`` with private fields, ``game_over``),
  ``host`` the spectator's ``game_state``;
* one short real game per shipped ruleset (classic, valley, mini): a scripted human
  plays the first turns against a bot and a scripted seat, the first ``game_state`` of
  every phase/decision the human faces is kept (so the unit tests see each ruleset's own
  board size, chains, prices and limits).

Writes ``wire-messages.json`` next to this file.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
BACKEND = ROOT / "backend"
SNAPSHOTS = ROOT / "frontend" / "tests" / "e2e" / "fixtures" / "snapshots"

os.environ["ACQUIRE_TEST_MODE"] = "1"
os.environ["ACQUIRE_TEST_MODE_ACTION_DELAY"] = "0"
sys.path.insert(0, str(BACKEND))

PROMPTS = ("choose_chain", "choose_merger_survivor", "stock_disposition_required")


def drain(ws, until) -> list[dict]:
    """Read messages (answering pings) until ``until(msg)``; returns them all."""
    out: list[dict] = []
    while True:
        msg = ws.receive_json()
        if msg.get("type") == "ping":
            ws.send_json({"type": "pong"})
            continue
        out.append(msg)
        if msg.get("type") == "error":
            raise AssertionError(f"server refused the action: {msg}")
        if until(msg):
            return out


def snapshot_views(client, name: str, spec: dict) -> dict:
    from tests.protocol.helpers import add_seat, create_room

    snap = spec["snapshot"]
    n = len(snap["players"])
    code, me = create_room(client, "Alice")
    others = [add_seat(client, code, "scripted") for _ in range(n - 1)]
    seat_map = {"p1": me}
    for i, seat in enumerate(others):
        seat_map[f"p{i + 2}"] = seat["player_id"]
    with client.websocket_connect(f"/ws/host/{code}") as host:
        drain(host, lambda m: m.get("type") == "lobby_update")
        with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
            drain(ws, lambda m: m.get("type") == "lobby_update")
            r = client.post(
                f"/test/room/{code}/load-snapshot",
                json={"snapshot": snap, "seat_map": seat_map},
            )
            assert r.status_code == 200, r.text
            host_msgs = drain(host, lambda m: m.get("type") == "game_state")
            got = drain(ws, lambda m: m.get("type") == "game_state")
            state = got[-1]
            after: list[dict] = []
            prompt = next((m for m in got if m["type"] == "stock_disposition_required"), None)
            if prompt and name == "disposition-human-first":
                # The human sells everything; keep what the server sends next.
                ws.send_json(
                    {
                        "action": "merger_disposition",
                        "defunct_chain": prompt["defunct_chain"],
                        "disposition": {"sell": prompt["stock_count"], "trade": 0, "hold": 0},
                    }
                )
                after = drain(
                    ws,
                    lambda m: m.get("type") == "game_state"
                    and m["awaiting"] != state["awaiting"],
                )
    extra: list[dict] = []
    if state["phase"] == "game_over":
        with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
            extra = drain(ws, lambda m: m.get("type") == "game_over")
    msgs = got + extra
    return {
        "description": spec["description"],
        "human": me,
        "seats": {"p1": me, **{f"p{i + 2}": s["player_id"] for i, s in enumerate(others)}},
        "player": msgs,
        "after_disposition": after,
        "host": [m for m in host_msgs if m["type"] == "game_state"][-1],
        "expect": spec["expect"],
    }


def trade_events(client, snapshots: dict) -> dict:
    """The messages a trade's lifecycle sends, each driven through the real server."""
    from tests.protocol.helpers import add_seat, create_room

    def room_with(name):
        spec = json.loads((SNAPSHOTS / f"{name}.json").read_text())
        snap = spec["snapshot"]
        code, me = create_room(client, "Alice")
        others = [add_seat(client, code, "scripted") for _ in range(len(snap["players"]) - 1)]
        seat_map = {"p1": me, **{f"p{i + 2}": o["player_id"] for i, o in enumerate(others)}}
        return code, me, snap, seat_map

    out: dict = {}

    def run(label, fixture, make_action, until):
        code, me, snap, seat_map = room_with(fixture)
        with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
            drain(ws, lambda m: m.get("type") == "lobby_update")
            client.post(
                f"/test/room/{code}/load-snapshot",
                json={"snapshot": snap, "seat_map": seat_map},
            )
            state = drain(ws, lambda m: m.get("type") == "game_state")[-1]
            ws.send_json(make_action(state))
            out[label] = drain(ws, until)[-1]

    run(
        "accepted",
        "trade-incoming",
        lambda st: {"action": "accept_trade", "trade_id": st["incoming_trades"][0]["trade_id"]},
        lambda m: m.get("type") == "trade_accepted",
    )
    run(
        "rejected",
        "trade-incoming",
        lambda st: {"action": "reject_trade", "trade_id": st["incoming_trades"][0]["trade_id"]},
        lambda m: m.get("type") == "trade_rejected",
    )
    run(
        "proposed",
        "trade-incoming",
        lambda st: {
            "action": "propose_trade",
            "to_player_id": st["incoming_trades"][0]["from_player_id"],
            "offering_money": 500,
            "requesting_stocks": {next(iter(st["incoming_trades"][0]["offering_stocks"])): 1},
        },
        lambda m: m.get("type") == "trade_proposed",
    )
    # The human cancels the offer it just made. The recipient is a second human (an agent
    # seat would answer at once), seated where the snapshot's trading partner sat.
    from tests.protocol.helpers import join_room

    spec = json.loads((SNAPSHOTS / "trade-incoming.json").read_text())
    snap = spec["snapshot"]
    code, me = create_room(client, "Alice")
    bob = join_room(client, code, "Bob")
    rest = [add_seat(client, code, "scripted") for _ in range(len(snap["players"]) - 2)]
    ids = [p["player_id"] for p in snap["players"] if p["player_id"] != "p1"]
    seat_map = {"p1": me, ids[0]: bob, **{o: r["player_id"] for o, r in zip(ids[1:], rest)}}
    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        drain(ws, lambda m: m.get("type") == "lobby_update")
        client.post(
            f"/test/room/{code}/load-snapshot", json={"snapshot": snap, "seat_map": seat_map}
        )
        st = drain(ws, lambda m: m.get("type") == "game_state")[-1]

        ws.send_json(
            {
                "action": "propose_trade",
                "to_player_id": bob,
                "offering_money": 500,
                "requesting_money": 100,
            }
        )
        proposed = drain(ws, lambda m: m.get("type") == "trade_proposed")[-1]
        ws.send_json({"action": "cancel_trade", "trade_id": proposed["trade"]["trade_id"]})
        out["canceled"] = drain(ws, lambda m: m.get("type") == "trade_canceled")[-1]
    return out


def refusals(client) -> list[str]:
    """What the server says when a player does something it does not allow (real messages)."""
    from tests.protocol.helpers import add_seat, create_room

    spec = json.loads((SNAPSHOTS / "opening-place-tile.json").read_text())
    snap = spec["snapshot"]
    code, me = create_room(client, "Alice")
    others = [add_seat(client, code, "scripted") for _ in range(len(snap["players"]) - 1)]
    seat_map = {"p1": me, **{f"p{i + 2}": o["player_id"] for i, o in enumerate(others)}}
    out: list[str] = []
    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        drain(ws, lambda m: m.get("type") == "lobby_update")
        client.post(
            f"/test/room/{code}/load-snapshot", json={"snapshot": snap, "seat_map": seat_map}
        )
        state = drain(ws, lambda m: m.get("type") == "game_state")[-1]
        held = set(state["your_hand"])
        absent = next(
            f"{c}{r}" for c in range(1, 13) for r in "ABCDEFGHI" if f"{c}{r}" not in held
        )
        attempts = [
            {"action": "place_tile", "tile": absent},
            {"action": "buy_stocks", "purchases": {"Luxor": 1}},
            {"action": "end_turn"},
            {"action": "found_chain", "chain": "Luxor"},
            {"action": "accept_trade", "trade_id": "nope"},
            {"action": "cancel_trade", "trade_id": "nope"},
            {"action": "merger_choice", "surviving_chain": "Luxor"},
        ]
        for attempt in attempts:
            ws.send_json(attempt)
            while True:
                msg = ws.receive_json()
                if msg.get("type") == "ping":
                    ws.send_json({"type": "pong"})
                    continue
                if msg.get("type") == "error":
                    out.append(msg["message"])
                    break
                if msg.get("type") == "game_state":
                    break  # accepted (not a refusal): nothing to record
        ws.send_text("{not json")
        while True:
            msg = ws.receive_json()
            if msg.get("type") == "error":
                out.append(msg["message"])
                break
    return list(dict.fromkeys(out))


def home_page_api(client) -> dict:
    """The answers of the home page's routes: create, join, spectator, and each refusal."""
    from tests.protocol.helpers import add_seat, start

    def form(path, **data):
        r = client.post(path, data=data)
        return {"status": r.status_code, "body": r.json()}

    out = {}
    out["create"] = form("/create", player_name="Alice")
    code = out["create"]["body"]["room_code"]
    out["join"] = form("/join", room_code=code.lower(), player_name="Bob")
    out["spectator"] = form("/create-spectator")
    out["join_unknown_room"] = form("/join", room_code="ZZZZ", player_name="Bob")
    out["join_duplicate_name"] = form("/join", room_code=code, player_name="bob")
    full = form("/create", player_name="Host")["body"]["room_code"]
    for _ in range(5):
        add_seat(client, full, "bot")
    out["join_full_room"] = form("/join", room_code=full, player_name="Late")
    started = form("/create", player_name="Host")["body"]["room_code"]
    add_seat(client, started, "bot")
    add_seat(client, started, "bot")
    start(client, started)
    out["join_started_game"] = form("/join", room_code=started, player_name="Late")
    return out


def played_game(client, ruleset: str, seed: int) -> dict:
    from config import get_settings
    from tests.protocol.helpers import (
        HumanClient,
        add_seat,
        configure,
        create_room,
        start,
    )

    get_settings().game_ruleset = ruleset
    code, me = create_room(client, "Alice")
    add_seat(client, code, "bot")
    add_seat(client, code, "scripted")
    configure(client, code, seed)
    kept: dict[str, dict] = {}
    prompts: dict[str, dict] = {}
    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        human = HumanClient(ws, me)
        lobby = human.recv()  # the lobby as a joining player sees it: human, bot, scripted
        start(client, code)

        def keep(h, state):
            aw = state.get("awaiting") or {}
            key = f"{state['phase']}/{aw.get('decision')}"
            if key not in kept:
                kept[key] = state
            # A buy turn that has chains to buy into and cash to do it with (the first one
            # of the game usually has neither).
            me = state["players"][h.player_id]
            if (
                key == "buy_stocks/buy_stocks"
                and "buy_stocks/with_chains" not in kept
                and len(state["hotel"]["active_chains"]) >= 2
                and me["money"] >= 1800
            ):
                kept["buy_stocks/with_chains"] = state
            for t, p in h.prompts.items():
                prompts.setdefault(t, p)
            return None

        final = human.play(max_actions=900, on_state=keep, deadline_s=120)
        game_over = next(
            (m for m in reversed(human.messages) if m["type"] == "game_over"), None
        )
    return {
        "lobby": lobby,
        "states": kept,
        "prompts": prompts,
        "final": final,
        "game_over": game_over,
    }


def main() -> None:
    from fastapi.testclient import TestClient

    from app_state import session_manager
    from config import get_settings
    from main import create_app

    s = get_settings()
    s.bot_decision_timeout = s.scripted_decision_timeout = s.llm_decision_timeout = 5.0
    s.test_mode_agent_action_delay = 0.0
    session_manager._rooms.clear()

    out: dict = {"snapshots": {}, "games": {}, "trades": {}, "refusals": [], "catalog": [], "home": {}}
    index = json.loads((SNAPSHOTS / "index.json").read_text())
    with TestClient(create_app()) as client:
        for entry in index["fixtures"]:
            spec = json.loads((SNAPSHOTS / entry["file"]).read_text())
            out["snapshots"][entry["name"]] = snapshot_views(client, entry["name"], spec)
        out["trades"] = trade_events(client, out["snapshots"])
        out["refusals"] = refusals(client)
        out["catalog"] = client.get("/agents/catalog").json()
        out["home"] = home_page_api(client)
        for ruleset, seed in (("classic", 3), ("valley", 3), ("mini", 4)):
            out["games"][ruleset] = played_game(client, ruleset, seed)
        get_settings().game_ruleset = "classic"
    (HERE / "wire-messages.json").write_text(json.dumps(out, ensure_ascii=False) + "\n")
    size = (HERE / "wire-messages.json").stat().st_size
    print(f"wrote wire-messages.json ({size} bytes)")


if __name__ == "__main__":
    main()
