"""Tests for the engine's append-only event log (game.events)."""

import json

from game.action import TradeOffer
from game.board import Tile
from game.decisions import public_events
from game.game import Game, GamePhase


def make_game(num_players=3, seed=1) -> Game:
    game = Game(seed=seed)
    for i in range(num_players):
        game.add_player(f"p{i + 1}", f"Player {i + 1}")
    game.start_game()
    return game


def set_hand(player, tiles):
    for t in player.hand:
        player.remove_tile(t)
    for s in tiles:
        player.add_tile(Tile.from_string(s))


def build_chain(game, chain, tiles):
    for s in tiles:
        t = Tile.from_string(s)
        game.board.place_tile(t)
        game.board.set_chain(t, chain)
    game.hotel.activate_chain(chain)


def give_stock(game, player, chain, n):
    game.hotel.buy_stock(chain, n)
    player.add_stocks(chain, n)


def new_events(game, since):
    return game.events[since:]


def types(events):
    return [e["type"] for e in events]


class TestEventShape:
    def test_game_started_and_private_deals(self):
        game = make_game()
        assert types(game.events) == ["game_started"] + ["tiles_dealt"] * 3
        started = game.events[0]
        assert started["turn_order"] == ["p1", "p2", "p3"]
        assert started["private_to"] is None
        for e, p in zip(game.events[1:], game.players):
            assert e["private_to"] == p.player_id == e["player_id"]
            assert sorted(e["tiles"]) == sorted(str(t) for t in p.hand)

    def test_seq_is_contiguous_and_json_serialisable(self):
        game = make_game()
        set_hand(game.get_player("p1"), ["1A"])
        game.play_tile("p1", Tile.from_string("1A"))
        game.buy_stocks("p1", [])
        game.end_turn("p1")
        assert [e["seq"] for e in game.events] == list(range(len(game.events)))
        json.dumps(game.events)
        for e in game.events:
            assert {"seq", "type", "player_id", "private_to"} <= set(e)


class TestPublicEvents:
    def test_filters_private_events(self):
        game = make_game()
        spectator = public_events(game)
        assert types(spectator) == ["game_started"]
        p2_view = public_events(game, "p2")
        assert types(p2_view) == ["game_started", "tiles_dealt"]
        assert p2_view[1]["player_id"] == "p2"

    def test_since_seq(self):
        game = make_game()
        assert public_events(game, "p1", since_seq=1)[0]["seq"] == 1
        assert public_events(game, None, since_seq=len(game.events)) == []


