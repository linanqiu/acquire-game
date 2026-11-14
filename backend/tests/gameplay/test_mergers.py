"""Mergers: survivor, stock disposition, multi-chain order, the merged board.

Rules: docs/rules/mergers.md
- "The chain with more tiles survives"; on a tie "the mergemaker chooses".
- Bonuses are paid, then "starting with the mergemaker, then clockwise, each
  player handles their defunct stock": hold, sell at the defunct chain's price
  "before the merger", or trade 2 defunct for 1 survivor share while the bank
  has survivor stock.
- Multi-chain mergers resolve "each defunct chain separately, largest to
  smallest".
- Afterwards all defunct tiles, the merger tile and any lone tiles it touches
  belong to the survivor; the defunct chain can be founded again.

Every position is reached by real moves (``tests.support.table.Table``) or
loaded from a real-play snapshot fixture.
"""

from __future__ import annotations

from game.decisions import apply_action, legal_actions, pending_decisions
from game.game import GamePhase
from tests.support.snapshots import load_fixture
from tests.support.table import Table


def luxor3_vs_tower4() -> Table:
    """Luxor 1A-3A (3 tiles) and Tower 5A-8A (4 tiles); p2 holds 4A.

    Luxor shares: p2 3 (founder + 2 bought), p3 2, p1 1. Tower: p1 1 (founder).
    Cash before the merger: p1 5800, p2 5600, p3 5600.
    """
    t = Table([["1A", "6A", "8A"], ["2A", "3A", "4A"], ["5A", "7A"]])
    t.turn("1A")
    t.turn("2A", found="Luxor", buy={"Luxor": 2})
    t.turn("5A", buy={"Luxor": 2})
    t.turn("6A", found="Tower", buy={"Luxor": 1})
    t.turn("3A")
    t.turn("7A")
    t.turn("8A")
    assert (t.size("Luxor"), t.size("Tower")) == (3, 4)
    assert t.current == "p2"
    return t


class TestSurvivor:
    def test_larger_chain_survives_and_mergemaker_disposes_first(self):
        t = luxor3_vs_tower4()
        result = t.place("4A")

        assert result["survivor"] == "Tower" and result["defunct"] == ["Luxor"]
        assert result["next_action"] == "stock_disposition"
        d = t.decision()
        assert (d.kind, d.player_id) == ("stock_disposition", "p2")
        assert d.context["defunct_chain"] == "Luxor"
        assert d.context["surviving_chain"] == "Tower"
        assert d.context["stock_count"] == 3

    def test_tie_lets_the_mergemaker_choose_and_the_other_chain_dies(self):
        # Luxor 1A-2A and Tower 4A-5A, both 2 tiles; p3 joins them with 3A.
        t = Table([["1A", "4A"], ["2A", "5A"], ["12I", "3A"]])
        t.turn("1A")
        t.turn("2A", found="Luxor")
        t.turn("12I")
        t.turn("4A")
        t.turn("5A", found="Tower")
        result = t.place("3A")

        assert result["result"] == "merge_tie"
        assert sorted(result["tied_chains"]) == ["Luxor", "Tower"]
        d = t.decision()
        assert (d.kind, d.player_id) == ("choose_survivor", "p3")
        # Nobody else may decide for the mergemaker
        assert not t.try_act("p1", action="merger_choice", surviving_chain="Luxor")[
            "success"
        ]
        # ...and only a tied chain can be chosen
        assert not t.try_act("p3", action="merger_choice", surviving_chain="American")[
            "success"
        ]

        chosen = t.act("p3", action="merger_choice", surviving_chain="Tower")
        assert chosen["next_action"] == "stock_disposition"
        # p2 holds the defunct Luxor founder share
        d = t.decision()
        assert (d.kind, d.player_id) == ("stock_disposition", "p2")
        assert d.context["defunct_chain"] == "Luxor"
        t.dispose("p2", "Luxor", hold=1)
        assert t.game.hotel.get_active_chains() == ["Tower"]
        assert t.size("Tower") == 5
        assert t.events("survivor_chosen")[0]["survivor"] == "Tower"


