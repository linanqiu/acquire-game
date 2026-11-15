"""Tier 1: the table view every client gets in ``game_state`` (BL-007).

``public_net_worth``, ``public_chain_holders`` and ``merger_history`` in
``game/calculator.py``: net worth and rank, majority/minority holders with ties,
and the merger record, checked against what the engine really pays.
"""

from __future__ import annotations

import copy

from game.calculator import (
    build_calculator_pack,
    merger_history,
    public_chain_holders,
    public_net_worth,
)
from game.decisions import apply_action, pending_decisions
from game.game import Game, GamePhase
from tests.support.drive import HeuristicTable
from tests.test_calculator import add_chain, give, make_game, merger_position


class TestNetWorth:
    def test_cash_plus_shares_at_current_prices(self):
        game = merger_position()
        worth = public_net_worth(game)
        # p1: halcyon 5 x 600 + marlowe 4 x 300
        assert worth["p1"] == {
            "cash": 6000,
            "stock_value": 4200,
            "net_worth": 10200,
            "rank": 1,
        }
        assert worth["p2"]["stock_value"] == 3 * 600 + 2 * 300
        assert worth["p3"]["stock_value"] == 2 * 600
        assert [worth[p]["rank"] for p in ("p1", "p2", "p3")] == [1, 2, 3]

    def test_matches_the_calculator_pack(self):
        game = merger_position()
        pack = {p["player_id"]: p for p in build_calculator_pack(game, "p1")["players"]}
        for pid, w in public_net_worth(game).items():
            assert w["stock_value"] == pack[pid]["stock_value"]
            assert w["net_worth"] == pack[pid]["net_worth"]
            assert w["cash"] == pack[pid]["cash"]

    def test_ties_share_a_rank(self):
        game = make_game(3)
        add_chain(game, "sandpiper", ["1A", "2A"])  # $200
        give(game, "p1", sandpiper=1)
        give(game, "p2", sandpiper=1)
        worth = public_net_worth(game)
        assert worth["p1"]["net_worth"] == worth["p2"]["net_worth"] == 6200
        assert [worth[p]["rank"] for p in ("p1", "p2", "p3")] == [1, 1, 3]

    def test_shares_of_a_defunct_chain_are_worth_nothing(self):
        game = make_game(3)
        give(game, "p1", halcyon=4)  # held, chain not on the board
        assert public_net_worth(game)["p1"]["stock_value"] == 0


def _roles(info):
    return [
        (h["player_id"], h["shares"], h["role"], h["tied"], h["bonus"]) for h in info
    ]


class TestChainHolders:
    def test_majority_and_minority(self):
        holders = public_chain_holders(merger_position())
        assert set(holders) == {"halcyon", "marlowe"}  # active chains only
        hal = holders["halcyon"]
        assert (hal["size"], hal["price"]) == (5, 600)
        assert (hal["majority_bonus"], hal["minority_bonus"]) == (6000, 3000)
        assert _roles(hal["holders"]) == [
            ("p1", 5, "majority", False, 6000),
            ("p2", 3, "minority", False, 3000),
            ("p3", 2, None, False, 0),
        ]

    def test_tied_minority(self):
        game = make_game(4)
        add_chain(game, "sandpiper", ["1A", "2A", "3A", "4A", "5A"])
        give(game, "p1", sandpiper=5)
        give(game, "p2", sandpiper=3)
        give(game, "p3", sandpiper=3)
        give(game, "p4", sandpiper=1)
        assert _roles(public_chain_holders(game)["sandpiper"]["holders"]) == [
            ("p1", 5, "majority", False, 5000),
            ("p2", 3, "minority", True, 1300),  # 2500 / 2 rounded up
            ("p3", 3, "minority", True, 1300),
            ("p4", 1, None, False, 0),
        ]

    def test_tied_majority_takes_both_bonuses_and_no_minority(self):
        game = make_game(3)
        add_chain(game, "sandpiper", ["1A", "2A", "3A", "4A", "5A"])
        give(game, "p1", sandpiper=4)
        give(game, "p2", sandpiper=4)
        give(game, "p3", sandpiper=1)
        assert _roles(public_chain_holders(game)["sandpiper"]["holders"]) == [
            ("p1", 4, "majority", True, 3800),
            ("p2", 4, "majority", True, 3800),
            ("p3", 1, None, False, 0),
        ]

    def test_sole_holder_gets_both(self):
        game = make_game()
        add_chain(game, "obsidian", ["1A", "2A"])
        give(game, "p1", obsidian=1)
        [h] = public_chain_holders(game)["obsidian"]["holders"]
        assert (h["role"], h["tied"], h["majority"], h["minority"]) == (
            "majority",
            False,
            4000,
            2000,
        )

    def test_chain_with_no_holders(self):
        game = make_game()
        add_chain(game, "obsidian", ["1A", "2A"])
        assert public_chain_holders(game)["obsidian"]["holders"] == []


