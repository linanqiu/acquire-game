"""Tests for the decision seam (game/decisions.py).

The centrepiece is a property-style full-game driver: random seats that only
ever build actions from ``legal_actions`` output must always be accepted, play
must terminate, illegal actions must be rejected without mutating state, and
money/stock must be conserved according to the event log.
"""

import json
import random

import pytest

from game.board import Tile
from game.calculator import build_calculator_pack
from game.decisions import (
    BUY_STOCKS,
    CHOOSE_DEFUNCT_ORDER,
    CHOOSE_SURVIVOR,
    FOUND_CHAIN,
    PLACE_TILE,
    STOCK_DISPOSITION,
    TRADE_RESPONSE,
    Decision,
    apply_action,
    legal_actions,
    pending_decisions,
    public_events,
    validate_action,
)
from game.game import Game, GamePhase
from game.hotel import Hotel
from game.player import Player
from tests.event_ledger import Ledger

ALL_CHAINS = Hotel().get_all_chain_names()
TOTAL_STOCK_PER_CHAIN = 25


# =============================================================================
# Helpers
# =============================================================================


def make_game(num_players=3, seed=1) -> Game:
    game = Game(seed=seed)
    for i in range(num_players):
        game.add_player(f"p{i + 1}", f"Player {i + 1}")
    game.start_game()
    return game


def set_hand(player: Player, tiles: list[str]):
    for t in player.hand:
        player.remove_tile(t)
    for s in tiles:
        player.add_tile(Tile.from_string(s))


def build_chain(game: Game, chain: str, tiles: list[str]):
    for s in tiles:
        t = Tile.from_string(s)
        game.board.place_tile(t)
        game.board.set_chain(t, chain)
    game.hotel.activate_chain(chain)


def give_stock(game: Game, player: Player, chain: str, n: int):
    game.hotel.buy_stock(chain, n)
    player.add_stocks(chain, n)


def fingerprint(game: Game):
    """Everything an action could mutate."""
    return json.dumps(
        {
            "board": game.board.get_state(),
            "hotel": (
                game.hotel.get_active_chains(),
                {
                    c: game.hotel.get_available_stocks(c)
                    for c in game.hotel.get_all_chain_names()
                },
            ),
            "players": [
                (p.player_id, p.money, p.stocks, sorted(str(t) for t in p.hand))
                for p in game.players
            ],
            "bag": [str(t) for t in game.tile_bag],
            "phase": game.phase.value,
            "current": game.current_player_index,
            "pending": repr(game.pending_action),
            "merger": repr(game._merger),
            "trades": [t.to_dict() for t in game.pending_trades.values()],
            "events": len(game.events),
            "bought": game.stocks_bought_this_turn,
        },
        sort_keys=True,
        default=str,
    )


# =============================================================================
# Random seat (only uses legal_actions output + public state)
# =============================================================================


def random_answer(
    rng: random.Random, decision: Decision, legal: dict, declare_prob: float = 0.3
) -> dict:
    kind = decision.kind
    types = legal["action_types"]

    if kind == PLACE_TILE:
        if "declare_end_game" in types and rng.random() < declare_prob:
            return {"action": "declare_end_game"}
        tile = rng.choice(legal["tiles"])["tile"]
        # Exercise tile-string normalisation now and then
        if rng.random() < 0.1:
            tile = f" {tile.lower()} "
        return {"action": "place_tile", "tile": tile}

    if kind == FOUND_CHAIN:
        return {"action": "found_chain", "chain": rng.choice(legal["chains"])}

    if kind == CHOOSE_SURVIVOR:
        return {
            "action": "merger_choice",
            "surviving_chain": rng.choice(legal["chains"]),
        }

    if kind == CHOOSE_DEFUNCT_ORDER:
        return {
            "action": "merger_order",
            "defunct_chain": rng.choice(legal["chains"]),
        }

    if kind == STOCK_DISPOSITION:
        count = legal["stock_count"]
        step = legal.get("trade_ratio", 2)
        trade = rng.choice(range(0, legal["max_trade"] + 1, step))
        sell = rng.randint(0, count - trade)
        return {
            "action": "merger_disposition",
            "defunct_chain": legal["defunct_chain"],
            "disposition": {"sell": sell, "trade": trade, "hold": count - trade - sell},
        }

    if kind == BUY_STOCKS:
        if "declare_end_game" in types and rng.random() < declare_prob:
            return {"action": "declare_end_game"}
        if "buy_stocks" in types and rng.random() < 0.85:
            money = legal["money"]
            purchases: dict[str, int] = {}
            for _ in range(rng.randint(0, legal["max_total"])):
                choices = [
                    o
                    for o in legal["options"]
                    if purchases.get(o["chain"], 0) < o["max_affordable"]
                    and o["price"] <= money
                ]
                if not choices:
                    break
                o = rng.choice(choices)
                purchases[o["chain"]] = purchases.get(o["chain"], 0) + 1
                money -= o["price"]
            return {"action": "buy_stocks", "purchases": purchases}
        return {"action": "end_turn"}

    if kind == TRADE_RESPONSE:
        trade_id = legal["trade"]["trade_id"]
        if legal["can_accept"] and rng.random() < 0.6:
            return {"action": "accept_trade", "trade_id": trade_id}
        return {"action": "reject_trade", "trade_id": trade_id}

    raise AssertionError(f"unknown decision kind {kind}")


def random_trade_proposal(rng: random.Random, game: Game) -> tuple[str, dict]:
    """A plausible trade built from public state (holdings, cash)."""
    public = game.get_public_state()
    players = public["players"]
    a, b = rng.sample(players, 2)

    def pick(holder):
        owned = [(c, n) for c, n in holder["stocks"].items() if n > 0]
        if owned and rng.random() < 0.7:
            c, n = rng.choice(owned)
            return {c: rng.randint(1, n)}, 0
        return {}, rng.randint(0, min(holder["money"], 1000)) // 100 * 100

    off_stocks, off_money = pick(a)
    req_stocks, req_money = pick(b)
    return a["player_id"], {
        "action": "propose_trade",
        "to_player_id": b["player_id"],
        "offering_stocks": off_stocks,
        "offering_money": off_money,
        "requesting_stocks": req_stocks,
        "requesting_money": req_money,
    }