class TestDisposition:
    def test_sell_trade_and_hold_in_clockwise_order(self):
        t = luxor3_vs_tower4()
        t.place("4A")
        # Bonuses (Luxor, cheap tier, 3 tiles: $3,000 / $1,500) are paid
        # before anyone disposes.
        assert t.money("p2") == 5600 + 3000
        assert t.money("p3") == 5600 + 1500
        assert t.money("p1") == 5800

        # p2 (mergemaker): sell 1 at the pre-merger price $300, trade 2 for 1
        t.dispose("p2", "Luxor", sell=1, trade=2)
        assert t.money("p2") == 8600 + 300
        assert (t.shares("p2", "Luxor"), t.shares("p2", "Tower")) == (0, 1)

        # then clockwise: p3, then p1
        assert t.decision().player_id == "p3"
        assert not t.try_act(
            "p1",
            action="merger_disposition",
            defunct_chain="Luxor",
            disposition={"sell": 1},
        )["success"]
        t.dispose("p3", "Luxor", hold=2)
        assert t.decision().player_id == "p1"
        t.dispose("p1", "Luxor", sell=1)
        assert t.money("p1") == 5800 + 300
        assert t.shares("p3", "Luxor") == 2  # held through the merger

        # The merger is over: the mergemaker buys next
        d = t.decision()
        assert (d.kind, d.player_id) == ("buy_stocks", "p2")
        hotel = t.game.hotel
        assert hotel.get_available_stocks("Luxor") == 25 - 2  # p3 still holds 2
        assert hotel.get_available_stocks("Tower") == 25 - 2  # founder + trade
        done = t.events("stock_disposition")
        assert [(e["player_id"], e["sale_proceeds"]) for e in done] == [
            ("p2", 300),
            ("p3", 0),
            ("p1", 300),
        ]
        assert done[0]["survivor_shares_received"] == 1

    def test_missing_disposition_keys_count_as_zero(self):
        """Seat contract: ``sell``/``trade``/``hold`` default to 0."""
        t = luxor3_vs_tower4()
        t.place("4A")
        for pid, disposition in [
            ("p2", {"sell": 3}),
            ("p3", {"hold": 2}),
            ("p1", {"keep": 1}),  # the engine's own word for hold
        ]:
            t.act(
                pid,
                action="merger_disposition",
                defunct_chain="Luxor",
                disposition=disposition,
            )
        assert [t.shares(p, "Luxor") for p in ("p1", "p2", "p3")] == [1, 0, 2]
        assert t.money("p2") == 5600 + 3000 + 3 * 300
        assert t.decision().kind == "buy_stocks"

    def test_counts_must_add_up_and_trades_come_in_pairs(self):
        t = luxor3_vs_tower4()
        t.place("4A")
        for disposition, error in [
            ({"sell": 1, "hold": 1}, "add up"),
            ({"sell": 4}, "add up"),
            ({"trade": 3}, "even"),
            ({"sell": 2, "trade": 1}, "even"),
        ]:
            r = t.try_act(
                "p2",
                action="merger_disposition",
                defunct_chain="Luxor",
                disposition=disposition,
            )
            assert not r["success"] and error in r["error"], (disposition, r)
        assert t.money("p2") == 8600 and t.shares("p2", "Luxor") == 3

    def test_held_shares_count_again_when_the_chain_is_refounded(self):
        t = Table([["1A", "6A", "8A", "11E"], ["2A", "3A", "4A"], ["5A", "7A", "10E"]])
        for tile, kw in [
            ("1A", {}),
            ("2A", {"found": "Luxor", "buy": {"Luxor": 2}}),
            ("5A", {"buy": {"Luxor": 2}}),
            ("6A", {"found": "Tower", "buy": {"Luxor": 1}}),
            ("3A", {}),
            ("7A", {}),
            ("8A", {}),
        ]:
            t.turn(tile, **kw)
        t.place("4A")
        t.dispose("p2", "Luxor", hold=3)
        t.dispose("p3", "Luxor", hold=2)
        t.dispose("p1", "Luxor", hold=1)
        t.end()
        assert "Luxor" in t.game.hotel.get_inactive_chains()
        t.turn("10E")
        # p1 founds Luxor again (and gets a founder share: 2 in all)
        t.turn("11E", found="Luxor")
        assert t.size("Luxor") == 2
        assert [t.shares(p, "Luxor") for p in ("p1", "p2", "p3")] == [2, 3, 2]

        before = t.mark()
        t.game.end_game()
        luxor = [
            e for e in t.events("bonuses_paid", since=before) if e["chain"] == "Luxor"
        ]
        # Luxor 2 tiles: $2,000 / $1,000; p2 majority, p1 and p3 tie for
        # minority and split $1,000.
        assert luxor[0]["bonuses"] == {
            "p2": {"majority": 2000, "minority": 0},
            "p1": {"majority": 0, "minority": 500},
            "p3": {"majority": 0, "minority": 500},
        }
        sales = t.events("game_ended")[0]["final_sales"]
        tower_price = t.game.hotel.get_stock_price("Tower", t.size("Tower"))
        assert sales["p2"] == 3 * 200
        assert sales["p1"] == 2 * 200 + 1 * tower_price

    def test_trading_is_limited_by_the_survivor_stock_left_in_the_bank(self):
        """Snapshot: p1 holds 8 defunct Luxor, the bank has 2 American left."""
        game = load_fixture("disposition-trade-limited")
        d = pending_decisions(game)[0]
        assert (d.kind, d.player_id) == ("stock_disposition", "p1")
        assert d.context["available_to_trade"] == 2
        assert legal_actions(game, d)["max_trade"] == 4

        def dispose(**disp):
            return apply_action(
                game,
                "p1",
                {
                    "action": "merger_disposition",
                    "defunct_chain": "Luxor",
                    "disposition": disp,
                },
            )

        r = dispose(trade=6, hold=2)
        assert not r["success"] and "Not enough survivor stock" in r["error"]
        p1 = game.get_player("p1")
        american = p1.get_stock_count("American")
        assert dispose(trade=4, hold=4)["success"]
        assert p1.get_stock_count("American") == american + 2
        assert p1.get_stock_count("Luxor") == 4
        assert game.hotel.get_available_stocks("American") == 0


