"""Every kind of seat answers the merger-order decision (which same-size
defunct chain is resolved next): rules bot, heuristic agent, scripted seat,
fixture policies, LLM prompt/schema and the offline fake LLM."""

from __future__ import annotations

import asyncio
import random

import pytest

from agents.base import build_context
from agents.heuristic import HeuristicAgent
from agents.llm.agent import forced_action
from agents.llm.prompt import build_system_prompt, build_user_prompt, compact_event
from agents.llm.providers import schema_first_answer
from agents.llm.schema import (
    build_schema,
    build_static_schema,
    check_against_legal,
)
from agents.scripted import default_action, fits
from fixtures_gen.policies import POLICIES, choose
from game.bot import Bot
from game.decisions import (
    CHOOSE_DEFUNCT_ORDER,
    apply_action,
    legal_actions,
    pending_decisions,
    validate_action,
)
from game.player import Player
from tests.gameplay.test_merger_order import three_twos


def position():
    """p1 placed 5E and kept halcyon; marlowe (p1 holds 1) and sandpiper (p2
    holds 1) are tied and p1 must pick the order."""
    t = three_twos()
    t.place("5E")
    t.act("p1", action="merger_choice", surviving_chain="halcyon")
    d = pending_decisions(t.game)[0]
    assert d.kind == CHOOSE_DEFUNCT_ORDER
    return t.game, d


# --- rules bot ---------------------------------------------------------------


def bot_with(**stocks) -> Bot:
    player = Player("bot1", "Bot Player")
    for chain, n in stocks.items():
        player._stocks[chain] = n
    return Bot(player, difficulty="hard")


def test_bot_resolves_first_the_chain_it_holds_most_of():
    bot = bot_with(sandpiper=2, marlowe=5)
    assert bot.choose_defunct_order(["sandpiper", "marlowe"]) == "marlowe"
    assert bot.choose_defunct_order(["marlowe", "sandpiper"]) == "marlowe"


def test_bot_breaks_equal_holdings_by_its_larger_bonus_then_board_order():
    bot = bot_with(sandpiper=3, marlowe=3)
    bonus = {"sandpiper": 1000, "marlowe": 3000}
    assert bot.choose_defunct_order(["sandpiper", "marlowe"], bonus) == "marlowe"
    assert bot.choose_defunct_order(["sandpiper", "marlowe"]) == "sandpiper"
    assert bot.choose_defunct_order(["marlowe", "sandpiper"]) == "marlowe"


@pytest.mark.parametrize("difficulty", ["easy", "medium", "hard"])
def test_bot_choice_draws_no_random_number(difficulty):
    player = Player("bot1", "Bot Player")
    player._stocks["marlowe"] = 1
    rng = random.Random(7)
    before = rng.getstate()
    bot = Bot(player, difficulty=difficulty, rng=rng)
    assert bot.choose_defunct_order(["sandpiper", "marlowe"]) == "marlowe"
    assert rng.getstate() == before


def test_bot_rejects_an_empty_list():
    with pytest.raises(ValueError, match="No chains to choose from"):
        bot_with().choose_defunct_order([])


# --- agents ------------------------------------------------------------------


@pytest.mark.parametrize("difficulty", ["easy", "medium", "hard"])
def test_heuristic_agent_gives_a_legal_answer(difficulty):
    game, d = position()
    ctx = build_context(game, d)
    action = HeuristicAgent("Bot", difficulty).choose(ctx)
    # p1 holds marlowe (founder share) and no sandpiper.
    assert action == {"action": "merger_order", "defunct_chain": "marlowe"}
    assert validate_action(game, "p1", action) is None


def test_scripted_seat_default_is_the_board_order():
    game, d = position()
    ctx = build_context(game, d)
    action = default_action(ctx)
    assert action == {"action": "merger_order", "defunct_chain": "marlowe"}
    assert fits(ctx, action)
    assert fits(ctx, {"action": "merger_order", "defunct_chain": "sandpiper"})
    assert not fits(ctx, {"action": "merger_order", "defunct_chain": "halcyon"})


