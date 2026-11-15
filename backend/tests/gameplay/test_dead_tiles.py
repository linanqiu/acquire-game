"""Safe chains and dead (permanently unplayable) tiles.

Rules: docs/rules/tiles.md "Unplayable Tiles", docs/rules/mergers.md "Safe
Chain Involvement".
- A chain of 11+ tiles (default; 8 in mini) is safe: it cannot be acquired.
- A tile that would merge two safe chains can never be played. At the end of
  the holder's turn it is removed from the game and replaced by a new draw.
- A safe chain may still acquire an unsafe one.
"""

from __future__ import annotations

from game.ruleset import load_ruleset
from tests.support.table import Table, line, scripts_for


def two_chains(rs, upper: int, lower: int, holder_extra: list[str]):
    """Chain 0 on row A (``upper`` tiles), chain 1 on row C (``lower``);
    ``holder_extra`` tiles are dealt from the start to the player who is on
    turn once the chains are built; returns (table, chain 0, chain 1)."""
    a, b = rs.chain_ids[0], rs.chain_ids[1]
    moves = ["1A", ("2A", {"found": a})] + line("A", 3, upper)
    moves += ["1C", ("2C", {"found": b})] + line("C", 3, lower)
    players = max(rs.min_players, 3)
    scripts = scripts_for(moves, players)
    holder = len(moves) % players
    scripts[holder] = holder_extra + scripts[holder]
    t = Table(scripts, ruleset=rs)
    t.play(moves)
    assert t.current == f"p{holder + 1}"
    return t, a, b


def test_a_tile_between_two_safe_chains_is_dead_and_replaced_at_end_of_turn():
    rs = load_ruleset("default")
    t, a, b = two_chains(rs, 11, 11, ["5B"])
    assert (t.size(a), t.size(b)) == (11, 11)
    holder = t.current
    assert "5B" in [str(x) for x in t.player(holder).hand]
    assert "5B" not in t.offered_tiles()
    r = t.try_act(t.current, action="place_tile", tile="5B")
    assert not r["success"]
    reason = t.game.get_player_state(t.current)["tile_playability"]["5B"]
    assert reason == {
        "playable": False,
        "reason": "would_merge_safe_chains",
        "permanent": False,
        "would_trigger_merger": True,
    }

    bag = len(t.game.tile_bag)
    before = t.mark()
    t.place_filler()
    assert t.end()["replaced_tiles"] == ["5B"]
    hand = [str(x) for x in t.player(holder).hand]
    assert "5B" not in hand and len(hand) == rs.hand_size
    (replaced,) = t.events("tiles_replaced", since=before)
    assert replaced["reason"] == "permanently_unplayable"
    assert replaced["removed_tiles"] == ["5B"]
    assert len(t.game.tile_bag) == bag - 2  # the normal draw + the replacement
    # the dead tile is out of the game, not back in the bag
    assert "5B" not in [str(x) for x in t.game.tile_bag]


def test_one_tile_short_of_safe_the_same_tile_merges():
    rs = load_ruleset("default")
    t, a, b = two_chains(rs, 11, 10, ["5B"])
    assert "5B" in t.offered_tiles()
    seen = t.game.get_player_state(t.current)["tile_playability"]["5B"]
    assert (seen["playable"], seen["would_trigger_merger"]) == (True, True)
    chains = t.game.get_public_state()["chains"]
    assert (chains[a]["safe"], chains[b]["safe"]) == (True, False)
    r = t.place("5B")
    assert r["survivor"] == a  # the safe chain acquires the unsafe one
    assert r["defunct"] == [b]


def test_safe_size_comes_from_the_ruleset():
    """Mini: chains are safe from 8 tiles."""
    rs = load_ruleset("mini")
    t, a, b = two_chains(rs, 8, 8, ["5B"])
    assert "5B" not in t.offered_tiles()
    t, a, b = two_chains(rs, 8, 7, ["5B"])
    assert "5B" in t.offered_tiles()


def test_a_hand_of_only_unplayable_tiles_is_replaced_at_the_start_of_the_turn():
    """docs/rules/tiles.md "All Tiles Unplayable": all seven chains are on the
    board and every tile in p3's hand would found an eighth, so p3 reveals
    the hand, the tiles leave the game and p3 draws a fresh hand."""
    pairs = [("1A", "2A"), ("4A", "5A"), ("7A", "8A"), ("10A", "11A"),
             ("1C", "2C"), ("4C", "5C"), ("7C", "8C")]  # fmt: skip
    chains = load_ruleset("default").chain_ids
    moves = []
    for (first, second), chain in zip(pairs, chains):
        moves += [first, (second, {"found": chain})]
    moves += ["1I", "3I", "5I", "7I", "9I", "11I"]  # lone tiles
    dead = ["2I", "4I", "6I", "8I", "10I", "12I"]
    scripts = scripts_for(moves, 3, {2: dead})
    assert len(scripts[2]) == 6 + 6  # p3 plays 6 moves, then draws the dead six
    t = Table(scripts)
    before = t.mark()
    t.play(moves)

    assert t.current == "p3" and len(t.game.hotel.get_active_chains()) == 7
    (replaced,) = t.events("tiles_replaced", since=before)
    assert replaced["reason"] == "all_unplayable"
    assert sorted(replaced["revealed_hand"]) == sorted(dead)
    assert sorted(replaced["removed_tiles"]) == sorted(dead)
    assert replaced["new_tile_count"] == 6
    hand = [str(x) for x in t.player("p3").hand]
    drawn = [
        e for e in t.events("tile_drawn", since=before) if e["reason"] == "replacement"
    ]
    assert sorted(e["tile"] for e in drawn) == sorted(hand)
    assert {e["private_to"] for e in drawn} == {"p3"}
    assert len(hand) == 6 and not set(hand) & set(dead)
    assert t.decision().kind == "place_tile" and t.offered_tiles()
    for tile in dead:  # out of the game for good
        assert tile not in [str(x) for x in t.game.tile_bag]
