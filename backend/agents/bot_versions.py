"""Versions of the rules-based bot (docs/ai/bot-versions.md).

Every generation of the bot stays playable, so versions can be compared in
self-play (``bench/bot_tournament.py``) and a game can be replayed with the
bot it was played with. A version is a ``BotPolicy``: a named choice for each
rule component the generations differ in, plus that rule's weights. The
heuristic agent (``agents/heuristic.py``) reads its policy at each decision;
the rules themselves live in ``game/bot.py`` and ``agents/bot_rules.py``.

Components (a version names one option for each):

* ``tile``: how tiles are scored.
    - ``legacy``: v1's points (found 100; grow a chain I hold 50 + 5/share;
      merger 30 + 3/survivor share if I hold the survivor, 20 + 2/defunct
      share if I hold the defunct), medium picks at random among the top 3.
    - ``position``: ``game/tile_value.py`` (my gain minus weighted rival
      gains, in money); medium picks among tiles within
      ``MEDIUM_TILE_MARGIN`` of the best, never a negative one while a
      non-negative one exists.
* ``buy``: ``legacy`` (v1: spread over owned, large and dear chains) or
  ``position`` (``agents/bot_rules.py: choose_buys_position``; weights
  ``defend``, ``size_ahead``, ``cash_cost``, ``buy_min_gain``, ``fallback``).
* ``disposition``: ``legacy`` (v1: sell/trade by price and cash) or
  ``position`` (``choose_disposition_position``: post-merger survivor math).
* ``found``: ``legacy`` (v1: dear tiers when rich, cheap when poor),
  ``cheapest`` or ``dearest``.
* ``weights["tile"]``: overrides of the tile value's ``lambda``,
  ``found_factor``, ``safe_lock`` (``game/tile_value.py``).
* ``declare``: ``legacy`` (declare when projected first) in every version.

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

V3 = BotPolicy(
    version="v3",
    summary="Buys for bonus positions: the purchase that gains most in weighted "
    "majority/minority bonuses (mine up, rivals' down); legacy buying otherwise.",
    tile="position",
    buy="position",
)

V4 = BotPolicy(
    version="v4",
    summary="Merger shares by post-merger position math: trade the amount that "
    "maximises survivor value plus survivor bonus position, sell the rest.",
    tile="position",
    buy="position",
    disposition="position",
)

V5 = BotPolicy(
    version="v5",
    summary="v3 + defended buying: a position's value blends 'bought out now' "
    "with 'after the strongest rival buys a full turn of shares'.",
    tile="position",
    buy="position",
    weights={"defend": 0.5},
)
V6 = BotPolicy(
    version="v6",
    summary="v3 but no fallback buying: when no purchase gains a bonus "
    "position, keep the cash.",
    tile="position",
    buy="position",
    weights={"fallback": "none"},
)

V7 = BotPolicy(
    version="v7",
    summary="v3 + found the cheapest chain available: more shares per dollar "
    "to hold the new race the founder starts.",
    tile="position",
    buy="position",
    found="cheapest",
)
V8 = BotPolicy(
    version="v8",
    summary="v7 + buy for the chain's size 3 tiles ahead (bonuses grow with "
    "size: favour positions in chains that will grow).",
    tile="position",
    buy="position",
    found="cheapest",
    weights={"size_ahead": 3},
)

VERSIONS: dict[str, BotPolicy] = {
    p.version: p for p in (V1, V2, V3, V4, V5, V6, V7, V8)
}

# The version new bot seats get: the strongest one accepted so far.
DEFAULT_VERSION = "v8"


def get_policy(version: str | None = None) -> BotPolicy:
    """The policy for ``version`` (default: ``DEFAULT_VERSION``)."""
    v = version or DEFAULT_VERSION
    if v not in VERSIONS:
        raise ValueError(f"Unknown bot version: {v} (known: {', '.join(VERSIONS)})")
    return VERSIONS[v]


__all__ = ["DEFAULT_VERSION", "VERSIONS", "BotPolicy", "get_policy"]
