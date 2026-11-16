"""Prompt synthesis for LLM seats."""

import json
import re

import pytest
from agents.llm.prompt import (
    PromptBudget,
    build_system_prompt,
    build_user_prompt,
    render_board,
    render_event,
    render_events,
)
from game.hotel import Hotel

from tests.llm_support import (
    bot_game,
    buy_ctx,
    make_ctx,
    place_ctx,
    sample_events,
)


@pytest.fixture(scope="module")
def game():
    return bot_game(seed=39, min_turns=30)


def test_system_prompt_states_the_implemented_rules():
    s = build_system_prompt()
    assert s == build_system_prompt()  # static: cacheable
    for needle in (
        "$6,000",
        "6 tiles",
        "0 to 3 shares",
        "11 or more tiles",
        "41+",
        "two defunct shares for one share of the survivor",
        "rounded UP",
        "Player-to-player trading",
        "propose_trade",
        "accept_trade",
        "declare_end_game",
        "worthless",
        "legal options",
    ):
        assert needle in s, needle
    for chain in Hotel().get_all_chain_names():
        assert chain in s
    # price table is generated from the engine's own table
    assert "$1,200" in s and "$200" in s


def test_user_prompt_has_legal_options_hand_notes_and_board(game):
    ctx = place_ctx(game, events=sample_events(10))
    p = build_user_prompt(ctx, ["Aim for marlowe majority."])
    assert json.dumps(ctx.legal, separators=(",", ":")) in p
    for tile in ctx.state["hand"]:
        assert tile in p
    assert "Aim for marlowe majority." in p
    assert "Decision: place_tile" in p
    grid = [
        ln for ln in render_board(ctx.state).splitlines() if re.match(r"^  [A-I] ", ln)
    ]
    assert len(grid) == 9
    for chain in Hotel().get_all_chain_names():
        assert chain in p


def test_prompt_is_deterministic(game):
    ctx = place_ctx(game, events=sample_events(20))
    assert build_user_prompt(ctx, ["n"]) == build_user_prompt(ctx, ["n"])


def test_no_other_players_tiles_in_prompt(game):
    me = "p1"
    ctx = place_ctx(game, me, events=[])
    p = build_user_prompt(ctx, [])
    on_board = set(ctx.state["board"]["cells"])
    mine = set(ctx.state["hand"])
    for other in game.players:
        if other.player_id == me:
            continue
        for t in map(str, other.hand):
            if t in mine or t in on_board:
                continue
            assert not re.search(rf"\b{t}\b", p), f"leaked {t} from {other.player_id}"


def test_events_private_to_someone_else_are_dropped(game):
    evs = [
        {
            "seq": 0,
            "type": "tile_drawn",
            "player_id": "p2",
            "private_to": "p2",
            "tile": "8H",
        },
        {
            "seq": 1,
            "type": "tile_drawn",
            "player_id": "p1",
            "private_to": "p1",
            "tile": "9I",
        },
        {"seq": 2, "type": "turn_ended", "player_id": "p2", "private_to": None},
    ]
    p = build_user_prompt(place_ctx(game, events=evs), [])
    assert "8H" not in p.split("# Recent public events")[1]
    assert "tile=9I" in p
    assert "Bob turn ended" in p


def test_prompt_stays_under_budget_with_500_events(game):
    ctx = place_ctx(game, events=sample_events(500))
    p = build_user_prompt(ctx, ["note"] * 6)
    section = p.split("# Recent public events")[1].split("# Your private notes")[0]
    lines = section.strip().splitlines()
    b = PromptBudget()
    assert len(lines) <= b.detailed_events + b.milestone_lines + 4
    assert len(p) < 24_000
    # newest events are in detail, old ones summarised
    assert "[498]" in section  # 499 is another seat's private event: dropped
    assert "[100]" not in section
    assert re.search(r"Earlier history, summarised \(\d+ events\)", section)
    # the rest of the prompt is not affected by the log length
    small = build_user_prompt(place_ctx(game, events=sample_events(5)), ["note"] * 6)
    assert len(p) - len(small) < 9_000