def test_every_fixture_policy_answers_with_the_board_order_and_no_rng_draw():
    game, d = position()
    legal = legal_actions(game, d)
    for policy in POLICIES:
        rng = random.Random(3)
        before = rng.getstate()
        action = choose(policy, game, d, legal, rng)
        assert action == {"action": "merger_order", "defunct_chain": "marlowe"}
        assert rng.getstate() == before


# --- LLM seat ----------------------------------------------------------------


def test_rules_text_and_playbook_mention_the_order_choice():
    s = build_system_prompt()
    assert (
        "When defunct hotel chains are the same size, the player who placed the "
        "tile chooses which of them is resolved next." in s
    )
    assert '{"action":"merger_order","defunct_chain":' in s
    assert sum(1 for x in s.splitlines() if x.startswith("- Merger order (tie):")) == 1


def test_prompt_lists_each_tied_chain_with_its_facts():
    game, d = position()
    ctx = build_context(game, d)
    p = build_user_prompt(ctx, [])
    assert "# Merger order" in p
    assert "# Decision: choose_defunct_order" in p
    assert "halcyon has 24 shares left in the bank for trades" in p
    assert "Player 1 chose" not in p  # nothing chosen yet
    section = p[p.index("# Merger order") : p.index("# Recent public events")]
    assert section.splitlines()[2:4] == [
        "- marlowe: 2 tiles, $200/share. Bonuses: majority $2,000 / minority "
        "$1,000, paid to: Player 1 $3,000. Holders: Player 1 1. You hold 1 "
        "(sell all: $200; trade at most 0 for 0 halcyon).",
        "- sandpiper: 2 tiles, $200/share. Bonuses: majority $2,000 / minority "
        "$1,000, paid to: Player 2 $3,000. Holders: Player 2 1. You hold none.",
    ]
    assert '"chains":["marlowe","sandpiper"]' in p.replace(" ", "")


def test_schemas_and_legality_check():
    game, d = position()
    legal = legal_actions(game, d)
    static = build_static_schema(CHOOSE_DEFUNCT_ORDER)
    act = static["properties"]["action"]
    assert act["properties"]["action"]["enum"] == ["merger_order"]
    # Static per kind: every chain of the ruleset, not the tied ones of the moment.
    assert act["properties"]["defunct_chain"]["enum"] == list(game.ruleset.chain_ids)
    ok = {"action": "merger_order", "defunct_chain": "sandpiper"}
    assert check_against_legal(ok, legal) is None
    err = check_against_legal(
        {"action": "merger_order", "defunct_chain": "halcyon"}, legal
    )
    assert "tied chains" in err
    assert "not allowed" in check_against_legal(
        {"action": "merger_choice", "surviving_chain": "marlowe"}, legal
    )
    # Two real options: never answered without asking the model.
    assert forced_action(CHOOSE_DEFUNCT_ORDER, legal) is None


def test_fake_llm_answer_is_legal():
    game, d = position()
    legal = legal_actions(game, d)
    schema = build_schema(legal, other_player_ids=("p2", "p3"))
    answer = schema_first_answer(schema)
    assert answer["action"] == {"action": "merger_order", "defunct_chain": "marlowe"}
    assert apply_action(game, "p1", answer["action"])["success"]


def test_llm_agent_with_the_fake_provider_answers_the_decision():
    from agents.llm.agent import LLMAgent
    from agents.llm.providers import FakeProvider

    game, d = position()
    ctx = build_context(game, d)
    agent = LLMAgent(FakeProvider(), name="LLM")
    action = asyncio.run(agent.decide(ctx))
    assert action == {"action": "merger_order", "defunct_chain": "marlowe"}


def test_event_line_in_later_prompts():
    line = compact_event(
        {
            "type": "defunct_order_chosen",
            "player_id": "p1",
            "chain": "sandpiper",
            "tied_chains": ["marlowe", "sandpiper"],
        },
        {"p1": "Alice"},
    )
    assert line == (
        "Alice chose sandpiper to be resolved next (same size: marlowe, sandpiper)"
    )
