"""Tests for game snapshots (backend/game/snapshot.py).

The guarantee under test: for any reachable game state ``g``,
``from_snapshot(json round trip of to_snapshot(g))`` behaves identically to
``g`` under any subsequent action sequence.

Method: play bot games one engine call at a time. At many points (and at least
a few points inside every kind of phase) fork the game two ways -- a deepcopy
(reference) and a JSON round-tripped restore -- then drive both with the same
decision procedure to the end of the game, asserting identical public state,
identical per-player state and identical fresh snapshots after every step.
"""

import copy
import json
from functools import cache

import pytest
from game.action import TradeOffer
from game.board import Tile, TileState
from game.bot import Bot
from game.game import Game, GamePhase, MergerState
from game.hotel import Hotel
from game.player import Player
from game.rules import Rules
from game.snapshot import (
    HANDLED_BOARD_ATTRS,
    HANDLED_BOT_ATTRS,
    HANDLED_GAME_ATTRS,
    HANDLED_HOTEL_ATTRS,
    HANDLED_MERGER_FIELDS,
    HANDLED_PLAYER_ATTRS,
    SNAPSHOT_VERSION,
    from_snapshot,
    to_snapshot,
)

MAX_STEPS = 4000


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def roundtrip(snap: dict) -> dict:
    """What a snapshot looks like after being stored/sent as JSON."""
    return json.loads(json.dumps(snap))


def restore(game: Game) -> Game:
    snap = to_snapshot(game)
    again = roundtrip(snap)
    assert again == snap, "snapshot is not JSON-stable"
    return from_snapshot(again)


def make_game(seed, n_players, difficulties=("medium",)):
    game = Game(seed=seed)
    for i in range(n_players):
        game.add_player(
            f"p{i}",
            f"Player {i}",
            is_bot=True,
            bot_difficulty=difficulties[i % len(difficulties)],
        )
    game.start_game()
    return game


def assert_same(a: Game, b: Game, where: str = "") -> None:
    assert a.get_public_state() == b.get_public_state(), f"public state {where}"
    for p in a.players:
        assert a.get_player_state(p.player_id) == b.get_player_state(p.player_id), (
            f"player state {p.player_id} {where}"
        )
    assert to_snapshot(a) == to_snapshot(b), f"snapshot {where}"


def category(game: Game, ctx: dict) -> str:
    """Coarse description of where in the game we are."""
    if game.phase == GamePhase.MERGING and game.pending_action:
        t = game.pending_action.get("type")
        if t == "stock_disposition":
            return "disposition_mid" if game._merger.stock_index > 0 else "disposition"
        return t
    if game.phase == GamePhase.BUYING_STOCKS:
        return "buying_after_buy" if ctx["bought"] else "buying"
    return game.phase.value


# ---------------------------------------------------------------------------
# Deterministic driver: ONE engine call per step, decided purely from the game
# state (plus a tiny driver context that is copied along with the game).
# ---------------------------------------------------------------------------


def new_ctx() -> dict:
    return {"n": 0, "bought": False}


def _trade_step(game: Game, ctx: dict):
    n = ctx["n"]
    if game.pending_trades and n % 20 == 0:
        trade = next(iter(game.pending_trades.values()))
        r = game.accept_trade(trade.to_player_id, trade.trade_id)
        return {"action": "accept_trade", **r.to_dict()}
    if game.pending_trades and n % 15 == 0:
        trade = next(iter(game.pending_trades.values()))
        r = game.cancel_trade(trade.from_player_id, trade.trade_id)
        return {"action": "cancel_trade", **r.to_dict()}
    if game.pending_trades and n % 25 == 0:
        trade = list(game.pending_trades.values())[-1]
        r = game.reject_trade(trade.to_player_id, trade.trade_id)
        return {"action": "reject_trade", **r.to_dict()}
    for giver in game.players:
        chains = [c for c, k in giver.stocks.items() if k > 0]
        others = [p for p in game.players if p is not giver and p.money >= 100]
        if chains and others:
            offer = TradeOffer(
                from_player_id=giver.player_id,
                to_player_id=others[n % len(others)].player_id,
                offering_stocks={chains[0]: 1},
                requesting_money=100,
                trade_id=f"trade-{n}",
            )
            r = game.propose_trade(offer)
            return {"action": "propose_trade", **r.to_dict()}
    return None