def test_budget_is_a_parameter(game):
    ctx = place_ctx(game, events=sample_events(200))
    tight = build_user_prompt(
        ctx, [], budget=PromptBudget(detailed_events=5, milestone_lines=2)
    )
    loose = build_user_prompt(
        ctx, [], budget=PromptBudget(detailed_events=100, milestone_lines=30)
    )
    assert len(tight) < len(loose)
    sec = tight.split("# Recent public events")[1].split("# Your private notes")[0]
    assert "Most recent 5 events" in sec
    recent = sec.split("Most recent 5 events, oldest first:")[1]
    assert len(re.findall(r"^\[\d+\]", recent, re.MULTILINE)) == 5
    none = build_user_prompt(ctx, [], budget=PromptBudget(detailed_events=0))
    assert "Most recent 0 events" in none


def test_unknown_and_malformed_events_render_generically():
    names = {"p1": "Alice"}
    line = render_event(
        {"seq": 3, "type": "brand_new_thing", "player_id": "p1", "x": {"a": [1, 2]}},
        names,
    )
    assert line.startswith("[3] Alice brand new thing")
    assert "x={a: [1, 2]}" in line
    assert render_event({}, names) == "event"
    assert render_event("weird", names) == "weird"
    assert len(render_event({"type": "t", "blob": "y" * 1000}, names, 100)) == 100
    out = render_events(
        [{"type": "a"}, None, 5, {"seq": 9, "type": "b"}], names, PromptBudget()
    )
    assert "[9] b" in out
    assert render_events([], names, PromptBudget()) == "(no events yet)"


def test_slices_per_decision_kind(game):
    place = build_user_prompt(place_ctx(game), [])
    buy = build_user_prompt(buy_ctx(game), [])
    assert "What each of your tiles would do" in place
    assert "Purchase options" not in place
    assert "Purchase options" in buy
    assert "What each of your tiles would do" not in buy
    assert "buy 1: cost" in buy
    assert "Bank and end game" in place and "Bank and end game" in buy


def test_disposition_prompt_has_derived_numbers(game):
    legal = {
        "action_types": ["merger_disposition"],
        "defunct_chain": "sandpiper",
        "surviving_chain": "marlowe",
        "stock_count": 4,
        "max_trade": 2,
    }
    p = build_user_prompt(make_ctx(game, "p1", "stock_disposition", legal), [])
    assert "Bonuses for sandpiper have ALREADY been paid" in p
    assert "selling all 4 gives $1,200" in p
    assert "more than $600" in p
    assert "Decision: stock_disposition" in p


def _first_decisions(seed, kinds, ruleset=None, limit=3000):
    """Real played positions (heuristic seats through the decisions API):
    yields (game, decision) for each blocking decision of a kind in ``kinds``."""
    from game.decisions import pending_decisions
    from game.game import Game, GamePhase
    from tests.support.drive import HeuristicTable

    g = Game(seed=seed, ruleset=ruleset)
    for i in range(4):
        g.add_player(f"p{i + 1}", f"P{i + 1}", is_bot=True)
    g.start_game()
    table = HeuristicTable(g, seed=seed)
    for _ in range(limit):
        if g.phase == GamePhase.GAME_OVER:
            return
        d = pending_decisions(g)[0]
        if d.kind in kinds:
            yield g, d
        table.step()


def test_strategy_playbook_is_in_the_default_system_prompt():
    s = build_system_prompt()
    play = s[s.index("# Strategy playbook") :]
    for needle in (
        "majority bonus is 10x the share price and the minority bonus 5x",
        "Use your 3 purchases",
        "a rival buying N passes you",
        "LOCKED",
        "bonuses paid to all",
        "SELL / TRADE / HOLD",
        "Named blunders",
        "Your note: keep it a plan",
    ):
        assert needle in play, needle
    assert len(play.split()) < 1000  # a rubric, not an essay


