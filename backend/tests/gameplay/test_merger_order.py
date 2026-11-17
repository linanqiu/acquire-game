"""Merger order: the mergemaker picks which same-size defunct chain goes next.

Rules: docs/rules/mergers.md, "Multi-chain mergers".
- Defunct chains are resolved largest first.
- When defunct chains are the same size, the player who placed the merging
  tile chooses which of them is resolved next (one choice at a time, so a
  three-way tie is two choices; the last chain needs none).
- Chains of different sizes are never offered.

Every position is reached by real moves (``tests.support.table.Table``).
"""

from __future__ import annotations

from game.calculator import merger_history
from game.decisions import CHOOSE_DEFUNCT_ORDER, apply_action
from game.game import GamePhase
from game.ruleset import Ruleset, default_ruleset
from game.snapshot import from_snapshot, to_snapshot
from tests.support.table import Table


def three_twos(ruleset=None) -> Table:
    """sandpiper 3E-4E (p2), marlowe 6E-7E (p1) and halcyon 5C-5D (p3), two
    tiles each, all touching 5E, which p1 holds. Founders hold one share."""
    t = Table([["3E", "7E", "5E"], ["4E", "5C"], ["6E", "5D"]], ruleset=ruleset)
    t.turn("3E")
    t.turn("4E", found="sandpiper")
    t.turn("6E")
    t.turn("7E", found="marlowe")
    t.turn("5C")
    t.turn("5D", found="halcyon")
    return t


def four_chains(halcyon_three: bool) -> Table:
    """obsidian 5F-5H (3 tiles) below 5E; sandpiper 3E-4E, marlowe 6E-7E and
    halcyon 5C-5D (5B-5D when ``halcyon_three``) around it. p1 holds 5E."""
    p1 = ["3E", "7E", "5H"] + (["5B"] if halcyon_three else []) + ["5E"]
    t = Table([p1, ["4E", "5C", "5G"], ["6E", "5D", "5F"]])
    t.turn("3E")
    t.turn("4E", found="sandpiper")
    t.turn("6E")
    t.turn("7E", found="marlowe")
    t.turn("5C")
    t.turn("5D", found="halcyon")
    t.turn("5H")
    t.turn("5G", found="obsidian")
    t.turn("5F")
    if halcyon_three:
        t.turn("5B")
        t.pass_turn()
        t.pass_turn()
    assert t.current == "p1"
    return t


def order(t: Table, chain: str) -> dict:
    return t.act("p1", action="merger_order", defunct_chain=chain)