def step(game: Game, ctx: dict):
    """Perform exactly one action. Returns a description, or None if game over."""
    if game.phase == GamePhase.GAME_OVER:
        return None
    ctx["n"] += 1
    game.events.append(
        {
            "seq": len(game.events),
            "type": "driver_step",
            "n": ctx["n"],
            "x": [1, {"a": None}],
        }
    )
    if ctx["n"] > MAX_STEPS:
        r = game.end_game()
        return {"action": "forced_end_game", **r.to_dict()}

    if ctx["n"] % 5 == 0:
        done = _trade_step(game, ctx)
        if done is not None:
            return done

    cur = game.get_current_player()
    bot = game.bots[cur.player_id]

    if game.phase == GamePhase.PLAYING:
        ctx["bought"] = False
        if game.can_declare_end_game():
            r = game.declare_end_game(cur.player_id)
            return {"action": "declare_end_game", **r.to_dict()}
        tile = bot.choose_tile_to_play(game.board, game.hotel)
        # Engine oddity: Bot._get_playable_tiles ignores "would found an 8th
        # chain", so a bot can insist on an unplayable tile forever. Fall back
        # to the engine's own playability rules so games always progress.
        playable = Rules.get_playable_tiles(game.board, cur.hand, game.hotel)
        if tile not in playable:
            tile = playable[0] if playable else None
        if tile is None:
            game.phase = GamePhase.BUYING_STOCKS
            return {"action": "skip_tile"}
        r = game.play_tile(cur.player_id, tile)
        return {"action": "play_tile", **r.to_dict()}

    if game.phase == GamePhase.FOUNDING_CHAIN:
        chain = bot.choose_chain_to_found(
            game.pending_action["available_chains"], game.board
        )
        r = game.found_chain(cur.player_id, chain)
        return {"action": "found_chain", **r.to_dict()}

    if game.phase == GamePhase.MERGING:
        pa = game.pending_action
        assert pa is not None, "merging with no pending action"
        if pa["type"] == "choose_survivor":
            choice = bot.choose_merger_survivor(
                pa["tied_chains"], game.board, game.hotel
            )
            r = game.choose_merger_survivor(cur.player_id, choice)
            return {"action": "choose_survivor", **r.to_dict()}
        assert pa["type"] == "stock_disposition"
        pid = pa["player_id"]
        d = game.bots[pid].choose_stock_disposition(
            pa["defunct_chain"],
            pa["surviving_chain"],
            pa["stock_count"],
            game.board,
            game.hotel,
        )
        r = game.handle_stock_disposition(pid, d["sell"], d["trade"], d["keep"])
        return {"action": "stock_disposition", "player": pid, **r.to_dict()}

    assert game.phase == GamePhase.BUYING_STOCKS, game.phase
    if not ctx["bought"]:
        ctx["bought"] = True
        game.stocks_bought_this_turn = True
        r = game.buy_stocks(
            cur.player_id, bot.choose_stocks_to_buy(game.board, game.hotel)
        )
        return {"action": "buy_stocks", **r.to_dict()}
    ctx["bought"] = False
    game.stocks_bought_this_turn = False
    r = game.end_turn(cur.player_id)
    return {"action": "end_turn", **r.to_dict()}


def continue_in_lockstep(ref: Game, ref_ctx: dict, rest: Game, rest_ctx: dict):
    """Drive both games with the same procedure to the end, comparing each step."""
    assert_same(ref, rest, "at fork")
    steps = 0
    while True:
        a = step(ref, ref_ctx)
        b = step(rest, rest_ctx)
        assert a == b, f"action result diverged at +{steps}"
        if a is None:
            break
        steps += 1
        assert_same(ref, rest, f"after +{steps} ({a['action']})")
    assert ref.phase == GamePhase.GAME_OVER
    return steps


# ---------------------------------------------------------------------------
# Main fidelity test
# ---------------------------------------------------------------------------

REQUIRED_CATEGORIES = {
    "playing",
    "founding_chain",
    "disposition",
    "disposition_mid",
    "buying",
    "buying_after_buy",
    "game_over",
    "trades_pending",
}

CONFIGS = [
    (1, 3, ("medium",)),
    (2, 4, ("easy", "medium", "hard")),
    (3, 5, ("hard",)),
    (4, 6, ("medium", "easy")),
    (5, 3, ("hard", "medium")),
    (42, 3, ("medium",)),
]

FORK_EVERY = 60  # also fork at every Nth step, in addition to per-category forks
FORKS_PER_CATEGORY = 1


