"""Default names for AI seats (BL-010; docs/architecture/seat-contract.md).

An AI seat (rules-based bot or LLM) added without an explicit ``name`` gets a
playful character name from :data:`SEAT_NAMES`, picked at random per room.
The seat's model is never part of its name: it travels in ``agent_label``.

Rules (tested in ``tests/test_seat_names.py``):

* unique within the room, case-insensitive, also against human names;
* the first word of every name in the list is unique, and a name whose first
  word or full name clashes with a seat already at the table is skipped, so the
  chat's "named by first word" addressing (:func:`short_names`) keeps working;
* deterministic when the room has a seed (``/configure``) or ``GAME_SEED`` is
  set: the room's name generator is seeded from it when the first AI seat is
  added; otherwise random;
* when every name is taken: ``Tycoon 1``, ``Tycoon 2``, ...
"""

from __future__ import annotations

import os
import random
from typing import Iterable, Optional, Sequence

# One or two words, at most 14 characters, distinct first words. Original,
# family-friendly money/business characters that suit every theme (hotels,
# startups, shipping lines): no real people, brands or existing characters.
SEAT_NAMES: tuple[str, ...] = (
    "Penny Stocks",
    "Baron Brick",
    "Lady Ledger",
    "Max Margin",
    "Duke Dividend",
    "Contessa Cash",
    "Sir Surplus",
    "Madam Merger",
    "Commodore Coin",
    "Tilly Tycoon",
    "Bonnie Bonds",
    "Rex Revenue",
    "Goldie Gains",
    "Monty Moneybag",
    "Dot Dealmaker",
    "Hedge Hogg",
    "Ivy Interest",
    "Bea Bullish",
    "Barry Bearish",
    "Cosmo Compound",
    "Olive Options",
    "Felix Futures",
    "Nina Nest-Egg",
    "Archie Assets",
    "Ruby Royalty",
    "Prof Profit",
    "Mabel Markup",
    "Otto Overdraft",
    "Della Deposit",
    "Gus Gross",
    "Wren Windfall",
    "Bertie Buyout",
    "Lulu Liquidity",
    "Hector Hostile",
    "Polly Premium",
    "Clem Coupon",
    "Vera Venture",
    "Ziggy Zillions",
    "Fitz Fortune",
    "Quinn Quota",
    "Mimi Minority",
    "Basil Bargain",
    "Junie Jackpot",
    "Tess Takeover",
    "Ned Networth",
    "Rosie Returns",
    "Babs Balance",
    "Dolly Dollars",
)

FALLBACK_BASE = "Tycoon"


def first_word(name: str) -> str:
    """Lower-cased first word of a name, without surrounding punctuation."""
    return (name.split() or [""])[0].strip("()@,.:;!?").lower()


def name_rng(seed: Optional[int]) -> random.Random:
    """The generator a room picks names with: ``seed`` (the room's), else
    ``GAME_SEED``, else unseeded."""
    if seed is None:
        env = os.environ.get("GAME_SEED")
        seed = int(env) if env else None
    if seed is None:
        return random.Random()
    return random.Random(f"seat-names:{seed}")


def pick_seat_name(
    taken: Iterable[str],
    rng: random.Random,
    names: Sequence[str] = SEAT_NAMES,
) -> str:
    """A free character name for a new AI seat.

    ``taken``: the names already in the room. A candidate is skipped when its
    full name or its first word equals (case-insensitively) a taken name or a
    taken name's first word. Falls back to ``Tycoon N``.
    """
    taken = [t for t in taken if t]
    blocked = {t.lower() for t in taken} | {first_word(t) for t in taken}
    free = [
        n for n in names if n.lower() not in blocked and first_word(n) not in blocked
    ]
    if free:
        return rng.choice(free)
    lowered = {t.lower() for t in taken}
    n = 1
    while f"{FALLBACK_BASE} {n}".lower() in lowered:
        n += 1
    return f"{FALLBACK_BASE} {n}"


def short_names(names: dict[str, str]) -> dict[str, str]:
    """Distinctive first words, ``{player_id: word}``: the first word of a seat
    name when it has 3+ characters, is not the whole name and no other seat's
    name starts with it ("baron" for "Baron Brick"). Chat messages may address
    a seat by it (``chat.named_seats``, the LLM talk prompt)."""
    firsts: dict[str, list[str]] = {}
    for pid, name in names.items():
        word = first_word(name)
        if len(word) >= 3 and word != name.strip().lower():
            firsts.setdefault(word, []).append(pid)
    return {pids[0]: w for w, pids in firsts.items() if len(pids) == 1}
