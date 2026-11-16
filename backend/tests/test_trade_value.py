"""Tier 1: the position-aware trade valuation and the rules-based seat's
answers to trade offers (docs/ai/bot-trading.md).

Every position is reached by real play: scripted turns through
``apply_action`` (``tests.support.table.Table``) or games played by the
rules-based seat. Offers are proposed and answered through ``apply_action``
too, the way every seat does it.
"""

from __future__ import annotations

import json
import random

import pytest

from agents.base import build_context
from agents.heuristic import HeuristicAgent
from game.calculator import build_calculator_pack
from game.decisions import TRADE_RESPONSE, apply_action, pending_decisions
from game.game import GamePhase
from game.ruleset import default_ruleset
from game.trade_value import (
    BONUS_WEIGHT_SAFE_MAX,
    BONUS_WEIGHT_SAFE_MIN,
    BONUS_WEIGHT_UNSAFE,
    INACTIVE_SHARE_FACTOR,
    MARGIN,
    MARGIN_AHEAD,
    SCARCE_PREMIUM,
    bonus_weight,
    game_progress,
    share_unit_value,
    trade_valuation,
)
from tests.support.drive import HeuristicTable, bot_game
from tests.support.table import Table, grow_two_chains

RS = default_ruleset()
A = RS.chain_ids[0]  # cheapest tier
Z = RS.chain_ids[-1]  # dearest tier


def small_table() -> Table:
    """Three players, two young chains (neither safe).

    A (2 tiles): p2 holds 3 (sole majority), p1 2 (sole minority), p3 1 (no
    bonus position). Z (2 tiles): p3 holds 2 (only holder: both bonuses).
    p1 is on turn, at the tile step.
    """
    t = Table([["1A", "5E"], ["2A"], ["8H", "9H"]])
    t.turn("1A")
    t.turn("2A", found=A, buy={A: 2})
    t.turn("8H")
    t.turn("5E", buy={A: 2})
    t.pass_turn()
    t.turn("9H", found=Z, buy={Z: 1, A: 1})
    assert [t.shares(p, A) for p in ("p1", "p2", "p3")] == [2, 3, 1]
    assert [t.shares(p, Z) for p in ("p1", "p2", "p3")] == [0, 0, 2]
    assert t.current == "p1"
    return t


def offer(frm: str, to: str, give=None, give_cash=0, want=None, want_cash=0) -> dict:
    return {
        "action": "propose_trade",
        "from_player_id": frm,
        "to_player_id": to,
        "offering_stocks": dict(give or {}),
        "offering_money": give_cash,
        "requesting_stocks": dict(want or {}),
        "requesting_money": want_cash,
    }


def bot_answer(game, frm: str, proposal: dict) -> tuple[str, dict]:
    """Propose through apply_action, let the rules-based seat answer its
    trade_response decision through apply_action; returns (verb, valuation)."""
    result = apply_action(game, frm, proposal)
    assert result["success"], result
    trade_id = result["trade_id"]
    decision = next(
        d
        for d in pending_decisions(game)
        if d.kind == TRADE_RESPONSE and d.context["trade"]["trade_id"] == trade_id
    )
    ctx = build_context(game, decision)
    value = ctx.calc["trades"][trade_id]
    action = HeuristicAgent(name=decision.player_id).choose(ctx)
    assert action["trade_id"] == trade_id
    done = apply_action(game, decision.player_id, action)
    assert done["success"], done
    assert trade_id not in game.pending_trades
    return action["action"], value


def bonuses(game, chain: str) -> tuple[int, int]:
    size = game.board.get_chain_size(chain)
    return (
        game.hotel.get_majority_bonus(chain, size),
        game.hotel.get_minority_bonus(chain, size),
    )


def price(game, chain: str) -> int:
    return game.hotel.get_stock_price(chain, game.board.get_chain_size(chain))


# --------------------------------------------------------------------------
# The valuation
# --------------------------------------------------------------------------