@cache
def run_config(seed, n_players, difficulties):
    """Play one game, forking at many points. Returns the set of categories forked."""
    game = make_game(seed, n_players, difficulties)
    ctx = new_ctx()
    forked: dict[str, int] = {}
    seen: set[str] = set()
    i = 0
    while True:
        cats = {category(game, ctx)}
        if game.pending_trades:
            cats.add("trades_pending")
        if game.phase == GamePhase.GAME_OVER:
            cats.add("game_over")
        seen |= cats

        # Cheap check at EVERY point: restore reproduces the exact state.
        restored = restore(game)
        assert_same(game, restored, f"seed={seed} step={i}")

        # Expensive check at selected points: continue both to the end.
        need = any(forked.get(c, 0) < FORKS_PER_CATEGORY for c in cats)
        if need or i % FORK_EVERY == 0:
            for c in cats:
                forked[c] = forked.get(c, 0) + 1
            continue_in_lockstep(copy.deepcopy(game), dict(ctx), restored, dict(ctx))

        if step(game, ctx) is None:
            break
        i += 1
    return frozenset(seen)


@pytest.mark.parametrize(
    "seed,n_players,difficulties", CONFIGS, ids=[f"seed{c[0]}-{c[1]}p" for c in CONFIGS]
)
def test_restore_then_continue_matches_original(seed, n_players, difficulties):
    run_config(seed, n_players, difficulties)


def test_all_phases_were_exercised():
    seen = set()
    for cfg in CONFIGS:
        seen |= run_config(*cfg)
    missing = REQUIRED_CATEGORIES - seen
    assert not missing, f"snapshot fidelity never forked inside: {sorted(missing)}"


# ---------------------------------------------------------------------------
# Hand-built states the random bot games may never reach
# ---------------------------------------------------------------------------


def _build_tie_merger_game():
    """Two equal-size chains with a human-held tile that merges them (tie)."""
    game = Game(seed=9)
    for i in range(3):
        game.add_player(f"p{i}", f"P{i}", is_bot=True)
    game.start_game()
    # Luxor on 1A,2A ; Tower on 4A,5A ; joining tile 3A.
    for t, chain in (
        ("1A", "Luxor"),
        ("2A", "Luxor"),
        ("4A", "Tower"),
        ("5A", "Tower"),
    ):
        tile = Tile.from_string(t)
        game.board.place_tile(tile)
        game.board.set_chain(tile, chain)
    game.hotel.activate_chain("Luxor")
    game.hotel.activate_chain("Tower")
    for _ in range(2):
        game.hotel.buy_stock("Luxor")
        game.hotel.buy_stock("Tower")
    game.players[1].add_stocks("Luxor", 2)
    game.players[2].add_stocks("Tower", 2)
    p0 = game.players[0]
    for t in list(p0.hand):
        p0.remove_tile(t)
    three_a = Tile.from_string("3A")
    p0.add_tile(three_a)
    game.tile_bag = [t for t in game.tile_bag if t != three_a]
    for pl in game.players:
        for t in list(pl.hand):
            if game.board.is_tile_played(t):
                pl.remove_tile(t)
    game.tile_bag = [t for t in game.tile_bag if not game.board.is_tile_played(t)]
    for pl in game.players[1:]:
        pl._hand = [t for t in pl._hand if t != three_a]
    return game, three_a


def test_merger_survivor_choice_pending_roundtrip():
    game, tile = _build_tie_merger_game()
    r = game.play_tile("p0", tile)
    assert r.success and game.pending_action["type"] == "choose_survivor"
    assert isinstance(game.pending_action["tile"], Tile)

    snap = to_snapshot(game)
    restored = from_snapshot(roundtrip(snap))
    # pending_action holds a real Tile again, exactly like the engine's own shape
    assert isinstance(restored.pending_action["tile"], Tile)
    assert restored.pending_action == game.pending_action
    assert_same(game, restored, "tie pending")

    ref, ref_ctx = copy.deepcopy(game), new_ctx()
    rest, rest_ctx = restored, new_ctx()
    continue_in_lockstep(ref, ref_ctx, rest, rest_ctx)


def test_merger_state_midway_roundtrip():
    """Snapshot after survivor choice, with merger tile + queue populated."""
    game, tile = _build_tie_merger_game()
    game.play_tile("p0", tile)
    game.choose_merger_survivor("p0", "Luxor")
    assert game.phase == GamePhase.MERGING
    assert game._merger.tile == tile
    assert game._merger.survivor == "Luxor"
    restored = restore(game)
    assert restored._merger == game._merger
    assert_same(game, restored, "mid merger")
    continue_in_lockstep(copy.deepcopy(game), new_ctx(), restored, new_ctx())