def test_user_prompt_shows_the_share_race_from_the_calculator():
    from agents.base import build_context

    seen = 0
    for g, d in _first_decisions(7, {"buy_stocks"}):
        ctx = build_context(g, d)
        p = build_user_prompt(ctx, [])
        for chain, c in ctx.calc["chains"].items():
            v = c.get("viewer") or {}
            if not v.get("shares"):
                continue
            if v["majority_locked"]:
                assert "LOCKED" in p
            if v["lead"] < 0:
                assert (
                    f"top rival holds {v['best_rival_shares']}, {-v['lead']} more" in p
                )
            elif v["rival_shares_to_pass"] is not None:
                assert f"a rival buying {v['rival_shares_to_pass']} passes you" in p
            seen += 1
        if seen > 30:
            break
    assert seen > 30


def test_merge_tiles_show_every_players_bonus():
    from agents.base import build_context
    from agents.llm.prompt import money

    for g, d in _first_decisions(5, {"place_tile"}):
        ctx = build_context(g, d)
        merges = [
            t
            for t in ctx.calc["viewer"]["tiles"]
            if t["effect"] == "merge" and t["playable"]
        ]
        if not merges:
            continue
        p = build_user_prompt(ctx, [])
        names = {x["player_id"]: x["name"] for x in ctx.calc["players"]}
        for t in merges:
            for sc in t["scenarios"]:
                want = ", ".join(
                    f"{'YOU' if pid == d.player_id else names[pid]} {money(v)}"
                    for pid, v in sc["bonus_by_player"].items()
                )
                assert f"bonuses paid to all: {want or 'nobody holds shares'}" in p
        return
    raise AssertionError("no merge tile in the played game")


@pytest.mark.parametrize("ruleset", [None, "mini"])
def test_disposition_prompt_shows_sell_trade_hold_from_the_calculator(ruleset):
    from agents.base import build_context
    from agents.llm.prompt import money
    from game.ruleset import load_ruleset

    rs = load_ruleset(ruleset) if ruleset else None
    sym = rs.theme.currency_symbol if rs else "$"
    positions = (
        pos
        for seed in (21, 4, 8, 9, 12)
        for pos in _first_decisions(seed, {"stock_disposition"}, ruleset=rs)
    )
    for g, d in positions:
        ctx = build_context(g, d)
        x = ctx.calc["disposition"]
        if not x["trade_max"]["shares_traded"]:
            continue
        p = build_user_prompt(ctx, [])
        tm = x["trade_max"]
        assert (
            f"- SELL all {x['shares']}: {money(x['sell_all_value'], sym)} cash now."
            in p
        )
        assert (
            f"- TRADE {tm['shares_traded']} for {tm['survivor_shares_received']} "
            f"{x['survivor']}" in p
        )
        assert f"worth {money(tm['total_value'], sym)} at the post-merger price" in p
        assert (
            f"{x['survivor_size_after']} tiles at "
            f"{money(x['survivor_price_after'], sym)}/share" in p
        )
        assert "- HOLD:" in p
        return
    raise AssertionError("no tradable disposition in the played game")


def test_trade_response_prompt_values_the_offer(game):
    trade = {
        "trade_id": "t-77",
        "from_player_id": "p2",
        "to_player_id": "p1",
        "offering_stocks": {"juniper": 2},
        "offering_money": 100,
        "requesting_stocks": {"marlowe": 1},
        "requesting_money": 0,
    }
    legal = {
        "action_types": ["accept_trade", "reject_trade"],
        "trade": trade,
        "can_accept": True,
    }
    p = build_user_prompt(make_ctx(game, "p1", "trade_response", legal), [])
    assert "Bob [id p2] offers you: 2 juniper + $100 (worth $900" in p
    assert "in exchange for: 1 marlowe (worth $200" in p
    assert "trade_id = t-77" in p


def test_engine_context_is_included_verbatim(game):
    ctx = make_ctx(
        game,
        "p1",
        "found_chain",
        {"action_types": ["found_chain"], "chains": ["marlowe"]},
        context={"tile": "5C"},
    )
    p = build_user_prompt(ctx, [])
    assert 'Engine context: {"tile":"5C"}' in p
