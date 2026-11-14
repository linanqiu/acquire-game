"""The Game object outside the turn rules: lobby, deal, the engine's own
guards, and the state it shows to clients.

Rules: docs/rules/setup.md (3-6 players in classic, 6 tiles each, shuffled
bag). The turn rules themselves live in ``tests/gameplay``.

Every seat acts through ``game.decisions.apply_action``, which validates first;
the ``Game`` methods still refuse illegal calls on their own (defence in
depth for direct callers). ``test_engine_methods_refuse_illegal_calls``
checks that they do, and that a refusal changes nothing.
"""

from __future__ import annotations

import pytest

from game.action import TradeOffer
from game.game import Game
from game.ruleset import load_ruleset
from tests.support.table import Table
from tests.test_decisions import fingerprint


def lobby(n: int, ruleset=None) -> Game:
    game = Game(seed=1, ruleset=ruleset)
    for i in range(n):
        game.add_player(f"p{i + 1}", f"Player {i + 1}")
    return game


# ---------------------------------------------------------------------------
# Lobby and deal
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("ruleset_id", ["classic", "mini"])
def test_seat_limits_come_from_the_ruleset(ruleset_id):
    rs = load_ruleset(ruleset_id)
    game = lobby(rs.min_players - 1, rs)
    with pytest.raises(ValueError, match="at least"):
        game.start_game()
    for i in range(rs.min_players - 1, rs.max_players):
        game.add_player(f"p{i + 1}", f"Player {i + 1}")
    with pytest.raises(ValueError, match="Maximum"):
        game.add_player("extra", "Extra")
    game.start_game()
    assert [p.hand_size for p in game.players] == [rs.hand_size] * rs.max_players
    assert len(game.tile_bag) == rs.board.area - rs.hand_size * rs.max_players
    assert game.get_current_player_id() == "p1"


def test_lobby_rules():
    game = lobby(2)
    assert game.get_public_state()["current_player"] == "p1"
    with pytest.raises(ValueError, match="already exists"):
        game.add_player("p1", "Again")
    game.add_player("b1", "Bot", is_bot=True)
    assert game.remove_player("nobody") is False
    assert game.remove_player("p1") is True
    assert game.remove_player("b1") is True
    assert [p.player_id for p in game.players] == ["p2"]
    back = game.add_player("p1", "Back")
    assert back is game.get_player("p1") and back.name == "Back"
    game.add_player("b1", "Now human")  # a removed bot's seat id, reused
    assert game.get_public_state()["can_end_game"] is False  # lobby
    game.start_game()
    flags = {p["player_id"]: p["is_bot"] for p in game.get_public_state()["players"]}
    assert flags == {"p2": False, "p1": False, "b1": False}
    with pytest.raises(ValueError, match="started"):
        game.add_player("p4", "Late")
    with pytest.raises(ValueError, match="started"):
        game.remove_player("p2")
    with pytest.raises(ValueError, match="already started"):
        game.start_game()


def test_explicit_tile_order_deals_from_the_end_of_the_list():
    order = [f"{c}{r}" for r in "AB" for c in range(1, 10)]  # 1A..9A, 1B..9B
    game = Game(tile_order=order)
    for pid in ("p0", "p1", "p2"):
        game.add_player(pid, pid)
    game.start_game()
    hands = [{str(t) for t in p.hand} for p in game.players]
    assert hands == [
        {"9B", "8B", "7B", "6B", "5B", "4B"},
        {"3B", "2B", "1B", "9A", "8A", "7A"},
        {"6A", "5A", "4A", "3A", "2A", "1A"},
    ]
    assert game.tile_bag == []


def test_a_seed_fixes_the_shuffle():
    def deal(seed):
        game = Game(seed=seed)
        for pid in ("p1", "p2", "p3"):
            game.add_player(pid, pid)
        game.start_game()
        return [str(t) for t in game.tile_bag], [
            [str(t) for t in p.hand] for p in game.players
        ]

    assert deal(42) == deal(42)
    assert deal(42) != deal(43)


# ---------------------------------------------------------------------------
# The engine's own guards
# ---------------------------------------------------------------------------


