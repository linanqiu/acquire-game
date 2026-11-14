"""Seat driver behaviour over the real protocol: fallbacks, awaiting, trades,
locking, reconnects."""

from __future__ import annotations

import asyncio
import time

import pytest

from agents.scripted import default_action
from app_state import session_manager
from tests.protocol.helpers import (
    HumanClient,
    add_seat,
    configure,
    create_room,
    debug,
    recv_until,
    start,
    watch_until_game_over,
)


def install_fake_llms(monkeypatch, factories: dict):
    """Expose ``factories`` ({id: callable(name) -> agent}) as LLM catalog entries."""
    from agents.llm import config as llm_config

    entries = [
        {"id": i, "kind": "llm", "label": i, "description": "", "available": True}
        for i in factories
    ]
    monkeypatch.setattr(llm_config, "catalog_entries", lambda: entries)
    monkeypatch.setattr(
        llm_config, "create_agent", lambda agent_id, *, name: factories[agent_id](name)
    )


class Raiser:
    kind = "llm"

    def __init__(self, name):
        self.notes = []

    async def decide(self, ctx):
        raise RuntimeError("provider exploded")

    def note_fallback(self, reason):
        self.notes.append(reason)


class Illegal:
    kind = "llm"

    def __init__(self, name):
        self.n = 0

    async def decide(self, ctx):
        self.n += 1
        # alternate: wrong action type for the decision / malformed tile
        if self.n % 2:
            return {"action": "place_tile", "tile": "13Z"}
        return {"action": "found_chain", "chain": "NotAChain"}


class Sleeper:
    """Times out on its first two decisions, then plays legally."""

    kind = "llm"

    def __init__(self, name):
        self.n = 0

    async def decide(self, ctx):
        self.n += 1
        if self.n <= 2:
            await asyncio.sleep(5)
        return default_action(ctx)


class Proposer:
    """Proposes a trade at every buy decision, forever (runaway guard)."""

    kind = "llm"

    def __init__(self, name):
        self.proposals = 0

    async def decide(self, ctx):
        if ctx.decision.kind == "buy_stocks":
            others = [p["player_id"] for p in ctx.state["players"]]
            to = next(p for p in others if p != ctx.player_id)
            self.proposals += 1
            return {
                "action": "propose_trade",
                "to_player_id": to,
                "offering_money": 1,
            }
        return default_action(ctx)


@pytest.mark.slow
def test_failing_llm_seats_fall_back_and_game_completes(app_client, monkeypatch):
    """(c) raise / timeout / illegal answers -> heuristic fallback, counted."""
    from config import get_settings

    monkeypatch.setattr(get_settings(), "llm_decision_timeout", 0.2)
    made = {}

    def track(cls):
        def factory(name):
            made[cls.__name__] = cls(name)
            return made[cls.__name__]

        return factory

    install_fake_llms(
        monkeypatch,
        {"llm:raise": track(Raiser), "llm:illegal": track(Illegal), "llm:sleep": track(Sleeper)},
    )
    code = app_client.post("/create-spectator").json()["room_code"]
    for agent_id in ("llm:raise", "llm:illegal", "llm:sleep"):
        add_seat(app_client, code, agent_id)
    configure(app_client, code, 5)
    with app_client.websocket_connect(f"/ws/host/{code}") as host:
        start(app_client, code)
        final = watch_until_game_over(host)

    assert final["phase"] == "game_over"
    info = debug(app_client, code)
    reasons = [f["reason"] for f in info["fallbacks"]]
    kinds = info["fallback_kinds"]
    assert info["fallback_count"] == sum(kinds.values()) > 10
    assert kinds["timeout"] == 2  # the sleeper's first two decisions
    assert kinds["error"] > 0 and kinds["illegal"] > 0
    assert any("provider exploded" in r for r in reasons)
    assert any("not offered" in r or "Invalid" in r for r in reasons)
    assert made["Raiser"].notes, "note_fallback() must be called"
    assert info["stalled"] is None