def illegal_candidates(game: Game, decision: Decision) -> list[tuple[str, object]]:
    """Actions that are definitely illegal in the current state."""
    pid = decision.player_id
    player = game.get_player(pid)
    others = [p for p in game.players if p.player_id != pid]
    other = others[0]
    all_tiles = game.board.all_tiles()
    on_board = next((str(t) for t in all_tiles if game.board.is_tile_played(t)), None)
    not_in_hand = next(str(t) for t in all_tiles if t not in player.hand)
    spec = game.ruleset.board
    off_board = f"{spec.columns + 1}A"
    cands: list[tuple[str, object]] = [
        (pid, None),
        (pid, "place_tile"),
        (pid, []),
        (pid, {}),
        (pid, {"action": "fly"}),
        (pid, {"action": "place_tile", "tile": "13Z"}),
        (pid, {"action": "place_tile", "tile": off_board}),
        (pid, {"action": "place_tile", "tile": 5}),
        (pid, {"action": "place_tile"}),
        (pid, {"action": "place_tile", "tile": not_in_hand}),
        (pid, {"action": "found_chain", "chain": "Hilton"}),
        (pid, {"action": "found_chain", "chain": ["marlowe"]}),
        (pid, {"action": "buy_stocks", "purchases": {"marlowe": -1}}),
        (pid, {"action": "buy_stocks", "purchases": {"marlowe": True}}),
        (pid, {"action": "buy_stocks", "purchases": {"marlowe": 1.5}}),
        (pid, {"action": "buy_stocks", "purchases": "marlowe"}),
        (pid, {"action": "buy_stocks", "purchases": {"Hilton": 1}}),
        (pid, {"action": "merger_disposition", "defunct_chain": "sandpiper"}),
        (
            pid,
            {
                "action": "merger_disposition",
                "defunct_chain": "sandpiper",
                "disposition": {"sell": -1, "trade": 0, "hold": 0},
            },
        ),
        (pid, {"action": "accept_trade", "trade_id": "nope"}),
        (pid, {"action": "accept_trade", "trade_id": 7}),
        (pid, {"action": "reject_trade"}),
        (pid, {"action": "cancel_trade", "trade_id": "nope"}),
        (pid, {"action": "propose_trade", "to_player_id": pid, "offering_money": 100}),
        (pid, {"action": "propose_trade", "to_player_id": other.player_id}),
        (
            pid,
            {
                "action": "propose_trade",
                "to_player_id": other.player_id,
                "offering_money": -100,
            },
        ),
        (
            pid,
            {
                "action": "propose_trade",
                "to_player_id": other.player_id,
                "offering_money": player.money + 1,
            },
        ),
        ("ghost", {"action": "end_turn"}),
        (other.player_id, {"action": "end_turn"}),
    ]
    if on_board:
        cands.append((pid, {"action": "place_tile", "tile": on_board}))
    if not game.can_declare_end_game() or game.get_current_player() is not player:
        cands.append((pid, {"action": "declare_end_game"}))

    kind = decision.kind
    if kind == PLACE_TILE:
        cands += [
            (pid, {"action": "end_turn"}),
            (pid, {"action": "buy_stocks", "purchases": {}}),
            (pid, {"action": "found_chain", "chain": "marlowe"}),
        ]
        tiles = [t["tile"] for t in legal_actions(game, decision)["tiles"]]
        if tiles:
            cands.append((other.player_id, {"action": "place_tile", "tile": tiles[0]}))
    elif kind == FOUND_CHAIN:
        active = game.hotel.get_active_chains()
        if active:
            cands.append((pid, {"action": "found_chain", "chain": active[0]}))
        cands.append((pid, {"action": "end_turn"}))
        avail = decision.context["available_chains"]
        cands.append((other.player_id, {"action": "found_chain", "chain": avail[0]}))
    elif kind == CHOOSE_SURVIVOR:
        tied = decision.context["tied_chains"]
        non_tied = [c for c in game.ruleset.chain_ids if c not in tied]
        cands.append((pid, {"action": "merger_choice", "surviving_chain": non_tied[0]}))
        cands.append(
            (other.player_id, {"action": "merger_choice", "surviving_chain": tied[0]})
        )
    elif kind == CHOOSE_DEFUNCT_ORDER:
        tied = decision.context["tied_chains"]
        non_tied = [c for c in game.ruleset.chain_ids if c not in tied]
        cands.append((pid, {"action": "merger_order", "defunct_chain": non_tied[0]}))
        cands.append((pid, {"action": "merger_order"}))
        cands.append((pid, {"action": "merger_choice", "surviving_chain": tied[0]}))
        cands.append(
            (other.player_id, {"action": "merger_order", "defunct_chain": tied[0]})
        )
    elif kind == STOCK_DISPOSITION:
        ctx = decision.context
        count = ctx["stock_count"]
        good = {"sell": count, "trade": 0, "hold": 0}
        cands += [
            (
                pid,
                {
                    "action": "merger_disposition",
                    "defunct_chain": ctx["defunct_chain"],
                    "disposition": {"sell": count + 1, "trade": 0, "hold": 0},
                },
            ),
            (
                pid,
                {
                    "action": "merger_disposition",
                    "defunct_chain": ctx["surviving_chain"],
                    "disposition": good,
                },
            ),
            (
                other.player_id,
                {
                    "action": "merger_disposition",
                    "defunct_chain": ctx["defunct_chain"],
                    "disposition": good,
                },
            ),
            (pid, {"action": "end_turn"}),
        ]
        if count >= 1:
            cands.append(
                (
                    pid,
                    {
                        "action": "merger_disposition",
                        "defunct_chain": ctx["defunct_chain"],
                        "disposition": {"sell": count - 1, "trade": 1, "hold": 0},
                    },
                )
            )
    elif kind == BUY_STOCKS:
        legal = legal_actions(game, decision)
        if player.hand:
            cands.append((pid, {"action": "place_tile", "tile": str(player.hand[0])}))
        if game.stocks_bought_this_turn:
            cands.append((pid, {"action": "buy_stocks", "purchases": {}}))
        else:
            if legal["options"]:
                c = legal["options"][0]["chain"]
                over = game.ruleset.max_stock_purchases_per_turn + 1
                cands.append((pid, {"action": "buy_stocks", "purchases": {c: over}}))
            inactive = game.hotel.get_inactive_chains()
            if inactive:
                cands.append(
                    (pid, {"action": "buy_stocks", "purchases": {inactive[0]: 1}})
                )
            for o in legal["options"]:
                max_buy = game.ruleset.max_stock_purchases_per_turn
                if o["max_affordable"] < max_buy and o["available"] >= max_buy:
                    # Can't afford this many
                    cands.append(
                        (
                            pid,
                            {
                                "action": "buy_stocks",
                                "purchases": {o["chain"]: o["max_affordable"] + 1},
                            },
                        )
                    )
    return cands


