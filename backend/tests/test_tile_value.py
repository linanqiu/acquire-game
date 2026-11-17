"""Tier 1: the position-aware tile value and the rules-based seat's tile pick
(docs/ai/bot-tiles.md).

Every position is reached by real play (``tests.support.table.Table``: every
move through ``apply_action``). The seat answers through ``build_context`` ->
``HeuristicAgent.choose``, the path the server and the benchmark use.

The main position mirrors the owner's report: a rules-based seat holding no
shares of the smaller chain could set off a merger that pays the majority and
minority bonuses to two rivals and nothing to itself.
"""

from __future__ import annotations

import random

import pytest

from agents.base import build_context
from agents.heuristic import MEDIUM_TILE_MARGIN, HeuristicAgent
from game.decisions import PLACE_TILE
from game.ruleset import default_ruleset
from game.tile_value import (
    RIVAL_WEIGHT_BEHIND,
    RIVAL_WEIGHT_LEADER,
    rival_weights,
    tile_valuation,
)
from tests.support.table import Table, scripts_for

RS = default_ruleset()
SURV = RS.chain_ids[0]  # sandpiper: 4 tiles along row A
DEF = RS.chain_ids[3]  # meridian: 3 tiles along row C
MERGE_TILE = "2B"  # touches 2A (survivor) and 2C (defunct)
SEEDS = range(40)


def screenshot_table(maker: str = "p1", hand: list[str] | None = None) -> Table:
    """Four players. SURV (4 tiles): p2 4, p3 3, p4 6 shares. DEF (3 tiles):
    p2 4 (majority), p3 2 (minority), p1 and p4 none. ``maker`` holds
    ``MERGE_TILE`` (or ``hand``, for p1) and is on turn at the tile step."""
    moves = [
        "1A",
        ("2A", {"found": SURV, "buy": {SURV: 3}}),
        ("3A", {"buy": {SURV: 3}}),
        ("4A", {"buy": {SURV: 3}}),
        "1C",
        ("2C", {"found": DEF, "buy": {DEF: 3}}),
        ("3C", {"buy": {DEF: 2}}),
        ("12I", {"buy": {SURV: 3}}),
    ]
    idx = int(maker[1:]) - 1
    extra = {idx: list(hand or [MERGE_TILE])}
    t = Table(scripts_for(moves, 4, extra))
    t.play(moves)
    while t.current != maker:
        t.pass_turn()
    assert (t.size(SURV), t.size(DEF)) == (4, 3)
    assert [t.shares(p, SURV) for p in ("p1", "p2", "p3", "p4")] == [0, 4, 3, 6]
    assert [t.shares(p, DEF) for p in ("p1", "p2", "p3", "p4")] == [0, 4, 2, 0]
    assert t.decision().kind == PLACE_TILE
    return t


def pick(t: Table, difficulty: str, seed) -> str:
    agent = HeuristicAgent(name=t.current, difficulty=difficulty, seed=seed)
    action = agent.choose(build_context(t.game, t.decision()))
    assert action["action"] == "place_tile"
    return action["tile"]


def values(t: Table) -> dict[str, dict]:
    return {tile: tile_valuation(t.game, tile, t.current) for tile in t.offered_tiles()}


# ---------------------------------------------------------------------------
# The valuation
# ---------------------------------------------------------------------------


def test_merger_that_pays_only_rivals_scores_clearly_negative():
    t = screenshot_table("p1")
    v = values(t)
    m = v[MERGE_TILE]
    assert m["effect"] == "merge" and m["survivor"] == SURV
    assert m["defunct"] == [DEF]
    assert m["my_gain"] == 0
    assert set(m["bonus_by_player"]) == {"p2", "p3"}
    # Clearly negative: worse than every neutral tile by more than the
    # medium seat's random margin.
    assert m["score"] < -MEDIUM_TILE_MARGIN
    others = [x for tile, x in v.items() if tile != MERGE_TILE]
    assert others and all(x["score"] >= 0 for x in others)


def test_merger_bonuses_are_the_ones_the_engine_pays():
    t = screenshot_table("p1")
    m = tile_valuation(t.game, MERGE_TILE, "p1")
    since = t.mark()
    t.place(MERGE_TILE)
    paid = next(e for e in t.events("bonuses_paid", since) if e["chain"] == DEF)
    engine = {
        pid: b.get("majority", 0) + b.get("minority", 0)
        for pid, b in paid["bonuses"].items()
        if b.get("majority", 0) + b.get("minority", 0)
    }
    assert m["bonus_by_player"] == engine
    assert m["survivor_size_after"] == 8


