"""Placing tiles: lone tiles, founding a chain, expanding, the chain limit.

Rules: docs/rules/tiles.md "Types of Tile Placements", docs/rules/chains.md
"Founding a New Chain".
- A tile touching nothing stays alone; play moves on to buying.
- A tile touching lone tiles founds a chain; every connected lone tile joins
  it; the founder picks any chain not on the board and receives the
  ruleset's founder shares free (1 in classic, 2 in mini). Shares the bank
  cannot supply are paid in cash at the new chain's price.
- A tile touching one chain expands it, adopting lone tiles it connects.
- A tile that would found a chain while every chain is on the board cannot
  be played (it is not offered), but lone placements and expansions still are.
"""

from __future__ import annotations

import pytest

from game.ruleset import load_ruleset
from tests.support.table import Table


def test_lone_tile_then_founding_with_every_connected_lone_tile():
    t = Table([["5C", "12I"], ["6D", "10I"], ["5D"]])
    t.turn("5C")
    assert t.events("tile_placed")[-1]["outcome"] == "nothing"
    t.turn("6D")
    assert t.game.hotel.get_active_chains() == []

    r = t.place("5D")  # touches 5C (above) and 6D (right)
    assert r["result"] == "found"
    d = t.decision()
    assert (d.kind, d.player_id) == ("found_chain", "p3")
    assert d.context["available_chains"] == t.game.hotel.get_all_chain_names()
    founded = t.found("Festival")
    assert founded["founder_bonus"] is True

    assert t.size("Festival") == 3
    assert t.shares("p3", "Festival") == 1
    assert t.game.hotel.get_available_stocks("Festival") == 24
    assert t.money("p3") == 6000  # the founder share is free
    founded = t.events("chain_founded")[0]
    assert (founded["size"], founded["founder_bonus_type"]) == (3, "stock")
    assert t.decision().kind == "buy_stocks"


def test_founder_cannot_pick_a_chain_already_on_the_board():
    t = Table([["1A", "2A"], ["5E", "6E"], ["12I"]])
    t.turn("1A")
    t.turn("5E")
    t.turn("12I")
    t.turn("2A", found="Luxor")
    t.place("6E")
    assert "Luxor" not in t.decision().context["available_chains"]
    r = t.try_act("p2", action="found_chain", chain="Luxor")
    assert not r["success"] and "not available" in r["error"]
    t.found("Tower")
    assert t.game.hotel.get_active_chains() == ["Luxor", "Tower"]


def test_expansion_adopts_lone_tiles_it_connects():
    # Luxor 1A-2A; lone tile 4A; 3A joins both to Luxor.
    t = Table([["1A", "3A"], ["2A"], ["4A"]])
    t.turn("1A")
    t.turn("2A", found="Luxor")
    t.turn("4A")
    r = t.place("3A")
    assert (r["result"], r["chain"]) == ("expand", "Luxor")
    assert t.size("Luxor") == 4
    expanded = t.events("chain_expanded")[0]
    assert (expanded["chain"], expanded["size"]) == ("Luxor", 4)
    # the price follows the new size ($400 for a cheap chain of 4)
    t.buy({"Luxor": 1})
    assert t.money("p1") == 6000 - 400


@pytest.mark.parametrize("ruleset_id", ["classic", "mini"])
def test_founder_receives_the_rulesets_founder_shares(ruleset_id):
    rs = load_ruleset(ruleset_id)
    chain = rs.chain_ids[-1]
    t = Table([["1A"], ["2A"]] + [[]] * (rs.min_players - 2), ruleset=rs)
    t.turn("1A")
    t.place("2A")
    t.found(chain)
    assert t.shares("p2", chain) == rs.founder_bonus_shares
    assert t.game.hotel.get_available_stocks(chain) == (
        rs.stocks_per_chain - rs.founder_bonus_shares
    )


@pytest.mark.parametrize("bought_last, shares, cash", [(4, 0, 200), (3, 1, 100)])
def test_founder_shares_the_bank_cannot_supply_are_paid_in_cash(
    bought_last, shares, cash
):
    """Mini (2 founder shares, 18 per chain): the players buy up harbor,
    hold it through a merger, and p1 founds harbor again."""
    rs = load_ruleset("mini")
    a, b = "harbor", "meadow"
    t = Table(
        [["1A", "9G", "3G", "5A", "3A", "2D"], ["2A", "1G", "4A", "6A", "1D"]],
        ruleset=rs,
    )
    t.turn("1A")
    t.turn("2A", found=a, buy={a: 4})  # p2: 2 + 4, bank 12
    t.turn("9G", buy={a: 4})  # bank 8
    t.turn("1G", buy={a: 4})  # bank 4
    t.turn("3G", buy={a: bought_last})
    t.turn("4A")
    t.turn("5A", found=b)
    t.turn("6A")  # meadow 3 tiles
    t.place("3A")  # harbor (2) into meadow (3)
    for pid in ("p1", "p2"):
        held = t.shares(pid, a)
        t.dispose(pid, a, hold=held)
    t.end()
    assert t.game.hotel.get_available_stocks(a) == 4 - bought_last
    t.turn("1D")
    cash_before = t.money("p1")
    shares_before = t.shares("p1", a)
    t.place("2D")
    t.found(a)

    assert t.shares("p1", a) - shares_before == shares
    assert t.money("p1") - cash_before == cash  # $100 per missing share
    event = t.events("chain_founded")[-1]
    assert event["founder_bonus_type"] == ("stock" if shares else "cash")
    if shares:
        assert event["founder_bonus_cash"] == cash
    else:
        assert event["founder_bonus_value"] == cash
        assert "founder_bonus_cash" not in event


def test_a_tile_that_would_found_one_chain_too_many_is_not_playable():
    """All seven classic chains on the board: 12H next to lone 12I would found
    an eighth, so it is not offered; a lone tile still is."""
    pairs = ["1A", "2A", "4A", "5A", "7A", "8A", "10A", "11A",
             "1C", "2C", "4C", "5C", "7C", "8C"]  # fmt: skip
    chains = ["Luxor", "Tower", "American", "Worldwide", "Festival", "Imperial",
              "Continental"]  # fmt: skip
    # p1 plays the first tile of each pair, p2 the second (founding).
    p1 = pairs[0::2] + ["12I", "12H", "10E"]
    p2 = pairs[1::2] + ["10G"]
    t = Table([p1, p2, []])
    for i, chain in enumerate(chains):
        t.turn(pairs[2 * i])
        t.turn(pairs[2 * i + 1], found=chain)
        t.pass_turn()  # p3 places a filler
    t.turn("12I")
    t.turn("10G")
    t.pass_turn()
    assert len(t.game.hotel.get_active_chains()) == 7

    offered = t.offered_tiles()
    assert "12H" not in offered and "10E" in offered
    r = t.try_act("p1", action="place_tile", tile="12H")
    assert not r["success"] and "cannot be placed" in r["error"]
    state = t.game.get_player_state("p1")
    assert state["tile_playability"]["12H"] == {
        "playable": False,
        "reason": "would_create_eighth_chain",
        "permanent": True,  # until a merger frees a chain
        "would_trigger_merger": False,
    }
    t.place("10E")