def money_delta_from_events(events: list[dict]) -> int:
    """Net cash entering (+) or leaving (-) players according to events."""
    delta = 0
    for e in events:
        t = e["type"]
        if t == "stocks_purchased":
            delta -= e["total_cost"]
        elif t == "chain_founded" and e["founder_bonus_type"] == "cash":
            delta += e["founder_bonus_value"]
        elif t == "chain_founded":
            delta += e.get("founder_bonus_cash", 0)
        elif t == "bonuses_paid":
            delta += sum(b["majority"] + b["minority"] for b in e["bonuses"].values())
        elif t == "stock_disposition":
            delta += e["sale_proceeds"]
        elif t == "game_ended":
            delta += sum(e["final_sales"].values())
    return delta


def reconstruct_hand(game: Game, player_id: str) -> set[str]:
    """Rebuild a player's hand purely from the events they can see."""
    hand: set[str] = set()
    for e in public_events(game, player_id):
        if e["type"] == "tiles_dealt" and e["player_id"] == player_id:
            hand |= set(e["tiles"])
        elif e["type"] == "tile_drawn" and e["player_id"] == player_id:
            hand.add(e["tile"])
        elif e["type"] == "tile_placed" and e["player_id"] == player_id:
            hand.discard(e["tile"])
        elif e["type"] == "tiles_replaced" and e["player_id"] == player_id:
            hand -= set(e["removed_tiles"])
    return hand


def check_calculator_purity_and_leaks(game: Game):
    """``build_calculator_pack`` never mutates the game and never reveals other
    players' hands or the bag: for every viewer, no tile that sits in another
    hand or in the bag appears anywhere in the (JSON) pack."""
    import re

    for viewer in game.players:
        before = fingerprint(game)
        pack = build_calculator_pack(game, viewer.player_id)
        assert fingerprint(game) == before, "calculator mutated the game"
        text = json.dumps(pack)
        hidden = {str(t) for p in game.players if p is not viewer for t in p.hand}
        hidden |= {str(t) for t in game.tile_bag}
        hidden -= {str(t) for t in viewer.hand}  # your own tiles are yours to see
        hidden -= {c for c in game.board.get_state()["cells"]}  # public board
        for tile in hidden:
            assert not re.search(rf"(?<![0-9A-Z]){tile}(?![0-9A-Z])", text), (
                f"{viewer.player_id}'s pack mentions hidden tile {tile}"
            )


def check_invariants(game: Game):
    rs = game.ruleset
    if game.phase != GamePhase.GAME_OVER:
        for chain in rs.chain_ids:
            held = sum(p.get_stock_count(chain) for p in game.players)
            assert held + game.hotel.get_available_stocks(chain) == (
                rs.stocks_per_chain
            ), chain
    # Tiles are conserved: bag + hands + board + removed-from-game == area.
    if game.phase != GamePhase.LOBBY:
        removed = sum(
            len(e["removed_tiles"])
            for e in game.events
            if e["type"] == "tiles_replaced"
        )
        on_board = len(game.board.get_state()["cells"])
        in_hands = sum(p.hand_size for p in game.players)
        assert on_board + in_hands + len(game.tile_bag) + removed == rs.board.area
    for p in game.players:
        assert p.money >= 0


# =============================================================================
# The property test
# =============================================================================


class FuzzFailure(AssertionError):
    """A fuzzed game broke an invariant; the message names the seed and lists
    every action applied so far so the game can be replayed by hand."""


def run_random_game(
    seed: int,
    num_players: int,
    declare_prob: float = 0.3,
    max_steps: int = 20000,
    ruleset=None,
    calc_every: int = 0,
):
    """Random legal play to game over with all invariants checked.

    ``ruleset``: any ``game.ruleset.Ruleset`` (default: the default ruleset); every
    invariant uses the game's own ruleset. ``calc_every``: every N-th action
    the calculator pack is built for every player and checked for purity (the
    game is unchanged) and leaks (no other hand or bag tile appears in it);
    0 (default, it is the costly check) turns it off; the volume fuzz in
    ``test_fuzz_games.py`` uses 120. A failure is re-raised as ``FuzzFailure`` with the seed
    and the full action list.
    """
    log: list = []
    try:
        return _run_random_game(
            seed, num_players, declare_prob, max_steps, ruleset, calc_every, log
        )
    except FuzzFailure:
        raise
    except Exception as exc:
        rs = "default" if ruleset is None else ruleset.id
        text = json.dumps(log)
        raise FuzzFailure(
            f"{type(exc).__name__}: {exc}\n"
            f"seed={seed} players={num_players} declare_prob={declare_prob} "
            f"ruleset={rs} after {len(log)} actions; "
            f"actions (player_id, action): {text[:30000]}"
        ) from exc