def test_found_chain_pending_action_shape():
    game = make_game(3, 3)
    ctx = new_ctx()
    for _ in range(MAX_STEPS):
        if game.phase == GamePhase.FOUNDING_CHAIN:
            break
        step(game, ctx)
    assert game.phase == GamePhase.FOUNDING_CHAIN
    restored = restore(game)
    assert restored.pending_action == game.pending_action
    assert isinstance(restored.pending_action["tile"], Tile)
    assert type(restored.pending_action["available_chains"]) is list


# ---------------------------------------------------------------------------
# Structure / format
# ---------------------------------------------------------------------------


def test_snapshot_is_pure_json_and_versioned():
    game = make_game(5, 4)
    ctx = new_ctx()
    for _ in range(60):
        step(game, ctx)
    snap = to_snapshot(game)
    assert snap["version"] == SNAPSHOT_VERSION
    assert json.loads(json.dumps(snap)) == snap
    # No aliasing with live game state
    snap2 = to_snapshot(game)
    step(game, ctx)
    assert snap == snap2


def test_lobby_game_roundtrip_then_start():
    game = Game(seed=77)
    game.add_player("a", "A", is_bot=True, bot_difficulty="hard")
    game.add_player("b", "B")
    game.add_player("c", "C", is_bot=True, bot_difficulty="easy")
    restored = restore(game)
    assert restored.phase == GamePhase.LOBBY
    assert_same(game, restored, "lobby")
    game.start_game()
    restored.start_game()
    assert_same(game, restored, "started")
    assert set(restored.bots) == {"a", "c"}
    assert restored.bots["a"].difficulty == "hard"


def test_explicit_tile_order_preserved():
    order = [f"{c}{r}" for r in "ABCDEFGHI" for c in range(1, 13)]
    game = Game(seed=None, tile_order=order)
    for i in range(3):
        game.add_player(f"p{i}", f"P{i}")
    restored = restore(game)
    assert restored._tile_order == order
    game.start_game()
    restored.start_game()
    assert [str(t) for t in game.tile_bag] == [str(t) for t in restored.tile_bag]
    assert game.get_player("p0").hand == restored.get_player("p0").hand


def test_bots_share_game_rng_after_restore():
    game = make_game(8, 4)
    restored = restore(game)
    for bot in restored.bots.values():
        assert bot.rng is restored.rng
        assert bot.player is restored.get_player(bot.player.player_id)


def test_hand_order_and_bag_order_preserved():
    game = make_game(6, 5)
    ctx = new_ctx()
    for _ in range(40):
        step(game, ctx)
    restored = restore(game)
    for p in game.players:
        assert [str(t) for t in p.hand] == [
            str(t) for t in restored.get_player(p.player_id).hand
        ]
    assert [str(t) for t in game.tile_bag] == [str(t) for t in restored.tile_bag]
    assert game.rng.getstate() == restored.rng.getstate()


def test_pending_trades_roundtrip_with_order_and_ids():
    game = make_game(4, 3)
    ctx = new_ctx()
    for _ in range(400):
        step(game, ctx)
        if sum(sum(p.stocks.values()) for p in game.players) > 0:
            break
    holder = next(p for p in game.players if sum(p.stocks.values()) > 0)
    chain = next(c for c, k in holder.stocks.items() if k)
    other = next(p for p in game.players if p is not holder)
    ids = ["zzz", "aaa", "mmm"]
    for tid in ids:
        r = game.propose_trade(
            TradeOffer(holder.player_id, other.player_id, {chain: 1}, 0, {}, 50, tid)
        )
        assert r.success
    restored = restore(game)
    assert list(restored.pending_trades) == ids
    assert [t.to_dict() for t in restored.pending_trades.values()] == [
        t.to_dict() for t in game.pending_trades.values()
    ]
    acc = restored.accept_trade(other.player_id, "aaa")
    ref = game.accept_trade(other.player_id, "aaa")
    assert acc.to_dict() == ref.to_dict()
    assert_same(game, restored, "after accept")


def test_game_over_state_roundtrip():
    game = make_game(1, 3)
    ctx = new_ctx()
    while step(game, ctx) is not None:
        pass
    assert game.phase == GamePhase.GAME_OVER
    restored = restore(game)
    assert_same(game, restored, "game over")
    assert restored.phase == GamePhase.GAME_OVER


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


def _good_snapshot():
    game = make_game(2, 3)
    ctx = new_ctx()
    for _ in range(30):
        step(game, ctx)
    return to_snapshot(game)


def test_wrong_version_rejected():
    snap = _good_snapshot()
    snap["version"] = SNAPSHOT_VERSION + 1
    with pytest.raises(ValueError):
        from_snapshot(snap)
    del snap["version"]
    with pytest.raises(ValueError):
        from_snapshot(snap)