def test_selling_the_majority_costs_the_bonus_not_the_list_price():
    t = small_table()
    g = t.game
    maj, mino = bonuses(g, A)
    p = price(g, A)
    v = trade_valuation(g, offer("p1", "p2", give_cash=2 * p, want={A: 2}), "p2")
    assert v["valid"] and v["list"] == {"give": 2 * p, "get": 2 * p, "net": 0}
    # p2: 3 -> 1 share: sole majority becomes a tied minority with p3.
    # p1: 2 -> 4 shares: sole majority.
    assert v["rank_changes"] == [
        {
            "chain": A,
            "player_id": "p2",
            "before": "majority_sole",
            "after": "minority_tied",
        },
        {
            "chain": A,
            "player_id": "p1",
            "before": "minority_sole",
            "after": "majority_sole",
        },
    ]
    lost = maj - RS.round_split(mino / 2)
    assert v["viewer"] == {
        "cash_change": 2 * p,
        "share_value_change": -2 * p,
        "bonus_change_now": -lost,
        "bonus_change": -round(lost * BONUS_WEIGHT_UNSAFE),
        "change": -round(lost * BONUS_WEIGHT_UNSAFE),
    }
    assert v["counterparty"]["bonus_change_now"] == maj - mino
    assert v["counterparty"]["change"] == round((maj - mino) * BONUS_WEIGHT_UNSAFE)
    assert v["chains"][A] == {
        "active": True,
        "safe": False,
        "bonus_weight": BONUS_WEIGHT_UNSAFE,
        "share_unit_value": p,
    }
    assert v["adjusted_gain"] < 0 and not v["acceptable"]


def test_both_views_of_a_trade_agree_and_the_dict_is_plain():
    g = small_table().game
    proposal = offer("p1", "p3", give={A: 1}, want={Z: 1})
    mine = trade_valuation(g, proposal, "p3")
    theirs = trade_valuation(g, proposal, "p1")
    assert mine["viewer"] == theirs["counterparty"]
    assert mine["counterparty"] == theirs["viewer"]
    assert mine["list"]["give"] == theirs["list"]["get"]
    assert json.loads(json.dumps(mine)) == mine  # ready to send to clients
    assert trade_valuation(g, proposal, "p3") == mine  # deterministic
    with pytest.raises(ValueError):
        trade_valuation(g, proposal, "p2")


def test_valuation_does_not_change_the_game():
    g = small_table().game
    before = json.dumps(g.get_public_state(), sort_keys=True, default=str)
    trade_valuation(g, offer("p1", "p2", give_cash=400, want={A: 2}), "p2")
    assert json.dumps(g.get_public_state(), sort_keys=True, default=str) == before
    assert g.pending_trades == {}


def test_invalid_trade_is_reported_and_never_acceptable():
    g = small_table().game
    v = trade_valuation(g, offer("p1", "p2", give_cash=99_999, want={A: 1}), "p2")
    assert v["valid"] is False and v["error"] and v["acceptable"] is False
    assert "viewer" not in v


def test_bonus_weight_safe_chain_rises_with_progress():
    t, _, _ = grow_two_chains(RS, RS.safe_chain_size, 3)
    g = t.game
    big, small = RS.chain_ids[0], RS.chain_ids[1]
    progress = game_progress(g)
    played = sum(1 for x in g.board.all_tiles() if g.board.is_tile_played(x))
    assert progress == played / len(g.board.all_tiles()) and 0 < progress < 1
    assert bonus_weight(g, small) == BONUS_WEIGHT_UNSAFE
    safe = bonus_weight(g, big)
    assert safe == round(
        BONUS_WEIGHT_SAFE_MIN
        + (BONUS_WEIGHT_SAFE_MAX - BONUS_WEIGHT_SAFE_MIN) * progress,
        3,
    )
    assert BONUS_WEIGHT_SAFE_MIN < safe < BONUS_WEIGHT_UNSAFE
    assert bonus_weight(g, big, progress=1.0) == BONUS_WEIGHT_SAFE_MAX
    assert bonus_weight(g, RS.chain_ids[2]) == 0.0  # not on the board


def _play_until(seed: int, wanted, max_turns: int = 200):
    """A game played by the rules-based seat until ``wanted(game)`` returns
    something truthy; returns (game, that value)."""
    g = bot_game(3, seed)
    table = HeuristicTable(g, seed=seed)
    for _ in range(max_turns):
        table.play_turn()
        assert g.phase != GamePhase.GAME_OVER, "state never reached"
        found = wanted(g)
        if found:
            return g, found
    raise AssertionError("state never reached")


