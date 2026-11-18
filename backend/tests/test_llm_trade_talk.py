"""Tier 1: what an LLM seat is told when people talk trades (LO-013).

The UMWT game: the seat answered "I give you SP" as if it were asked to give
shares away, deferred every deal to "my turn" and never sent an offer, made up
which chains it had founded, and talked about itself in the third person.
These tests pin the prompt facts and rules that fix that, on positions reached
by real play (bots through the decision API), never hand-built states.
"""

from __future__ import annotations

import pytest

from agents.llm.deal_facts import deal_facts, mentioned_chains, share_moves
from agents.llm.prompt import (
    PROMPT_BUILDER_VERSION,
    build_user_prompt,
    chat_line,
    compact_event,
    render_trade,
)
from agents.llm.talk import TALK_INSTRUCTIONS, build_talk_prompt, render_history
from game.action import TradeOffer
from game.calculator import _standing, build_calculator_pack
from game.decisions import public_events
from tests.llm_support import bot_game, buy_ctx, make_ctx


@pytest.fixture(scope="module")
def game():
    return bot_game(seed=39, min_turns=30)


def names_of(game):
    return {p.player_id: p.name for p in game.players}


def msg(i, pid, name, text, after_seq=-1, reply_to=None, kind="human"):
    return {
        "id": i,
        "player_id": pid,
        "name": name,
        "kind": kind,
        "source": "human" if kind == "human" else "reply",
        "text": text,
        "after_seq": after_seq,
        "reply_to": reply_to,
    }


def view_for(game, me, trigger, chat=None, with_facts=True):
    names = names_of(game)
    return {
        "player_id": me,
        "name": names[me],
        "trigger": trigger,
        "chat": chat or [],
        "lobby_players": [
            {"player_id": p.player_id, "name": p.name, "kind": "human"}
            for p in game.players
        ],
        "kinds": {},
        "state": game.get_player_state(me),
        "events": public_events(game, me),
        "calc": build_calculator_pack(game, me),
        "deal_facts": deal_facts(game, me, trigger) if with_facts else None,
    }


def flipping_pair(game):
    """(me, other, chain, n): a chain where ``other`` giving ``me`` n shares
    changes my bonus position, found in the played position."""
    for other in ("p2", "p3", "p4"):
        for chain in game.hotel.get_active_chains():
            moves = share_moves(game, "p1", other, chain)["receive"]
            for m in moves:
                if m["me"][0] != m["me"][1]:
                    return "p1", other, chain, m["n"]
    raise AssertionError("no chain where a 1-3 share gift changes p1's position")


# ---------------------------------------------------------------- talk rules


def test_talk_rules_match_the_real_trade_mechanics():
    t = TALK_INSTRUCTIONS
    assert "on your turn, and then do it" not in t  # the UMWT rule
    assert "Anyone may send an offer at any time" in t
    assert 'accept or reject it then, not "on your turn"' in t
    assert "only at your own buy step" in t
    assert '"I give you X" means YOU RECEIVE X' in t
    assert "first person" in t and "Never call yourself by your name" in t
    assert "Only state facts shown above" in t and "say you do not remember" in t
    assert "always gets an answer" in t
    assert PROMPT_BUILDER_VERSION == 11


def test_nickname_line_says_it_is_you(game):
    names = {"p1": "Hedge Hogg", "p2": "Bob", "p3": "Cara", "p4": "Dan"}
    v = view_for(game, "p1", {"source": "human", "message": None, "events": []})
    v["name"] = "Hedge Hogg"
    v["lobby_players"] = [
        {"player_id": k, "name": n, "kind": "human"} for k, n in names.items()
    ]
    p = build_talk_prompt(v)
    assert (
        'Players may call you "Hedge"; that is you, so answer in the first person.' in p
    )


# ---------------------------------------------------------------- deal facts


def test_chains_are_found_by_name_or_capital_abbreviation(game):
    sp = next(c for c in game.ruleset.chains if c.id == "sandpiper")
    assert mentioned_chains(game, f"if I give you {sp.abbreviation}") == ["sandpiper"]
    assert mentioned_chains(game, "some Sandpiper?") == ["sandpiper"]
    # "me" is not meridian (ME): abbreviations only count in capitals
    assert "meridian" not in mentioned_chains(game, "give me some")