class TestMergedBoard:
    def test_defunct_tiles_merger_tile_and_touching_lone_tiles_join_survivor(self):
        # Luxor 1A-2A, Tower 4A-6A, lone tile 3B under the merger tile 3A.
        t = Table([["1A", "4A", "3B"], ["2A", "5A", "10I"], ["6A", "12I", "3A"]])
        t.turn("1A")
        t.turn("2A", found="Luxor")
        t.turn("6A")
        t.turn("4A")
        t.turn("5A", found="Tower")
        t.turn("12I")
        t.turn("3B")
        t.turn("10I")
        before = t.mark()
        result = t.place("3A")
        assert result["survivor"] == "Tower"
        # Luxor founder share (p2) is the only defunct stock
        t.dispose("p2", "Luxor", sell=1)

        board = t.game.board
        assert t.size("Tower") == 3 + 2 + 1 + 1  # 4A-6A, 1A-2A, 3A, 3B
        for tile in ("1A", "2A", "3A", "3B"):
            cell = board.get_cell(int(tile[:-1]), tile[-1])
            assert cell.chain == "Tower", tile
        assert t.size("Luxor") == 0
        assert not t.game.hotel.is_chain_active("Luxor")
        completed = t.events("merger_completed", since=before)
        assert completed[0]["survivor_size"] == 7


