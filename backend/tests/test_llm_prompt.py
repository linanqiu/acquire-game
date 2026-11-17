"""Prompt synthesis for LLM seats."""

import json
import re

import pytest
from agents.llm.prompt import (
    PromptBudget,
    PROMPT_BUILDER_VERSION,
    build_system_prompt,
    build_user_prompt,
    render_board,
    render_event,
    render_events,
)
from game.calculator import build_calculator_pack
from game.decisions import public_events
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
    log = p.split("# Recent public events")[1].split("# Your private notes")[0]
    assert "8H" not in log
    # own draws and turn ends are noise (the hand and the player to move are
    # shown above): not rendered either
    assert "9I" not in log and "turn ended" not in log
    evs.append(
        {
            "seq": 3,
            "type": "tile_placed",
            "player_id": "p2",
            "tile": "7C",
            "outcome": "nothing",
        }
    )
    p = build_user_prompt(place_ctx(game, events=evs), [])
    assert "Bob placed 7C (lone tile)" in p


def test_prompt_stays_under_budget_with_500_events(game):
    ctx = place_ctx(game, events=sample_events(500))
    p = build_user_prompt(ctx, ["note"] * 6)
    section = p.split("# Recent public events")[1].split("# Your private notes")[0]
    lines = section.strip().splitlines()
    b = PromptBudget()
    assert len(lines) <= b.detailed_events + b.milestone_lines + 2
    assert len(p) < 12_000
    assert "Latest events, oldest first:" in section
    # the rest of the prompt is not affected by the log length
    small = build_user_prompt(place_ctx(game, events=sample_events(5)), ["note"] * 6)
    assert len(p) - len(small) < 3_500


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
    recent = sec.split("Latest events, oldest first:")[1]
    assert len(recent.strip().splitlines()) == 5
    assert len(sec.split("Key earlier events:")[1].split("Latest")[0].split()) > 0
    none = build_user_prompt(ctx, [], budget=PromptBudget(detailed_events=0))
    none_sec = none.split("# Recent public events")[1].split("# Your private notes")[0]
    assert none_sec.split("Latest events, oldest first:")[1].strip() == ""


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
    assert out.splitlines() == ["a", "None", "5", "b"]  # no sequence numbers
    assert render_events([], names, PromptBudget()) == "(no events yet)"
    # a known type with an unexpected shape still renders
    odd = render_events(
        [{"type": "bonuses_paid", "bonuses": "??"}, {"type": "stocks_purchased"}],
        names,
        PromptBudget(),
    )
    assert "bonuses paid" in odd and "stocks purchased" not in odd


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


def test_trade_response_prompt_shows_position_aware_numbers():
    """The offer block carries the numbers of game.trade_value for the seat
    deciding, so the model does not have to work out bonus positions."""
    from agents.base import build_context
    from game.calculator import build_calculator_pack
    from game.decisions import TRADE_RESPONSE, apply_action, pending_decisions

    g = bot_game(seed=39, min_turns=30)
    calc = build_calculator_pack(g, "p1")
    # A chain where p1 collects a bonus: p2 asks for all of p1's shares for
    # their list price (or all the cash it has, if that is less).
    chain = next(
        c
        for c, info in calc["chains"].items()
        if info["active"] and info["payouts"].get("p1", {}).get("total")
    )
    held = calc["chains"][chain]["viewer"]["shares"]
    cost = held * calc["chains"][chain]["price"]
    paid = min(cost, g.get_player("p2").money)
    assert paid > 0
    r = apply_action(
        g,
        "p2",
        {
            "action": "propose_trade",
            "to_player_id": "p1",
            "offering_money": paid,
            "requesting_stocks": {chain: held},
        },
    )
    assert r["success"], r
    decision = next(d for d in pending_decisions(g) if d.kind == TRADE_RESPONSE)
    ctx = build_context(g, decision)
    v = ctx.calc["trades"][r["trade_id"]]
    assert v["viewer"]["bonus_change"] < 0 and not v["acceptable"]
    p = build_user_prompt(ctx, [])
    offer = p.split("# The offer\n", 1)[1].split("\n#", 1)[0]
    assert f"At list prices: give ${cost:,}, get ${paid:,}." in offer
    assert "Counting bonus positions" in offer
    assert (
        f"net -${-v['viewer']['change']:,} for you "
        f"(bonuses -${-v['viewer']['bonus_change']:,})"
    ) in offer
    them = v["counterparty"]["change"]
    assert f"{'+' if them >= 0 else '-'}${abs(them):,} for Bob" in offer
    assert f"you in {chain}: " in offer and "-> no bonus position" in offer