@pytest.mark.slow
def test_runaway_trade_proposals_are_capped(app_client, monkeypatch):
    install_fake_llms(monkeypatch, {"llm:prop": Proposer})
    code = app_client.post("/create-spectator").json()["room_code"]
    add_seat(app_client, code, "llm:prop")
    add_seat(app_client, code, "bot")
    add_seat(app_client, code, "bot")
    configure(app_client, code, 9)
    with app_client.websocket_connect(f"/ws/host/{code}") as host:
        start(app_client, code)
        final = watch_until_game_over(host)
    assert final["phase"] == "game_over"
    info = debug(app_client, code)
    assert info["fallback_kinds"].get("cap", 0) > 0


class Gate:
    """LLM seat that thinks until the test opens the gate (thread-safe flag)."""

    kind = "llm"
    opened = False
    thinking = False

    def __init__(self, name):
        pass

    async def decide(self, ctx):
        if ctx.decision.kind != "trade_response":
            Gate.thinking = True
            while not Gate.opened:
                await asyncio.sleep(0.01)
        return default_action(ctx)


def test_awaiting_and_trade_while_agent_thinks(app_client, monkeypatch):
    """(d) `awaiting` shows the thinking agent; a human trade proposal made
    meanwhile is processed (the lock is not held across decide())."""
    Gate.opened = False
    Gate.thinking = False
    install_fake_llms(monkeypatch, {"llm:gate": Gate})
    code, me = create_room(app_client)
    llm = add_seat(app_client, code, "llm:gate")
    add_seat(app_client, code, "scripted")
    configure(app_client, code, 4)
    try:
        with app_client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
            human = HumanClient(ws, me)
            human.recv()
            start(app_client, code)
            # Play my first turn (place + buy) until the LLM seat is up.
            state = human.play(
                stop=lambda m: (m.get("awaiting") or {}).get("player_id")
                == llm["player_id"]
            )
            assert state["awaiting"] == {
                "player_id": llm["player_id"],
                "kind": "llm",
                "decision": "place_tile",
            }
            deadline = time.monotonic() + 5
            while not Gate.thinking:
                assert time.monotonic() < deadline
                time.sleep(0.01)
            ws.send_json(
                {
                    "action": "propose_trade",
                    "to_player_id": llm["player_id"],
                    "offering_money": 100,
                }
            )
            msg = recv_until(ws, lambda m: m["type"] in ("trade_proposed", "error"))
            assert msg["type"] == "trade_proposed", msg
            assert msg["trade"]["to_player_id"] == llm["player_id"]
            assert Gate.thinking and not Gate.opened  # agent still thinking
            Gate.opened = True
            # The agent answers its turn and the offer (default: reject).
            msg = recv_until(ws, lambda m: m["type"] == "trade_rejected")
            assert msg["rejected_by"] == llm["player_id"]
    finally:
        Gate.opened = True


def test_bot_answers_human_trade_offers(app_client):
    """(e) An agent seat answers a human's offer: gift accepted, bad deal rejected."""
    code, me = create_room(app_client)
    bot = add_seat(app_client, code, "bot")
    add_seat(app_client, code, "scripted")
    with app_client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        human = HumanClient(ws, me)
        human.recv()
        start(app_client, code)
        recv_until(ws, lambda m: m["type"] == "game_state" and human.my_turn(m))
        ws.send_json(
            {"action": "propose_trade", "to_player_id": bot["player_id"], "offering_money": 500}
        )
        acc = recv_until(ws, lambda m: m["type"] in ("trade_accepted", "trade_rejected"))
        assert acc["type"] == "trade_accepted"
        assert acc["from_player"] == me and acc["to_player"] == bot["player_id"]
        state = recv_until(ws, lambda m: m["type"] == "game_state")
        assert state["players"][me]["money"] == 5500
        assert state["players"][bot["player_id"]]["money"] == 6500
        ws.send_json(
            {
                "action": "propose_trade",
                "to_player_id": bot["player_id"],
                "requesting_money": 1000,
            }
        )
        rej = recv_until(ws, lambda m: m["type"] in ("trade_accepted", "trade_rejected"))
        assert rej["type"] == "trade_rejected"
        assert rej["rejected_by"] == bot["player_id"]


