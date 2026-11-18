"""Time budget of one ``game_state`` broadcast (BL-020).

A broadcast builds the public state once (calculator: net worth, chain
holders, merger history) and each player's private part (hand, tile
playability, trades). Measured in BL-020 at about 0.5 ms for six players late
in the game, so the server is not where the lag is; this guard keeps it so
(generous bounds: a loaded CI machine must not fail it).
"""

from __future__ import annotations

import json
import statistics
import time
from types import SimpleNamespace

from agents.base import build_context
from agents.heuristic import HeuristicAgent
from broadcast import build_public_state, private_fields
from game.decisions import apply_action, pending_decisions
from game.game import Game, GamePhase


def test_six_player_broadcast_stays_cheap_through_a_whole_game():
    game = Game(seed=7)
    for i in range(6):
        game.add_player(f"p{i}", f"P{i}")
    game.start_game()
    bots = {p.player_id: HeuristicAgent(name=p.player_id) for p in game.players}
    room = SimpleNamespace(players={}, runtime=None, game_id="g")
    costs: list[float] = []
    sizes: list[int] = []
    for _ in range(3000):
        if game.phase == GamePhase.GAME_OVER:
            break
        d = pending_decisions(game)[0]
        apply_action(
            game, d.player_id, bots[d.player_id].choose(build_context(game, d))
        )
        t = time.perf_counter()
        public = build_public_state(room, game)
        texts = [
            json.dumps({**public, **private_fields(game, p.player_id)})
            for p in game.players
        ]
        costs.append(time.perf_counter() - t)
        sizes.append(max(len(x) for x in texts))
    assert game.phase == GamePhase.GAME_OVER
    late = costs[int(len(costs) * 0.7) :]
    assert statistics.mean(late) < 0.010, (
        f"late-game broadcast {statistics.mean(late):.4f} s"
    )
    assert max(costs) < 0.100, f"slowest broadcast {max(costs):.4f} s"
    # Uncompressed message size (the socket deflates it to about a fifth).
    assert max(sizes) < 40_000, max(sizes)