class TestTurnEvents:
    def test_place_nothing_buy_end_turn(self):
        game = make_game()
        build_chain(game, "marlowe", ["1A", "2A"])
        p1 = game.get_player("p1")
        set_hand(p1, ["9I"])
        start = len(game.events)
        game.play_tile("p1", Tile.from_string("9I"))
        game.buy_stocks("p1", ["marlowe", "marlowe"])
        game.end_turn("p1")
        ev = new_events(game, start)
        assert types(ev) == [
            "tile_placed",
            "stocks_purchased",
            "tile_drawn",
            "turn_ended",
        ]
        assert ev[0]["tile"] == "9I" and ev[0]["outcome"] == "nothing"
        assert ev[1]["purchases"] == {"marlowe": 2}
        assert ev[1]["total_cost"] == 400
        assert ev[1]["prices"] == {"marlowe": 200}
        assert ev[2]["private_to"] == "p1"
        assert ev[2]["tile"] in [str(t) for t in p1.hand]
        assert ev[3]["player_id"] == "p1" and ev[3]["next_player_id"] == "p2"

    def test_expand(self):
        game = make_game()
        build_chain(game, "marlowe", ["1A", "2A"])
        set_hand(game.get_player("p1"), ["3A"])
        start = len(game.events)
        game.play_tile("p1", Tile.from_string("3A"))
        ev = new_events(game, start)
        assert types(ev) == ["tile_placed", "chain_expanded"]
        assert ev[0]["outcome"] == "expand" and ev[0]["chains"] == ["marlowe"]
        assert ev[1]["chain"] == "marlowe" and ev[1]["size"] == 3

    def test_found_chain(self):
        game = make_game()
        game.board.place_tile(Tile.from_string("1A"))
        set_hand(game.get_player("p1"), ["2A"])
        start = len(game.events)
        game.play_tile("p1", Tile.from_string("2A"))
        game.found_chain("p1", "sandpiper")
        ev = new_events(game, start)
        assert types(ev) == ["tile_placed", "chain_founded"]
        assert ev[0]["outcome"] == "found"
        assert ev[1]["chain"] == "sandpiper" and ev[1]["size"] == 2
        assert ev[1]["founder_bonus_type"] == "stock"

    def test_stocks_bought_flag(self):
        game = make_game()
        build_chain(game, "marlowe", ["1A", "2A"])
        game.phase = GamePhase.BUYING_STOCKS
        assert game.stocks_bought_this_turn is False
        assert game.buy_stocks("p1", ["marlowe"]).success
        assert game.stocks_bought_this_turn is True
        second = game.buy_stocks("p1", ["marlowe"])
        assert not second.success and "already" in second.error
        assert game.get_player("p1").get_stock_count("marlowe") == 1
        game.end_turn("p1")
        assert game.stocks_bought_this_turn is False

    def test_permanently_unplayable_replacement_is_public(self):
        game = make_game()
        build_chain(game, "marlowe", [f"{c}A" for c in range(1, 12)])
        build_chain(game, "sandpiper", [f"{c}C" for c in range(1, 12)])
        p1 = game.get_player("p1")
        set_hand(p1, ["5B"])  # would merge two safe chains
        game.phase = GamePhase.BUYING_STOCKS
        start = len(game.events)
        game.end_turn("p1")
        ev = new_events(game, start)
        replaced = [e for e in ev if e["type"] == "tiles_replaced"]
        assert replaced and replaced[0]["removed_tiles"][0] == "5B"
        assert replaced[0]["private_to"] is None
        assert replaced[0]["reason"] == "permanently_unplayable"
        drawn = [e for e in ev if e["type"] == "tile_drawn"]
        assert all(e["private_to"] == "p1" for e in drawn)
        removed = {t for e in replaced for t in e["removed_tiles"]}
        assert {e["tile"] for e in drawn} - removed == {str(t) for t in p1.hand}


class TestMergerEvents:
    def test_clear_survivor_merger(self):
        game = make_game()
        p1, p2, p3 = game.players
        build_chain(game, "marlowe", ["1A", "2A"])
        build_chain(game, "sandpiper", ["4A", "5A", "6A"])
        give_stock(game, p2, "marlowe", 3)
        give_stock(game, p3, "marlowe", 1)
        set_hand(p1, ["3A"])
        start = len(game.events)
        game.play_tile("p1", Tile.from_string("3A"))
        game.handle_stock_disposition("p2", 1, 2, 0)
        game.handle_stock_disposition("p3", 0, 0, 1)
        ev = new_events(game, start)
        assert types(ev) == [
            "tile_placed",
            "merger_started",
            "bonuses_paid",
            "stock_disposition",
            "stock_disposition",
            "merger_completed",
        ]
        assert ev[0]["outcome"] == "merge"
        assert ev[1]["survivor"] == "sandpiper" and ev[1]["defunct"] == ["marlowe"]
        assert ev[1]["sizes"] == {"sandpiper": 3, "marlowe": 2}
        assert ev[2]["chain"] == "marlowe" and ev[2]["final"] is False
        assert ev[2]["bonuses"] == {
            "p2": {"majority": 2000, "minority": 0},
            "p3": {"majority": 0, "minority": 1000},
        }
        assert ev[3]["player_id"] == "p2"
        assert (ev[3]["sell"], ev[3]["trade"], ev[3]["hold"]) == (1, 2, 0)
        assert ev[3]["sale_proceeds"] == 200
        assert ev[3]["survivor_shares_received"] == 1
        assert ev[5]["survivor"] == "sandpiper" and ev[5]["survivor_size"] == 6

    def test_tied_merger_emits_survivor_chosen(self):
        game = make_game()
        build_chain(game, "marlowe", ["1A", "2A"])
        build_chain(game, "sandpiper", ["4A", "5A"])
        set_hand(game.get_player("p1"), ["3A"])
        start = len(game.events)
        game.play_tile("p1", Tile.from_string("3A"))
        game.choose_merger_survivor("p1", "marlowe")
        ev = new_events(game, start)
        assert types(ev) == [
            "tile_placed",
            "survivor_chosen",
            "merger_started",
            "bonuses_paid",
            "merger_completed",
        ]
        assert ev[0]["outcome"] == "merge_tie"
        assert sorted(ev[0]["tied_chains"]) == ["marlowe", "sandpiper"]
        assert ev[1]["survivor"] == "marlowe"
        assert ev[3]["bonuses"] == {}

    def test_negative_disposition_rejected_without_mutation(self):
        game = make_game()
        p1, p2, _ = game.players
        build_chain(game, "marlowe", ["1A", "2A"])
        build_chain(game, "sandpiper", ["4A", "5A", "6A"])
        give_stock(game, p2, "marlowe", 2)
        set_hand(p1, ["3A"])
        game.play_tile("p1", Tile.from_string("3A"))
        available = game.hotel.get_available_stocks("marlowe")
        n = len(game.events)
        result = game.handle_stock_disposition("p2", 4, -2, 0)
        assert not result.success
        assert game.hotel.get_available_stocks("marlowe") == available
        assert len(game.events) == n