def test_buy_prompt_shows_open_offers_between_other_players(game):
    """Offers are public: an offer between two other seats is in my prompt,
    valued at current prices; my own offers are not repeated there."""
    theirs = {
        "trade_id": "t-90",
        "from_player_id": "p2",
        "to_player_id": "p3",
        "offering_stocks": {"juniper": 2},
        "offering_money": 0,
        "requesting_stocks": {},
        "requesting_money": 600,
    }
    mine = {**theirs, "trade_id": "t-91", "from_player_id": "p1"}
    ctx = make_ctx(game, "p1", "buy_stocks", {"action_types": ["buy_stocks"]})
    heading = "# Open offers between other players (public"
    assert heading not in build_user_prompt(ctx, [])
    names = {p["player_id"]: p["name"] for p in ctx.state["players"]}
    ctx.state["pending_trades"] = [theirs, mine]
    p = build_user_prompt(ctx, [])
    block = p.split(heading)[1].split("\n\n")[0]
    assert (
        f"- {names['p2']} [id p2] offers {names['p3']} [id p3]: 2 juniper "
        "(worth $800) for $600 (worth $600)." in block
    )
    assert block.count("\n- ") == 1  # my own offer to p3 is not listed here
    # only where a competing offer can be made (the buy step)
    place = place_ctx(game, "p1", events=[])
    place.state["pending_trades"] = [theirs]
    assert heading not in build_user_prompt(place, [])


def test_rules_text_says_offers_are_public():
    s = build_system_prompt()
    assert "Offers are public" in s and "competing offer" in s
    assert PROMPT_BUILDER_VERSION == 9


def test_playbook_teaches_position_aware_trading():
    s = build_system_prompt()
    line = next(x for x in s.splitlines() if x.startswith("- Trade offer:"))
    for needle in (
        "majority/minority positions",
        "not by list price",
        "holds a bonus position",
        "premium",
        "helps the other side more than me",
        "Rules-based opponents",
    ):
        assert needle in line, needle
    assert 80 <= len(line.split()) <= 130


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


# --------------------------------------------------------- prompt size (cost)


def test_event_log_is_compact_and_leaves_out_noise():
    names = {"p1": "Alice", "p2": "Bob"}
    evs = [
        {"seq": 0, "type": "game_started", "turn_order": ["p1", "p2"]},
        {"seq": 1, "type": "tiles_dealt", "player_id": "p1", "tiles": ["1A"]},
        {
            "seq": 2,
            "type": "tile_placed",
            "player_id": "p1",
            "tile": "4F",
            "outcome": "nothing",
        },
        {
            "seq": 3,
            "type": "stocks_purchased",
            "player_id": "p1",
            "purchases": {},
            "total_cost": 0,
        },
        {"seq": 4, "type": "turn_ended", "player_id": "p1", "next_player_id": "p2"},
        {
            "seq": 5,
            "type": "tile_placed",
            "player_id": "p2",
            "tile": "4E",
            "outcome": "found",
        },
        {
            "seq": 6,
            "type": "chain_founded",
            "player_id": "p2",
            "chain": "marlowe",
            "tile": "4E",
            "size": 2,
            "founder_bonus_type": "stock",
            "founder_bonus_value": 1,
        },
        {
            "seq": 7,
            "type": "stocks_purchased",
            "player_id": "p2",
            "purchases": {"marlowe": 2, "halcyon": 0},
            "prices": {"marlowe": 200},
            "total_cost": 400,
        },
        {"seq": 8, "type": "tile_drawn", "player_id": "p2", "tile": "9I"},
        {
            "seq": 9,
            "type": "tile_placed",
            "player_id": "p1",
            "tile": "4D",
            "outcome": "expand",
            "chains": ["marlowe"],
        },
        {
            "seq": 10,
            "type": "chain_expanded",
            "player_id": "p1",
            "chain": "marlowe",
            "tile": "4D",
            "size": 3,
        },
        {
            "seq": 11,
            "type": "merger_started",
            "player_id": "p2",
            "tile": "5D",
            "survivor": "halcyon",
            "defunct": ["marlowe"],
            "sizes": {"halcyon": 5, "marlowe": 3},
        },
        {
            "seq": 12,
            "type": "bonuses_paid",
            "chain": "marlowe",
            "chain_size": 3,
            "final": False,
            "bonuses": {"p2": {"majority": 3000, "minority": 1500}},
        },
        {
            "seq": 13,
            "type": "stock_disposition",
            "player_id": "p2",
            "defunct_chain": "marlowe",
            "surviving_chain": "halcyon",
            "sell": 1,
            "trade": 2,
            "hold": 0,
            "sale_proceeds": 300,
            "survivor_shares_received": 1,
        },
        {
            "seq": 14,
            "type": "tile_placed",
            "player_id": "p1",
            "tile": "7C",
            "outcome": "found",
        },
    ]
    assert render_events(evs, names, PromptBudget()).splitlines() == [
        "Alice placed 4F (lone tile)",
        "Bob placed 4E and founded marlowe (2 tiles)",
        "Bob bought marlowe 2 for $400",
        "Alice placed 4D: marlowe grows to 3",
        "Bob placed 5D: MERGER, halcyon (5) absorbs marlowe (3)",
        "bonuses for marlowe (3 tiles): Bob $4,500",
        "Bob marlowe shares: sold 1 for $300, traded 2 for 1 halcyon, kept 0",
        # the placement whose founding decision is still open is shown
        "Alice placed 7C: found",
    ]


