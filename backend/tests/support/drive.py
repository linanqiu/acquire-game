"""Drive games with the rules-based seat, the way the server does.

Replaces the old ``Game.execute_bot_turn`` shortcut (removed: nothing but
tests used it). Every decision goes through ``build_context`` ->
``HeuristicAgent.choose`` -> ``apply_action``: the same path the server's seat
driver and the benchmark use for a "bot" seat.
"""

from __future__ import annotations

from agents.base import build_context
from agents.heuristic import HeuristicAgent
from game.decisions import apply_action, pending_decisions
from game.game import Game, GamePhase


class HeuristicTable:
    """One deterministic heuristic agent per seat (seeded by player id)."""

    def __init__(self, game: Game, difficulty: str = "medium", seed: int = 0):
        self.game = game
        self.agents = {
            p.player_id: HeuristicAgent(
                name=p.player_id, difficulty=difficulty, seed=f"{seed}:{p.player_id}"
            )
            for p in game.players
        }

    def step(self) -> dict:
        """Answer the blocking decision; returns the action taken."""
        decision = pending_decisions(self.game)[0]
        ctx = build_context(self.game, decision)
        action = self.agents[decision.player_id].choose(ctx)
        result = apply_action(self.game, decision.player_id, action)
        assert result["success"], f"heuristic {action} refused: {result}"
        return action

    def play_turn(self) -> list[dict]:
        """Play until the turn passes to another player (or the game ends)."""
        start = sum(1 for e in self.game.events if e["type"] == "turn_ended")
        actions = []
        while self.game.phase not in (GamePhase.GAME_OVER, GamePhase.LOBBY):
            actions.append(self.step())
            ended = sum(1 for e in self.game.events if e["type"] == "turn_ended")
            if ended > start:
                break
        return actions

    def play(self, max_turns: int = 400) -> int:
        """Play to the end of the game; returns the number of turns."""
        turns = 0
        while self.game.phase != GamePhase.GAME_OVER:
            assert turns < max_turns, "game did not finish"
            self.play_turn()
            turns += 1
        return turns


def bot_game(players: int = 3, seed: int = 1, ruleset=None) -> Game:
    """A started game with ``players`` bot seats."""
    game = Game(seed=seed, ruleset=ruleset)
    for i in range(players):
        game.add_player(f"bot{i}", f"Bot {i}", is_bot=True)
    game.start_game()
    return game