class TestTradeEvents:
    def _offer(self, game):
        return TradeOffer("p1", "p2", offering_money=100, requesting_money=0)

    def test_propose_accept(self):
        game = make_game()
        trade = self._offer(game)
        start = len(game.events)
        game.propose_trade(trade)
        game.accept_trade("p2", trade.trade_id)
        ev = new_events(game, start)
        assert types(ev) == ["trade_proposed", "trade_accepted"]
        assert ev[0]["trade"]["trade_id"] == trade.trade_id
        assert ev[0]["player_id"] == "p1"
        assert ev[1]["player_id"] == "p2"

    def test_reject_and_cancel(self):
        game = make_game()
        t1, t2 = self._offer(game), self._offer(game)
        game.propose_trade(t1)
        game.propose_trade(t2)
        start = len(game.events)
        game.reject_trade("p2", t1.trade_id)
        game.cancel_trade("p1", t2.trade_id)
        ev = new_events(game, start)
        assert types(ev) == ["trade_rejected", "trade_cancelled"]
        assert ev[1]["reason"] == "cancelled"

    def test_stale_trade_cancelled_on_accept(self):
        game = make_game()
        trade = self._offer(game)
        game.propose_trade(trade)
        p1 = game.get_player("p1")
        p1.remove_money(p1.money)
        result = game.accept_trade("p2", trade.trade_id)
        assert result.success is False and "no longer valid" in result.error
        assert trade.trade_id not in game.pending_trades
        assert game.events[-1]["type"] == "trade_cancelled"
        assert game.events[-1]["reason"] == "no_longer_valid"

    def test_merger_chain_stock_cannot_be_traded_mid_merger(self):
        game = make_game()
        p1, p2, _ = game.players
        build_chain(game, "marlowe", ["1A", "2A"])
        build_chain(game, "sandpiper", ["4A", "5A", "6A"])
        give_stock(game, p2, "marlowe", 2)
        set_hand(p1, ["3A"])
        game.play_tile("p1", Tile.from_string("3A"))
        result = game.propose_trade(
            TradeOffer("p2", "p1", offering_stocks={"marlowe": 2})
        )
        assert not result.success and "merger" in result.error


class TestEndGameEvents:
    def test_declare_end_game(self):
        game = make_game()
        _p1, p2, _ = game.players
        build_chain(game, "marlowe", [f"{c}A" for c in range(1, 12)])
        give_stock(game, p2, "marlowe", 2)
        start = len(game.events)
        assert game.declare_end_game("p1").success
        ev = new_events(game, start)
        assert types(ev) == ["end_game_declared", "bonuses_paid", "game_ended"]
        assert ev[1]["final"] is True and ev[1]["chain"] == "marlowe"
        ended = ev[2]
        assert ended["reason"] == "declared"
        assert ended["winner"] == "p2"
        assert ended["final_sales"] == {"p2": 2 * 700}
        assert ended["standings"][0]["player_id"] == "p2"
        assert ended["standings"][0]["rank"] == 1
