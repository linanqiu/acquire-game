"""Buying stock from the bank.

Rules: docs/rules/stocks.md "Purchasing Stock".
- After placing a tile a player may buy up to the ruleset's limit (3 in
  default, 4 in mini) in any mix of chains on the board, once per turn.
- The price is the chain's price at its current size; you must afford the
  whole purchase and the bank must have the shares.
- No stock in chains that are not on the board (never founded or defunct).
"""

from __future__ import annotations

import pytest

from game.ruleset import load_ruleset
from tests.support.table import Table


def two_chains() -> Table:
    """sandpiper 1A-2A ($200) and obsidian 1C-3C ($500); p3 to buy."""
    t = Table([["1A", "1C"], ["2A", "2C"], ["12I", "3C"]])
    t.turn("1A")
    t.turn("2A", found="sandpiper")
    t.turn("12I")
    t.turn("1C")
    t.turn("2C", found="obsidian")
    t.place("3C")
    assert t.current == "p3"
    return t


def test_mixed_purchase_at_current_prices_then_only_end_turn():
    t = two_chains()
    before = t.mark()
    t.buy({"sandpiper": 1, "obsidian": 2})
    assert t.money("p3") == 6000 - 200 - 2 * 500
    assert (t.shares("p3", "sandpiper"), t.shares("p3", "obsidian")) == (1, 2)
    assert t.game.hotel.get_available_stocks("obsidian") == 25 - 1 - 2
    (event,) = t.events("stocks_purchased", since=before)
    assert event["total_cost"] == 1200
    assert event["prices"] == {"sandpiper": 200, "obsidian": 500}

    # One purchase per turn; the turn can only end now.
    r = t.try_act("p3", action="buy_stocks", purchases={"sandpiper": 1})
    assert not r["success"] and "already bought" in r["error"]
    assert "buy_stocks" not in t.legal()["action_types"]
    t.end()
    assert t.current == "p1"


def test_buying_nothing_is_a_choice_and_ends_the_buy():
    t = two_chains()
    t.buy({})
    assert t.money("p3") == 6000
    assert t.legal()["action_types"][0] == "end_turn"


@pytest.mark.parametrize(
    "purchases, error",
    [
        ({"sandpiper": 2, "obsidian": 2}, "up to 3"),
        ({"marlowe": 1}, "not active"),  # never founded
    ],
)
def test_illegal_purchases_change_nothing(purchases, error):
    t = two_chains()
    r = t.try_act("p3", action="buy_stocks", purchases=purchases)
    assert not r["success"] and error in r["error"]
    assert t.money("p3") == 6000
    assert t.game.stocks_bought_this_turn is False
    t.buy({"sandpiper": 3})  # the player can still buy


@pytest.mark.parametrize("ruleset_id", ["default", "mini"])
def test_purchase_limit_comes_from_the_ruleset(ruleset_id):
    rs = load_ruleset(ruleset_id)
    chain = rs.chain_ids[0]
    t = Table([["1A"], ["2A"]] + [[]] * (rs.min_players - 2), ruleset=rs)
    t.turn("1A")
    t.place("2A")
    t.found(chain)
    limit = rs.max_stock_purchases_per_turn
    assert t.legal()["max_total"] == limit
    r = t.try_act("p2", action="buy_stocks", purchases={chain: limit + 1})
    assert not r["success"]
    t.buy({chain: limit})
    assert t.shares("p2", chain) == rs.founder_bonus_shares + limit


def test_cannot_spend_more_than_you_have():
    """obsidian at $500: p3 buys 3 a turn until the cash runs out."""
    t = two_chains()
    p = "p3"
    while True:
        assert t.current == p and t.decision().kind == "buy_stocks"
        if t.money(p) < 1500:
            break
        t.buy({"obsidian": 3})
        t.end()
        while t.current != p:  # p1 and p2 place lone fillers
            t.pass_turn()
        t.place(str(t.player(p).hand[0]))
    assert t.money(p) == 6000 - 4 * 1500
    option = next(o for o in t.legal()["options"] if o["chain"] == "obsidian")
    assert (option["price"], option["max_affordable"]) == (500, 0)
    r = t.try_act(p, action="buy_stocks", purchases={"obsidian": 1})
    assert not r["success"] and "Not enough money" in r["error"]


def test_cannot_buy_more_shares_than_the_bank_has_left():
    rs = load_ruleset("mini")
    chain = rs.chain_ids[0]
    t = Table([["1A"], ["2A"]], ruleset=rs)
    t.turn("1A")
    t.turn("2A", found=chain, buy={chain: 4})  # bank 18 - 2 - 4 = 12
    for _ in range(3):  # p1 4, p2 4, p1 3 -> 1 left
        t.place_filler()
        t.buy({chain: 4 if t.game.hotel.get_available_stocks(chain) > 4 else 3})
        t.end()
    assert t.game.hotel.get_available_stocks(chain) == 1
    t.place_filler()
    option = next(o for o in t.legal()["options"] if o["chain"] == chain)
    assert (option["available"], option["max_affordable"]) == (1, 1)
    r = t.try_act(t.current, action="buy_stocks", purchases={chain: 2})
    assert not r["success"] and f"Not enough {chain} stock" in r["error"]
    t.buy({chain: 1})
    assert t.game.hotel.get_available_stocks(chain) == 0
    holdings = sum(t.shares(p, chain) for p in ("p1", "p2"))
    assert holdings == rs.stocks_per_chain


def test_defunct_chain_stock_cannot_be_bought():
    t = Table([["1A", "4A"], ["2A", "5A"], ["12I", "3A", "10I"]])
    t.turn("1A")
    t.turn("2A", found="sandpiper")
    t.turn("12I")
    t.turn("4A")
    t.turn("5A", found="marlowe")
    t.place("3A")
    t.act("p3", action="merger_choice", surviving_chain="marlowe")
    t.dispose("p2", "sandpiper", sell=1)
    r = t.try_act("p3", action="buy_stocks", purchases={"sandpiper": 1})
    assert not r["success"] and "not active" in r["error"]
    assert [o["chain"] for o in t.legal()["options"]] == ["marlowe"]