class TestMergerHistory:
    def test_bonuses_and_dispositions_are_what_the_engine_paid(self):
        game = merger_position()
        predicted = public_chain_holders(game)["marlowe"]
        cash_before = {p.player_id: p.money for p in game.players}
        game.current_player_index = 1  # p2 holds the merging tile
        assert apply_action(game, "p2", {"action": "place_tile", "tile": "2B"})[
            "success"
        ]
        [m] = merger_history(game)
        assert (m["survivor"], m["tile"], m["player_id"]) == ("halcyon", "2B", "p2")
        assert m["complete"] is False and m["survivor_size"] is None
        [d] = m["defunct"]
        assert (d["chain"], d["size"], d["price"]) == ("marlowe", 3, 300)
        # Bonuses recorded = bonuses predicted for the defunct chain = cash received.
        paid = {b["player_id"]: b["majority"] + b["minority"] for b in d["bonuses"]}
        assert paid == {
            h["player_id"]: h["bonus"] for h in predicted["holders"] if h["bonus"]
        }
        for pid, amount in paid.items():
            assert game.get_player(pid).money == cash_before[pid] + amount
        # The stockholders still to decide, in the engine's order (p2 placed the tile).
        assert d["waiting_on"] == ["p2", "p1"]

        assert apply_action(
            game,
            "p2",
            {
                "action": "merger_disposition",
                "defunct_chain": "marlowe",
                "disposition": {"sell": 2, "trade": 0, "hold": 0},
            },
        )["success"]
        d = merger_history(game)[0]["defunct"][0]
        assert d["waiting_on"] == ["p1"]
        assert d["dispositions"] == [
            {
                "player_id": "p2",
                "sell": 2,
                "trade": 0,
                "hold": 0,
                "sale_proceeds": 600,
                "survivor_shares_received": 0,
            }
        ]
        assert apply_action(
            game,
            "p1",
            {
                "action": "merger_disposition",
                "defunct_chain": "marlowe",
                "disposition": {"sell": 0, "trade": 4, "hold": 0},
            },
        )["success"]
        m = merger_history(game)[0]
        assert m["complete"] is True
        assert m["survivor_size"] == game.board.get_chain_size("halcyon") == 9
        d = m["defunct"][0]
        assert d["waiting_on"] == []
        assert d["dispositions"][1]["survivor_shares_received"] == 2

    def test_played_games_record_every_merger_exactly(self):
        """Heuristic games: every merger's record equals the event log, and the
        bonuses predicted the moment before the merger are the ones paid."""
        seen = 0
        for seed in range(1, 6):
            game = Game(seed=seed)
            for i in range(1, 5):
                game.add_player(f"p{i}", f"P{i}")
            game.start_game()
            table = HeuristicTable(game, seed=seed)
            before = None
            while game.phase != GamePhase.GAME_OVER:
                n_events = len(game.events)
                snapshot = copy.deepcopy(public_chain_holders(game))
                if game.phase in (GamePhase.PLAYING, GamePhase.FOUNDING_CHAIN):
                    before = snapshot
                table.step()
                for e in game.events[n_events:]:
                    if e["type"] == "bonuses_paid" and not e["final"]:
                        predicted = {
                            h["player_id"]: {
                                "majority": h["majority"],
                                "minority": h["minority"],
                            }
                            for h in before[e["chain"]]["holders"]
                            if h["bonus"]
                        }
                        assert e["bonuses"] == predicted
                        seen += 1
            history = merger_history(game)
            started = [e for e in game.events if e["type"] == "merger_started"]
            assert [m["seq"] for m in history] == [e["seq"] for e in started]
            dispositions = [e for e in game.events if e["type"] == "stock_disposition"]
            recorded = [
                (dd["player_id"], d["chain"], dd["sell"], dd["trade"], dd["hold"])
                for m in history
                for d in m["defunct"]
                for dd in d["dispositions"]
            ]
            assert sorted(recorded) == sorted(
                (e["player_id"], e["defunct_chain"], e["sell"], e["trade"], e["hold"])
                for e in dispositions
            )
            assert all(m["complete"] for m in history)
        assert seen > 0, "no merger in five heuristic games"

    def test_survivor_after_the_merger(self):
        """The post-merger survivor (BL-011): size, price and bonuses at the size
        the merger will give, everyone's survivor shares with the trades made so
        far, and who may still trade."""
        game = merger_position()
        game.current_player_index = 1
        assert apply_action(game, "p2", {"action": "place_tile", "tile": "2B"})[
            "success"
        ]
        after = merger_history(game)[0]["survivor_after"]
        # halcyon 5 + marlowe 3 + the merging tile 2B = 9 tiles.
        assert after["size"] == 9
        assert after["price"] == game.hotel.get_stock_price("halcyon", 9)
        assert after["majority_bonus"] == game.hotel.get_majority_bonus("halcyon", 9)
        assert after["minority_bonus"] == game.hotel.get_minority_bonus("halcyon", 9)
        assert after["bank"] == game.hotel.get_available_stocks("halcyon")
        rows = {h["player_id"]: h for h in after["holders"]}
        assert [(h["player_id"], h["shares"]) for h in after["holders"]] == [
            ("p1", 5),
            ("p2", 3),
            ("p3", 2),
        ]
        assert rows["p1"]["undecided"] and rows["p2"]["undecided"]
        assert not rows["p3"]["undecided"]
        assert rows["p1"]["role"] == "majority" and rows["p2"]["role"] == "minority"
        assert all(h["received"] == 0 for h in after["holders"])

        assert apply_action(
            game,
            "p2",
            {
                "action": "merger_disposition",
                "defunct_chain": "marlowe",
                "disposition": {"sell": 2, "trade": 0, "hold": 0},
            },
        )["success"]
        rows = {
            h["player_id"]: h
            for h in merger_history(game)[0]["survivor_after"]["holders"]
        }
        assert not rows["p2"]["undecided"] and rows["p1"]["undecided"]
        assert apply_action(
            game,
            "p1",
            {
                "action": "merger_disposition",
                "defunct_chain": "marlowe",
                "disposition": {"sell": 0, "trade": 4, "hold": 0},
            },
        )["success"]
        m = merger_history(game)[0]
        assert m["complete"] and m["survivor_after"] is None
        assert m["survivor_size"] == 9
        assert game.get_player("p1").get_stock_count("halcyon") == 7

    def test_played_games_survivor_after_is_what_the_merger_produces(self):
        """Random and heuristic games: at every step of every merger, the
        projected survivor size and price are the ones the finished merger has,
        players who already decided end with exactly the projected shares, and
        when nobody still to decide trades, the projected roles and bonuses are
        the engine's for the finished chain."""
        from tests.support.drive import RandomTable

        checked = exact = 0
        tables = [("random", s) for s in range(1, 9)] + [
            ("heuristic", s) for s in (1, 2)
        ]
        for kind, seed in tables:
            game = Game(seed=seed)
            for i in range(1, 5):
                game.add_player(f"p{i}", f"P{i}")
            game.start_game()
            table = (
                RandomTable(game, seed=seed)
                if kind == "random"
                else HeuristicTable(game, seed=seed)
            )
            projections: list[dict] = []
            while game.phase != GamePhase.GAME_OVER:
                history = merger_history(game)
                live = history[-1] if history and not history[-1]["complete"] else None
                if live is not None:
                    projections.append(copy.deepcopy(live["survivor_after"]))
                n_events = len(game.events)
                table.step()
                for e in game.events[n_events:]:
                    if e["type"] != "merger_completed":
                        continue
                    survivor = e["survivor"]
                    final_size = e["survivor_size"]
                    final_price = game.hotel.get_stock_price(survivor, final_size)
                    actual = public_chain_holders(game)[survivor]
                    shares = {
                        p.player_id: p.get_stock_count(survivor) for p in game.players
                    }
                    for proj in projections:
                        checked += 1
                        assert proj["size"] == final_size
                        assert proj["price"] == final_price
                        assert proj["majority_bonus"] == actual["majority_bonus"]
                        assert proj["minority_bonus"] == actual["minority_bonus"]
                        nobody_moved = True
                        for h in proj["holders"]:
                            got = shares[h["player_id"]]
                            if h["undecided"]:
                                assert got >= h["shares"]
                                nobody_moved &= got == h["shares"]
                            else:
                                assert got == h["shares"]
                        if nobody_moved:
                            exact += 1
                            projected = {
                                h["player_id"]: (h["role"], h["tied"], h["bonus"])
                                for h in proj["holders"]
                                if h["shares"] > 0
                            }
                            assert projected == {
                                h["player_id"]: (h["role"], h["tied"], h["bonus"])
                                for h in actual["holders"]
                            }
                    projections = []
        assert checked > 0 and exact > 0, (checked, exact)

    def test_survives_a_snapshot_round_trip(self):
        from game.snapshot import from_snapshot, to_snapshot

        game = merger_position()
        game.current_player_index = 1
        apply_action(game, "p2", {"action": "place_tile", "tile": "2B"})
        restored = from_snapshot(to_snapshot(game))
        assert merger_history(restored) == merger_history(game)
        assert pending_decisions(restored)[0].player_id == "p2"
