"""Replay recipes through the engine and describe the resulting state."""

from __future__ import annotations

from typing import Any

from game.decisions import apply_action, legal_actions, pending_decisions
from game.game import Game, GamePhase
from game.rules import Rules
from game.ruleset import Ruleset

PLAYER_NAMES = ["Alice", "Bob", "Cara", "Dev", "Eli", "Fay"]


class ReplayError(Exception):
    """An action from a recipe was rejected by the engine."""


def make_players(count: int) -> list[dict]:
    return [{"player_id": f"p{i + 1}", "name": PLAYER_NAMES[i]} for i in range(count)]


def new_game(
    seed: int,
    players: list[dict],
    tile_order: list[str] | None = None,
    ruleset: Ruleset | None = None,
) -> Game:
    """A freshly started game (hands dealt, turn 1). Fixtures use default."""
    game = Game(seed=seed, tile_order=tile_order, ruleset=ruleset)
    for p in players:
        game.add_player(p["player_id"], p["name"])
    game.start_game()
    return game


def replay_recipe(recipe: dict) -> Game:
    """Rebuild the game of ``recipe`` using ``apply_action`` only."""
    game = new_game(recipe["seed"], recipe["players"], recipe.get("tile_order"))
    for i, step in enumerate(recipe["actions"]):
        result = apply_action(game, step["player_id"], step["action"])
        if not result.get("success"):
            raise ReplayError(
                f"action #{i} {step} rejected: {result.get('error')} "
                f"(seed={recipe['seed']})"
            )
    return game


def turn_count(game: Game) -> int:
    """Number of completed turns (turn_ended events)."""
    return sum(1 for e in game.events if e["type"] == "turn_ended")


def _decision_entry(game: Game, decision) -> dict:
    return {
        "player_id": decision.player_id,
        "kind": decision.kind,
        "context": decision.context,
        "legal": legal_actions(game, decision),
    }


def build_expect(game: Game, human_seat: str) -> dict:
    """Facts a UI test can assert without re-deriving the rules.

    Everything here is computed from the engine (``pending_decisions``,
    ``legal_actions``, ``get_public_state``), never typed by hand.
    """
    public = game.get_public_state()
    human = game.get_player(human_seat)
    decisions = [_decision_entry(game, d) for d in pending_decisions(game)]
    chains = {}
    all_chains = game.hotel.get_all_chain_names()
    for name in all_chains:
        info = public["chains"][name]
        if info["active"]:
            chains[name] = {
                "size": info["size"],
                "price": info["stock_price"],
                "available": info["available_stocks"],
                "safe": info["safe"],
            }
    playability = Rules.get_tiles_playability(game.board, human.hand, game.hotel)
    expect: dict[str, Any] = {
        "phase": public["phase"],
        "current_player": public["current_player"],
        "decisions": decisions,
        "flow_decision": decisions[0] if decisions else None,
        "human_decisions": [d for d in decisions if d["player_id"] == human_seat],
        "human": {
            "player_id": human_seat,
            "name": human.name,
            "hand": [str(t) for t in human.hand],
            "unplayable_tiles": {
                t: v["reason"] for t, v in playability.items() if not v["playable"]
            },
            "cash": human.money,
            "holdings": {k: v for k, v in sorted(human.stocks.items()) if v > 0},
        },
        "active_chains": chains,
        "inactive_chains": sorted(n for n in all_chains if n not in chains),
        "players": [
            {
                "player_id": p.player_id,
                "name": p.name,
                "cash": p.money,
                "tile_count": p.hand_size,
                "holdings": {k: v for k, v in sorted(p.stocks.items()) if v > 0},
            }
            for p in game.players
        ],
        "tiles_on_board": len(public["board"]["cells"]),
        "tiles_remaining": public["tiles_remaining"],
        "turns_completed": turn_count(game),
        "pending_trades": public["pending_trades"],
    }
    if game.phase == GamePhase.GAME_OVER:
        ended = [e for e in game.events if e["type"] == "game_ended"][-1]
        expect["game_over"] = {
            "reason": ended["reason"],
            "winner": ended["winner"],
            "standings": ended["standings"],
        }
    return expect