class TestMultiChainMerger:
    def test_defunct_chains_resolve_largest_first_each_at_its_own_size(self):
        """Tower (3) and Luxor (2) both join American (4) via 4B."""
        # American 4C-4F (4 tiles, column 4 below the merger tile 4B)
        # Tower 1B-3B (3 tiles, left of 4B); Luxor 5B-6B (2 tiles, right).
        t = Table(
            [
                ["4C", "1B", "5B", "4F"],
                ["4D", "2B", "6B", "10I"],
                ["4E", "3B", "12I", "4B"],
            ]
        )
        t.turn("4C")
        t.turn("4D", found="American")
        t.turn("4E")
        t.turn("1B")
        t.turn("2B", found="Tower")
        t.turn("3B", buy={"Tower": 2})
        t.turn("5B")
        t.turn("6B", found="Luxor")
        t.turn("12I", buy={"Luxor": 1})
        t.turn("4F")
        t.turn("10I")
        assert [t.size(c) for c in ("American", "Tower", "Luxor")] == [4, 3, 2]

        result = t.place("4B")
        assert result["survivor"] == "American"
        assert result["defunct"] == ["Luxor", "Tower"]  # board order
        started = t.events("merger_started")[0]
        assert started["defunct"] == ["Tower", "Luxor"]  # resolution order

        # Tower first: bonuses at Tower's size (3 tiles: price $300)
        paid = t.events("bonuses_paid")
        assert paid[0]["chain"] == "Tower" and paid[0]["chain_size"] == 3
        # Tower: p3 2 shares (majority $3,000), p2 1 founder share ($1,500)
        assert paid[0]["bonuses"] == {
            "p3": {"majority": 3000, "minority": 0},
            "p2": {"majority": 0, "minority": 1500},
        }
        d = t.decision()
        assert (d.player_id, d.context["defunct_chain"]) == ("p3", "Tower")
        t.dispose("p3", "Tower", sell=2)
        assert t.decision().player_id == "p2"
        t.dispose("p2", "Tower", sell=1)

        # Then Luxor at its own size (2 tiles: $200), p2 founder 1 + p3 1:
        # tied for majority -> ($2,000 + $1,000) / 2 each.
        paid = t.events("bonuses_paid")
        assert paid[1]["chain"] == "Luxor" and paid[1]["chain_size"] == 2
        assert paid[1]["bonuses"] == {
            "p2": {"majority": 1500, "minority": 0},
            "p3": {"majority": 1500, "minority": 0},
        }
        d = t.decision()
        assert (d.player_id, d.context["defunct_chain"]) == ("p3", "Luxor")
        t.dispose("p3", "Luxor", sell=1)
        t.dispose("p2", "Luxor", trade=0, sell=1)
        assert t.game.phase == GamePhase.BUYING_STOCKS
        assert t.size("American") == 4 + 3 + 2 + 1
        assert t.game.hotel.get_active_chains() == ["American"]

    def test_three_way_tie_mergemaker_picks_and_equal_defuncts_go_in_board_order(
        self,
    ):
        """Luxor 3E-4E, Tower 6E-7E and American 5C-5D (2 tiles each) all
        touch 5E."""
        t = Table([["3E", "7E", "5E"], ["4E", "5C"], ["6E", "5D"]])
        t.turn("3E")
        t.turn("4E", found="Luxor")
        t.turn("6E")
        t.turn("7E", found="Tower")
        t.turn("5C")
        t.turn("5D", found="American")
        r = t.place("5E")
        assert r["result"] == "merge_tie"
        assert r["tied_chains"] == ["American", "Luxor", "Tower"]
        t.act("p1", action="merger_choice", surviving_chain="American")
        assert t.events("merger_started")[0]["defunct"] == ["Luxor", "Tower"]
        d = t.decision()
        assert (d.player_id, d.context["defunct_chain"]) == ("p2", "Luxor")
        t.dispose("p2", "Luxor", trade=0, sell=1)
        d = t.decision()
        assert (d.player_id, d.context["defunct_chain"]) == ("p1", "Tower")
        t.dispose("p1", "Tower", hold=1)
        assert t.size("American") == 7
        assert t.game.hotel.get_active_chains() == ["American"]


class TestTradingIsFrozenDuringAMerger:
    def test_stock_of_a_merging_chain_cannot_change_hands_mid_merger(self):
        t = luxor3_vs_tower4()
        t.place("4A")
        r = t.try_act(
            "p3",
            action="propose_trade",
            to_player_id="p1",
            offering_stocks={"Luxor": 1},
            requesting_money=100,
        )
        assert not r["success"] and "merger" in r["error"]
        r = t.try_act(
            "p3",
            action="propose_trade",
            to_player_id="p1",
            requesting_stocks={"Tower": 1},
            offering_money=100,
        )
        assert not r["success"] and "merger" in r["error"]
        # Unrelated stock and cash may still be traded
        t.act("p1", action="propose_trade", to_player_id="p3", offering_money=100)
