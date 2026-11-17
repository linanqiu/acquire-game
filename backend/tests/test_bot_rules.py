"""Tier 1: the rules later bot generations add (agents/bot_rules.py,
agents/bot_versions.py), on positions reached by real play.

The position is the one of tests/test_tile_value.py (the owner's report):
SURV (4 tiles): p2 4, p3 3, p4 6 shares; DEF (3 tiles): p2 4, p3 2.
"""

from __future__ import annotations

from agents.base import build_context
from agents.bot_rules import buy_position_value, choose_buys_position
from agents.heuristic import HeuristicAgent
from game.decisions import BUY_STOCKS, STOCK_DISPOSITION
from tests.test_tile_value import DEF, MERGE_TILE, screenshot_table


def to_buy_step(t, pid: str):
    """``pid`` (on turn) places a lone tile and reaches the buy step."""
    assert t.current == pid
    t.place_filler()
    d = t.decision()
    assert d.kind == BUY_STOCKS and d.player_id == pid
    return d


def options(t, d) -> dict:
    return {o["chain"]: o for o in t.legal()["options"]}


def test_position_buying_takes_the_cheapest_open_bonus_position():
    t = screenshot_table("p1")
    d = to_buy_step(t, "p1")
    legal = t.legal()
    counts, value = choose_buys_position(
        t.game, "p1", options(t, d), legal["money"], legal["max_total"]
    )
    # 3 DEF shares beat p3's 2: p1 takes the DEF minority; in SURV p1 would
    # need 4 shares just to tie for the minority.
    assert counts == {DEF: 3}
    assert value > 0
    # the v3+ seat answers exactly that through the seat contract
    for version in ("v3", "v8"):
        agent = HeuristicAgent(name="p1", seed=1, version=version)
        answer = agent.choose(build_context(t.game, d))
        assert answer == {"action": "buy_stocks", "purchases": {DEF: 3}}
    # v1's spread buying does not
    v1 = HeuristicAgent(name="p1", seed=1, version="v1").choose(
        build_context(t.game, d)
    )
    assert v1["purchases"] != {DEF: 3}


def test_size_ahead_values_growing_chains_more():
    t = screenshot_table("p1")
    now = buy_position_value(t.game, "p1", DEF, 3)
    ahead = buy_position_value(t.game, "p1", DEF, 3, size_ahead=3)
    assert ahead > now > 0


def test_defended_value_discounts_a_lead_a_rival_can_overtake():
    t = screenshot_table("p3")
    to_buy_step(t, "p3")
    # p3 (2 DEF) buying 3 leads p2 (4) by one: p2 can buy 3 and pass again.
    plain = buy_position_value(t.game, "p3", DEF, 3)
    defended = buy_position_value(t.game, "p3", DEF, 3, defend=0.5)
    assert 0 < defended < plain


def test_position_disposition_trades_into_a_survivor_majority():
    """p2 sets off the merger and holds 4 DEF and 4 SURV against p4's 6 SURV:
    trading 4 DEF for 2 SURV ties p4 for the survivor's majority."""
    t = screenshot_table("p2")
    t.place(MERGE_TILE)
    d = t.decision()
    assert d.kind == STOCK_DISPOSITION and d.player_id == "p2"
    ctx = build_context(t.game, d)
    info = ctx.calc["disposition"]
    assert info["shares"] == 4 and info["max_trade"] == 4
    v4 = HeuristicAgent(name="p2", seed=1, version="v4").choose(ctx)
    assert v4["disposition"] == {"sell": 0, "trade": 4, "hold": 0}


def test_cheapest_founding():
    from game.board import Board
    from game.decisions import Decision

    t = screenshot_table("p1")
    chains = t.game.hotel.get_inactive_chains()
    agent = HeuristicAgent(name="p1", seed=1, version="v8")
    rs = Board().ruleset
    # the found decision is answered from legal chains only
    ctx = build_context(t.game, t.decision())
    ctx.decision = Decision("p1", "found_chain", {})
    ctx.legal = {"action_types": ["found_chain"], "chains": chains}
    choice = agent.choose(ctx)["chain"]
    cheapest = min(rs.tier_rank(rs.chain(c).tier) for c in chains)
    assert rs.tier_rank(rs.chain(choice).tier) == cheapest