def test_score_is_my_gain_minus_weighted_rival_gains():
    t = screenshot_table("p4")  # p4: survivor majority only, no defunct shares
    m = tile_valuation(t.game, MERGE_TILE, "p4")
    w = m["rival_weights"]
    cost = sum(w[r] * max(0, m["gains"][r]) for r in w)
    assert m["rival_cost"] == round(cost)
    assert abs(m["score"] - (m["gains"]["p4"] - cost)) <= 1
    # p4's gain is the survivor growing (price and bonus position), not a bonus
    assert "p4" not in m["bonus_by_player"]
    assert m["my_gain"] > 0
    # Rivals collect the defunct bonuses in full on top of their survivor stake.
    for r in ("p2", "p3"):
        assert m["gains"][r] >= m["bonus_by_player"][r]


def test_rival_weights_follow_standing():
    t = screenshot_table("p1")
    w = rival_weights(t.game, "p1")
    assert set(w) == {"p2", "p3", "p4"}
    # p1 bought nothing and kept its cash; whoever leads counts in full.
    assert max(w.values()) == RIVAL_WEIGHT_LEADER
    assert min(w.values()) >= RIVAL_WEIGHT_BEHIND


# ---------------------------------------------------------------------------
# The seat's pick
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("difficulty", ["medium", "hard"])
def test_seat_never_sets_off_a_merger_that_pays_only_rivals(difficulty):
    """The owner's report: the bot holds none of the defunct chain, rivals do,
    and a neutral tile is in hand."""
    t = screenshot_table("p1")
    v = values(t)
    best = max(x["score"] for x in v.values())
    picks = {pick(t, difficulty, seed) for seed in SEEDS}
    assert MERGE_TILE not in picks
    assert all(v[p]["score"] >= best - MEDIUM_TILE_MARGIN for p in picks)
    if difficulty == "hard":
        assert len(picks) == 1


@pytest.mark.parametrize("difficulty", ["medium", "hard"])
def test_seat_sets_off_a_merger_that_pays_it_the_majority(difficulty):
    t = screenshot_table("p2")  # p2 holds the defunct chain's majority
    m = tile_valuation(t.game, MERGE_TILE, "p2")
    assert m["bonus_by_player"]["p2"] > m["bonus_by_player"]["p3"]
    assert m["score"] > 0
    for seed in SEEDS:
        assert pick(t, difficulty, seed) == MERGE_TILE


@pytest.mark.parametrize("difficulty", ["medium", "hard"])
def test_survivor_holder_is_judged_on_the_numbers(difficulty):
    t = screenshot_table("p4")
    v = values(t)
    best = max(x["score"] for x in v.values())
    for seed in SEEDS:
        chosen = v[pick(t, difficulty, seed)]
        assert chosen["score"] >= best - MEDIUM_TILE_MARGIN
        assert chosen["score"] >= 0 or best < 0
    if v[MERGE_TILE]["score"] < 0 <= best:
        assert all(pick(t, difficulty, s) != MERGE_TILE for s in SEEDS)


@pytest.mark.parametrize("difficulty", ["medium", "hard"])
def test_all_harmful_hand_plays_the_least_harmful_tile(difficulty):
    # Three tiles set off the merger that pays only rivals; the others grow a
    # chain only rivals hold.
    hand = ["1B", "2B", "3B", "4B", "5A", "4C"]
    t = screenshot_table("p1", hand=hand)
    assert sorted(t.offered_tiles()) == sorted(hand)
    v = values(t)
    assert all(x["score"] < 0 for x in v.values())
    best = max(x["score"] for x in v.values())
    for seed in SEEDS:
        assert v[pick(t, difficulty, seed)]["score"] == best


def test_easy_seat_still_plays_a_random_legal_tile():
    t = screenshot_table("p1")
    options = t.offered_tiles()
    picks = []
    for seed in SEEDS:
        expected = random.Random(seed).choice(options)
        got = pick(t, "easy", seed)
        assert got == expected
        picks.append(got)
    assert MERGE_TILE in picks  # easy's purpose: it does blunder sometimes


def test_medium_varies_among_equally_good_tiles_and_hard_does_not():
    hand = [MERGE_TILE, "6E", "8G", "10E", "6G", "8E"]
    t = screenshot_table("p1", hand=hand)
    v = values(t)
    assert [v[x]["score"] for x in hand[1:]] == [0] * 5
    medium = {pick(t, "medium", seed) for seed in SEEDS}
    assert MERGE_TILE not in medium and len(medium) > 1
    assert len({pick(t, "hard", seed) for seed in SEEDS}) == 1
