"""Versions of the rules-based bot (docs/ai/bot-versions.md).

Every generation of the bot stays playable, so versions can be compared in
self-play (``bench/bot_tournament.py``) and a game can be replayed with the
bot it was played with. A version is a ``BotPolicy``: a named choice for each
rule component the generations differ in, plus that rule's weights. The
heuristic agent (``agents/heuristic.py``) reads its policy at each decision;
the rules themselves live in ``game/bot.py`` and ``game/tile_value.py``.

Components (a version names one option for each):

* ``tile``: how tiles are scored.
    - ``legacy``: v1's points (found 100; grow a chain I hold 50 + 5/share;
      merger 30 + 3/survivor share if I hold the survivor, 20 + 2/defunct
      share if I hold the defunct), medium picks at random among the top 3.
    - ``position``: ``game/tile_value.py`` (my gain minus weighted rival
      gains, in money); medium picks among tiles within
      ``MEDIUM_TILE_MARGIN`` of the best, never a negative one while a
      non-negative one exists.
* ``buy``, ``disposition``, ``declare``, ``found``: added by later versions
  (``legacy`` = v1's rules).

Difficulty (easy / medium / hard) still works on top of every version: easy
plays random legal tiles and chains, hard takes the best-scored option.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class BotPolicy:
    version: str
    summary: str
    tile: str = "position"
    buy: str = "legacy"
    disposition: str = "legacy"
    declare: str = "legacy"
    found: str = "legacy"
    # Weights of the non-legacy rules (documented where each rule is used).
    weights: dict = field(default_factory=dict)

    def w(self, key: str, default: float) -> float:
        return float(self.weights.get(key, default))


V1 = BotPolicy(
    version="v1",
    summary="Original heuristic: fixed points per tile effect, top-3 random pick.",
    tile="legacy",
)
V2 = BotPolicy(
    version="v2",
    summary="Position-aware tile value (my gain minus weighted rival gains).",
    tile="position",
)

VERSIONS: dict[str, BotPolicy] = {p.version: p for p in (V1, V2)}

# The version new bot seats get: the strongest one accepted so far.
DEFAULT_VERSION = "v2"


def get_policy(version: str | None = None) -> BotPolicy:
    """The policy for ``version`` (default: ``DEFAULT_VERSION``)."""
    v = version or DEFAULT_VERSION
    if v not in VERSIONS:
        raise ValueError(f"Unknown bot version: {v} (known: {', '.join(VERSIONS)})")
    return VERSIONS[v]


__all__ = ["DEFAULT_VERSION", "VERSIONS", "BotPolicy", "get_policy"]