class TestTwoDefunctChainsOfTheSameSize:
    def start(self) -> Table:
        t = three_twos()
        t.place("5E")
        r = t.act("p1", action="merger_choice", surviving_chain="halcyon")
        assert r["next_action"] == "choose_defunct_order"
        return t

    def test_the_mergemaker_is_asked_and_nothing_is_paid_before_the_answer(self):
        t = self.start()
        d = t.decision()
        assert (d.kind, d.player_id) == (CHOOSE_DEFUNCT_ORDER, "p1")
        assert d.context == {
            "tied_chains": ["marlowe", "sandpiper"],
            "surviving_chain": "halcyon",
        }
        assert t.legal() == {
            "action_types": ["merger_order"],
            "chains": ["marlowe", "sandpiper"],
        }
        assert t.game.phase == GamePhase.MERGING
        assert t.events("bonuses_paid") == []
        assert t.game.can_player_act("p1") and not t.game.can_player_act("p2")

    def test_only_the_mergemaker_may_answer_and_only_with_a_tied_chain(self):
        t = self.start()
        before = to_snapshot(t.game)
        for pid, action in [
            ("p2", {"action": "merger_order", "defunct_chain": "sandpiper"}),
            ("p1", {"action": "merger_order", "defunct_chain": "halcyon"}),
            ("p1", {"action": "merger_order", "defunct_chain": "obsidian"}),
            ("p1", {"action": "merger_order", "defunct_chain": "nope"}),
            ("p1", {"action": "merger_order"}),
            ("p1", {"action": "merger_choice", "surviving_chain": "marlowe"}),
            (
                "p1",
                {
                    "action": "merger_disposition",
                    "defunct_chain": "marlowe",
                    "disposition": {"sell": 1},
                },
            ),
            ("p1", {"action": "end_turn"}),
        ]:
            r = apply_action(t.game, pid, action)
            assert not r["success"], (pid, action)
        assert to_snapshot(t.game) == before

    def test_the_chosen_chain_is_resolved_first(self):
        t = self.start()
        r = order(t, "sandpiper")
        assert r["defunct_chain"] == "sandpiper"
        assert r["next_action"] == "stock_disposition"
        chosen = t.events("defunct_order_chosen")
        assert len(chosen) == 1
        assert chosen[0]["player_id"] == "p1"
        assert chosen[0]["chain"] == "sandpiper"
        assert chosen[0]["tied_chains"] == ["marlowe", "sandpiper"]
        assert [e["chain"] for e in t.events("bonuses_paid")] == ["sandpiper"]
        d = t.decision()
        assert (d.player_id, d.context["defunct_chain"]) == ("p2", "sandpiper")
        t.dispose("p2", "sandpiper", sell=1)
        # One chain left: no second question.
        assert [e["chain"] for e in t.events("bonuses_paid")] == [
            "sandpiper",
            "marlowe",
        ]
        d = t.decision()
        assert (d.player_id, d.context["defunct_chain"]) == ("p1", "marlowe")
        t.dispose("p1", "marlowe", hold=1)
        assert t.game.phase == GamePhase.BUYING_STOCKS
        assert t.size("halcyon") == 7
        assert len(t.events("defunct_order_chosen")) == 1

    def test_the_other_choice_gives_the_other_order(self):
        t = self.start()
        order(t, "marlowe")
        d = t.decision()
        assert (d.player_id, d.context["defunct_chain"]) == ("p1", "marlowe")
        t.dispose("p1", "marlowe", sell=1)
        d = t.decision()
        assert (d.player_id, d.context["defunct_chain"]) == ("p2", "sandpiper")

    def test_merger_history_lists_defunct_chains_in_the_chosen_order(self):
        t = self.start()
        assert [d["chain"] for d in merger_history(t.game)[-1]["defunct"]] == [
            "marlowe",
            "sandpiper",
        ]
        order(t, "sandpiper")
        rows = merger_history(t.game)[-1]["defunct"]
        assert [d["chain"] for d in rows] == ["sandpiper", "marlowe"]
        assert rows[0]["bonuses"] is not None and rows[1]["bonuses"] is None
        assert rows[0]["waiting_on"] == ["p2"]

    def test_snapshot_round_trip_while_the_choice_is_pending(self):
        t = self.start()
        snap = to_snapshot(t.game)
        copy = from_snapshot(snap)
        assert to_snapshot(copy) == snap
        assert copy.pending_action == {
            "type": "choose_defunct_order",
            "tied_chains": ["marlowe", "sandpiper"],
        }
        for game in (t.game, copy):
            r = apply_action(
                game, "p1", {"action": "merger_order", "defunct_chain": "sandpiper"}
            )
            assert r["success"]
        assert to_snapshot(copy) == to_snapshot(t.game)


class TestNoChoiceWhenSizesDiffer:
    def test_different_sizes_go_largest_first_without_a_question(self):
        """halcyon 5B-5D (3) and obsidian 5F-5H (3) tie for survivor; the loser
        (3) is larger than marlowe and sandpiper (2 each) and goes first."""
        t = four_chains(halcyon_three=True)
        r = t.place("5E")
        assert r["result"] == "merge_tie"
        assert r["tied_chains"] == ["halcyon", "obsidian"]
        r = t.act("p1", action="merger_choice", surviving_chain="obsidian")
        # halcyon (3) is alone at its size: resolved at once, never offered.
        assert r["next_action"] == "stock_disposition"
        assert t.events("defunct_order_chosen") == []
        d = t.decision()
        assert (d.player_id, d.context["defunct_chain"]) == ("p3", "halcyon")

    def test_a_second_tie_group_is_asked_when_its_turn_comes(self):
        t = four_chains(halcyon_three=True)
        t.place("5E")
        t.act("p1", action="merger_choice", surviving_chain="obsidian")
        r = t.dispose("p3", "halcyon", sell=1)
        assert r["next_action"] == "choose_defunct_order"
        d = t.decision()
        assert (d.kind, d.player_id) == (CHOOSE_DEFUNCT_ORDER, "p1")
        assert d.context["tied_chains"] == ["marlowe", "sandpiper"]
        order(t, "sandpiper")
        t.dispose("p2", "sandpiper", sell=1)
        t.dispose("p1", "marlowe", sell=1)
        assert t.game.phase == GamePhase.BUYING_STOCKS
        assert [e["chain"] for e in t.events("bonuses_paid")] == [
            "halcyon",
            "sandpiper",
            "marlowe",
        ]
        assert t.size("obsidian") == 3 + 3 + 2 + 2 + 1
        assert t.game.hotel.get_active_chains() == ["obsidian"]


