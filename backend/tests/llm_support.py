"""Shared helpers for the LLM seat tests (hand-built DecisionContexts).

``game.decisions`` is written by another agent; these helpers only rely on the
shapes in docs/architecture/seat-contract.md.
"""

from __future__ import annotations

import copy
import functools
from dataclasses import dataclass, field

from agents.base import DecisionContext
from game.calculator import build_calculator_pack
from game.game import Game, GamePhase
from tests.support.drive import HeuristicTable


@dataclass(frozen=True)
class Decision:
    """Local stand-in for game.decisions.Decision."""

    player_id: str
    kind: str
    context: dict = field(default_factory=dict)


def bot_game(seed: int = 3, min_turns: int = 24, players: int = 4) -> Game:
    """A game played by bots until it is p1's turn to place a tile mid-game.

    Each call returns a fresh copy; the position itself is played once per
    process (the bots go through the real decision path, which is not free).
    """
    return copy.deepcopy(_played(seed, min_turns, players))


@functools.lru_cache(maxsize=None)
def _played(seed: int, min_turns: int, players: int) -> Game:
    g = Game(seed=seed)
    for i in range(players):
        g.add_player(
            f"p{i + 1}", ["Alice", "Bob", "Cara", "Dan", "Eve", "Finn"][i], is_bot=True
        )
    g.start_game()
    table = HeuristicTable(g)
    turns = 0
    while turns < 400:
        pid = g.get_current_player_id()
        if (
            turns >= min_turns
            and pid == "p1"
            and g.phase == GamePhase.PLAYING
            and g.hotel.get_active_chains()
        ):
            return g
        table.play_turn()
        turns += 1
    raise AssertionError("could not reach a mid-game position")


def place_tile_legal(calc: dict) -> dict:
    tiles = []
    for t in calc["viewer"]["tiles"]:
        if t["playable"]:
            tiles.append(
                {
                    "tile": t["tile"],
                    "outcome": t["effect"],
                    "chains": t.get("chains")
                    or ([t["chain"]] if t.get("chain") else []),
                }
            )
    return {"action_types": ["place_tile"], "tiles": tiles}


def buy_legal(calc: dict, *, extra=("declare_end_game", "propose_trade")) -> dict:
    options = [
        {
            "chain": c,
            "price": o["price"],
            "available": o["available"],
            "max_affordable": o["max_affordable"],
        }
        for c, o in calc["buy_options"].items()
    ]
    return {
        "action_types": ["buy_stocks", "end_turn", *extra],
        "max_total": 3,
        "options": options,
        "money": calc["viewer"]["cash"],
    }


def sample_events(n: int, pids=("p1", "p2", "p3", "p4")) -> list[dict]:
    chains = ["sandpiper", "marlowe", "halcyon"]
    evs: list[dict] = []
    for i in range(n):
        pid = pids[i % len(pids)]
        r = i % 5
        if r == 0:
            evs.append(
                {
                    "seq": i,
                    "type": "tile_placed",
                    "player_id": pid,
                    "private_to": None,
                    "tile": f"{i % 12 + 1}{'ABCDEFGHI'[i % 9]}",
                    "outcome": "nothing",
                }
            )
        elif r == 1:
            evs.append(
                {
                    "seq": i,
                    "type": "stocks_purchased",
                    "player_id": pid,
                    "private_to": None,
                    "purchases": {chains[i % 3]: 1},
                    "total_cost": 300,
                }
            )
        elif r == 2:
            evs.append(
                {"seq": i, "type": "turn_ended", "player_id": pid, "private_to": None}
            )
        elif r == 3:
            evs.append(
                {
                    "seq": i,
                    "type": "chain_founded",
                    "player_id": pid,
                    "private_to": None,
                    "chain": chains[i % 3],
                }
            )
        else:
            evs.append(
                {
                    "seq": i,
                    "type": "tile_drawn",
                    "player_id": pid,
                    "private_to": pid,
                    "tile": "1A",
                }
            )
    return evs


def make_ctx(
    game: Game,
    pid: str,
    kind: str,
    legal: dict,
    *,
    events: list[dict] | None = None,
    context: dict | None = None,
) -> DecisionContext:
    return DecisionContext(
        player_id=pid,
        decision=Decision(pid, kind, context or {}),
        legal=legal,
        state=game.get_player_state(pid),
        events=events if events is not None else [],
        calc=build_calculator_pack(game, pid),
    )


def place_ctx(game: Game, pid: str = "p1", **kw) -> DecisionContext:
    calc = build_calculator_pack(game, pid)
    return make_ctx(game, pid, "place_tile", place_tile_legal(calc), **kw)


def buy_ctx(game: Game, pid: str = "p1", **kw) -> DecisionContext:
    calc = build_calculator_pack(game, pid)
    return make_ctx(game, pid, "buy_stocks", buy_legal(calc), **kw)
