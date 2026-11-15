"""Majority and minority stockholder bonuses.

Rules: docs/rules/mergers.md "Stockholder Bonuses" and "Tie-Breaking Rules",
docs/rules/endgame.md (final bonuses for every chain still on the board).
- Majority holder: majority bonus (10x price in default); second-largest
  holder: minority bonus (5x price).
- A sole stockholder receives both.
- A tie for majority adds both bonuses and splits them, rounded up to the
  ruleset's step ($100 in default); nobody receives a minority bonus.
- A tie for minority splits the minority bonus, rounded up likewise.

Each test plays a defunct sandpiper of 3 tiles (cheap tier: price $300,
majority $3,000, minority $1,500) into a 4-tile marlowe and reads what was paid.
"""

from __future__ import annotations

import pytest

from tests.support.table import Table


def merge_sandpiper(buys: dict[str, int]) -> Table:
    """Play sandpiper (1A-3A, founded by p2) into marlowe (5A-8A) with p2's 4A.

    ``buys``: extra sandpiper shares bought by each player while sandpiper has 2
    tiles (p2 also holds the founder share).
    """
    t = Table([["1A", "6A", "8A"], ["2A", "3A", "4A"], ["5A", "7A"]])
    t.turn("1A")
    t.turn("2A", found="sandpiper", buy={"sandpiper": buys.get("p2", 0)})
    t.turn("5A", buy={"sandpiper": buys.get("p3", 0)})
    t.turn("6A", found="marlowe", buy={"sandpiper": buys.get("p1", 0)})
    t.turn("3A")
    t.turn("7A")
    t.turn("8A")
    t.place("4A")
    return t


def sandpiper_bonuses(t: Table) -> dict:
    (paid,) = [e for e in t.events("bonuses_paid") if e["chain"] == "sandpiper"]
    assert paid["chain_size"] == 3
    return {pid: b["majority"] + b["minority"] for pid, b in paid["bonuses"].items()}


@pytest.mark.parametrize(
    "buys, expected",
    [
        # sole stockholder (p2, the founder): both bonuses
        pytest.param({}, {"p2": 4500}, id="sole-holder"),
        # p2 2 shares, p3 1: majority and minority
        pytest.param({"p2": 1, "p3": 1}, {"p2": 3000, "p3": 1500}, id="clear"),
        # p2 3, p3 2, p1 1: the third-largest holder gets nothing
        pytest.param(
            {"p2": 2, "p3": 2, "p1": 1}, {"p2": 3000, "p3": 1500}, id="third-nothing"
        ),
        # p1 3, founder p2 1: the majority need not be the founder or mergemaker
        pytest.param({"p1": 3}, {"p1": 3000, "p2": 1500}, id="majority-elsewhere"),
        # two tied for majority: (3000 + 1500) / 2 = 2250 -> 2300 each
        pytest.param(
            {"p2": 1, "p3": 2}, {"p2": 2300, "p3": 2300}, id="majority-tie-rounds-up"
        ),
        # three tied for majority: 4500 / 3 = 1500 each, no rounding
        pytest.param(
            {"p2": 1, "p3": 2, "p1": 2},
            {"p1": 1500, "p2": 1500, "p3": 1500},
            id="three-way-majority-tie",
        ),
        # two tied for minority: 1500 / 2 = 750 -> 800 each
        pytest.param(
            {"p2": 2, "p3": 1, "p1": 1},
            {"p2": 3000, "p3": 800, "p1": 800},
            id="minority-tie-rounds-up",
        ),
    ],
)
def test_merger_bonuses(buys, expected):
    t = merge_sandpiper(buys)
    cash = {p: t.money(p) for p in ("p1", "p2", "p3")}
    assert sandpiper_bonuses(t) == expected
    # and the money really arrived (bonuses are paid before disposition)
    spent = {"p1": 6000, "p2": 6000, "p3": 6000}
    for pid, n in buys.items():
        spent[pid] -= 200 * n
    for pid in ("p1", "p2", "p3"):
        assert cash[pid] == spent[pid] + expected.get(pid, 0), pid


def test_final_bonuses_are_paid_for_every_chain_still_on_the_board():
    """docs/rules/endgame.md: at the end, bonuses for each active chain are
    paid exactly as in a merger, then every share is sold at its price."""
    t = Table([["1A", "1C"], ["2A", "2C"], ["12I", "3C"]])
    t.turn("1A")
    t.turn("2A", found="sandpiper", buy={"sandpiper": 1})  # p2: 2 sandpiper
    t.turn("12I", buy={"sandpiper": 1})  # p3: 1 sandpiper
    t.turn("1C")
    t.turn("2C", found="obsidian")  # p2: 1 obsidian
    t.place("3C")  # p3: obsidian 3 tiles
    t.buy({"obsidian": 3})  # p3: 3 obsidian at $500
    t.end()
    cash = {p: t.money(p) for p in ("p1", "p2", "p3")}

    before = t.mark()
    result = t.game.end_game()
    paid = {e["chain"]: e for e in t.events("bonuses_paid", since=before)}
    assert all(e["final"] for e in paid.values())
    # sandpiper 2 tiles ($200): p2 majority $2,000, p3 minority $1,000
    assert paid["sandpiper"]["bonuses"] == {
        "p2": {"majority": 2000, "minority": 0},
        "p3": {"majority": 0, "minority": 1000},
    }
    # obsidian 3 tiles (expensive, $500): p3 $5,000, p2 $2,500
    assert paid["obsidian"]["bonuses"] == {
        "p3": {"majority": 5000, "minority": 0},
        "p2": {"majority": 0, "minority": 2500},
    }
    final = {s.player_id: s.money for s in result.standings}
    assert final["p1"] == cash["p1"]
    assert final["p2"] == cash["p2"] + 2000 + 2500 + 2 * 200 + 1 * 500
    assert final["p3"] == cash["p3"] + 1000 + 5000 + 1 * 200 + 3 * 500
