"""Ending the game and final scoring.

Rules: docs/rules/endgame.md.
- The player on turn MAY declare the game over once one chain has reached
  the ruleset's end size (41 in classic, 25 in mini) or every chain on the
  board is safe (11 tiles in classic, 8 in mini). Nobody else may.
- Final scoring: bonuses for every chain on the board, then every share is
  sold at its chain's final price; stock of a defunct chain is worthless.
  Most money wins.
"""

from __future__ import annotations

import pytest

from game.game import GamePhase
from game.ruleset import load_ruleset
from tests.support.table import Table, grow_two_chains as grow_table, line, scripts_for


@pytest.mark.parametrize("ruleset_id", ["classic", "mini"])
def test_a_chain_at_the_end_size_lets_the_player_on_turn_declare(ruleset_id):
    rs = load_ruleset(ruleset_id)
    end = rs.end_game_chain_size
    # chain 1 stays small (and unsafe) so only the size condition can apply
    t, next_big, _ = grow_table(rs, end - 1, 2)
    assert "declare_end_game" not in t.legal()["action_types"]
    r = t.try_act(t.current, action="declare_end_game")
    assert not r["success"] and "not met" in r["error"]

    t.place(next_big)
    assert t.size(rs.chain_ids[0]) == end
    assert t.game.get_public_state()["can_end_game"] is True
    assert "declare_end_game" in t.legal()["action_types"]
    other = next(p.player_id for p in t.game.players if p.player_id != t.current)
    r = t.try_act(other, action="declare_end_game")
    assert not r["success"] and "current player" in r["error"]
    t.act(t.current, action="declare_end_game")
    assert t.game.phase == GamePhase.GAME_OVER
    assert not any(
        t.game.get_player_state(p.player_id)["can_act"] for p in t.game.players
    )
    assert t.events("game_ended")[0]["reason"] == "declared"


@pytest.mark.parametrize("ruleset_id", ["classic", "mini"])
def test_every_chain_safe_lets_the_player_on_turn_declare(ruleset_id):
    rs = load_ruleset(ruleset_id)
    safe = rs.safe_chain_size
    t, _, next_small = grow_table(rs, safe, safe - 1)
    # one chain safe, the other one tile short: no
    assert "declare_end_game" not in t.legal()["action_types"]
    t.pass_turn()
    t.place(next_small)
    assert t.size(rs.chain_ids[1]) == safe
    assert "declare_end_game" in t.legal()["action_types"]
    t.end()
    # still available at the start of the next player's turn
    assert "declare_end_game" in t.legal()["action_types"]


def test_declaring_is_only_possible_when_placing_or_buying():
    """Safe Luxor (11 tiles) is the only chain: the end condition holds, but
    not while a chain is being founded or a merger is being resolved."""
    rs = load_ruleset("classic")
    moves = ["1A", ("2A", {"found": "Luxor"})] + line("A", 3, 11)
    extra = {len(moves) % 3: ["1C"], (len(moves) + 1) % 3: ["2C"]}
    t = Table(scripts_for(moves, 3, extra), ruleset=rs)
    t.play(moves)
    me = t.current
    assert t.game.get_player_state(me)["end_game_available"] is True
    nxt = next(p.player_id for p in t.game.players if p.player_id != me)
    assert t.game.get_player_state(nxt)["end_game_available"] is False
    t.turn("1C")
    t.place("2C")  # founding: no declaring now
    assert t.decision().kind == "found_chain"
    r = t.try_act(t.current, action="declare_end_game")
    assert not r["success"] and "not met" in r["error"]
    assert t.game.get_player_state(t.current)["end_game_available"] is False
    t.found("Tower")
    # a 2-tile Tower is not safe: the condition no longer holds
    assert "declare_end_game" not in t.legal()["action_types"]


def test_final_scoring_sells_everything_and_defunct_stock_is_worthless():
    # Luxor (1A-3A) dies into Tower (5A-8A); p2 holds its 3 Luxor shares.
    t = Table([["1A", "6A", "8A"], ["2A", "3A", "4A"], ["5A", "7A"]])
    t.turn("1A")
    t.turn("2A", found="Luxor", buy={"Luxor": 2})
    t.turn("5A", buy={"Luxor": 2})
    t.turn("6A", found="Tower", buy={"Luxor": 1})
    t.turn("3A")
    t.turn("7A")
    t.turn("8A")
    t.place("4A")
    t.dispose("p2", "Luxor", hold=3)
    t.dispose("p3", "Luxor", sell=2)
    t.dispose("p1", "Luxor", trade=0, hold=1)
    t.buy({"Tower": 1})  # p2: Tower 8 tiles, $600
    t.end()
    cash = {p: t.money(p) for p in ("p1", "p2", "p3")}

    result = t.game.end_game()
    sales = t.events("game_ended")[0]["final_sales"]
    # Tower: p1 1 (founder), p2 1 -> tied majority: ($6,000 + $3,000) / 2
    assert sales == {"p1": 600, "p2": 600}  # held Luxor sold for nothing
    assert t.shares("p2", "Luxor") == 0
    final = {s.player_id: s.money for s in result.standings}
    assert final == {
        "p1": cash["p1"] + 4500 + 600,
        "p2": cash["p2"] + 4500 + 600,
        "p3": cash["p3"],
    }
    # standings: most money first, ties share a rank
    ranked = [(s.player_id, s.rank) for s in result.standings]
    order = sorted(final, key=lambda p: -final[p])
    assert [p for p, _ in ranked] == order
    assert [w.player_id for w in result.winners] == [
        p for p in order if final[p] == max(final.values())
    ]