def _run_random_game(
    seed, num_players, declare_prob, max_steps, ruleset, calc_every, log
):
    rng = random.Random(seed * 1000 + num_players)
    game = Game(seed=seed, ruleset=ruleset)
    for i in range(num_players):
        game.add_player(f"p{i + 1}", f"Player {i + 1}")
    game.start_game()

    money = sum(p.money for p in game.players)
    seen_events = len(game.events)
    stats = {"actions": 0, "illegal": 0, "trades_proposed": 0, "turns": 0}
    ledger = Ledger(game.ruleset)
    ledger.feed(game.events)
    ledger.check_against(game)

    def apply_checked(pid, action):
        nonlocal money, seen_events
        err = validate_action(game, pid, action)
        assert err is None, f"legal action rejected: {action} by {pid}: {err}"
        log.append((pid, action))
        result = apply_action(game, pid, action)
        assert result["success"], f"apply failed: {action} -> {result}"
        # every successful action leaves a trace in the event log
        assert len(game.events) > seen_events, f"no event for {action}"
        new_events = game.events[seen_events:]
        money += money_delta_from_events(new_events)
        seen_events = len(game.events)
        assert sum(p.money for p in game.players) == money, new_events
        check_invariants(game)
        # cash and holdings rebuilt from the events alone match the engine
        ledger.feed(game.events)
        ledger.check_against(game)
        stats["actions"] += 1
        if calc_every and stats["actions"] % calc_every == 0:
            check_calculator_purity_and_leaks(game)
        return result

    for _step in range(max_steps):
        decisions = pending_decisions(game)
        if not decisions:
            break
        assert game.phase != GamePhase.GAME_OVER
        for d in decisions:
            json.dumps(d.to_dict())
            json.dumps(legal_actions(game, d))
        flow = decisions[0]
        assert flow.kind != TRADE_RESPONSE
        assert all(d.kind == TRADE_RESPONSE for d in decisions[1:])
        legal = legal_actions(game, flow)
        if flow.kind == PLACE_TILE:
            assert legal["tiles"], "place_tile decision with no legal tiles"

        # Illegal actions must be rejected without mutation
        if rng.random() < 0.3:
            pid, bad = rng.choice(illegal_candidates(game, flow))
            before = fingerprint(game)
            assert validate_action(game, pid, bad) is not None, (pid, bad)
            result = apply_action(game, pid, bad)
            assert result["success"] is False and result["error"], result
            assert fingerprint(game) == before, (pid, bad)
            stats["illegal"] += 1

        # Out-of-turn trade traffic
        roll = rng.random()
        if roll < 0.08:
            pid, proposal = random_trade_proposal(rng, game)
            err = validate_action(game, pid, proposal)
            if err is None:
                apply_checked(pid, proposal)
                stats["trades_proposed"] += 1
            else:
                before = fingerprint(game)
                assert apply_action(game, pid, proposal)["success"] is False
                assert fingerprint(game) == before
            continue
        if roll < 0.12 and game.pending_trades:
            trade = rng.choice(list(game.pending_trades.values()))
            apply_checked(
                trade.from_player_id,
                {"action": "cancel_trade", "trade_id": trade.trade_id},
            )
            continue
        if roll < 0.3 and len(decisions) > 1:
            d = rng.choice(decisions[1:])
            apply_checked(
                d.player_id,
                random_answer(rng, d, legal_actions(game, d), declare_prob),
            )
            continue

        action = random_answer(rng, flow, legal, declare_prob)
        if action["action"] == "end_turn":
            stats["turns"] += 1
        apply_checked(flow.player_id, action)
    else:
        pytest.fail(f"game did not terminate in {max_steps} steps")

    assert game.phase == GamePhase.GAME_OVER
    assert pending_decisions(game) == []
    assert game.events[-1]["type"] == "game_ended"

    # Final standings and the turn sequence follow from the events alone
    ended = game.events[-1]
    assert ledger.final == [
        {"player_id": s["player_id"], "money": s["money"], "rank": s["rank"]}
        for s in ended["standings"]
    ]
    top = [s["player_id"] for s in ledger.final if s["rank"] == 1]
    assert ended["winners"] == top and ended["winner"] == top[0]
    ledger.check_turn_sequence(game)
    assert len(ledger.turns) == sum(1 for e in game.events if e["type"] == "turn_ended")

    # Event log integrity
    assert [e["seq"] for e in game.events] == list(range(len(game.events)))
    json.dumps(game.events)
    for viewer in [None] + [p.player_id for p in game.players]:
        for e in public_events(game, viewer):
            assert e["private_to"] in (None, viewer)
    # No public event mentions a tile still hidden in someone's hand
    hidden = {str(t) for p in game.players for t in p.hand}
    for e in public_events(game, None):
        for v in e.values():
            if isinstance(v, str):
                assert v not in hidden, e
            elif isinstance(v, list):
                assert not (set(map(str, v)) & hidden), e
    # Each player's hand is reconstructible from what they can see
    for p in game.players:
        assert reconstruct_hand(game, p.player_id) == {str(t) for t in p.hand}

    return game, stats


@pytest.mark.parametrize("num_players", [3, 4, 5, 6])
@pytest.mark.parametrize("seed", [1, 2, 3, 7, 42])
def test_random_full_game_property(seed, num_players):
    _game, stats = run_random_game(seed, num_players)
    assert stats["actions"] > 20
    assert stats["illegal"] > 0