def test_deal_facts_show_the_direction_and_the_rank_effect(game):
    me, other, chain, n = flipping_pair(game)
    abbr = next(c.abbreviation for c in game.ruleset.chains if c.id == chain)
    name = names_of(game)[other]
    trigger = {
        "source": "human",
        "message": msg(5, other, name, f"If I give you {abbr} you get ahead"),
    }
    facts = deal_facts(game, me, trigger)
    assert facts["other_id"] == other and facts["named"]
    c = next(x for x in facts["chains"] if x["chain"] == chain)
    holdings = {p.player_id: p.get_stock_count(chain) for p in game.players}
    # receiving: my count goes up, theirs down, standings as the engine ranks them
    for m in c["receive"]:
        after = dict(holdings)
        after[me] += m["n"]
        after[other] -= m["n"]
        assert m["my_shares"] == holdings[me] + m["n"]
        assert m["me"] == (_standing(holdings, me), _standing(after, me))
        assert m["other"] == (_standing(holdings, other), _standing(after, other))
    for m in c["give"]:
        assert m["my_shares"] == holdings[me] - m["n"]

    p = build_talk_prompt(view_for(game, me, trigger))
    assert "# Deal facts (calculator: you and " + name + ")" in p
    assert f'If {name} says "I give you X", YOU RECEIVE X' in p
    move = c["receive"][n - 1]
    assert f"{name} gives you {n} {chain}: you {holdings[me] + n}" in p
    assert f"value to you {'+' if move['value'] >= 0 else '-'}$" in p
    # the block sits before the trigger, after the voice
    assert p.index("# Deal facts") < p.index("# Why you are asked now")


def test_no_deal_facts_for_small_talk(game):
    trigger = {"source": "human", "message": msg(5, "p2", "Bob", "nice evening")}
    assert deal_facts(game, "p1", trigger) is None
    p = build_talk_prompt(view_for(game, "p1", trigger))
    assert "# Deal facts" not in p
    # events never get the block either (no message to read)
    ev = {"source": "event", "message": None, "events": []}
    assert deal_facts(game, "p1", ev) is None


def test_a_deal_word_without_a_chain_lists_the_chains_that_would_flip(game):
    trigger = {"source": "human", "message": msg(5, "p2", "Bob", "trade?")}
    facts = deal_facts(game, "p1", trigger)
    assert facts is not None and not facts["named"]
    for c in facts["chains"]:
        assert any(
            m["me"][0] != m["me"][1] or m["other"][0] != m["other"][1]
            for m in c["receive"] + c["give"]
        )


def test_open_and_answered_offers_are_shown_from_the_seats_side(game):
    g = bot_game(seed=39, min_turns=30)
    me, other, chain, n = flipping_pair(g)
    name = names_of(g)[other]
    offer = TradeOffer(
        from_player_id=other,
        to_player_id=me,
        offering_stocks={chain: n},
        offering_money=0,
        requesting_stocks={},
        requesting_money=100,
        trade_id="t-1",
    )
    assert g.propose_trade(offer).success
    trigger = {"source": "human", "message": msg(5, other, name, "take it")}
    p = build_talk_prompt(view_for(g, me, trigger))
    assert f"- Open offer from {name} to you: you GIVE $100, you GET {n} {chain}." in p
    # after it is rejected, "that" still refers to it
    assert g.reject_trade(me, "t-1").success
    trigger = {
        "source": "human",
        "message": msg(6, other, name, "no but that helps you"),
    }
    p = build_talk_prompt(view_for(g, me, trigger))
    assert (
        f"- Last offer between you (from {name}, rejected): you GIVE $100, "
        f"you GET {n} {chain}." in p
    )
    # and the event log says who gives what (it was cut off before the money)
    assert f"{name} offered " in p and f"{name} gives {n} {chain}" in p


# ---------------------------------------------------------------- history


def test_who_did_what_counts_the_whole_game(game):
    events = public_events(game, "p1")
    calc = build_calculator_pack(game, "p1")
    names = names_of(game)
    text = render_history(events, calc, names, "p1")
    for p in game.players:
        founded = [
            e["chain"]
            for e in events
            if e["type"] == "chain_founded" and e["player_id"] == p.player_id
        ]
        merged = sum(
            1
            for e in events
            if e["type"] == "merger_started" and e["player_id"] == p.player_id
        )
        line = next(x for x in text.splitlines() if x.startswith(f"- {p.name}"))
        assert f"founded {len(founded)} chain" in line
        assert all(c in line for c in founded)
        assert f"set off {merged} merger" in line
    assert "- Alice (YOU):" in text
    p = build_talk_prompt(
        view_for(game, "p1", {"source": "human", "message": msg(1, "p2", "Bob", "hi")})
    )
    assert "# Who did what this game (whole game)" in p