class TestThreeDefunctChainsOfTheSameSize:
    def test_one_choice_at_a_time_until_one_chain_is_left(self):
        """obsidian (3) absorbs halcyon, marlowe and sandpiper (2 each)."""
        t = four_chains(halcyon_three=False)
        r = t.place("5E")
        assert r["survivor"] == "obsidian"
        assert r["next_action"] == "choose_defunct_order"
        assert t.decision().context["tied_chains"] == [
            "halcyon",
            "marlowe",
            "sandpiper",
        ]
        order(t, "marlowe")
        r = t.dispose("p1", "marlowe", sell=1)
        assert r["next_action"] == "choose_defunct_order"
        assert t.decision().context["tied_chains"] == ["halcyon", "sandpiper"]
        # A chain that was already resolved is not offered again.
        assert not t.try_act("p1", action="merger_order", defunct_chain="marlowe")[
            "success"
        ]
        order(t, "sandpiper")
        t.dispose("p2", "sandpiper", sell=1)
        d = t.decision()
        assert (d.player_id, d.context["defunct_chain"]) == ("p3", "halcyon")
        t.dispose("p3", "halcyon", sell=1)
        assert t.game.phase == GamePhase.BUYING_STOCKS
        assert [e["chain"] for e in t.events("defunct_order_chosen")] == [
            "marlowe",
            "sandpiper",
        ]
        assert [d["chain"] for d in merger_history(t.game)[-1]["defunct"]] == [
            "marlowe",
            "sandpiper",
            "halcyon",
        ]
        assert t.size("obsidian") == 3 + 2 + 2 + 2 + 1


class TestTheOrderDecidesWhoGetsTheLastSurvivorShares:
    """Three shares per chain: after the founder's share and one purchase the
    bank holds ONE halcyon share. p1 holds 2 marlowe, p2 holds 2 sandpiper:
    whoever's chain is resolved first can trade 2:1, the other cannot."""

    def start(self) -> Table:
        rs = Ruleset.from_dict({**default_ruleset().to_dict(), "stocks_per_chain": 3})
        t = Table([["3E", "7E", "5B", "5E"], ["4E", "5C"], ["6E", "5D"]], ruleset=rs)
        t.turn("3E")
        t.turn("4E", found="sandpiper", buy={"sandpiper": 1})
        t.turn("6E")
        t.turn("7E", found="marlowe", buy={"marlowe": 1})
        t.turn("5C")
        t.turn("5D", found="halcyon", buy={"halcyon": 1})
        t.turn("5B")
        t.pass_turn()
        t.pass_turn()
        assert t.game.hotel.get_available_stocks("halcyon") == 1
        assert (t.shares("p1", "marlowe"), t.shares("p2", "sandpiper")) == (2, 2)
        r = t.place("5E")
        assert r["survivor"] == "halcyon"
        assert r["next_action"] == "choose_defunct_order"
        return t

    def test_own_chain_first_the_mergemaker_takes_the_share(self):
        t = self.start()
        order(t, "marlowe")
        assert t.legal()["max_trade"] == 2
        t.dispose("p1", "marlowe", trade=2)
        assert t.decision().player_id == "p2"
        assert t.legal()["max_trade"] == 0
        assert not t.try_act(
            "p2",
            action="merger_disposition",
            defunct_chain="sandpiper",
            disposition={"sell": 0, "trade": 2, "hold": 0},
        )["success"]
        t.dispose("p2", "sandpiper", sell=2)
        assert (t.shares("p1", "halcyon"), t.shares("p2", "halcyon")) == (1, 0)

    def test_rivals_chain_first_the_rival_takes_the_share(self):
        t = self.start()
        order(t, "sandpiper")
        assert t.decision().player_id == "p2"
        assert t.legal()["max_trade"] == 2
        t.dispose("p2", "sandpiper", trade=2)
        assert t.decision().player_id == "p1"
        assert t.legal()["max_trade"] == 0
        t.dispose("p1", "marlowe", sell=2)
        assert (t.shares("p1", "halcyon"), t.shares("p2", "halcyon")) == (0, 1)
