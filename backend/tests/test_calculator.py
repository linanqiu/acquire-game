"""Tests for the calculator pack (game/calculator.py)."""

import copy
import json
import random

import pytest
from game.board import Tile
from game.calculator import build_calculator_pack
from game.game import Game, GamePhase
from game.hotel import Hotel
from game.rules import Rules

# ---------------------------------------------------------------------------
# Position builders
# ---------------------------------------------------------------------------


def make_game(n=3, seed=1):
    game = Game(seed=seed)
    for i in range(1, n + 1):
        game.add_player(f"p{i}", f"P{i}")
    game.start_game()
    for p in game.players:
        p._hand = []
    return game


def add_chain(game, name, tiles):
    game.hotel.activate_chain(name)
    for t in tiles:
        game.board.set_chain(Tile.from_string(t), name)


def give(game, pid, **shares):
    p = game.get_player(pid)
    for chain, n in shares.items():
        p.set_stocks(chain, n)
        game.hotel.buy_stock(chain, n)


def hand(game, pid, *tiles):
    p = game.get_player(pid)
    p._hand = [Tile.from_string(t) for t in tiles]


def merger_position():
    """American (5, A1-A5) next to Tower (3, C1-C3); B2 merges them."""
    game = make_game()
    add_chain(game, "American", ["1A", "2A", "3A", "4A", "5A"])
    add_chain(game, "Tower", ["1C", "2C", "3C"])
    give(game, "p1", American=5, Tower=4)
    give(game, "p2", American=3, Tower=2)
    give(game, "p3", American=2)
    hand(game, "p2", "2B", "9I")
    return game


# ---------------------------------------------------------------------------
# Exact numbers
# ---------------------------------------------------------------------------


class TestChainFigures:
    def test_chain_numbers(self):
        pack = build_calculator_pack(merger_position(), "p3")
        am = pack["chains"]["American"]
        assert am["active"] and am["size"] == 5 and not am["safe"]
        assert am["price"] == 600
        assert am["available_stock"] == 25 - 10
        assert am["tiles_to_safe"] == 6
        assert (am["next_price_size"], am["next_price"]) == (6, 700)
        assert am["majority_bonus"] == 6000 and am["minority_bonus"] == 3000
        assert [(h["player_id"], h["shares"]) for h in am["holders"]] == [
            ("p1", 5),
            ("p2", 3),
            ("p3", 2),
        ]
        assert am["payouts"] == {
            "p1": {"majority": 6000, "minority": 0, "total": 6000},
            "p2": {"majority": 0, "minority": 3000, "total": 3000},
        }
        assert am["majority_receivers"] == ["p1"]
        assert am["minority_receivers"] == ["p2"]

        tower = pack["chains"]["Tower"]
        assert tower["price"] == 300 and tower["majority_bonus"] == 3000

        lux = pack["chains"]["Luxor"]
        assert lux["active"] is False and lux["size"] == 0 and lux["price"] == 0
        assert lux["price_if_founded"] == 200

    def test_viewer_standing_and_shares_needed(self):
        pack = build_calculator_pack(merger_position(), "p3")
        v = pack["chains"]["American"]["viewer"]
        assert v["shares"] == 2 and v["sell_value"] == 1200
        assert v["standing"] == "none"
        assert v["shares_to_tie_majority"] == 3  # 2 -> 5
        assert v["shares_to_take_majority"] == 4  # 2 -> 6
        assert v["shares_to_reach_minority"] == 1  # 3 ties p2
        assert v["shares_to_take_minority"] == 2  # 4 beats p2, below p1

    def test_tied_minority_split_rounds_up(self):
        game = make_game(4)
        add_chain(game, "Luxor", ["1A", "2A", "3A", "4A", "5A"])  # $500/share
        give(game, "p1", Luxor=5)
        give(game, "p2", Luxor=3)
        give(game, "p3", Luxor=3)
        give(game, "p4", Luxor=1)
        lux = build_calculator_pack(game, "p4")["chains"]["Luxor"]
        assert lux["majority_bonus"] == 5000 and lux["minority_bonus"] == 2500
        assert lux["payouts"]["p1"]["total"] == 5000
        # 2500 / 2 = 1250 -> rounded up to 1300 by the engine
        assert lux["payouts"]["p2"]["total"] == 1300
        assert lux["payouts"]["p3"]["total"] == 1300
        assert "p4" not in lux["payouts"]
        assert lux["viewer"]["standing"] == "none"
        assert lux["minority_receivers"] == ["p2", "p3"]

    def test_tied_majority_split_rounds_up(self):
        game = make_game(3)
        add_chain(game, "Luxor", ["1A", "2A", "3A", "4A", "5A"])
        give(game, "p1", Luxor=4)
        give(game, "p2", Luxor=4)
        give(game, "p3", Luxor=1)
        lux = build_calculator_pack(game, "p3")["chains"]["Luxor"]
        # (5000 + 2500) / 2 = 3750 -> 3800; minority is swallowed by the tie
        assert lux["payouts"] == {
            "p1": {"majority": 3800, "minority": 0, "total": 3800},
            "p2": {"majority": 3800, "minority": 0, "total": 3800},
        }
        assert lux["viewer"]["shares_to_tie_majority"] == 3

    def test_sole_stockholder_gets_both(self):
        game = make_game()
        add_chain(game, "Imperial", ["1A", "2A"])  # $400
        give(game, "p1", Imperial=1)
        pack = build_calculator_pack(game, "p1")
        assert pack["chains"]["Imperial"]["payouts"]["p1"]["total"] == 4000 + 2000
        assert pack["chains"]["Imperial"]["viewer"]["standing"] == "majority_sole"


