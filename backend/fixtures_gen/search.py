"""Deterministic search for real games that reach each fixture's target state."""

from __future__ import annotations

import copy
import random
from dataclasses import dataclass, field

from fixtures_gen.policies import POLICIES, choose
from fixtures_gen.replay import make_players, new_game
from fixtures_gen.specs import FIXTURES, Ctx, Fixture, evaluate
from game.decisions import apply_action, legal_actions, pending_decisions

MAX_ACTIONS_PER_GAME = 900

# (human-seat policy index, every-other-seat policy index)
POLICY_PAIRS = [(0, 0), (1, 2), (3, 4), (5, 1), (4, 6), (2, 7), (7, 8), (8, 3), (6, 5)]


class EngineProblem(Exception):
    """The engine rejected an action it listed as legal, or misbehaved."""


@dataclass
class Hit:
    fixture: str
    seed: int
    players: int
    policy_pair: int
    actions: list[dict]
    met: list[str]
    missed: list[str]
    games_scanned: int = 0


@dataclass
class SearchResult:
    hits: dict[str, Hit] = field(default_factory=dict)
    games_run: int = 0
    steps: int = 0


def _try_tail(ctx: Ctx, fixture: Fixture):
    """Apply the fixture's tail to a copy; return (ctx_after, steps) or None."""
    steps = fixture.tail(ctx)
    if not steps:
        return None
    clone = copy.deepcopy(ctx.game)
    for pid, action in steps:
        if not apply_action(clone, pid, action).get("success"):
            return None
    return Ctx(clone, ctx.n_actions + len(steps), ctx.human), steps


def play_and_scan(
    seed: int,
    players: int,
    pair_index: int,
    pending: dict[str, Fixture],
    best: dict[str, Hit],
    result: SearchResult,
    max_actions: int = MAX_ACTIONS_PER_GAME,
) -> None:
    """Play one policy-driven game, testing every state against ``pending``."""
    human_pol, other_pol = (POLICIES[i] for i in POLICY_PAIRS[pair_index])
    rng = random.Random(f"{seed}:{players}:{pair_index}")
    game = new_game(seed, make_players(players))
    actions: list[dict] = []
    for _ in range(max_actions):
        decisions = pending_decisions(game)
        if not decisions:
            return
        ctx = Ctx(game, len(actions))
        for name, fixture in list(pending.items()):
            if players not in fixture.players:
                continue
            if fixture.tail is None:
                ev = evaluate(fixture, ctx)
                steps: list = []
            else:
                if not fixture.pre(ctx):
                    continue
                tried = _try_tail(ctx, fixture)
                if tried is None:
                    continue
                ev = evaluate(fixture, tried[0])
                steps = tried[1]
            if ev is None:
                continue
            met, missed = ev
            prev = best.get(name)
            if prev is None or len(met) > len(prev.met):
                recipe_actions = actions + [
                    {"player_id": pid, "action": a} for pid, a in steps
                ]
                best[name] = Hit(
                    name, seed, players, pair_index, recipe_actions, met, missed
                )
                if not missed:
                    del pending[name]
        if not pending:
            return
        flow = decisions[0]
        legal = legal_actions(game, flow)
        policy = human_pol if flow.player_id == "p1" else other_pol
        action = choose(policy, game, flow, legal, rng)
        res = apply_action(game, flow.player_id, action)
        result.steps += 1
        if not res.get("success"):
            raise EngineProblem(
                f"legal action rejected: seed={seed} players={players} "
                f"pair={pair_index} decision={flow.to_dict()} action={action} "
                f"error={res.get('error')} actions={actions}"
            )
        actions.append({"player_id": flow.player_id, "action": action})
    raise EngineProblem(
        f"game did not finish within {max_actions} actions "
        f"(seed={seed}, players={players}, pair={pair_index})"
    )


def search(
    seed_budget: int = 40,
    fixtures: list[Fixture] | None = None,
    verbose: bool = False,
) -> SearchResult:
    """Scan seeds 0..seed_budget-1 over player counts and policy pairs."""
    fixtures = fixtures if fixtures is not None else FIXTURES
    pending = {f.name: f for f in fixtures}
    counts = sorted({n for f in fixtures for n in f.players})
    best: dict[str, Hit] = {}
    result = SearchResult()
    for seed in range(seed_budget):
        for players in counts:
            for pair_index in range(len(POLICY_PAIRS)):
                if not any(players in f.players for f in pending.values()):
                    continue
                play_and_scan(seed, players, pair_index, pending, best, result)
                result.games_run += 1
        if verbose:
            print(
                f"seed {seed}: pending {sorted(pending)} games={result.games_run}",
                flush=True,
            )
        if not pending:
            break
    result.hits = best
    return result