def test_shares_the_bank_has_run_out_of_carry_a_premium():
    def sold_out(g):
        return next(
            (
                c
                for c in g.hotel.get_active_chains()
                if g.hotel.get_available_stocks(c) == 0
            ),
            None,
        )

    g, chain = _play_until(1, sold_out)
    p = price(g, chain)
    assert share_unit_value(g, chain) == round(p * (1 + SCARCE_PREMIUM)) > p
    # The smallest holder sells one share at list price: a loss of the premium.
    holder = min(
        (x for x in g.players if x.get_stock_count(chain)),
        key=lambda x: x.get_stock_count(chain),
    )
    buyer = next(x for x in g.players if x is not holder and x.money >= p)
    v = trade_valuation(
        g,
        offer(buyer.player_id, holder.player_id, give_cash=p, want={chain: 1}),
        holder.player_id,
    )
    assert v["list"]["net"] == 0
    assert v["viewer"]["cash_change"] + v["viewer"]["share_value_change"] == -round(
        p * SCARCE_PREMIUM
    )
    assert not v["acceptable"]


def test_shares_of_a_chain_off_the_board_are_worth_little():
    def held_off_board(g):
        for c in g.hotel.get_inactive_chains():
            for p in g.players:
                if p.get_stock_count(c):
                    return c, p.player_id
        return None

    g, (chain, holder) = _play_until(2, held_off_board)
    refound = g.hotel.get_stock_price(chain, 2)
    unit = share_unit_value(g, chain)
    assert unit == round(refound * INACTIVE_SHARE_FACTOR) and 0 < unit < refound
    rich = max((p for p in g.players if p.player_id != holder), key=lambda p: p.money)
    assert rich.money >= refound
    buyer = rich.player_id
    # Paying anything like the re-founding price for a dead share is refused...
    verb, v = bot_answer(
        g, holder, offer(holder, buyer, give={chain: 1}, want_cash=refound)
    )
    assert v["list"] == {"give": refound, "get": 0, "net": -refound}
    assert verb == "reject_trade" and v["viewer"]["change"] == unit - refound
    # ...and selling one for a fraction of that price is a good trade.
    cash = 2 * unit
    verb, v = bot_answer(
        g, buyer, offer(buyer, holder, give_cash=cash, want={chain: 1})
    )
    assert v["list"] == {"give": 0, "get": cash, "net": cash}
    assert v["viewer"]["share_value_change"] == -unit
    assert v["adjusted_gain"] == unit >= v["margin"] and verb == "accept_trade"


# --------------------------------------------------------------------------
# The rules-based seat's answers
# --------------------------------------------------------------------------


def test_bot_keeps_its_majority_at_face_value_and_sells_it_at_a_fair_price():
    t = small_table()
    g = t.game
    p = price(g, A)
    verb, v = bot_answer(g, "p1", offer("p1", "p2", give_cash=2 * p, want={A: 2}))
    assert verb == "reject_trade"
    assert (t.shares("p2", A), t.money("p2")) == (3, 5600)

    # Break-even for p2: list price + its weighted bonus loss + what it must
    # charge for handing p1 the majority; then the margin on top.
    lost = -v["viewer"]["bonus_change"]
    handed = v["counterparty"]["bonus_change"]
    assert lost > 0 and handed > 0
    too_low = 2 * p + lost  # covers the bot's own loss only
    verb, low = bot_answer(g, "p1", offer("p1", "p2", give_cash=too_low, want={A: 2}))
    assert verb == "reject_trade" and low["viewer"]["change"] == 0
    fair = 2 * p + lost + handed  # nothing left for p1 either: pure premium
    assert fair <= t.money("p1")
    verb, ok = bot_answer(g, "p1", offer("p1", "p2", give_cash=fair, want={A: 2}))
    assert ok["counterparty"]["change"] < 0
    assert ok["adjusted_gain"] == handed >= ok["margin"]
    assert verb == "accept_trade"
    assert (t.shares("p2", A), t.shares("p1", A)) == (1, 4)
    assert t.money("p2") == 5600 + fair