class TestPlayers:
    def test_net_worth_and_projection(self):
        game = merger_position()
        pack = build_calculator_pack(game, "p1")
        by = {p["player_id"]: p for p in pack["players"]}
        p1 = by["p1"]
        # American 600 * 5 + Tower 300 * 4
        assert p1["stock_value"] == 3000 + 1200
        assert p1["net_worth"] == 6000 + 4200
        # p1: American majority 6000, Tower majority 3000 (size 3: 300*10)
        assert p1["projected_bonuses"] == {"American": 6000, "Tower": 3000}
        assert p1["projected_final_score"] == 6000 + 9000 + 4200
        p2 = by["p2"]
        # American minority 3000 ; Tower minority 1500
        assert p2["projected_bonus_income"] == 4500
        assert p2["projected_final_score"] == 6000 + 4500 + (3 * 600 + 2 * 300)
        assert p1["projected_rank"] == 1

    def test_projection_equals_end_game_hand_built(self):
        game = merger_position()
        pack = build_calculator_pack(game, "p1")
        end = copy.deepcopy(game)
        end.end_game()
        for p in pack["players"]:
            assert p["projected_final_score"] == end.get_player(p["player_id"]).money


class TestTileEffects:
    def test_merge_scenario_exact(self):
        game = merger_position()
        pack = build_calculator_pack(game, "p2")
        by_tile = {t["tile"]: t for t in pack["viewer"]["tiles"]}
        merge = by_tile["2B"]
        assert merge["effect"] == "merge" and merge["playable"]
        assert merge["survivor_candidates"] == ["American"]
        (sc,) = merge["scenarios"]
        assert sc["survivor"] == "American"
        assert sc["survivor_size_after"] == 9  # 5 + 3 + placed tile
        assert sc["survivor_price_after"] == 700
        (d,) = sc["defunct"]
        assert d["chain"] == "Tower" and d["size"] == 3 and d["price"] == 300
        assert d["bonus_payouts"]["p1"]["total"] == 3000
        assert d["bonus_payouts"]["p2"]["total"] == 1500
        assert d["viewer_bonus"] == 1500
        assert d["viewer_shares"] == 2
        assert d["sell_all_value"] == 600
        assert d["trade"]["survivor_shares_received"] == 1
        assert d["trade"]["value_at_survivor_post_merger_price"] == 700
        assert d["trade"]["total_value"] == 700
        assert d["trade_minus_sell"] == 100
        assert sc["viewer_total_bonus"] == 1500
        # the quiet tile is just an isolated tile
        assert by_tile["9I"]["effect"] == "nothing"

    def test_merge_tie_lists_both_survivors(self):
        game = make_game()
        add_chain(game, "American", ["1A", "2A", "3A"])
        add_chain(game, "Tower", ["1C", "2C", "3C"])
        give(game, "p1", Tower=3, American=1)
        hand(game, "p1", "2B")
        pack = build_calculator_pack(game, "p1")
        (t,) = pack["viewer"]["tiles"]
        assert t["survivor_chosen_by_player"] is True
        assert sorted(t["survivor_candidates"]) == ["American", "Tower"]
        assert {s["survivor"] for s in t["scenarios"]} == {"American", "Tower"}
        by = {s["survivor"]: s for s in t["scenarios"]}
        assert by["American"]["defunct"][0]["chain"] == "Tower"
        assert by["Tower"]["defunct"][0]["chain"] == "American"
        # Surviving Tower (cheap, size 7 -> $600) vs American (medium, 7 -> $700)
        assert by["Tower"]["survivor_price_after"] == 600
        assert by["American"]["survivor_price_after"] == 700

    def test_trade_limited_by_bank_stock(self):
        game = merger_position()
        # drain the bank of American stock held by p3
        give(game, "p3", American=2)
        game.hotel._available_stocks["American"] = 0
        give(game, "p2", Tower=5)  # odd count
        pack = build_calculator_pack(game, "p2")
        d = {t["tile"]: t for t in pack["viewer"]["tiles"]}["2B"]["scenarios"][0][
            "defunct"
        ][0]
        assert d["trade"]["survivor_shares_received"] == 0
        assert d["trade"]["leftover_shares_sold"] == 5
        assert d["trade"]["total_value"] == d["sell_all_value"]

    def test_expand_found_and_unplayable(self):
        game = make_game()
        add_chain(game, "American", ["1A", "2A", "3A"])
        game.board.place_tile(Tile.from_string("5E"))  # lone tile
        hand(game, "p1", "4A", "5F", "9I", "1B")
        by = {
            t["tile"]: t for t in build_calculator_pack(game, "p1")["viewer"]["tiles"]
        }
        assert by["4A"]["effect"] == "expand" and by["4A"]["new_size"] == 4
        assert by["4A"]["new_price"] == 500
        assert by["5F"]["effect"] == "found"
        assert by["5F"]["new_size"] == 2
        assert "American" not in by["5F"]["chains_available_to_found"]
        assert len(by["5F"]["chains_available_to_found"]) == 6
        assert by["9I"]["effect"] == "nothing"
        assert by["1B"]["new_size"] == 4

    def test_expand_absorbs_lone_tiles(self):
        game = make_game()
        add_chain(game, "American", ["1A", "2A"])
        game.board.place_tile(Tile.from_string("4A"))
        hand(game, "p1", "3A")
        (t,) = build_calculator_pack(game, "p1")["viewer"]["tiles"]
        assert t["new_size"] == 4  # 2 + placed + lone 4A

    def test_unplayable_reasons(self):
        game = make_game()
        add_chain(game, "American", [f"{c}A" for c in range(1, 12)])  # 11 safe
        add_chain(game, "Tower", [f"{c}C" for c in range(1, 12)])  # 11 safe
        hand(game, "p1", "1B", "9I")
        by = {
            t["tile"]: t for t in build_calculator_pack(game, "p1")["viewer"]["tiles"]
        }
        assert by["1B"]["playable"] is False
        assert by["1B"]["unplayable_reason"] == "would_merge_safe_chains"
        assert by["9I"]["playable"] is True

    def test_eighth_chain(self):
        game = make_game()
        for i, name in enumerate(Hotel.get_all_chain_names()):
            add_chain(game, name, [f"{12 - i}A", f"{12 - i}B"][:2])
        game.board.place_tile(Tile.from_string("1I"))
        hand(game, "p1", "2I")
        (t,) = build_calculator_pack(game, "p1")["viewer"]["tiles"]
        assert t["effect"] == "found" and t["playable"] is False
        assert t["unplayable_reason"] == "would_create_eighth_chain"


