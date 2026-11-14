"""Ratings from finishing orders: pairwise Bradley-Terry on the Elo scale.

Each game's finishing order is broken into all pairs of seats held by
DIFFERENT agents (a finish ahead = 1 win, a tie = half a win each; the three
bot seats of a vs-baseline game are never compared with each other). The
Bradley-Terry strengths ``g`` maximise the likelihood of those pairwise
results (Hunter's MM algorithm); a rating is ``anchor + 400 * log10(g / g_anchor)``
so the anchor (the rules-based bot) sits at a fixed value and a 400-point gap
means 10:1 odds of finishing ahead of the other.

Why this and not a full Plackett-Luce fit: ties for a place (equal final
money) are handled exactly as half-wins, several seats of the same agent in
one game need no special casing, and full rank-breaking into all pairs is a
consistent estimator of Plackett-Luce strengths (Azari Soufiani, Parkes & Xia,
"Computing Parametric Ranking Models via Rank-Breaking", ICML 2014). The pairs
from one game are not independent, so the interval comes from a bootstrap
over GAMES (resampling whole finishing orders), not from the pair count.

A weak prior (``prior`` virtual half-won comparisons of every agent against
the anchor, default 1) keeps ratings finite for an agent that never (or
always) finished ahead, and ties agents that never met the anchor to the
scale. It shrinks small samples towards the anchor; with 72 games it is
negligible.
"""

from __future__ import annotations

import math
import random
from collections.abc import Sequence

ANCHOR_ID = "bot"
ANCHOR_RATING = 1500.0
Game = Sequence[tuple[str, float]]  # [(agent_id, rank)] per seat; 1 = best


def pairwise(games: Sequence[Game]) -> tuple[dict, dict]:
    """``(wins[(a, b)], n[(a, b)])`` over unordered agent pairs (a, b)."""
    wins: dict[tuple[str, str], float] = {}
    n: dict[tuple[str, str], float] = {}
    for g in games:
        seats = list(g)
        for i in range(len(seats)):
            a, ra = seats[i]
            for j in range(i + 1, len(seats)):
                b, rb = seats[j]
                if a == b:
                    continue
                key = (a, b) if a < b else (b, a)
                first = key[0] == a
                n[key] = n.get(key, 0.0) + 1
                if ra == rb:
                    score_a = 0.5
                else:
                    score_a = 1.0 if ra < rb else 0.0
                w = score_a if first else 1.0 - score_a
                wins[key] = wins.get(key, 0.0) + w  # wins of key[0] over key[1]
    return wins, n


def bradley_terry(
    games: Sequence[Game],
    *,
    anchor: str = ANCHOR_ID,
    anchor_rating: float = ANCHOR_RATING,
    prior: float = 1.0,
    max_iter: int = 5000,
    tol: float = 1e-10,
) -> dict[str, float]:
    """``{agent_id: rating}``; the anchor is exactly ``anchor_rating``."""
    wins, n = pairwise(games)
    agents = sorted({a for g in games for a, _ in g} | {anchor})
    if prior > 0:
        for a in agents:
            if a == anchor:
                continue
            key = (a, anchor) if a < anchor else (anchor, a)
            n[key] = n.get(key, 0.0) + prior
            wins[key] = wins.get(key, 0.0) + prior / 2
    total_w = {a: 0.0 for a in agents}
    nbrs: dict[str, list[tuple[str, float]]] = {a: [] for a in agents}
    for (a, b), cnt in n.items():
        w_ab = wins.get((a, b), 0.0)
        total_w[a] += w_ab
        total_w[b] += cnt - w_ab
        nbrs[a].append((b, cnt))
        nbrs[b].append((a, cnt))
    g = {a: 1.0 for a in agents}
    for _ in range(max_iter):
        new = {}
        for a in agents:
            denom = sum(cnt / (g[a] + g[b]) for b, cnt in nbrs[a])
            if denom <= 0:
                new[a] = g[a]
            else:
                new[a] = max(total_w[a], 1e-12) / denom
        scale = new[anchor]
        new = {a: v / scale for a, v in new.items()}
        delta = max(abs(math.log(new[a]) - math.log(g[a])) for a in agents)
        g = new
        if delta < tol:
            break
    return {a: anchor_rating + 400 * math.log10(g[a]) for a in agents}


def bootstrap(
    games: Sequence[Game],
    *,
    samples: int = 200,
    seed: int = 0,
    level: float = 0.95,
    **kw,
) -> dict[str, tuple[float, float]]:
    """Percentile bootstrap interval per agent (games resampled with
    replacement). Deterministic for a given ``seed``."""
    if not games:
        return {}
    rng = random.Random(seed)
    draws: dict[str, list[float]] = {}
    games = list(games)
    for _ in range(samples):
        sample = [games[rng.randrange(len(games))] for _ in games]
        ratings = bradley_terry(sample, max_iter=2000, tol=1e-8, **kw)
        for a, r in ratings.items():
            draws.setdefault(a, []).append(r)
    lo_q, hi_q = (1 - level) / 2, 1 - (1 - level) / 2
    out = {}
    for a, vals in draws.items():
        vals.sort()
        lo = vals[min(len(vals) - 1, int(lo_q * len(vals)))]
        hi = vals[min(len(vals) - 1, int(math.ceil(hi_q * len(vals))) - 1)]
        out[a] = (lo, hi)
    return out


def expected_score(r_a: float, r_b: float) -> float:
    """Probability that ``a`` finishes ahead of ``b``."""
    return 1 / (1 + 10 ** ((r_b - r_a) / 400))