def test_an_unnamed_follow_up_to_the_seats_reply_is_to_you(game):
    chat = [
        msg(1, "p2", "Bob", "Alice, how are you"),
        msg(2, "p1", "Alice", "fine", reply_to=1, kind="llm"),
        msg(3, "p2", "Bob", "and the deal?"),
    ]
    p = build_talk_prompt(
        view_for(game, "p1", {"source": "human", "message": chat[2]}, chat=chat)
    )
    assert "Bob just wrote (to you, after your last message)" in p
    # someone else spoke in between: back to the table
    chat2 = chat[:2] + [msg(3, "p3", "Cara", "hm"), msg(4, "p2", "Bob", "and?")]
    p = build_talk_prompt(
        view_for(game, "p1", {"source": "human", "message": chat2[3]}, chat=chat2)
    )
    assert "Bob just wrote (to the table)" in p


# ---------------------------------------------------------------- decisions


def test_trade_events_say_who_gives_what():
    names = {"a": "Linan", "b": "Hedge Hogg"}
    t = TradeOffer("a", "b", {"sandpiper": 3}, 0, {}, 5000, trade_id="x").to_dict()
    e = {"seq": 1, "type": "trade_proposed", "player_id": "a", "trade": t}
    assert (
        compact_event(e, names)
        == "Linan offered Hedge Hogg a trade: Linan gives 3 sandpiper, Hedge Hogg gives $5,000"
    )
    e = {"seq": 2, "type": "trade_rejected", "player_id": "b", "trade": t}
    assert compact_event(e, names).startswith("Hedge Hogg rejected Linan's offer:")
    e = {"seq": 3, "type": "trade_accepted", "player_id": "b", "trade": t}
    assert compact_event(e, names).endswith("(done)")
    e = {"type": "trade_cancelled", "player_id": "a", "reason": "cancelled", "trade": t}
    assert "was cancelled (withdrawn)" in compact_event(e, names)


def test_offer_line_says_what_you_give_and_get(game):
    calc = build_calculator_pack(game, "p1")
    t = TradeOffer("p2", "p1", {}, 0, {}, 0, trade_id="t9").to_dict()
    t.update(offering_stocks={"sandpiper": 3}, requesting_money=5000)
    text = render_trade(t, calc, names_of(game))
    assert "If you accept: you GIVE $5,000" in text
    assert "you GET 3 sandpiper" in text
    assert f"you have ${calc['viewer']['cash']:,} cash" in text
    assert (
        "describe the offer this way round (you give $5,000, you get 3 sandpiper)"
        in text
    )


def test_buy_step_names_propose_trade_and_lists_deal_talk_since_last_turn(game):
    events = public_events(game, "p1")
    my_end = max(
        e["seq"] for e in events if e["type"] == "turn_ended" and e["player_id"] == "p1"
    )
    old = msg(1, "p1", "Alice", "I'll send you an offer, Bob", after_seq=my_end - 1)
    new = msg(2, "p2", "Bob", "I give you 2, you give me 1?", after_seq=my_end + 1)
    mine = msg(3, "p1", "Alice", "ok, I'll send the offer", after_seq=my_end + 1)
    chit = msg(4, "p3", "Cara", "nice weather", after_seq=my_end + 1)
    ctx = buy_ctx(game, events=events)
    ctx.chat = [old, new, mine, chit]
    p = build_user_prompt(ctx, [])
    assert "This is also the only time you can propose a trade" in p
    block = p.split("# Deal talk since your last turn (follow up now)\n", 1)[1]
    block = block.split("\n\n", 1)[0]
    assert chat_line(new) in block and chat_line(mine) in block
    assert chat_line(old) not in block and chat_line(chit) not in block
    assert "send it now with propose_trade" in block
    assert "X goes in your requesting_stocks and Y in your offering_stocks" in block


def test_no_deal_talk_block_without_deal_talk_or_without_propose_trade(game):
    events = public_events(game, "p1")
    ctx = buy_ctx(game, events=events)
    ctx.chat = [msg(1, "p2", "Bob", "nice weather", after_seq=10**6)]
    assert "# Deal talk" not in build_user_prompt(ctx, [])
    calc = build_calculator_pack(game, "p1")
    legal = {"action_types": ["buy_stocks", "end_turn"], "options": [], "max_total": 3}
    ctx = make_ctx(game, "p1", "buy_stocks", legal, events=events)
    ctx.chat = [msg(1, "p2", "Bob", "trade?", after_seq=10**6)]
    assert calc and "# Deal talk" not in build_user_prompt(ctx, [])