@pytest.mark.parametrize("num_players", [3, 6])
@pytest.mark.parametrize("seed", [5, 11, 13])
def test_random_game_played_to_exhaustion(seed, num_players):
    """Nobody ever declares: play runs until the tiles run out."""
    game, _stats = run_random_game(seed, num_players, declare_prob=0.0)
    assert game.events[-1]["reason"] == "no_playable_tiles"
    assert not game.tile_bag


def test_random_games_cover_every_decision_kind():
    """Across a batch of games, every decision kind and key event occurs."""
    kinds = set()
    event_types = set()
    for seed in range(8):
        game, _ = run_random_game(seed + 100, 3 + seed % 4)
        event_types |= {e["type"] for e in game.events}
        kinds |= {
            {
                "tile_placed": PLACE_TILE,
                "chain_founded": FOUND_CHAIN,
                "survivor_chosen": CHOOSE_SURVIVOR,
                "stock_disposition": STOCK_DISPOSITION,
                "stocks_purchased": BUY_STOCKS,
                "trade_accepted": TRADE_RESPONSE,
            }[t]
            for t in event_types
            if t
            in (
                "tile_placed",
                "chain_founded",
                "survivor_chosen",
                "stock_disposition",
                "stocks_purchased",
                "trade_accepted",
            )
        }
    assert kinds == {
        PLACE_TILE,
        FOUND_CHAIN,
        CHOOSE_SURVIVOR,
        STOCK_DISPOSITION,
        BUY_STOCKS,
        TRADE_RESPONSE,
    }
    # The merger-order choice needs three chains on one tile with two defunct
    # chains of one size: rarer, so a seed known to reach it.
    game, _ = run_random_game(1391, 6, declare_prob=0.25)
    chosen = [e for e in game.events if e["type"] == "defunct_order_chosen"]
    assert chosen and all(e["chain"] in e["tied_chains"] for e in chosen)
    for t in (
        "game_started",
        "tiles_dealt",
        "chain_expanded",
        "merger_started",
        "bonuses_paid",
        "merger_completed",
        "turn_ended",
        "tile_drawn",
        "trade_proposed",
        "trade_rejected",
        "trade_cancelled",
        "game_ended",
    ):
        assert t in event_types, t


# =============================================================================
# pending_decisions / legal_actions
# =============================================================================