def merger_in_progress() -> Table:
    """Luxor (3) dies into Tower (4); p2 (mergemaker) must dispose 3 Luxor."""
    t = Table([["1A", "6A", "8A"], ["2A", "3A", "4A"], ["5A", "7A"]])
    t.turn("1A")
    t.turn("2A", found="Luxor", buy={"Luxor": 2})
    t.turn("5A", buy={"Luxor": 2})
    t.turn("6A", found="Tower", buy={"Luxor": 1})
    t.turn("3A")
    t.turn("7A")
    t.turn("8A")
    t.place("4A")
    return t


def tied_merger() -> Table:
    t = Table([["1A", "4A"], ["2A", "5A"], ["12I", "3A"]])
    t.turn("1A")
    t.turn("2A", found="Luxor")
    t.turn("12I")
    t.turn("4A")
    t.turn("5A", found="Tower")
    t.place("3A")
    return t


def founding() -> Table:
    t = Table([["1A"], ["2A"], []])
    t.turn("1A")
    t.place("2A")
    return t


def buying() -> Table:
    t = Table([["1A"], ["2A"], []])
    t.turn("1A")
    t.turn("2A", found="Luxor")
    t.pass_turn()
    t.place_filler()  # p1 to buy; Luxor ($200) on the board
    return t


def place_phase() -> Table:
    return Table([["1A"], ["3A"], ["5A"]])


def _tile(t, pid):
    return t.player(pid).hand[0]


CASES = [
    # (position, call, expected error)
    (place_phase, lambda t: t.game.play_tile("p2", _tile(t, "p2")), "Not your turn"),
    (place_phase, lambda t: t.game.play_tile("px", _tile(t, "p1")), "not found"),
    (place_phase, lambda t: t.game.play_tile("p1", _tile(t, "p2")), "not in hand"),
    (place_phase, lambda t: t.game.found_chain("p1", "Luxor"), "founding"),
    (place_phase, lambda t: t.game.buy_stocks("p1", []), "buying"),
    (place_phase, lambda t: t.game.end_turn("p1"), "Cannot end turn"),
    (place_phase, lambda t: t.game.choose_merger_survivor("p1", "Luxor"), "merging"),
    (place_phase, lambda t: t.game.handle_stock_disposition("p1", 0, 0, 0), "merging"),
    (place_phase, lambda t: t.game.declare_end_game("p2"), "current player"),
    (place_phase, lambda t: t.game.declare_end_game("p1"), "not met"),
    (place_phase, lambda t: t.game.accept_trade("p1", "nope"), "not found"),
    (place_phase, lambda t: t.game.reject_trade("p1", "nope"), "not found"),
    (place_phase, lambda t: t.game.cancel_trade("p1", "nope"), "not found"),
    (founding, lambda t: t.game.found_chain("p1", "Luxor"), "Not your turn"),
    (founding, lambda t: t.game.found_chain("p2", "Nope"), "not available"),
    (founding, lambda t: t.game.play_tile("p2", _tile(t, "p2")), "playing phase"),
    (tied_merger, lambda t: t.game.choose_merger_survivor("p1", "Luxor"), "Not your"),
    (tied_merger, lambda t: t.game.choose_merger_survivor("p3", "American"), "tied"),
    (tied_merger, lambda t: t.game.handle_stock_disposition("p2", 1, 0, 0), "No pending"),
    (merger_in_progress, lambda t: t.game.choose_merger_survivor("p2", "Tower"), "No pending"),
    (merger_in_progress, lambda t: t.game.handle_stock_disposition("p3", 2, 0, 0), "Not your turn"),
    (merger_in_progress, lambda t: t.game.handle_stock_disposition("p2", -1, 2, 2), "non-negative"),
    (merger_in_progress, lambda t: t.game.handle_stock_disposition("p2", 0, -2, 5), "non-negative"),
    (merger_in_progress, lambda t: t.game.handle_stock_disposition("p2", 0, 0, -1), "non-negative"),
    (merger_in_progress, lambda t: t.game.handle_stock_disposition("p2", 1, 0, 1), "add up"),
    (merger_in_progress, lambda t: t.game.handle_stock_disposition("p2", 0, 1, 2), "even"),
    (merger_in_progress, lambda t: t.game.buy_stocks("p2", []), "buying"),
    (buying, lambda t: t.game.buy_stocks("p2", []), "Not your turn"),
    (buying, lambda t: t.game.buy_stocks("p1", ["Luxor"] * 4), "up to 3"),
    (buying, lambda t: t.game.buy_stocks("p1", ["Tower"]), "not active"),
    (buying, lambda t: t.game.end_turn("p2"), "Not your turn"),
]  # fmt: skip


