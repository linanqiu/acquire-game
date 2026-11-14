"""Final-standings ranking, shared by the engine and every consumer.

Competition ranking ("1224"): players tied on score share the best rank of
their group and the next rank skips the tied places (1, 1, 3). Everyone with
rank 1 is a winner.
"""

from __future__ import annotations


def competition_ranks(scores: list[int]) -> list[int]:
    """Rank per score (1 = best); ties share the best rank (1, 1, 3)."""
    return [1 + sum(1 for t in scores if t > s) for s in scores]


__all__ = ["competition_ranks"]