class TestBankAndBuying:
    def test_end_game_flags(self):
        game = merger_position()
        bank = build_calculator_pack(game, "p1")["bank"]
        assert bank["can_end_game"] is False
        assert "not met" in bank["can_end_game_reason"]
        assert bank["chains_active"] == ["American", "Tower"]
        assert "Luxor" in bank["chains_available_to_found"]
        assert bank["tiles_remaining"] == len(game.tile_bag)

        game2 = make_game()
        add_chain(game2, "Luxor", [f"{c}{r}" for c in range(1, 12) for r in "AB"][:12])
        pack = build_calculator_pack(game2, "p1")["bank"]
        assert pack["can_end_game"] is True
        assert "safe" in pack["can_end_game_reason"]

        game3 = make_game()
        add_chain(
            game3, "Luxor", [f"{c}{r}" for c in range(1, 13) for r in "ABCD"][:41]
        )
        add_chain(game3, "Tower", ["1I", "2I"])
        reason = build_calculator_pack(game3, "p1")["bank"]["can_end_game_reason"]
        assert "41" in reason

    def test_buy_options_exact(self):
        game = merger_position()
        game.phase = GamePhase.BUYING_STOCKS
        game.current_player_index = 2  # p3
        pack = build_calculator_pack(game, "p3")
        opt = pack["buy_options"]["American"]
        assert opt["price"] == 600 and opt["max_affordable"] == 3
        assert opt["can_buy_now"] is True
        assert opt["standing_now"] == "none" and opt["payout_now"] == 0
        one = opt["purchases"]["1"]
        assert one["cost"] == 600 and one["standing_after"] == "minority_tied"
        # tied for minority at 3: 3000 split two ways = 1500 each
        assert one["payout_after"] == 1500
        two = opt["purchases"]["2"]
        assert two["standing_after"] == "minority_sole"
        assert two["payout_after"] == 3000
        three = opt["purchases"]["3"]
        assert three["standing_after"] == "majority_tied"
        # p1 5 vs p3 5 tie: (6000 + 3000) / 2 = 4500
        assert three["payout_after"] == 4500
        assert three["cash_after"] == pack["viewer"]["cash"] - 1800

    def test_buy_options_respect_cash_and_stock(self):
        game = merger_position()
        game.get_player("p3")._money = 700
        pack = build_calculator_pack(game, "p3")
        assert pack["buy_options"]["American"]["max_affordable"] == 1
        game.hotel._available_stocks["Tower"] = 0
        assert "Tower" not in build_calculator_pack(game, "p3")["buy_options"]