def broke_buyer() -> Table:
    """Imperial at $500 (3 tiles); p3 spends 4 x $1,500 and has nothing left."""
    t = Table([["1C"], ["2C"], ["3C"]])
    t.turn("1C")
    t.turn("2C", found="Imperial")
    t.place("3C")
    for _ in range(4):
        t.buy({"Imperial": 3})
        t.end()
        t.pass_turn()
        t.pass_turn()
        t.place_filler()
    assert t.current == "p3" and t.money("p3") == 0
    return t


def bank_nearly_empty() -> Table:
    """Mini: the player on turn may buy; one share of harbor left in the bank."""
    from game.ruleset import load_ruleset

    t = Table([["1A"], ["2A"]], ruleset=load_ruleset("mini"))
    t.turn("1A")
    t.turn("2A", found="harbor", buy={"harbor": 4})
    for n in (4, 4, 3):
        t.place_filler()
        t.buy({"harbor": n})
        t.end()
    t.place_filler()
    assert t.game.hotel.get_available_stocks("harbor") == 1
    return t


def dead_tile_on_turn() -> Table:
    from tests.gameplay.test_dead_tiles import two_chains
    from game.ruleset import classic

    t, _, _ = two_chains(classic(), 11, 11, ["5B"])
    return t


def limited_trade():
    """Snapshot: p1 holds 8 defunct Luxor, the bank has 2 American left."""
    from tests.support.snapshots import load_fixture

    class Wrap:
        game = load_fixture("disposition-trade-limited")

    return Wrap()


def open_offer():
    """p1 has offered p2 $1 (trade "t")."""
    t = place_phase()
    assert t.game.propose_trade(TradeOffer("p1", "p2", offering_money=1, trade_id="t"))
    return t


def _offer(**kw):
    return TradeOffer(kw.pop("frm", "p1"), kw.pop("to", "p2"), **kw)


ENGINE_CASES = [
    (open_offer, lambda t: t.game.accept_trade("p3", "t"), "recipient can accept"),
    (open_offer, lambda t: t.game.reject_trade("p1", "t"), "recipient can reject"),
    (open_offer, lambda t: t.game.cancel_trade("p2", "t"), "proposer can cancel"),
    (place_phase, lambda t: t.game.propose_trade(_offer(frm="px", offering_money=1)), "Offering player"),
    (place_phase, lambda t: t.game.propose_trade(_offer(to="p1", offering_money=1)), "yourself"),
    (place_phase, lambda t: t.game.propose_trade(_offer(offering_money=-1)), "cannot be negative"),
    (place_phase, lambda t: t.game.propose_trade(_offer(requesting_money=-1)), "cannot be negative"),
    (place_phase, lambda t: t.game.propose_trade(_offer(offering_stocks={"Luxor": -1})), "cannot be negative"),
    (place_phase, lambda t: t.game.propose_trade(_offer(requesting_stocks={"Luxor": -1})), "cannot be negative"),
    (broke_buyer, lambda t: t.game.buy_stocks("p3", ["Imperial"]), "Not enough money"),
    (bank_nearly_empty, lambda t: t.game.buy_stocks(t.current, ["harbor"] * 2), "Not enough harbor"),
    (dead_tile_on_turn, lambda t: t.game.play_tile(t.current, t.game.board.tile_from_string("5B")), "cannot be placed"),
    (limited_trade, lambda t: t.game.handle_stock_disposition("p1", 0, 6, 2), "Not enough survivor stock"),
]  # fmt: skip
CASES += ENGINE_CASES


@pytest.mark.parametrize(
    "position, call, error",
    CASES,
    ids=[f"{c[0].__name__}-{i}" for i, c in enumerate(CASES)],
)
def test_engine_methods_refuse_illegal_calls(position, call, error):
    t = position()
    before = fingerprint(t.game)
    result = call(t)
    assert result.success is False and error in result.error, result.error
    assert fingerprint(t.game) == before