class TestPendingDecisions:
    def test_lobby_has_no_decisions(self):
        game = Game(seed=1)
        game.add_player("p1", "A")
        assert pending_decisions(game) == []

    def test_game_over_has_no_decisions(self):
        game = make_game()
        game.end_game()
        assert pending_decisions(game) == []

    def test_start_is_place_tile_for_first_player(self):
        game = make_game()
        decisions = pending_decisions(game)
        assert len(decisions) == 1
        assert decisions[0].kind == PLACE_TILE
        assert decisions[0].player_id == "p1"
        # Context is public: never contains the hand
        assert "hand" not in decisions[0].context

    def test_place_tile_legal_lists_playable_hand_tiles(self):
        game = make_game()
        p1 = game.get_player("p1")
        build_chain(game, "marlowe", ["1A", "2A"])
        game.board.place_tile(Tile.from_string("5E"))
        set_hand(p1, ["3A", "6E", "9I", "1B", "12A", "4D"])
        legal = legal_actions(game, pending_decisions(game)[0])
        assert legal["action_types"] == ["place_tile"]
        by_tile = {t["tile"]: t for t in legal["tiles"]}
        assert by_tile["3A"] == {
            "tile": "3A",
            "outcome": "expand",
            "chains": ["marlowe"],
        }
        assert by_tile["1B"]["outcome"] == "expand"
        assert by_tile["6E"] == {"tile": "6E", "outcome": "found", "chains": []}
        assert by_tile["9I"]["outcome"] == "nothing"
        assert len(by_tile) == 6

    def test_place_tile_merge_outcome(self):
        game = make_game()
        build_chain(game, "marlowe", ["1A", "2A"])
        build_chain(game, "sandpiper", ["4A", "5A", "6A"])
        set_hand(game.get_player("p1"), ["3A"])
        legal = legal_actions(game, pending_decisions(game)[0])
        assert legal["tiles"][0]["outcome"] == "merge"
        assert sorted(legal["tiles"][0]["chains"]) == ["marlowe", "sandpiper"]

    def test_found_chain_decision(self):
        game = make_game()
        game.board.place_tile(Tile.from_string("1A"))
        set_hand(game.get_player("p1"), ["2A"])
        assert apply_action(game, "p1", {"action": "place_tile", "tile": "2A"})[
            "success"
        ]
        d = pending_decisions(game)[0]
        assert d.kind == FOUND_CHAIN
        assert d.context["tile"] == "2A"
        legal = legal_actions(game, d)
        assert legal["action_types"] == ["found_chain"]
        assert sorted(legal["chains"]) == sorted(ALL_CHAINS)

    def test_choose_survivor_and_disposition_decisions(self):
        game = make_game()
        p1, p2, p3 = game.players
        build_chain(game, "marlowe", ["1A", "2A"])
        build_chain(game, "sandpiper", ["4A", "5A"])
        give_stock(game, p2, "marlowe", 3)
        give_stock(game, p3, "marlowe", 1)
        set_hand(p1, ["3A"])
        apply_action(game, "p1", {"action": "place_tile", "tile": "3A"})
        d = pending_decisions(game)[0]
        assert d.kind == CHOOSE_SURVIVOR
        assert sorted(d.context["tied_chains"]) == ["marlowe", "sandpiper"]
        assert legal_actions(game, d) == {
            "action_types": ["merger_choice"],
            "chains": d.context["tied_chains"],
        }
        assert apply_action(
            game, "p1", {"action": "merger_choice", "surviving_chain": "sandpiper"}
        )["success"]
        d = pending_decisions(game)[0]
        assert d.kind == STOCK_DISPOSITION
        assert d.player_id == "p2"
        legal = legal_actions(game, d)
        assert legal == {
            "action_types": ["merger_disposition"],
            "defunct_chain": "marlowe",
            "surviving_chain": "sandpiper",
            "stock_count": 3,
            "max_trade": 2,
            "rule": "sell+trade+hold == stock_count",
        }

    def test_max_trade_limited_by_survivor_stock(self):
        game = make_game()
        p1, p2, _ = game.players
        build_chain(game, "marlowe", ["1A", "2A"])
        build_chain(game, "sandpiper", ["4A", "5A", "6A"])
        give_stock(game, p2, "marlowe", 10)
        give_stock(game, p1, "sandpiper", 24)  # only 1 sandpiper left in bank
        set_hand(p1, ["3A"])
        apply_action(game, "p1", {"action": "place_tile", "tile": "3A"})
        d = pending_decisions(game)[0]
        assert d.kind == STOCK_DISPOSITION and d.player_id == "p2"
        assert legal_actions(game, d)["max_trade"] == 2

    def test_buy_stocks_legal_before_and_after_buying(self):
        game = make_game()
        build_chain(game, "marlowe", ["1A", "2A"])
        p1 = game.get_player("p1")
        set_hand(p1, ["9I"])
        apply_action(game, "p1", {"action": "place_tile", "tile": "9I"})
        d = pending_decisions(game)[0]
        assert d.kind == BUY_STOCKS
        legal = legal_actions(game, d)
        assert legal["action_types"] == ["buy_stocks", "end_turn", "propose_trade"]
        assert legal["max_total"] == 3
        assert legal["money"] == 6000
        assert legal["options"] == [
            {"chain": "marlowe", "price": 200, "available": 25, "max_affordable": 3}
        ]
        assert apply_action(
            game, "p1", {"action": "buy_stocks", "purchases": {"marlowe": 2}}
        )["success"]
        d = pending_decisions(game)[0]
        assert d.kind == BUY_STOCKS and d.context["stocks_bought_this_turn"]
        legal = legal_actions(game, d)
        assert "buy_stocks" not in legal["action_types"]
        assert legal["options"] == []
        assert legal["max_total"] == 0

    def test_max_affordable_limited_by_money(self):
        game = make_game()
        build_chain(game, "marlowe", ["1A", "2A"])
        p1 = game.get_player("p1")
        p1.remove_money(p1.money - 450)
        game.phase = GamePhase.BUYING_STOCKS
        legal = legal_actions(game, pending_decisions(game)[0])
        assert legal["options"][0]["max_affordable"] == 2

    def test_declare_end_game_offered_when_possible(self):
        game = make_game()
        build_chain(game, "marlowe", [f"{c}A" for c in range(1, 12)])
        set_hand(game.get_player("p1"), ["9I"])
        legal = legal_actions(game, pending_decisions(game)[0])
        assert "declare_end_game" in legal["action_types"]
        result = apply_action(game, "p1", {"action": "declare_end_game"})
        assert result["success"] and result["declared_by"] == "p1"
        assert game.phase == GamePhase.GAME_OVER

    def test_trade_response_decisions_follow_flow_decision(self):
        game = make_game()
        r = apply_action(
            game,
            "p2",
            {"action": "propose_trade", "to_player_id": "p3", "offering_money": 100},
        )
        assert r["success"]
        decisions = pending_decisions(game)
        assert [d.kind for d in decisions] == [PLACE_TILE, TRADE_RESPONSE]
        assert decisions[1].player_id == "p3"
        legal = legal_actions(game, decisions[1])
        assert legal["action_types"] == ["accept_trade", "reject_trade"]
        assert legal["can_accept"] is True
        assert legal["trade"]["trade_id"] == r["trade_id"]
        # p2 spends the money elsewhere -> trade can no longer be accepted
        game.get_player("p2").remove_money(game.get_player("p2").money)
        assert legal_actions(game, decisions[1])["can_accept"] is False
        before = fingerprint(game)
        result = apply_action(
            game, "p3", {"action": "accept_trade", "trade_id": r["trade_id"]}
        )
        assert not result["success"] and "no longer valid" in result["error"]
        assert fingerprint(game) == before
        assert apply_action(
            game, "p3", {"action": "reject_trade", "trade_id": r["trade_id"]}
        )["success"]
        assert len(pending_decisions(game)) == 1


# =============================================================================
# apply_action translation and robustness
# =============================================================================


