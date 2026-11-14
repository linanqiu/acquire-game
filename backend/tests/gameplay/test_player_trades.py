"""Player-to-player trades of shares and cash.

Rules: docs/rules/stocks.md "Player-to-Player Trading" (shares, cash or both;
the other player accepts or declines) as implemented by the seat contract
(docs/architecture/seat-contract.md: any player may propose, accept, reject or
cancel at any time between start and game over; responses never block play).
- A trade only goes through if, at the moment it is accepted, both sides
  still have what they promised. (The engine also refuses a trade that would
  leave someone above the per-chain share cap; the cap equals the bank's
  stock per chain in every ruleset, so real play cannot reach it.)
- Only the recipient accepts or rejects; only the proposer cancels.
- A player may not trade with themselves, nor propose an empty trade, nor
  keep more than the ruleset's number of open proposals.
"""

from __future__ import annotations

import pytest

from game.decisions import legal_actions, pending_decisions
from tests.support.table import Table


def holdings() -> Table:
    """p2 founded Luxor and bought 3 (4 shares); p3 founded Tower (1)."""
    t = Table([["1A", "1C"], ["2A", "10G"], ["12I", "2C"]])
    t.turn("1A")
    t.turn("2A", found="Luxor", buy={"Luxor": 3})
    t.turn("12I")
    t.turn("1C")
    t.turn("10G")
    t.turn("2C", found="Tower")
    return t  # p1 on turn


def propose(t, frm, to, trade_id="t1", **kw):
    return t.act(frm, action="propose_trade", to_player_id=to, trade_id=trade_id, **kw)


def test_accepted_trade_moves_shares_and_cash_both_ways():
    t = holdings()
    cash = {p: t.money(p) for p in ("p2", "p3")}
    propose(
        t,
        "p2",
        "p3",
        offering_stocks={"Luxor": 2},
        offering_money=150,
        requesting_stocks={"Tower": 1},
        requesting_money=50,
    )
    # the offer waits for p3 without blocking p1's turn
    kinds = [(d.kind, d.player_id) for d in pending_decisions(t.game)]
    assert kinds == [("place_tile", "p1"), ("trade_response", "p3")]

    t.act("p3", action="accept_trade", trade_id="t1")
    assert (t.shares("p2", "Luxor"), t.shares("p3", "Luxor")) == (2, 2)
    assert (t.shares("p2", "Tower"), t.shares("p3", "Tower")) == (1, 0)
    assert t.money("p2") == cash["p2"] - 150 + 50
    assert t.money("p3") == cash["p3"] + 150 - 50
    assert t.game.pending_trades == {}
    assert t.events("trade_accepted")[0]["trade"]["trade_id"] == "t1"


def test_only_the_recipient_answers_and_only_the_proposer_cancels():
    t = holdings()
    propose(t, "p2", "p3", offering_money=100)
    for pid, action in [
        ("p2", "accept_trade"),
        ("p1", "accept_trade"),
        ("p1", "reject_trade"),
        ("p3", "cancel_trade"),
    ]:
        r = t.try_act(pid, action=action, trade_id="t1")
        assert not r["success"], (pid, action)
    t.act("p3", action="reject_trade", trade_id="t1")
    assert t.game.pending_trades == {} and t.money("p3") == 6000

    propose(t, "p2", "p3", trade_id="t2", offering_money=100)
    t.act("p2", action="cancel_trade", trade_id="t2")
    r = t.try_act("p3", action="accept_trade", trade_id="t2")
    assert not r["success"] and "not found" in r["error"]


def test_an_offer_that_can_no_longer_be_honoured_cannot_be_accepted():
    t = holdings()
    propose(t, "p2", "p3", trade_id="a", offering_stocks={"Luxor": 4})
    propose(t, "p2", "p1", trade_id="b", offering_stocks={"Luxor": 4})
    t.act("p1", action="accept_trade", trade_id="b")  # p2's Luxor is gone
    (response,) = [d for d in pending_decisions(t.game) if d.kind == "trade_response"]
    assert legal_actions(t.game, response)["can_accept"] is False
    r = t.try_act("p3", action="accept_trade", trade_id="a")
    assert not r["success"] and "no longer valid" in r["error"]
    assert t.shares("p3", "Luxor") == 0 and t.shares("p1", "Luxor") == 4
    # the stale offer stays until its recipient declines it
    t.act("p3", action="reject_trade", trade_id="a")
    assert t.game.pending_trades == {}


def test_you_cannot_offer_what_you_do_not_have_nor_ask_for_what_they_lack():
    t = holdings()
    cases = [
        ("p2", {"offering_stocks": {"Luxor": 5}}, "Offering player"),
        ("p2", {"offering_money": 999999}, "Offering player"),
        ("p2", {"requesting_stocks": {"Tower": 2}}, "Receiving player"),
        ("p2", {"requesting_money": 999999}, "Receiving player"),
        ("p2", {}, "at least one item"),
        ("p2", {"offering_stocks": {"Luxor": 0}}, "at least one item"),
        ("p2", {"requesting_stocks": {"Tower": 0}}, "at least one item"),
    ]
    for frm, kw, error in cases:
        r = t.try_act(frm, action="propose_trade", to_player_id="p3", **kw)
        assert not r["success"] and error in r["error"], (kw, r)
    r = t.try_act("p2", action="propose_trade", to_player_id="p2", offering_money=1)
    assert not r["success"] and "yourself" in r["error"]
    r = t.try_act("p2", action="propose_trade", to_player_id="p9", offering_money=1)
    assert not r["success"] and "not found" in r["error"]
    r = t.try_act(
        "p2", action="propose_trade", to_player_id="p3", offering_money=1, trade_id=7
    )
    assert not r["success"] and "trade_id" in r["error"]
    assert t.game.pending_trades == {}


@pytest.mark.parametrize(
    "terms",
    [
        {"offering_stocks": {"Luxor": 1}},  # a one-share gift
        {"offering_money": 1},  # a one-dollar gift
        {"requesting_stocks": {"Tower": 1}},  # asking for one share
        {"requesting_money": 1},  # asking for one dollar
    ],
)
def test_the_smallest_trade_is_one_share_or_one_dollar_one_way(terms):
    t = holdings()
    t.act("p2", action="propose_trade", to_player_id="p3", trade_id="s", **terms)
    t.act("p3", action="accept_trade", trade_id="s")
    assert t.events("trade_accepted")[0]["trade"]["trade_id"] == "s"


def test_open_proposals_per_player_are_limited_by_the_ruleset():
    t = holdings()
    limit = t.ruleset.max_pending_trades_per_player
    for i in range(limit):
        propose(t, "p1", "p3", trade_id=f"x{i}", offering_money=1)
    r = t.try_act("p1", action="propose_trade", to_player_id="p3", offering_money=1)
    assert not r["success"] and f"Maximum of {limit}" in r["error"]
    # others are not affected
    propose(t, "p2", "p3", trade_id="y", offering_money=1)