def test_reconnect_mid_game_gets_full_state(app_client):
    """(h) Closing and reopening the socket mid-game re-sends everything."""
    code, me = create_room(app_client)
    add_seat(app_client, code, "scripted")
    add_seat(app_client, code, "scripted")
    with app_client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        human = HumanClient(ws, me)
        human.recv()
        start(app_client, code)
        state = recv_until(ws, lambda m: m["type"] == "game_state" and human.my_turn(m))
        human.act(human.choose(state))  # place a tile
        before = recv_until(
            ws, lambda m: m["type"] == "game_state" and m["phase"] != "place_tile"
        )
    with app_client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        again = recv_until(ws, lambda m: m["type"] == "game_state")
        for key in ("board", "hotel", "players", "phase", "current_player", "your_hand"):
            assert again[key] == before[key], key
        assert again["awaiting"]["player_id"] == me
        assert "tile_playability" in again and "end_game_available" in again
        # still playable after reconnecting
        ws.send_json({"action": "buy_stocks", "purchases": {}})
        nxt = recv_until(ws, lambda m: m["type"] in ("game_state", "error"))
        assert nxt["type"] == "game_state"


@pytest.mark.slow
@pytest.mark.asyncio
async def test_concurrent_actions_never_interleave(clean_session_manager):
    """(g) Two humans and an agent act simultaneously for 200 rounds: every
    accepted trade is applied exactly once and money is conserved."""
    from seats import human_action, kick, wait_idle

    code = clean_session_manager.create_room()
    clean_session_manager.join_room(code, "h1", "Ann")
    clean_session_manager.join_room(code, "h2", "Ben")
    bot_id = clean_session_manager.add_bot(code)
    clean_session_manager.start_game(code)
    from lifecycle import initialize_game

    await initialize_game(code)
    room = clean_session_manager.get_room(code)
    game = room.game
    total = sum(p.money for p in game.players)

    async def gift(src):
        return await human_action(
            code, src, {"action": "propose_trade", "to_player_id": bot_id, "offering_money": 1}
        )

    results = []
    for _ in range(200):
        results += await asyncio.gather(gift("h1"), gift("h2"))
        kick(code)
    await wait_idle(code)
    accepted = [e for e in game.events if e["type"] == "trade_accepted"]
    proposed = [e for e in game.events if e["type"] == "trade_proposed"]
    assert len(proposed) == sum(1 for r in results if r["success"])
    assert len(accepted) == len(proposed)  # bot accepts every gift, exactly once
    assert len({e["trade"]["trade_id"] for e in accepted}) == len(accepted)
    assert game.get_player(bot_id).money == 6000 + len(accepted)
    assert sum(p.money for p in game.players) == total
    assert not game.pending_trades


@pytest.mark.asyncio
async def test_two_concurrent_place_tiles_only_one_applies(clean_session_manager):
    """(g) The lock serialises: a slow broadcast inside the first action does
    not let a second placement from the same player slip in."""
    from lifecycle import initialize_game
    from seats import human_action

    code = clean_session_manager.create_room()
    for pid, name in (("p1", "A"), ("p2", "B"), ("p3", "C")):
        clean_session_manager.join_room(code, pid, name)
    clean_session_manager.start_game(code)
    await initialize_game(code)
    game = clean_session_manager.get_room(code).game
    cur = game.get_current_player_id()
    tiles = [
        str(t)
        for t in game.get_player(cur).hand
        if not game.board.get_adjacent_played_tiles(t)
    ][:2]
    assert len(tiles) == 2

    real = session_manager.send_to_host

    async def slow_host(rc, msg):
        await asyncio.sleep(0.05)
        await real(rc, msg)

    session_manager.send_to_host = slow_host
    try:
        r1, r2 = await asyncio.gather(
            human_action(code, cur, {"action": "place_tile", "tile": tiles[0]}),
            human_action(code, cur, {"action": "place_tile", "tile": tiles[1]}),
        )
    finally:
        del session_manager.send_to_host
    assert [r1["success"], r2["success"]].count(True) == 1
    placed = [e for e in game.events if e["type"] == "tile_placed"]
    assert len(placed) == 1