# ---------------------------------------------------------------------------
# Privacy
# ---------------------------------------------------------------------------


def _quoted_tiles(blob: str, tiles):
    return [t for t in tiles if f'"{t}"' in blob]


def _hidden_tile_game(seed=5, turns=12):
    game = Game(seed=seed)
    for i in range(3):
        game.add_player(f"b{i}", f"Bot {i}", is_bot=True)
    game.start_game()
    for _ in range(turns):
        game.execute_bot_turn(game.get_current_player_id())
    return game


class TestNoLeak:
    def test_no_other_hand_or_bag_tiles(self):
        game = _hidden_tile_game()
        viewer = game.players[0]
        blob = json.dumps(build_calculator_pack(game, viewer.player_id))

        own = {str(t) for t in viewer.hand}
        # Control: the viewer's own tiles ARE present (the check can see tiles).
        assert own and all(f'"{t}"' in blob for t in own)
        hidden = {str(t) for p in game.players[1:] for t in p.hand} - own
        hidden |= {str(t) for t in game.tile_bag}
        # Tiles on the board are public; only unplayed ones are secrets.
        hidden = {
            t for t in hidden if not game.board.is_tile_played(Tile.from_string(t))
        }
        assert len(hidden) > 10
        assert _quoted_tiles(blob, hidden) == []

    def test_pack_invariant_under_hidden_information(self):
        """Shuffling hidden info (others' hands, bag order) cannot change the pack."""
        game = _hidden_tile_game()
        viewer_id = game.players[0].player_id
        baseline = json.dumps(build_calculator_pack(game, viewer_id), sort_keys=True)

        other = copy.deepcopy(game)
        rng = random.Random(0)
        # swap tiles between the other players' hands and the bag, and reorder bag
        pool = list(other.tile_bag)
        for p in other.players[1:]:
            pool.extend(p._hand)
        rng.shuffle(pool)
        sizes = [p.hand_size for p in other.players[1:]]
        bag_len = len(other.tile_bag)
        i = 0
        for p, n in zip(other.players[1:], sizes):
            p._hand = pool[i : i + n]
            i += n
        other.tile_bag = pool[i : i + bag_len]
        assert [str(t) for t in other.players[1].hand] != [
            str(t) for t in game.players[1].hand
        ]
        assert json.dumps(build_calculator_pack(other, viewer_id), sort_keys=True) == (
            baseline
        )


