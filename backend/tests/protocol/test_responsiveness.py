"""Responsiveness guards (BL-020): how many states a player is sent per move,
that an unchanged state is not sent twice, that a new socket still gets the
state, and that agent pacing overlaps a slow seat's think time.

Measured before BL-020 (1 human + 3 rules bots): about 2 ``game_state``
messages per bot move (the "thinking" state, identical to the state before it
for a bot, plus the move), and a fixed 0.4 s pause after every agent move on
top of its think time.
"""

from __future__ import annotations

import asyncio
import json
import time

from agents.scripted import default_action
from config import get_settings
from tests.protocol.helpers import (
    HumanClient,
    add_seat,
    configure,
    create_room,
    debug,
    recv_until,
    start,
)
from tests.protocol.test_driver import install_fake_llms


def _play_turns(human: HumanClient, turns: int, state: dict | None = None) -> dict:
    """Play until ``turns`` tiles placed in all and it is my turn again
    (``state``: the state a previous call stopped at)."""

    def stop(s):
        placed = sum(1 for a in human.actions if a["action"] == "place_tile")
        return placed >= turns and human.my_turn(s)

    return human.play(stop=stop, state=state)


def test_one_state_per_move_and_never_the_same_state_twice(app_client):
    client = app_client
    code, me = create_room(client, "Alice")
    for _ in range(3):
        add_seat(client, code, "bot")
    configure(client, code, 7)
    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        human = HumanClient(ws, me)
        human.recv()  # lobby
        start(client, code)
        _play_turns(human, 8)
    states = [m for m in human.messages if m["type"] == "game_state"]
    texts = [json.dumps(s, sort_keys=True) for s in states]
    repeats = sum(1 for a, b in zip(texts, texts[1:]) if a == b)
    assert repeats == 0, f"{repeats} identical game_state messages in a row"

    agent_moves = debug(client, code)["agent_actions"]
    # A human buy also ends the turn (two engine actions, two states).
    human_moves = 2 * len(human.actions)
    assert agent_moves >= 3 * 8 * 2, agent_moves  # the bots really played
    # At most one state per move (plus the opening state and the odd trade
    # answer shown as "thinking"); before BL-020 it was about two per bot move.
    assert len(states) <= agent_moves + human_moves + 5, (
        len(states),
        agent_moves,
        human_moves,
    )


def test_a_new_socket_gets_the_state_even_when_unchanged(app_client):
    client = app_client
    code, me = create_room(client, "Alice")
    add_seat(client, code, "bot")
    add_seat(client, code, "bot")
    configure(client, code, 7)
    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        human = HumanClient(ws, me)
        human.recv()
        start(client, code)
        state = _play_turns(human, 2)
        # Same player, second device: it is sent the current state at once.
        with client.websocket_connect(f"/ws/player/{code}/{me}") as ws2:
            again = recv_until(ws2, lambda m: m.get("type") == "game_state")
            assert again["board"] == state["board"]
            assert again["your_hand"] == state["your_hand"]
        # The host display too.
        with client.websocket_connect(f"/ws/host/{code}") as host:
            seen = recv_until(host, lambda m: m.get("type") == "game_state")
            assert seen["board"] == state["board"]
            assert "your_hand" not in seen
        # And an explicit refresh re-sends it to that player.
        r = client.post(f"/room/{code}/refresh/{me}")
        assert r.status_code == 200
        refreshed = recv_until(ws, lambda m: m.get("type") == "game_state")
        assert refreshed["board"] == state["board"]


class SlowSeat:
    """An LLM-like seat that thinks for ``THINK`` seconds per decision."""

    kind = "llm"
    THINK = 0.25

    def __init__(self, name):
        self.name = name

    async def decide(self, ctx):
        await asyncio.sleep(self.THINK)
        return default_action(ctx)


def test_pacing_overlaps_a_slow_seats_think_time(app_client, monkeypatch):
    """The pause after an agent move is a minimum gap, not an extra wait: a
    seat that thinks longer than the pause adds no pause of its own."""
    pause = 0.25
    monkeypatch.setattr(get_settings(), "test_mode_agent_action_delay", pause)
    install_fake_llms(monkeypatch, {"llm:slow": SlowSeat})
    client = app_client
    code, me = create_room(client, "Alice")
    add_seat(client, code, "llm:slow")
    add_seat(client, code, "llm:slow")
    configure(client, code, 7)
    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        human = HumanClient(ws, me)
        human.recv()
        start(client, code)
        state = _play_turns(human, 1)
        before = debug(client, code)["agent_actions"]
        t0 = time.monotonic()
        _play_turns(human, 4, state)
        elapsed = time.monotonic() - t0
        moves = debug(client, code)["agent_actions"] - before
    assert moves >= 8, moves
    # Think + pause in sequence would take moves * 0.5 s; overlapped, about
    # moves * 0.25 s (plus the human's moves, which are immediate).
    assert elapsed < moves * (SlowSeat.THINK + pause) * 0.8, (elapsed, moves)


def test_bot_turns_read_as_one_quick_sequence(monkeypatch):
    """Outside test mode: a short pause between the moves of one seat's turn,
    a longer one when the game moves on to another seat. A rules bot's usual
    turn (place, buy, end turn) is paced at about half a second (1.2 s at
    0.4 s per move before BL-020)."""
    import seats

    monkeypatch.delenv("GAME_TEST_MODE", raising=False)
    s = get_settings()
    step, turn = seats._pacing_delay(True), seats._pacing_delay(False)
    assert step == s.agent_step_delay
    assert turn == s.agent_action_delay
    assert step < turn
    assert 2 * step + turn <= 0.6
