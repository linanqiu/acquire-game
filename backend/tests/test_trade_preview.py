"""Tier 1: the preview of a trade offer (BL-021), what the trade composer
shows next to its controls before anything is proposed, and what an offer
card says about positions.

``trade_preview`` is pure and built from public information. For a draft
addressed to a rules-based seat it says what that seat would answer: the
tests hold it to the answer the seat then gives to the same offer through
``apply_action`` (one code path: ``trade_valuation``). Positions are reached
by real play (``tests.test_trade_value.small_table``, games played by the
rules-based seat).
"""

from __future__ import annotations

import json
import random

import pytest

from agents.base import build_context
from game.decisions import TRADE_RESPONSE, apply_action, draft_trade, pending_decisions
from game.game import GamePhase
from game.rules import Rules
from game.trade_value import (
    PREVIEW_CASH_STEP,
    _as_offer,
    _with_more_cash,
    cash_to_accept,
    position_changes,
    trade_preview,
    trade_valuation,
)
from tests.support.drive import HeuristicTable, bot_game
from tests.test_trade_value import A, Z, bot_answer, offer, price, small_table


def preview(game, proposal: dict, bots=frozenset()) -> dict:
    """The preview as the route builds it: the draft's verdict is
    ``apply_action``'s own validation (``draft_trade``)."""
    trade, error = draft_trade(game, proposal["from_player_id"], proposal)
    assert trade is not None, error
    return trade_preview(game, trade, rules_bots=bots, error=error)


def give_away(game, frm: str, to: str, cash: int) -> None:
    """``frm`` hands ``to`` cash for nothing, as two actions through
    ``apply_action`` (the only way a position changes in these tests)."""
    made = apply_action(game, frm, offer(frm, to, give_cash=cash))
    assert made["success"], made
    taken = apply_action(
        game, to, {"action": "accept_trade", "trade_id": made["trade_id"]}
    )
    assert taken["success"], taken


def public(game) -> str:
    return json.dumps(game.get_public_state(), sort_keys=True, default=str)


@pytest.mark.parametrize("cash", range(0, 5601, 400))
def test_preview_says_what_the_rules_based_seat_will_answer(cash):
    """The verdict shown to the proposer is the answer the seat then gives to
    the same offer through ``apply_action``, and "needs $X more" is exact."""
    g = small_table().game
    proposal = offer("p1", "p2", give_cash=cash, want={A: 2})
    before = public(g)
    shown = preview(g, proposal, bots={"p2"})
    assert public(g) == before
    assert g.pending_trades == {}  # a preview proposes nothing
    assert json.loads(json.dumps(shown)) == shown
    bot = shown["bot"]
    assert bot["player_id"] == "p2"
    needed = bot["cash_needed"]
    assert bot["acceptable"] is (needed == 0)

    if needed:  # exactly enough: one step less is refused, this much is taken
        assert needed % PREVIEW_CASH_STEP == 0
        step = PREVIEW_CASH_STEP
        short = offer("p1", "p2", give_cash=cash + needed - step, want={A: 2})
        assert bot_answer(small_table().game, "p1", short)[0] == "reject_trade"
        enough = offer("p1", "p2", give_cash=cash + needed, want={A: 2})
        assert bot_answer(small_table().game, "p1", enough)[0] == "accept_trade"

    verb, _ = bot_answer(g, "p1", proposal)
    assert verb == ("accept_trade" if bot["acceptable"] else "reject_trade")


def test_the_verdicts_cover_both_answers():
    """The parametrised test above is not all refusals or all acceptances."""
    g = small_table().game
    answers = {
        preview(g, offer("p1", "p2", give_cash=c, want={A: 2}), bots={"p2"})["bot"][
            "acceptable"
        ]
        for c in range(0, 5601, 400)
    }
    assert answers == {True, False}


def test_cash_needed_takes_less_asked_before_more_offered():
    g = small_table().game
    # p1 asks the bot for cash on top of its share: the first extra dollars
    # are dollars no longer asked.
    proposal = offer("p1", "p2", want={A: 1}, want_cash=300)
    needed = preview(g, proposal, bots={"p2"})["bot"]["cash_needed"]
    assert needed and needed > 300
    assert cash_to_accept(g, proposal, "p2") == needed
    more = _with_more_cash(_as_offer(proposal), needed)
    assert (more.requesting_money, more.offering_money) == (0, needed - 300)
    fixed = offer("p1", "p2", give_cash=needed - 300, want={A: 1})
    assert preview(g, fixed, bots={"p2"})["bot"] == {
        "player_id": "p2",
        "acceptable": True,
        "cash_needed": 0,
    }


def test_preview_says_when_no_cash_the_proposer_has_would_do():
    t = small_table()
    g = t.game
    give_away(g, "p1", "p3", t.money("p1"))
    assert t.money("p1") == 0
    proposal = offer("p1", "p2", give={A: 1}, want={A: 2})
    shown = preview(g, proposal, bots={"p2"})
    assert shown["valid"] is True
    assert shown["bot"] == {"player_id": "p2", "acceptable": False, "cash_needed": None}
    assert bot_answer(g, "p1", proposal)[0] == "reject_trade"


def test_preview_never_judges_for_a_seat_that_is_not_rules_based():
    g = small_table().game
    proposal = offer("p1", "p2", give_cash=5000, want={A: 2})
    assert preview(g, proposal)["bot"] is None  # p2 a human or an LLM seat
    assert preview(g, proposal, bots={"p3"})["bot"] is None  # another seat is