def test_json_serialisable_and_stable_keys():
    game = merger_position()
    game.phase = GamePhase.BUYING_STOCKS
    pack = build_calculator_pack(game, "p2")
    json.dumps(pack)
    assert set(pack) == {
        "phase",
        "current_player_id",
        "viewer_id",
        "viewer_is_current",
        "chains",
        "players",
        "viewer",
        "bank",
        "buy_options",
    }
    assert set(pack["chains"]) == set(Hotel.get_all_chain_names())


def test_unknown_viewer():
    with pytest.raises(ValueError):
        build_calculator_pack(merger_position(), "nobody")


# ---------------------------------------------------------------------------
# Engine equality over bot-played games
# ---------------------------------------------------------------------------


def _finish_merger(game, tile_player_id, survivor, sell_all=None, trade_all=None):
    """Drive a merger to completion in a copy; others keep their shares."""
    while game.phase == GamePhase.MERGING and game.pending_action:
        pa = game.pending_action
        if pa["type"] == "choose_survivor":
            game.choose_merger_survivor(tile_player_id, survivor)
        elif pa["type"] == "stock_disposition":
            pid, n = pa["player_id"], pa["stock_count"]
            if pid == tile_player_id and sell_all:
                res = game.handle_stock_disposition(pid, n, 0, 0)
            elif pid == tile_player_id and trade_all:
                t = n - n % 2
                t = min(t, game.hotel.get_available_stocks(survivor) * 2)
                res = game.handle_stock_disposition(pid, 0, t, n - t)
            else:
                res = game.handle_stock_disposition(pid, 0, 0, n)
            assert res.success, res.error
        else:
            raise AssertionError(pa)


class Tally:
    merges = 0
    multi = 0
    ties = 0
    founds = 0
    expands = 0


def _check_pack_vs_engine(game, tally):
    # 1. projected scores == Game.end_game on a copy, for every viewer
    end = copy.deepcopy(game)
    if end.phase in (GamePhase.GAME_OVER, GamePhase.LOBBY):
        return
    res = end.end_game()
    assert res.success
    final = {s.player_id: (s.money, s.rank) for s in res.standings}
    for viewer in game.players:
        pack = build_calculator_pack(game, viewer.player_id)
        json.dumps(pack)
        for row in pack["players"]:
            money, rank = final[row["player_id"]]
            assert row["projected_final_score"] == money
            assert row["projected_rank"] == rank
        # 2. chain payouts == engine bonuses
        for chain in game.hotel.get_active_chains():
            size = game.board.get_chain_size(chain)
            eng = Rules.calculate_bonuses(game.players, chain, size, game.hotel)
            got = pack["chains"][chain]["payouts"]
            assert {k: v["total"] for k, v in got.items()} == {
                k: v["majority"] + v["minority"] for k, v in eng.items()
            }
            assert pack["chains"][chain]["price"] == game.hotel.get_stock_price(
                chain, size
            )
        # 3. net worth uses engine pricing
        for row in pack["players"]:
            p = game.get_player(row["player_id"])
            prices = {
                c: game.hotel.get_stock_price(c, game.board.get_chain_size(c))
                for c in game.hotel.get_active_chains()
            }
            assert row["net_worth"] == p.get_net_worth(prices)


