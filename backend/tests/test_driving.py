"""The seat driver's pure pieces (agents/driving.py), shared by the server and
the benchmark: how long a seat may think, which answers are refused before
the engine sees them, and what players are told when the rules-based player
steps in. See docs/architecture/seat-contract.md."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from agents.base import build_context
from agents.driving import category, check_answer, describe_fallback, timeout_for
from config import get_settings
from game.decisions import pending_decisions
from tests.support.table import Table


@pytest.fixture
def settings(monkeypatch):
    s = get_settings()
    for name, value in (
        ("bot_decision_timeout", 3.0),
        ("scripted_decision_timeout", 4.0),
        ("llm_decision_timeout", 5.0),
        ("max_agent_actions_per_turn", 3),
        ("max_trade_proposals_per_turn", 1),
    ):
        monkeypatch.setattr(s, name, value)
    return s


def test_time_allowed_per_seat_kind(settings):
    def agent(kind, override=None):
        return SimpleNamespace(kind=kind, decision_timeout=override)

    assert timeout_for(agent("bot")) == 3.0
    assert timeout_for(agent("scripted")) == 4.0
    assert timeout_for(agent("llm")) == 5.0
    assert timeout_for(agent("llm", override=0.5)) == 0.5
    assert timeout_for(agent("llm", override=0)) == 5.0  # not a usable limit
    assert timeout_for(agent("llm", override="7")) == 5.0


def test_answers_are_capped_per_turn(settings):
    t = Table([["1A"], ["2A"], []])
    game = t.game
    decision = pending_decisions(game)[0]
    ctx = build_context(game, decision)
    place = {"action": "place_tile", "tile": "1A"}
    assert (
        check_answer(game, decision, ctx, place, {"actions": 2, "proposals": 0}) is None
    )
    capped = check_answer(game, decision, ctx, place, {"actions": 3, "proposals": 0})
    assert capped == "per-turn action cap reached" and category(capped) == "cap"
    assert "not an action object" in check_answer(
        game, decision, ctx, "1A", {"actions": 0, "proposals": 0}
    )
    assert "not offered" in check_answer(
        game, decision, ctx, {"action": "end_turn"}, {"actions": 0, "proposals": 0}
    )

    # proposals have their own, smaller cap (in the buy phase)
    t.turn("1A")
    t.place("2A")
    t.found("Luxor")
    decision = pending_decisions(game)[0]
    ctx = build_context(game, decision)
    offer = {"action": "propose_trade", "to_player_id": "p1", "offering_money": 1}
    assert (
        check_answer(game, decision, ctx, offer, {"actions": 0, "proposals": 0}) is None
    )
    assert (
        check_answer(game, decision, ctx, offer, {"actions": 0, "proposals": 1})
        == "per-turn trade proposal cap reached"
    )
    buy = {"action": "buy_stocks", "purchases": {"Luxor": 1}}
    assert (
        check_answer(game, decision, ctx, buy, {"actions": 0, "proposals": 1}) is None
    )


@pytest.mark.parametrize(
    "reason, attempts, elapsed, text",
    [
        ("timeout", 1, 12.0, "timed out after 12 s"),
        ("timeout", 1, 9.96, "timed out after 10.0 s"),
        ("timeout", 1, 10.0, "timed out after 10 s"),
        ("illegal", 1, 0.1, "gave an illegal answer"),
        ("illegal", 2, 0.1, "kept answering illegally after 2 tries"),
        ("cap", 1, 0.1, "went over the per-turn action limit"),
        ("script", 1, 0.1, "broke its test script"),
        ("error", 1, 0.1, "had a provider error"),
    ],
)
def test_fallback_announcements(reason, attempts, elapsed, text):
    message = describe_fallback("Claude", reason, attempts, elapsed)
    assert message.startswith(f"Claude {text}")
    assert message.endswith("the rules-based player made this move.")


@pytest.mark.parametrize(
    "reason, cat",
    [
        ("timeout after 5 s", "timeout"),
        ("script: entry 3 illegal", "script"),
        ("per-turn action cap reached", "cap"),
        ("engine: Not your turn", "engine"),
        ("error: provider down", "error"),
        ("tile 9Z is not playable", "illegal"),
    ],
)
def test_fallback_categories(reason, cat):
    assert category(reason) == cat