def test_preview_positions_name_everyone_whose_standing_changes():
    """A: p2 3 (1st), p1 2 (2nd), p3 1. p2 hands p1 two shares: p1 takes
    1st, p2 drops to a tied 2nd, and p3, no party to the trade, is level
    with it."""
    g = small_table().game
    shown = preview(g, offer("p1", "p2", give_cash=3000, want={A: 2}))
    assert shown["list"] == {"offering": 3000, "requesting": 2 * price(g, A)}
    assert shown["positions"] == [
        {
            "chain": A,
            "player_id": "p1",
            "before": "minority_sole",
            "after": "majority_sole",
            "shares_before": 2,
            "shares_after": 4,
        },
        {
            "chain": A,
            "player_id": "p2",
            "before": "majority_sole",
            "after": "minority_tied",
            "shares_before": 3,
            "shares_after": 1,
        },
        {
            "chain": A,
            "player_id": "p3",
            "before": "none",
            "after": "minority_tied",
            "shares_before": 1,
            "shares_after": 1,
        },
    ]
    # Cash alone moves no position.
    assert position_changes(g, offer("p1", "p2", give_cash=100, want_cash=50)) == []
    # A swap: each chain's changes, chains in the ruleset's order.
    swap = position_changes(g, offer("p1", "p3", give={A: 2}, want={Z: 1}))
    assert [c["chain"] for c in swap] == sorted(
        (c["chain"] for c in swap), key=g.hotel.get_all_chain_names().index
    )
    assert {c["chain"] for c in swap} == {A, Z}


def test_preview_of_a_draft_is_refused_like_the_proposal_would_be():
    t = small_table()
    g = t.game
    for bad in (
        offer("p1", "p2", give_cash=99_999, want={A: 1}),  # cash p1 lacks
        offer("p1", "p2", give={Z: 1}, want={A: 1}),  # shares p1 lacks
        offer("p1", "p1", give_cash=100, want={A: 1}),  # with itself
        offer("p1", "p2"),  # nothing at all
    ):
        shown = preview(g, bad, bots={"p2"})
        refused = apply_action(g, "p1", bad)
        assert refused["success"] is False
        assert shown == {
            "valid": False,
            "error": refused["error"],
            "from_player_id": bad["from_player_id"],
            "to_player_id": bad["to_player_id"],
        }
    # The limit of open offers is the proposal's own refusal too.
    limit = g.ruleset.max_pending_trades_per_player
    for i in range(limit):
        made = {**offer("p1", "p3", give_cash=100 + i), "trade_id": f"t{i}"}
        assert apply_action(g, "p1", made)["success"]
    one_more = offer("p1", "p2", give_cash=3000, want={A: 2})
    shown = preview(g, one_more, bots={"p2"})
    assert shown["valid"] is False and "pending trades" in shown["error"]
    assert shown["error"] == apply_action(g, "p1", one_more)["error"]
    # A malformed draft has no offer at all, and nothing raises.
    trade, why = draft_trade(g, "p1", {"to_player_id": 7})
    assert trade is None and why
    assert draft_trade(g, "p1", "nonsense")[0] is None


def test_preview_of_an_open_offer_checks_it_can_still_be_carried_out():
    t = small_table()
    g = t.game
    r = apply_action(g, "p1", offer("p1", "p3", give_cash=5000, want={Z: 1}))
    open_offer = g.pending_trades[r["trade_id"]]
    shown = trade_preview(g, open_offer)
    assert shown["valid"] is True and shown["bot"] is None
    give_away(g, "p1", "p2", t.money("p1") - 100)  # the cash went elsewhere
    stale = trade_preview(g, open_offer)
    assert stale["valid"] is False and stale["error"]
    assert "positions" not in stale


@pytest.mark.parametrize("seed", [5, 6])
def test_preview_matches_the_seat_on_random_offers(seed):
    """During games the rules-based seats play: for random drafts, the verdict
    shown equals the seat's answer, and the cash needed is the least that
    turns a refusal into an acceptance."""
    g = bot_game(3, seed)
    table = HeuristicTable(g, seed=seed)
    rng = random.Random(seed)
    checked = flipped = 0
    for _ in range(60):
        table.play_turn()
        if g.phase == GamePhase.GAME_OVER:
            break
        frm, to = rng.sample([p.player_id for p in g.players], 2)
        a, b = g.get_player(frm), g.get_player(to)
        proposal = offer(
            frm,
            to,
            give={
                c: rng.randint(1, n)
                for c, n in a.stocks.items()
                if n and rng.random() < 0.4
            },
            give_cash=rng.choice([0, rng.randint(0, a.money) // 100 * 100]),
            want={
                c: rng.randint(1, n)
                for c, n in b.stocks.items()
                if n and rng.random() < 0.4
            },
            want_cash=rng.choice([0, rng.randint(0, b.money) // 100 * 100]),
        )
        before = public(g)
        shown = preview(g, proposal, bots={to})
        assert public(g) == before
        if not shown["valid"]:
            assert apply_action(g, frm, proposal)["success"] is False
            continue
        needed = shown["bot"]["cash_needed"]
        if needed:
            better = _with_more_cash(_as_offer(proposal), needed)
            assert Rules.validate_trade(g, better)[0]
            assert trade_valuation(g, better, to)["acceptable"] is True
            nearly = _with_more_cash(_as_offer(proposal), needed - PREVIEW_CASH_STEP)
            assert trade_valuation(g, nearly, to)["acceptable"] is False
            flipped += 1
        result = apply_action(g, frm, proposal)
        assert result["success"], result
        decision = next(d for d in pending_decisions(g) if d.kind == TRADE_RESPONSE)
        action = table.agents[to].choose(build_context(g, decision))
        assert action["action"] == (
            "accept_trade" if shown["bot"]["acceptable"] else "reject_trade"
        )
        assert apply_action(g, to, action)["success"]
        checked += 1
    assert checked >= 10 and flipped >= 1