def _check_tile_predictions(game, tally):
    """Play every tile in the mover's hand on a copy and compare to the pack."""
    if game.phase != GamePhase.PLAYING:
        return
    pid = game.get_current_player_id()
    pack = build_calculator_pack(game, pid)
    for info in pack["viewer"]["tiles"]:
        tile = Tile.from_string(info["tile"])
        assert info["playable"] == Rules.can_place_tile(game.board, tile, game.hotel)
        if not info["playable"]:
            continue
        g = copy.deepcopy(game)
        res = g.play_tile(pid, tile)
        assert res.success
        if info["effect"] == "expand":
            tally.expands += 1
            assert g.board.get_chain_size(info["chain"]) == info["new_size"]
        elif info["effect"] == "found":
            tally.founds += 1
            chain = info["chains_available_to_found"][0]
            assert g.found_chain(pid, chain).success
            assert g.board.get_chain_size(chain) == info["new_size"]
        elif info["effect"] == "merge":
            tally.merges += 1
            for sc in info["scenarios"]:
                if len(info["scenarios"]) > 1:
                    tally.ties += 1
                _check_merge_scenario(game, tile, pid, sc, tally)


def _check_merge_scenario(game, tile, pid, sc, tally):
    survivor = sc["survivor"]
    if len(sc["defunct"]) > 1:
        tally.multi += 1
    # keep-all: cash change is exactly the predicted bonus, and sizes match
    g = copy.deepcopy(game)
    cash0 = g.get_player(pid).money
    g.play_tile(pid, tile)
    _finish_merger(g, pid, survivor)
    assert g.get_player(pid).money - cash0 == sc["viewer_total_bonus"]
    assert g.board.get_chain_size(survivor) == sc["survivor_size_after"]
    assert (
        g.hotel.get_stock_price(survivor, sc["survivor_size_after"])
        == sc["survivor_price_after"]
    )
    # sell-all
    g = copy.deepcopy(game)
    g.play_tile(pid, tile)
    _finish_merger(g, pid, survivor, sell_all=True)
    expect = sum(d["viewer_bonus"] + d["sell_all_value"] for d in sc["defunct"])
    assert g.get_player(pid).money - cash0 == expect
    # trade-all (single defunct: bank stock for the survivor is as predicted)
    if len(sc["defunct"]) == 1:
        d = sc["defunct"][0]
        g = copy.deepcopy(game)
        before = g.get_player(pid).get_stock_count(survivor)
        g.play_tile(pid, tile)
        _finish_merger(g, pid, survivor, trade_all=True)
        me = g.get_player(pid)
        assert (
            me.get_stock_count(survivor) - before
            == d["trade"]["survivor_shares_received"]
        )
        # leftover (kept, not sold) shares: cash change is bonus only
        assert me.money - cash0 == d["viewer_bonus"]


@pytest.mark.slow
@pytest.mark.parametrize(
    "seed,players", [(42, 3), (123, 4), (456, 5), (789, 6), (7, 4), (99, 3)]
)
def test_engine_equality_over_bot_games(seed, players):
    game = Game(seed=seed)
    for i in range(players):
        game.add_player(f"bot{i}", f"Bot {i}", is_bot=True)
    game.start_game()
    tally = Tally()
    turns = 0
    while game.phase != GamePhase.GAME_OVER and turns < 160:
        _check_pack_vs_engine(game, tally)
        _check_tile_predictions(game, tally)
        game.execute_bot_turn(game.get_current_player_id())
        turns += 1
        if turns > 120 and Rules.check_end_game(game.board, game.hotel):
            break
    _check_pack_vs_engine(game, tally)
    assert turns > 20
    # Do not let the test pass vacuously.
    assert tally.expands > 0 and tally.founds > 0


@pytest.mark.slow
def test_mergers_were_exercised_somewhere():
    """Across seeds at least some mergers get predicted-vs-engine checked."""
    total = Tally()
    for seed in (42, 123, 456, 789, 7, 99):
        game = Game(seed=seed)
        for i in range(4):
            game.add_player(f"bot{i}", f"Bot {i}", is_bot=True)
        game.start_game()
        for _ in range(140):
            if game.phase == GamePhase.GAME_OVER:
                break
            _check_tile_predictions(game, total)
            game.execute_bot_turn(game.get_current_player_id())
    assert total.merges > 0