def test_bot_keeps_its_minority_at_face_value():
    t = small_table()
    g = t.game
    p = price(g, A)
    _, mino = bonuses(g, A)
    # p3 (1 share, no position) asks p1 (2 shares, sole minority) for one.
    verb, v = bot_answer(g, "p3", offer("p3", "p1", give_cash=p, want={A: 1}))
    assert verb == "reject_trade"
    assert v["viewer"]["bonus_change_now"] == -mino
    assert {r["player_id"]: (r["before"], r["after"]) for r in v["rank_changes"]} == {
        "p1": ("minority_sole", "none"),
        "p3": ("none", "minority_sole"),
    }
    rich = p + 2 * mino
    verb, v = bot_answer(g, "p3", offer("p3", "p1", give_cash=rich, want={A: 1}))
    assert verb == "accept_trade" and v["adjusted_gain"] >= v["margin"] > 0
    assert (t.shares("p1", A), t.shares("p3", A)) == (1, 2)


def test_shares_without_a_position_sell_for_face_value_plus_margin():
    t = small_table()
    g = t.game
    p = price(g, A)
    # p2 (sole majority) buys p3's single share: no position changes hands.
    verb, v = bot_answer(g, "p2", offer("p2", "p3", give_cash=p, want={A: 1}))
    assert v["rank_changes"] == [] and v["viewer"]["bonus_change_now"] == 0
    assert v["counterparty"]["bonus_change_now"] == 0
    assert v["adjusted_gain"] == 0 and verb == "reject_trade"  # no gain, no deal

    rate = MARGIN_AHEAD if v["counterparty_ahead"] else MARGIN
    need = next(x for x in range(1, p) if x >= -(-(p + x) * rate // 1))
    assert need < p * 0.2  # a margin, not a bonus-sized premium
    verb, v = bot_answer(
        g, "p2", offer("p2", "p3", give_cash=p + need - 1, want={A: 1})
    )
    assert verb == "reject_trade"
    verb, v = bot_answer(g, "p2", offer("p2", "p3", give_cash=p + need, want={A: 1}))
    assert verb == "accept_trade" and v["adjusted_gain"] == need == v["margin"]
    assert t.shares("p3", A) == 0 and t.shares("p2", A) == 4


def test_handing_the_proposer_a_majority_before_a_merger_is_priced_in():
    """p1 (2 shares) buys p3's single share to tie p2 for the majority of a
    chain that can still be absorbed. p3 loses no position of its own, so its
    own gain is just the cash over list price, but it must charge for what the
    trade hands p1."""
    t = small_table()
    g = t.game
    p = price(g, A)
    maj, mino = bonuses(g, A)
    gain_now = RS.round_split((maj + mino) / 2) - mino
    assert gain_now > 0
    handed = round(gain_now * BONUS_WEIGHT_UNSAFE)
    # List price plus a little, enough where no position moves (see the test
    # above), is refused here: p1 would gain far more than p3.
    verb, v = bot_answer(g, "p1", offer("p1", "p3", give_cash=p + 20, want={A: 1}))
    assert v["viewer"]["change"] == 20
    assert v["counterparty"]["bonus_change_now"] == gain_now
    assert v["counterparty"]["change"] == handed - 20 > 0
    assert {r["player_id"]: (r["before"], r["after"]) for r in v["rank_changes"]} == {
        "p1": ("minority_sole", "majority_tied")
    }
    assert verb == "reject_trade"

    # The lowest price p3 takes: its own gain (cash over list price) must
    # outweigh rival_weight times what p1 still gains after paying it.
    w = v["rival_weight"]

    def adjusted(x: int) -> float:
        return (x - p) - w * max(0, handed - (x - p))

    floor = next(
        x
        for x in range(p, t.money("p1") + 1, 10)
        if trade_valuation(g, offer("p1", "p3", give_cash=x, want={A: 1}), "p3")[
            "acceptable"
        ]
    )
    assert floor > p + 20
    margin = -(-floor * (MARGIN_AHEAD if v["counterparty_ahead"] else MARGIN) // 1)
    assert adjusted(floor) >= margin and adjusted(floor - 10) < margin
    assert floor - p >= w * handed / (1 + w)  # a real share of the bonus handed over
    verb, v = bot_answer(g, "p1", offer("p1", "p3", give_cash=floor, want={A: 1}))
    assert verb == "accept_trade"
    assert t.shares("p1", A) == 3 == t.shares("p2", A)


def test_helping_a_richer_proposer_costs_more_than_helping_a_poorer_one():
    """The same kind of trade (one share that gives the buyer a position)
    needs a larger premium when the buyer is ahead of the bot in net worth."""
    t = small_table()
    g = t.game
    # p2 pays p1 a gift, so p1 is clearly ahead of p3 and p2 clearly behind.
    assert apply_action(g, "p2", offer("p2", "p1", give_cash=3000))["success"]
    tid = next(iter(g.pending_trades))
    assert apply_action(g, "p1", {"action": "accept_trade", "trade_id": tid})["success"]

    def floor(buyer: str) -> tuple[int, dict]:
        for x in range(0, g.get_player(buyer).money + 1, 100):
            v = trade_valuation(g, offer(buyer, "p3", give_cash=x, want={A: 1}), "p3")
            if v["acceptable"]:
                return x, v
        raise AssertionError("no acceptable price")

    # p1 would tie for the majority with the share.
    rich_price, rich = floor("p1")
    assert rich["counterparty_ahead"] and rich["rival_weight"] == 1.0
    assert rich["margin"] == -(-rich_price * MARGIN_AHEAD // 1)
    # p2 already holds the majority: nothing changes hands, p2 is behind.
    poor_price, poor = floor("p2")
    assert not poor["counterparty_ahead"] and poor["rival_weight"] == 0.5
    assert poor["margin"] == -(-poor_price * MARGIN // 1)
    assert rich_price > poor_price


def test_massive_overpayment_is_accepted():
    t = small_table()
    verb, v = bot_answer(t.game, "p1", offer("p1", "p2", give_cash=5000, want={A: 1}))
    assert verb == "accept_trade" and v["adjusted_gain"] > 3000
    assert t.money("p2") == 5600 + 5000 and t.shares("p2", A) == 2


def test_cash_requested_from_the_bot_is_weighed_like_anything_else():
    t = small_table()
    g = t.game
    pz = price(g, Z)
    # p3, the only holder of Z, sells one of its two shares: p1 then ties it
    # for the majority and the two split both bonuses.
    maj, mino = bonuses(g, Z)
    half = RS.round_split((maj + mino) / 2)
    verb, v = bot_answer(g, "p3", offer("p3", "p1", give={Z: 1}, want_cash=pz))
    assert v["viewer"]["bonus_change_now"] == half
    assert v["counterparty"]["bonus_change_now"] == half - maj - mino
    assert v["counterparty"]["change"] < 0 and verb == "accept_trade"
    assert t.money("p1") == 5600 - pz


def test_share_for_share_swaps_use_the_same_valuation():
    t = small_table()
    g = t.game
    _, min_a = bonuses(g, A)
    maj_z, min_z = bonuses(g, Z)
    half_z = RS.round_split((maj_z + min_z) / 2)
    # p1 gives one A (its A minority goes to p3) for one Z (p1 then ties p3,
    # so far the only holder, for the Z majority: they split both bonuses).
    verb, v = bot_answer(g, "p1", offer("p1", "p3", give={A: 1}, want={Z: 1}))
    pa, pz = price(g, A), price(g, Z)
    assert v["list"] == {"give": pz, "get": pa, "net": pa - pz}
    w = BONUS_WEIGHT_UNSAFE
    lost_z = maj_z + min_z - half_z
    assert v["viewer"]["bonus_change"] == round((min_a - lost_z) * w)
    assert v["counterparty"]["bonus_change"] == round((half_z - min_a) * w)
    assert v["viewer"]["change"] == pa - pz + v["viewer"]["bonus_change"]
    assert verb == ("accept_trade" if v["acceptable"] else "reject_trade")
    assert verb == "reject_trade"  # half of the dearer chain's bonuses is worth more

    # The same swap with cash added by p1 until it pays for what p3 gives up.
    cash = next(
        x
        for x in range(0, t.money("p1") + 1, 100)
        if trade_valuation(
            g, offer("p1", "p3", give={A: 1}, give_cash=x, want={Z: 1}), "p3"
        )["acceptable"]
    )
    assert cash >= -v["viewer"]["change"]
    verb, v = bot_answer(
        g, "p1", offer("p1", "p3", give={A: 1}, give_cash=cash, want={Z: 1})
    )
    assert verb == "accept_trade"
    assert (t.shares("p3", A), t.shares("p3", Z), t.shares("p1", Z)) == (2, 1, 1)


def test_bot_never_accepts_a_trade_validation_would_refuse():
    t = small_table()
    g = t.game
    # A huge overpayment the bot would love...
    proposal = offer("p1", "p2", give_cash=5000, want={A: 1})
    assert trade_valuation(g, proposal, "p2")["acceptable"]
    result = apply_action(g, "p1", proposal)
    assert result["success"]
    tid = result["trade_id"]
    # ...but p1 then spends its cash at the buy step, so the offer is stale.
    t.place_filler()
    t.buy({Z: 3})
    assert t.money("p1") < 5000
    decision = next(d for d in pending_decisions(g) if d.kind == TRADE_RESPONSE)
    ctx = build_context(g, decision)
    assert ctx.legal["can_accept"] is False
    assert ctx.calc["trades"][tid]["valid"] is False
    action = HeuristicAgent(name="p2").choose(ctx)
    assert action == {"action": "reject_trade", "trade_id": tid}
    assert apply_action(g, "p2", action)["success"]
    assert (t.shares("p2", A), t.money("p2")) == (3, 5600)


def test_calculator_pack_lists_only_the_viewers_offers():
    t = small_table()
    g = t.game
    r = apply_action(g, "p1", offer("p1", "p2", give_cash=400, want={A: 2}))
    tid = r["trade_id"]
    for pid in ("p1", "p2"):
        pack = build_calculator_pack(g, pid)
        assert list(pack["trades"]) == [tid]
        assert pack["trades"][tid] == trade_valuation(g, g.pending_trades[tid], pid)
        assert pack["trades"][tid]["viewer_id"] == pid
    assert build_calculator_pack(g, "p3")["trades"] == {}


def test_missing_valuation_means_reject():
    t = small_table()
    g = t.game
    r = apply_action(g, "p1", offer("p1", "p2", give_cash=5000, want={A: 1}))
    decision = next(d for d in pending_decisions(g) if d.kind == TRADE_RESPONSE)
    ctx = build_context(g, decision)
    ctx.calc = {k: v for k, v in ctx.calc.items() if k != "trades"}
    assert HeuristicAgent(name="p2").choose(ctx) == {
        "action": "reject_trade",
        "trade_id": r["trade_id"],
    }


@pytest.mark.parametrize("seed", [3, 4])
def test_bot_answers_random_offers_legally_and_never_loses_position_value(seed):
    """Random offers thrown at the rules-based seats during games they play:
    every answer is applied by the engine, an accepted trade always has a
    positive position-aware gain for the bot, and the valuation's cash and
    share-value parts are zero-sum between the two sides."""
    g = bot_game(3, seed)
    table = HeuristicTable(g, seed=seed)
    rng = random.Random(seed)
    answered = accepted = 0
    for _ in range(60):
        table.play_turn()
        if g.phase == GamePhase.GAME_OVER:
            break
        frm, to = rng.sample([p.player_id for p in g.players], 2)
        a, b = g.get_player(frm), g.get_player(to)
        give = {
            c: rng.randint(1, n)
            for c, n in a.stocks.items()
            if n and rng.random() < 0.4
        }
        want = {
            c: rng.randint(1, n)
            for c, n in b.stocks.items()
            if n and rng.random() < 0.4
        }
        proposal = offer(
            frm,
            to,
            give=give,
            give_cash=rng.choice([0, 0, rng.randint(0, a.money)]),
            want=want,
            want_cash=rng.choice([0, 0, rng.randint(0, b.money)]),
        )
        result = apply_action(g, frm, proposal)
        if not result["success"]:
            continue  # empty or frozen: refused by the rules
        decision = next(d for d in pending_decisions(g) if d.kind == TRADE_RESPONSE)
        ctx = build_context(g, decision)
        v = ctx.calc["trades"][result["trade_id"]]
        action = table.agents[to].choose(ctx)
        assert apply_action(g, to, action)["success"]
        answered += 1
        if v["valid"]:
            me, them = v["viewer"], v["counterparty"]
            assert me["cash_change"] == -them["cash_change"]
            assert me["share_value_change"] == -them["share_value_change"]
        if action["action"] == "accept_trade":
            accepted += 1
            assert v["viewer"]["change"] > 0 and v["adjusted_gain"] >= v["margin"]
    assert answered >= 20 and accepted >= 1