def test_long_games_keep_key_earlier_events_as_milestones():
    names = {"p1": "Alice"}
    evs = [
        {
            "seq": 0,
            "type": "chain_founded",
            "player_id": "p1",
            "chain": "marlowe",
            "tile": "1A",
            "size": 2,
        },
    ] + [
        {
            "seq": i,
            "type": "tile_placed",
            "player_id": "p1",
            "tile": f"{i % 12 + 1}B",
            "outcome": "nothing",
        }
        for i in range(1, 60)
    ]
    out = render_events(evs, names, PromptBudget(detailed_events=10, milestone_lines=3))
    lines = out.splitlines()
    assert lines[:3] == [
        "Key earlier events:",
        "  Alice placed 1A and founded marlowe (2 tiles)",
        "Latest events, oldest first:",
    ]
    assert len(lines) == 13


def test_chains_off_the_board_share_one_line():
    game = bot_game(seed=3, min_turns=4)  # early: most chains not founded yet
    p = build_user_prompt(place_ctx(game), [])
    section = p.split("# Chains (calculator)")[1].split("# Players")[0]
    off = [
        c
        for c, v in build_calculator_pack(game, "p1")["chains"].items()
        if not v["active"]
    ]
    assert off, "the fixture game should have a chain off the board"
    assert section.count("NOT on the board") == 1
    line = next(x for x in section.splitlines() if "NOT on the board" in x)
    assert all(c in line and "/share if founded" in line for c in off)


def test_purchase_counts_with_the_same_outcome_share_a_line(game):
    ctx = buy_ctx(game)
    section = (
        build_user_prompt(ctx, [])
        .split("# Purchase options (calculator)")[1]
        .split("# Bank and end game")[0]
    )
    opts = ctx.calc["buy_options"]
    assert opts
    merged_some = False
    for chain, o in opts.items():
        outcomes = [
            (p["standing_after"], p["payout_after"], p["payout_change"])
            for p in o["purchases"].values()
        ]
        runs = (
            (1 + sum(1 for a, b in zip(outcomes, outcomes[1:]) if a != b))
            if outcomes
            else 0
        )
        merged_some = merged_some or runs < len(outcomes)
        block = section.split(f"- {chain}: ")[1].split("\n- ")[0]
        assert len(block.strip().splitlines()) == 1 + runs
        for p in o["purchases"].values():  # every count's cost is still shown
            assert f"${p['cost']:,}" in block
    if merged_some:
        assert re.search(r"buy 1-\d: cost \$[\d,]+ / \$", section)


def test_purchase_lines_merge_only_counts_with_the_same_outcome():
    calc = {
        "buy_options": {
            "marlowe": {
                "price": 200,
                "available": 20,
                "max_affordable": 3,
                "standing_now": "none",
                "payout_now": 0,
                "purchases": {
                    "1": {
                        "cost": 200,
                        "cash_after": 800,
                        "standing_after": "minority_sole",
                        "payout_after": 1000,
                        "payout_change": 1000,
                    },
                    "2": {
                        "cost": 400,
                        "cash_after": 600,
                        "standing_after": "minority_sole",
                        "payout_after": 1000,
                        "payout_change": 1000,
                    },
                    "3": {
                        "cost": 600,
                        "cash_after": 400,
                        "standing_after": "majority_tied",
                        "payout_after": 1500,
                        "payout_change": 1500,
                    },
                },
            }
        }
    }
    from agents.llm.prompt import render_buy_options

    assert render_buy_options(calc).splitlines()[1:] == [
        "    buy 1-2: cost $200 / $400, sole minority, bonus payout $1,000 (+$1,000)",
        "    buy 3: cost $600, tied for majority, bonus payout $1,500 (+$1,500)",
    ]


def test_decision_prompt_is_about_half_the_size_it_was(game):
    # Version 6 rendered ~10,000 characters for this position (60 raw events,
    # six notes, the full legal dict); a guard against the prompt growing back.
    ctx = place_ctx(game, events=public_events(game, "p1"))
    p = build_user_prompt(ctx, ["a plan " * 30] * 3)
    assert len(p) < 8_000, len(p)
