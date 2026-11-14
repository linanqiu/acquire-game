"""Client-side helpers for protocol tests (act only on what the server sends)."""

from __future__ import annotations

import json
import time
from collections.abc import Callable


def create_room(client, name: str = "Alice") -> tuple[str, str]:
    r = client.post("/create", data={"player_name": name})
    assert r.status_code == 200, r.text
    return r.json()["room_code"], r.json()["player_id"]


def join_room(client, code: str, name: str) -> str:
    r = client.post("/join", data={"room_code": code, "player_name": name})
    assert r.status_code == 200, r.text
    return r.json()["player_id"]


def add_seat(client, code: str, agent_id: str, **extra) -> dict:
    r = client.post(f"/room/{code}/add-seat", json={"agent_id": agent_id, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def start(client, code: str) -> None:
    r = client.post(f"/room/{code}/start")
    assert r.status_code == 200, r.text


def configure(client, code: str, seed: int) -> None:
    r = client.post(f"/room/{code}/configure", json={"seed": seed})
    assert r.status_code == 200, r.text


def debug(client, code: str) -> dict:
    r = client.get(f"/room/{code}/debug")
    assert r.status_code == 200, r.text
    return r.json()


def recv_until(ws, predicate: Callable[[dict], bool], log: list | None = None) -> dict:
    """Read messages until ``predicate(msg)``; pings are answered."""
    while True:
        msg = ws.receive_json()
        if msg.get("type") == "ping":
            ws.send_json({"type": "pong"})
            continue
        if log is not None:
            log.append(msg)
        if predicate(msg):
            return msg


def watch_until_game_over(ws, log: list | None = None) -> dict:
    return recv_until(
        ws,
        lambda m: m.get("type") == "game_state" and m.get("phase") == "game_over",
        log,
    )


def fingerprint(state: dict) -> str:
    """Everything an action can change (``awaiting`` excluded)."""
    keys = ("board", "hotel", "players", "phase", "current_player", "tiles_remaining")
    return json.dumps({k: state.get(k) for k in keys}, sort_keys=True)


class HumanClient:
    """A scripted 'human' that plays over a player WebSocket.

    Policy: first playable tile, first offered chain, sell-all dispositions,
    buy nothing (the server ends the turn), declare the end when offered.
    ``on_state`` may return an action dict to override the policy.
    """

    def __init__(self, ws, player_id: str):
        self.ws = ws
        self.player_id = player_id
        self.messages: list[dict] = []
        self.prompts: dict[str, dict] = {}
        self.errors: list[str] = []
        self.actions: list[dict] = []
        self.last_state: dict | None = None

    def recv(self) -> dict:
        while True:
            msg = self.ws.receive_json()
            if msg.get("type") == "ping":
                self.ws.send_json({"type": "pong"})
                continue
            self.messages.append(msg)
            t = msg.get("type")
            if t in (
                "choose_chain",
                "choose_merger_survivor",
                "stock_disposition_required",
            ):
                self.prompts[t] = msg
            elif t == "error":
                self.errors.append(msg["message"])
            elif t == "game_state":
                self.last_state = msg
            return msg

    def my_turn(self, state: dict) -> bool:
        aw = state.get("awaiting")
        return bool(aw) and aw["player_id"] == self.player_id and aw["kind"] == "human"

    def choose(self, state: dict) -> dict:
        decision = state["awaiting"]["decision"]
        if decision in ("place_tile", "buy_stocks") and state.get("end_game_available"):
            return {"action": "declare_end_game"}
        if decision == "place_tile":
            play = state.get("tile_playability") or {}
            tiles = [
                t for t in state["your_hand"] if play.get(t, {}).get("playable", True)
            ]
            return {"action": "place_tile", "tile": tiles[0]}
        if decision == "found_chain":
            return {
                "action": "found_chain",
                "chain": self.prompts["choose_chain"]["available_chains"][0],
            }
        if decision == "choose_survivor":
            return {
                "action": "merger_choice",
                "surviving_chain": self.prompts["choose_merger_survivor"][
                    "tied_chains"
                ][0],
            }
        if decision == "stock_disposition":
            p = self.prompts["stock_disposition_required"]
            return {
                "action": "merger_disposition",
                "defunct_chain": p["defunct_chain"],
                "disposition": {"sell": p["stock_count"], "trade": 0, "hold": 0},
            }
        if decision == "buy_stocks":
            return {"action": "buy_stocks", "purchases": {}}
        raise AssertionError(f"unexpected decision {decision}")

    def act(self, action: dict) -> None:
        self.actions.append(action)
        self.ws.send_json(action)

    def play(
        self,
        max_actions: int = 500,
        on_state=None,
        deadline_s: float = 50,
        stop=None,
        state: dict | None = None,
    ) -> dict:
        """Play until game over (or ``stop(state)``); returns that game_state."""
        stale: str | None = None
        start = time.monotonic()
        while True:
            assert time.monotonic() - start < deadline_s, "game did not finish"
            msg, state = (state, None) if state is not None else (self.recv(), None)
            if msg.get("type") == "error":
                raise AssertionError(f"server rejected {self.actions[-1:]}: {msg}")
            if msg.get("type") != "game_state":
                continue
            if msg["phase"] == "game_over":
                return msg
            fp = fingerprint(msg)
            if stop is not None and (stale is None or fp != stale) and stop(msg):
                return msg
            if stale is not None and fp == stale:
                continue  # state from before our last action
            stale = None
            if not self.my_turn(msg):
                continue
            action = on_state(self, msg) if on_state else None
            action = action or self.choose(msg)
            assert len(self.actions) < max_actions, "too many actions"
            self.act(action)
            stale = fp