def test_end_game_and_trading_outside_a_running_game():
    game = lobby(3)

    def refused(result, text):
        return result.success is False and text in result.error

    assert refused(game.end_game(), "hasn't started")
    assert refused(game.declare_end_game("p1"), "not started")
    offer = TradeOffer("p1", "p2", offering_money=1)
    assert refused(game.propose_trade(offer), "not started")
    game.start_game()
    assert game.end_game().success
    assert refused(game.end_game(), "already over")
    assert refused(game.declare_end_game("p1"), "already over")
    assert refused(game.propose_trade(offer), "already over")


def test_engine_limits_open_proposals_on_its_own():
    game = lobby(3)
    game.start_game()
    limit = game.ruleset.max_pending_trades_per_player
    for i in range(limit):
        result = game.propose_trade(TradeOffer("p1", "p2", offering_money=1))
        assert result.success and result.trade_id in game.pending_trades
    result = game.propose_trade(TradeOffer("p1", "p2", offering_money=1))
    assert result.success is False and f"Maximum of {limit}" in result.error
    assert len(game.pending_trades) == limit


def test_buying_twice_in_a_turn_is_refused_by_the_engine():
    t = buying()
    assert t.game.buy_stocks("p1", []).success
    assert "already bought" in t.game.buy_stocks("p1", ["Luxor"]).error


# ---------------------------------------------------------------------------
# What clients see
# ---------------------------------------------------------------------------


def test_only_the_mergemaker_may_act_while_a_tie_is_open():
    t = tied_merger()
    assert [t.game.get_player_state(p)["can_act"] for p in ("p1", "p2", "p3")] == [
        False,
        False,
        True,
    ]
    assert t.game.turn_phase == "merger"
    t.act("p3", action="merger_choice", surviving_chain="Luxor")
    # p2 founded Tower and must now decide what to do with that share
    assert t.game.turn_phase == "stock_disposition"
    assert t.game.get_player_state("p2")["can_act"] is True
    assert t.game.get_player_state("p3")["can_act"] is False


def test_bot_seats_are_flagged_in_state_and_standings():
    game = Game(seed=3)
    game.add_player("h", "Human")
    game.add_player("b1", "Bot 1", is_bot=True)
    game.add_player("b2", "Bot 2", is_bot=True)
    game.start_game()
    flags = {p["player_id"]: p["is_bot"] for p in game.get_public_state()["players"]}
    assert flags == {"h": False, "b1": True, "b2": True}
    standings = game.end_game().standings
    assert {s.player_id: s.is_bot for s in standings} == flags


def test_state_shows_the_disposition_queue_during_a_merger():
    t = merger_in_progress()
    queue = lambda: [  # noqa: E731
        (q["player_id"], q["status"])
        for q in t.game.get_public_state()["merger_state"]["disposition_queue"]
    ]
    assert queue() == [("p2", "current"), ("p3", "waiting"), ("p1", "waiting")]
    t.dispose("p2", "Luxor", sell=3)
    assert queue() == [("p2", "completed"), ("p3", "current"), ("p1", "waiting")]
    state = t.game.get_public_state()["merger_state"]
    assert (state["survivor"], state["defunct"]) == ("Tower", "Luxor")
    assert t.game.get_player_state("p3")["can_act"] is True
    assert t.game.get_player_state("p2")["can_act"] is False
    t.dispose("p3", "Luxor", sell=2)
    t.dispose("p1", "Luxor", sell=1)
    assert "merger_state" not in t.game.get_public_state()


def test_state_shows_prices_safety_and_who_may_act():
    t = Table([["1A"], ["2A"], []])
    t.turn("1A")
    t.place("2A")
    state = t.game.get_player_state("p2")
    assert state["phase"] == "found_chain" and state["can_act"] is True
    assert t.game.get_player_state("p1")["can_act"] is False
    t.found("Imperial")
    chains = t.game.get_public_state()["chains"]
    assert chains["Imperial"] == {
        "active": True,
        "size": 2,
        "stock_price": 400,
        "available_stocks": 24,
        "safe": False,
        "color": chains["Imperial"]["color"],
    }
    luxor = chains["Luxor"]
    assert (luxor["active"], luxor["stock_price"], luxor["safe"]) == (False, 0, False)
    assert t.game.get_public_state()["can_end_game"] is False
    assert t.game.get_player_state("nobody") == {"error": "Player not found"}