class TestApplyAction:
    def test_tile_string_is_normalised(self):
        game = make_game()
        p1 = game.get_player("p1")
        set_hand(p1, ["12I"])
        assert apply_action(game, "p1", {"action": "place_tile", "tile": " 12i "})[
            "success"
        ]
        assert game.board.is_tile_played(Tile(12, "I"))

    def test_purchases_dict_is_expanded(self):
        game = make_game()
        build_chain(game, "marlowe", ["1A", "2A"])
        build_chain(game, "sandpiper", ["4A", "5A"])
        game.phase = GamePhase.BUYING_STOCKS
        r = apply_action(
            game,
            "p1",
            {
                "action": "buy_stocks",
                "purchases": {"marlowe": 2, "sandpiper": 1, "halcyon": 0},
            },
        )
        assert r["success"], r
        assert r["total_cost"] == 600
        p1 = game.get_player("p1")
        assert (
            p1.get_stock_count("marlowe") == 2 and p1.get_stock_count("sandpiper") == 1
        )
        # Turn not over until end_turn
        assert game.phase == GamePhase.BUYING_STOCKS
        assert apply_action(game, "p1", {"action": "end_turn"})["success"]
        assert game.get_current_player_id() == "p2"

    def test_empty_purchase_counts_as_buying(self):
        game = make_game()
        game.phase = GamePhase.BUYING_STOCKS
        assert apply_action(game, "p1", {"action": "buy_stocks", "purchases": {}})[
            "success"
        ]
        r = apply_action(game, "p1", {"action": "buy_stocks", "purchases": {}})
        assert not r["success"] and "already" in r["error"]

    @pytest.mark.parametrize("hold_key", ["hold", "keep"])
    def test_disposition_hold_maps_to_keep(self, hold_key):
        game = make_game()
        p1, p2, _ = game.players
        build_chain(game, "marlowe", ["1A", "2A"])
        build_chain(game, "sandpiper", ["4A", "5A", "6A"])
        give_stock(game, p2, "marlowe", 5)
        set_hand(p1, ["3A"])
        apply_action(game, "p1", {"action": "place_tile", "tile": "3A"})
        r = apply_action(
            game,
            "p2",
            {
                "action": "merger_disposition",
                "defunct_chain": "marlowe",
                "disposition": {"sell": 1, "trade": 2, hold_key: 2},
            },
        )
        assert r["success"], r
        assert (r["sold"], r["traded"], r["kept"]) == (1, 2, 2)
        assert p2.get_stock_count("marlowe") == 2
        assert p2.get_stock_count("sandpiper") == 1
        assert game.phase == GamePhase.BUYING_STOCKS

    def test_disposition_for_wrong_defunct_chain_rejected(self):
        game = make_game()
        p1, p2, _ = game.players
        build_chain(game, "marlowe", ["1A", "2A"])
        build_chain(game, "sandpiper", ["4A", "5A", "6A"])
        give_stock(game, p2, "marlowe", 2)
        set_hand(p1, ["3A"])
        apply_action(game, "p1", {"action": "place_tile", "tile": "3A"})
        r = apply_action(
            game,
            "p2",
            {
                "action": "merger_disposition",
                "defunct_chain": "sandpiper",
                "disposition": {"sell": 2},
            },
        )
        assert not r["success"]

    def test_propose_trade_builds_offer(self):
        game = make_game()
        give_stock(game, game.get_player("p1"), "marlowe", 2)
        game.hotel.activate_chain("marlowe")
        r = apply_action(
            game,
            "p1",
            {
                "action": "propose_trade",
                "to_player_id": "p2",
                "offering_stocks": {"marlowe": 2},
                "requesting_money": 500,
            },
        )
        assert r["success"], r
        trade = game.pending_trades[r["trade_id"]]
        assert trade.from_player_id == "p1" and trade.to_player_id == "p2"
        assert trade.offering_stocks == {"marlowe": 2}
        assert trade.requesting_money == 500
        assert apply_action(
            game, "p2", {"action": "accept_trade", "trade_id": r["trade_id"]}
        )["success"]
        assert game.get_player("p2").get_stock_count("marlowe") == 2
        assert game.get_player("p1").money == 6500

    def test_cancel_trade_only_by_proposer(self):
        game = make_game()
        r = apply_action(
            game,
            "p1",
            {"action": "propose_trade", "to_player_id": "p2", "offering_money": 100},
        )
        cancel = {"action": "cancel_trade", "trade_id": r["trade_id"]}
        assert not apply_action(game, "p2", cancel)["success"]
        assert apply_action(game, "p1", cancel)["success"]
        assert not game.pending_trades

    @pytest.mark.parametrize(
        "action",
        [
            None,
            42,
            "end_turn",
            [],
            {},
            {"action": None},
            {"action": "place_tile", "tile": None},
            {"action": "place_tile", "tile": ""},
            {"action": "place_tile", "tile": "0A"},
            {"action": "place_tile", "tile": "13A"},
            {"action": "place_tile", "tile": "1J"},
            {"action": "place_tile", "tile": {"x": 1}},
            {"action": "found_chain", "chain": {}},
            {"action": "merger_choice"},
            {"action": "merger_disposition", "disposition": {"sell": "1"}},
            {"action": "buy_stocks", "purchases": [1, 2]},
            {"action": "buy_stocks", "purchases": {("x",): 1}},
            {"action": "propose_trade", "to_player_id": 5},
            {"action": "propose_trade", "to_player_id": "p2", "offering_stocks": [1]},
            {"action": "propose_trade", "to_player_id": "p2", "offering_money": "9"},
            {"action": "accept_trade", "trade_id": ["x"]},
        ],
    )
    def test_malformed_input_never_raises(self, action):
        game = make_game()
        before = fingerprint(game)
        for pid in ("p1", "p2", "ghost", None):
            assert validate_action(game, pid, action) is not None
            r = apply_action(game, pid, action)
            assert r["success"] is False and r["error"]
        assert fingerprint(game) == before

    def test_lobby_and_game_over_reject_actions(self):
        game = Game(seed=1)
        game.add_player("p1", "A")
        assert not apply_action(game, "p1", {"action": "end_turn"})["success"]
        game = make_game()
        game.end_game()
        assert not apply_action(
            game,
            "p1",
            {"action": "propose_trade", "to_player_id": "p2", "offering_money": 1},
        )["success"]


# =============================================================================
# No-playable-tile handling
# =============================================================================


def _all_seven_chains_with_dead_tile(game: Game) -> str:
    """Activate all 7 chains; return a tile that would found an 8th chain."""
    spots = [("A", 1), ("A", 4), ("A", 7), ("C", 1), ("C", 4), ("C", 7), ("E", 1)]
    for chain, (row, col) in zip(ALL_CHAINS, spots):
        build_chain(game, chain, [f"{col}{row}", f"{col + 1}{row}"])
    # Lone tile at 10I; 11I would found an 8th chain
    game.board.place_tile(Tile.from_string("10I"))
    return "11I"


