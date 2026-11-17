"""The shape of a turn: place a tile, (found / merge), buy, end turn and draw.

Rules: docs/rules/gameplay.md "Turn Structure", docs/rules/setup.md.
- Players take turns in seating order, wrapping around.
- A turn is: place one tile from your hand, resolve what it does, optionally
  buy stock, then draw a tile to refill your hand. Steps cannot be skipped or
  reordered, and only the player on turn acts.
- When the bag is empty, players continue without drawing.
"""

from __future__ import annotations

from game.decisions import apply_action, legal_actions, pending_decisions
from game.game import Game, GamePhase
from game.ruleset import load_ruleset
from tests.support.table import Table


def test_deal_and_seating_order_wraps_around():
    t = Table([["1A"], ["3A"], ["5A"]])
    assert [p.hand_size for p in t.game.players] == [6, 6, 6]
    assert len(t.game.tile_bag) == 108 - 18
    order = []
    for tile in ("1A", "3A", "5A"):
        order.append(t.current)
        t.place(tile)
        result = t.end()
        drawn = t.events("tile_drawn")[-1]
        # the result tells the player which tile they drew; others never see it
        assert result["drew_tile"] == drawn["tile"]
        assert drawn["private_to"] == order[-1]
    order.append(t.current)
    assert order == ["p1", "p2", "p3", "p1"]
    ended = t.events("turn_ended")
    assert [e["next_player_id"] for e in ended] == ["p2", "p3", "p1"]


def test_only_the_player_on_turn_places_and_only_tiles_from_their_hand():
    t = Table([["1A"], ["3A"], ["5A"]])
    r = t.try_act("p2", action="place_tile", tile="3A")
    assert not r["success"] and "Not your turn" in r["error"]
    # 3A is provably not in p1's hand: it is scripted for p2
    r = t.try_act("p1", action="place_tile", tile="3A")
    assert not r["success"] and "not in hand" in r["error"]
    assert t.game.board.get_state()["cells"] == {}
    t.place("1A")
    assert t.player("p1").hand_size == 5


def test_steps_happen_in_order():
    t = Table([["1A"], ["3A"], ["5A"]])
    # no buying or ending the turn before a tile is placed
    for action in ({"action": "buy_stocks", "purchases": {}}, {"action": "end_turn"}):
        r = t.try_act("p1", **action)
        assert not r["success"] and "waiting for place_tile" in r["error"]
    t.place("1A")
    # one tile per turn
    other = next(str(x) for x in t.player("p1").hand)
    r = t.try_act("p1", action="place_tile", tile=other)
    assert not r["success"]
    t.end()  # buying is optional
    assert t.current == "p2"


def _never_declaring_answer(game):
    """Simplest legal play: first tile, first chain, sell defunct stock, buy
    nothing, never declare the end (so the bag runs out)."""
    d = pending_decisions(game)[0]
    legal = legal_actions(game, d)
    if d.kind == "place_tile":
        return d.player_id, {"action": "place_tile", "tile": legal["tiles"][0]["tile"]}
    if d.kind == "found_chain":
        return d.player_id, {"action": "found_chain", "chain": legal["chains"][0]}
    if d.kind == "choose_survivor":
        return d.player_id, {
            "action": "merger_choice",
            "surviving_chain": legal["chains"][0],
        }
    if d.kind == "choose_defunct_order":
        return d.player_id, {
            "action": "merger_order",
            "defunct_chain": legal["chains"][0],
        }
    if d.kind == "stock_disposition":
        return d.player_id, {
            "action": "merger_disposition",
            "defunct_chain": legal["defunct_chain"],
            "disposition": {"sell": legal["stock_count"]},
        }
    return d.player_id, {"action": "end_turn"}


def test_end_of_turn_draw_refills_the_hand_until_the_bag_is_empty():
    rs = load_ruleset("mini")  # 63 tiles, hands of 5
    game = Game(seed=4, ruleset=rs)
    game.add_player("p1", "A")
    game.add_player("p2", "B")
    game.start_game()
    draws_seen = 0
    while game.tile_bag:
        pid, action = _never_declaring_answer(game)
        before = len(game.events)
        assert apply_action(game, pid, action)["success"]
        if action["action"] == "end_turn":
            # the player who ended the turn drew one tile (plus replacements
            # for any dead tile) and is back to a full hand
            drawn = [
                e
                for e in game.events[before:]
                if e["type"] == "tile_drawn" and e["reason"] == "end_turn"
            ]
            assert [e["player_id"] for e in drawn] == [pid]
            assert game.get_player(pid).hand_size == rs.hand_size or not game.tile_bag
            draws_seen += 1
    assert draws_seen > 20
    assert game.phase != GamePhase.GAME_OVER

    # bag empty: placing shrinks the hand, ending the turn draws nothing
    while pending_decisions(game)[0].kind != "place_tile":
        pid, action = _never_declaring_answer(game)
        apply_action(game, pid, action)
    mover = game.get_current_player()
    hand = mover.hand_size
    events = len(game.events)
    pid, action = _never_declaring_answer(game)
    assert apply_action(game, pid, action)["success"]
    while pending_decisions(game)[0].kind != "buy_stocks":
        pid, action = _never_declaring_answer(game)
        apply_action(game, pid, action)
    assert apply_action(game, mover.player_id, {"action": "end_turn"})["success"]
    assert mover.hand_size == hand - 1
    assert not any(e["type"] == "tile_drawn" for e in game.events[events:])

    # ...until nobody can place a tile any more: the game ends by itself. A
    # player whose hand ran out simply skips placing (nothing to reveal).
    steps = 0
    while game.phase != GamePhase.GAME_OVER:
        pid, action = _never_declaring_answer(game)
        assert apply_action(game, pid, action)["success"]
        steps += 1
        assert steps < 2000
    assert game.events[-1]["reason"] == "no_playable_tiles"
    for e in game.events:
        if e["type"] == "tiles_replaced":
            assert e["revealed_hand"], e