@pytest.mark.parametrize("bad", [None, [], "x", 3])
def test_non_dict_rejected(bad):
    with pytest.raises(ValueError):
        from_snapshot(bad)


def _mutations():
    def drop(key):
        def f(s):
            del s[key]

        return f

    return {
        **{f"drop-{k}": drop(k) for k in _good_snapshot() if k != "version"},
        "bad-phase": lambda s: s.update(phase="nonsense"),
        "bad-tile-in-hand": lambda s: s["players"][0]["hand"].__setitem__(0, "13Z"),
        "garbage-tile": lambda s: s["players"][0]["hand"].__setitem__(0, ""),
        "bad-tile-bag": lambda s: s.update(tile_bag=["0A"]),
        "bad-cell-state": lambda s: s["board"]["cells"].update(
            {"1A": {"state": "wat", "chain": None}}
        ),
        "bad-cell-chain": lambda s: s["board"]["cells"].update(
            {"1A": {"state": "in_chain", "chain": "Nope"}}
        ),
        "bad-active-chain": lambda s: s["hotel"].update(active_chains=["Nope"]),
        "missing-stock-chain": lambda s: s["players"][0]["stocks"].pop("Luxor"),
        "bad-index": lambda s: s.update(current_player_index=99),
        "bad-rng": lambda s: s.update(rng_state=[3, [1, 2], None]),
        "rng-garbage": lambda s: s.update(rng_state="x"),
        "bot-unknown-player": lambda s: s["bots"].update(
            ghost={"difficulty": "easy", "rng_shared": True}
        ),
        "bot-bad-difficulty": lambda s: s["bots"].update(
            p0={"difficulty": "impossible", "rng_shared": True}
        ),
        "bad-merger-chain": lambda s: s["merger"].update(survivor="Nope"),
        "bad-trade": lambda s: s.update(pending_trades=[{"key": "k"}]),
        "players-not-list": lambda s: s.update(players={}),
    }


@pytest.mark.parametrize("name", sorted(_mutations()))
def test_malformed_snapshot_raises_value_error(name):
    snap = roundtrip(_good_snapshot())
    _mutations()[name](snap)
    with pytest.raises(ValueError):
        from_snapshot(snap)


# ---------------------------------------------------------------------------
# Drift protection: fail loudly when engine state is not covered by snapshots
# ---------------------------------------------------------------------------


def test_snapshot_knows_every_game_attribute():
    unknown = set(vars(Game())) - HANDLED_GAME_ATTRS
    assert not unknown, (
        f"Game gained attributes {sorted(unknown)} that backend/game/snapshot.py "
        "does not serialise. Add them to to_snapshot/from_snapshot (and to "
        "HANDLED_GAME_ATTRS) so snapshots stay complete."
    )


def test_snapshot_knows_every_started_game_attribute():
    """Attributes created lazily after start_game must be covered too."""
    game = make_game(1, 3)
    ctx = new_ctx()
    while step(game, ctx) is not None:
        pass
    unknown = set(vars(game)) - HANDLED_GAME_ATTRS
    assert not unknown, f"Unhandled Game attributes after play: {sorted(unknown)}"


def test_snapshot_knows_every_substate_attribute():
    game = make_game(1, 3)
    assert set(vars(game.players[0])) <= HANDLED_PLAYER_ATTRS, (
        set(vars(game.players[0])) - HANDLED_PLAYER_ATTRS
    )
    assert set(vars(next(iter(game.bots.values())))) <= HANDLED_BOT_ATTRS
    assert set(vars(game.hotel)) <= HANDLED_HOTEL_ATTRS
    assert set(vars(game.board)) <= HANDLED_BOARD_ATTRS
    assert set(vars(MergerState())) <= HANDLED_MERGER_FIELDS
    # BoardCell/TradeOffer have their own (de)serialisers; check they are intact.
    cell = game.board.get_cell(1, "A")
    assert set(vars(cell)) == {"state", "chain"}
    assert cell.state == TileState.EMPTY
    assert set(TradeOffer("a", "b").to_dict()) == {
        "trade_id",
        "from_player_id",
        "to_player_id",
        "offering_stocks",
        "offering_money",
        "requesting_stocks",
        "requesting_money",
    }
    # classes referenced for completeness
    assert Hotel and Player and Bot


def test_events_and_buy_flag_roundtrip():
    game = make_game(3, 3)
    game.events.append({"type": "x", "n": 1, "nested": {"a": [1, 2], "t": None}})
    game.stocks_bought_this_turn = True
    restored = restore(game)
    assert restored.events == game.events
    assert restored.events is not game.events
    assert restored.stocks_bought_this_turn is True