class TestNoPlayableTile:
    def test_all_unplayable_hand_is_replaced(self):
        game = make_game(seed=5)
        _p1, p2, _ = game.players
        dead = _all_seven_chains_with_dead_tile(game)
        game.phase = GamePhase.BUYING_STOCKS
        set_hand(p2, [dead])
        game.tile_bag.append(Tile.from_string("12A"))  # drawn by p1 at end_turn
        game.tile_bag.insert(0, Tile.from_string("9E"))
        assert apply_action(game, "p1", {"action": "end_turn"})["success"]
        # p2's dead hand was replaced and p2 can now place a tile
        assert dead not in [str(t) for t in p2.hand]
        assert game.phase == GamePhase.PLAYING
        d = pending_decisions(game)[0]
        assert d.kind == PLACE_TILE and d.player_id == "p2"
        assert legal_actions(game, d)["tiles"]
        replaced = [e for e in game.events if e["type"] == "tiles_replaced"]
        assert replaced[-1]["removed_tiles"] == [dead]
        assert replaced[-1]["reason"] == "all_unplayable"

    def test_skip_to_buy_when_still_unplayable(self):
        game = make_game(seed=5)
        p1, p2, _ = game.players
        dead = _all_seven_chains_with_dead_tile(game)
        game.phase = GamePhase.BUYING_STOCKS
        game.tile_bag.clear()
        set_hand(p1, ["12A"])  # someone still has a playable tile
        set_hand(p2, [dead])
        assert apply_action(game, "p1", {"action": "end_turn"})["success"]
        assert game.get_current_player_id() == "p2"
        assert game.phase == GamePhase.BUYING_STOCKS
        assert pending_decisions(game)[0].kind == BUY_STOCKS
        assert game.events[-1]["type"] == "tile_placement_skipped"

    def test_replacements_also_dead_skip_placement_and_the_hand_stays_full(self):
        """The fresh tiles are dead too and the bag is not empty: placement is
        skipped; ending the turn does not draw past a full hand."""
        game = make_game(seed=5)
        _p1, p2, _ = game.players
        _all_seven_chains_with_dead_tile(game)  # lone 10I
        for lone in ("2G", "2I", "6G", "10G"):
            game.board.place_tile(Tile.from_string(lone))
        # each of these touches a lone tile and would found an eighth chain
        dead = ["5G", "7G", "6H", "6F", "9G", "11G", "10H", "9I", "11I", "1I"]
        dead += ["3I", "1G", "3G"]
        game.phase = GamePhase.BUYING_STOCKS
        set_hand(p2, dead[:6])
        # drawn from the end: six dead replacements, then 3G and 12A remain
        game.tile_bag = [Tile.from_string(s) for s in ["12A"] + dead[12:5:-1]]
        assert apply_action(game, "p1", {"action": "end_turn"})["success"]
        assert game.get_current_player_id() == "p2"
        assert game.events[-1]["type"] == "tile_placement_skipped"
        assert p2.hand_size == 6 and len(game.tile_bag) == 2
        assert apply_action(game, "p2", {"action": "end_turn"})["success"]
        assert p2.hand_size == 6 and len(game.tile_bag) == 2

    def test_frozen_board_ends_game(self):
        game = make_game(seed=5)
        p1, p2, p3 = game.players
        dead = _all_seven_chains_with_dead_tile(game)
        game.phase = GamePhase.BUYING_STOCKS
        game.tile_bag.clear()
        set_hand(p1, [])
        set_hand(p2, [dead])
        set_hand(p3, [])
        assert apply_action(game, "p1", {"action": "end_turn"})["success"]
        assert game.phase == GamePhase.GAME_OVER
        assert game.events[-1]["type"] == "game_ended"
        assert game.events[-1]["reason"] == "no_playable_tiles"
        assert pending_decisions(game) == []

    def test_resolve_is_noop_when_playable(self):
        game = make_game()
        before = fingerprint(game)
        assert game.resolve_unplayable_turn() is None
        assert fingerprint(game) == before


# =============================================================================
# The fuzz checks themselves must be able to fail
# =============================================================================


def test_calculator_is_pure_and_leak_free_over_a_fuzzed_game():
    """Every 15th action of a whole game (the volume run does this for 600)."""
    game, stats = run_random_game(8, 4, calc_every=15)
    assert stats["actions"] > 60 and game.phase == GamePhase.GAME_OVER


def test_calculator_checks_catch_a_leak_and_a_mutation(monkeypatch):
    g = make_game(4, seed=9)
    check_calculator_purity_and_leaks(g)  # the real calculator is clean
    other_tile = str(g.players[1].hand[0])

    real = build_calculator_pack

    def leaky(game, viewer_id):
        pack = real(game, viewer_id)
        pack["debug"] = {"next": other_tile}
        return pack

    monkeypatch.setattr("tests.test_decisions.build_calculator_pack", leaky)
    with pytest.raises(AssertionError, match="hidden tile"):
        check_calculator_purity_and_leaks(g)

    def mutating(game, viewer_id):
        game.players[0].add_money(1)
        return real(game, viewer_id)

    monkeypatch.setattr("tests.test_decisions.build_calculator_pack", mutating)
    with pytest.raises(AssertionError, match="mutated"):
        check_calculator_purity_and_leaks(g)


def test_ledger_reconstructs_final_standings_from_events_only():
    game, _ = run_random_game(21, 4, calc_every=0)
    ledger = Ledger(game.ruleset)
    ledger.feed(game.events)  # nothing but the events
    assert ledger.final == [
        {"player_id": s["player_id"], "money": s["money"], "rank": s["rank"]}
        for s in game.events[-1]["standings"]
    ]
    ledger.check_against(game)
    # tampering with one event breaks the reconciliation
    broken = Ledger(game.ruleset)
    events = [dict(e) for e in game.events]
    for e in events:
        if e["type"] == "stocks_purchased":
            e["total_cost"] += 100
            break
    broken.feed(events)
    with pytest.raises(AssertionError):
        broken.check_against(game)
