"""Volume fuzzing of the decision seam (stories ES-001/ES-002/ES-004).

500 seeded random full games on default (3-6 players) and 100 on ``mini``
(2-5 players), every game checked with all invariants of
``test_decisions.run_random_game``: legal actions always accepted, illegal ones
rejected without mutation, money/stock/tile conservation, every successful
action appends an event, cash/holdings/standings/turn sequence rebuilt from
events alone match the engine, calculator purity and no hidden-information
leak, terminal state.

The games are split into chunks (one test each) so ``pytest -n auto`` spreads
them over all cores. A failure names the seed, player count and the complete
action list (``FuzzFailure``). Slow tier: ``pytest -m slow``.
"""

from __future__ import annotations

import pytest

from game.ruleset import load_ruleset
from tests.test_decisions import run_random_game

DEFAULT_GAMES = 500
MINI_GAMES = 100
CHUNK = 25
CALC_EVERY = 120  # calculator purity + leak check every 120th action (costly)


def _chunks(total: int):
    return list(range(0, total, CHUNK))


@pytest.mark.slow
@pytest.mark.parametrize("start", _chunks(DEFAULT_GAMES), ids=lambda s: f"games{s}")
def test_fuzz_default(start):
    for i in range(start, min(start + CHUNK, DEFAULT_GAMES)):
        players = 3 + i % 4  # 3, 4, 5, 6 in turn
        # every 5th game nobody declares: play runs until the bag is empty
        declare = 0.0 if i % 5 == 4 else 0.15 + (i % 3) * 0.1
        game, stats = run_random_game(
            1000 + i, players, declare_prob=declare, calc_every=CALC_EVERY
        )
        assert stats["actions"] > 20


@pytest.mark.slow
@pytest.mark.parametrize("start", _chunks(MINI_GAMES), ids=lambda s: f"games{s}")
def test_fuzz_mini(start):
    mini = load_ruleset("mini")
    span = mini.max_players - mini.min_players + 1
    for i in range(start, min(start + CHUNK, MINI_GAMES)):
        players = mini.min_players + i % span
        declare = 0.0 if i % 5 == 4 else 0.15 + (i % 3) * 0.1
        game, stats = run_random_game(
            5000 + i, players, declare_prob=declare, ruleset=mini, calc_every=CALC_EVERY
        )
        assert stats["actions"] > 10
