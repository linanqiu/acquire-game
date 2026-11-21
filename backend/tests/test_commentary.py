"""Tier 1: the commentator's rules and words (no server, no model).

Which events become moments, what the facts contain (public information
only), the checks on a model's answer, the rules-only line and which model
narrates.
"""

from __future__ import annotations

import re

import pytest

import commentary
from agents.llm import commentary as words
from game.game import Game, GamePhase
from tests.support.drive import HeuristicTable


def new_game(seed: int = 5, players: int = 4) -> Game:
    game = Game(seed=seed)
    for i in range(players):
        game.add_player(f"p{i}", ["Ann", "Bob", "Cy", "Di", "Eve", "Flo"][i])
    game.start_game()
    return game


def play_with_moments(seed: int = 5):
    """Play a whole heuristic game, running ``detect`` after every action the
    way the server does. Yields ``(game, events, moments)`` per action."""
    game = new_game(seed)
    table = HeuristicTable(game, seed=seed)
    track = commentary._snapshot(game)
    out = []
    while game.phase != GamePhase.GAME_OVER:
        since = len(game.events)
        from game.decisions import pending_decisions

        actor = pending_decisions(game)[0].player_id
        table.step()
        events = [e for e in game.events[since:] if not e.get("private_to")]
        out.append((events, commentary.detect(game, events, track, actor)))
    return game, out


@pytest.fixture(scope="module")
def played():
    return play_with_moments(5)


def types(moments) -> list[str]:
    return [m["type"] for m in moments]


# --------------------------------------------------------------- the triggers


def test_every_founding_merger_and_the_result_is_a_moment(played):
    game, steps = played
    founded = sum(1 for e in game.events if e["type"] == "chain_founded")
    paid = sum(
        1 for e in game.events if e["type"] == "bonuses_paid" and not e.get("final")
    )
    done = sum(1 for e in game.events if e["type"] == "merger_completed")
    all_types = [t for _ev, ms in steps for t in types(ms)]
    assert founded > 0 and paid > 0
    assert all_types.count("chain_founded") == founded
    assert all_types.count("merger") == paid  # one per acquired chain
    assert all_types.count("merger_done") == done
    assert all_types.count("game_ended") == 1
    assert types(steps[-1][1]) == ["game_ended"]  # nothing else at the end
    assert "chain_safe" in all_types
    assert "end_available" in all_types and all_types.count("end_available") == 1


def test_most_actions_are_not_moments(played):
    """Placing a tile, buying, ending a turn: nothing to say."""
    _game, steps = played
    silent = sum(1 for _ev, ms in steps if not ms)
    assert silent > len(steps) * 0.6
    for events, ms in steps:
        kinds = {e["type"] for e in events}
        if kinds <= {"turn_ended", "tiles_replaced"}:
            assert not [m for m in ms if m["type"] != "lead"], (kinds, types(ms))


def test_merger_moment_says_who_collected_what(played):
    game, steps = played
    names = words.player_names(game)
    paid = [
        e for e in game.events if e["type"] == "bonuses_paid" and not e.get("final")
    ]
    moments = [m for _ev, ms in steps for m in ms if m["type"] == "merger"]
    for e, m in zip(paid, moments, strict=True):
        assert words.chain_name(game.ruleset, e["chain"]) in m["fact"]
        for pid, b in e["bonuses"].items():
            got = b["majority"] + b["minority"]
            if got:
                assert names[pid] in m["fact"]
                assert f"${got:,}" in m["fact"]
        assert m["priority"] > 6 and m["solo"]


def test_majority_moments_are_real_changes_and_rate_limited(played):
    """A majority moment is told only when the top holders really changed,
    never during a merger's settling, and a line-worthy one at most once per
    chain per cooldown."""
    game, steps = played
    solo_turns: dict[str, list[int]] = {}
    seen = 0
    for events, ms in steps:
        kinds = {e["type"] for e in events}
        for m in ms:
            if m["type"] != "majority":
                continue
            seen += 1
            assert "stock_disposition" not in kinds or "merger_completed" in kinds
            assert "changed hands" in m["fact"]
            if m["solo"]:
                solo_turns.setdefault(m["key"][1], []).append(m["turn"])
    assert seen > 0
    for chain, turns in solo_turns.items():
        gaps = [b - a for a, b in zip(turns, turns[1:])]
        assert all(g >= commentary.MAJORITY_COOLDOWN_TURNS for g in gaps), (chain, gaps)


def test_trade_moments():
    game = new_game(3)
    track = commentary._snapshot(game)
    trade = {
        "trade_id": "t1",
        "from_player_id": "p0",
        "to_player_id": "p1",
        "offering_stocks": {"sandpiper": 2},
        "offering_money": 0,
        "requesting_stocks": {},
        "requesting_money": 900,
    }
    accepted = {"seq": 99, "type": "trade_accepted", "player_id": "p1", "trade": trade}
    rejected = {"seq": 100, "type": "trade_rejected", "player_id": "p1", "trade": trade}
    ms = commentary.detect(game, [accepted, rejected], track, "p1")
    assert types(ms) == ["trade_accepted", "trade_rejected"]
    assert "Ann gave 2 Sandpiper and got $900 from Bob" in ms[0]["fact"]
    assert ms[0]["priority"] > ms[1]["priority"]
    assert "Bob turns down Ann's offer of 2 Sandpiper for $900." == ms[1]["say"]


def test_private_events_are_never_moments():
    game = new_game(3)
    track = commentary._snapshot(game)
    private = {
        "seq": 50,
        "type": "chain_founded",
        "player_id": "p0",
        "private_to": "p0",
        "chain": "sandpiper",
        "tile": "1A",
        "size": 2,
    }
    assert commentary.detect(game, [private], track, "p0") == []


def test_quiet_stretch_gives_a_state_of_the_table_moment(played):
    game, _ = played
    q = commentary._quiet_moment(game, 30, 8)
    assert q["type"] == "quiet" and q["solo"]
    assert "tiles left in the bag" in q["say"]
    assert "8 turns" not in q["fact"]  # never "nothing happened for N turns"


def test_a_moment_that_is_no_longer_true_is_dropped():
    """The words are made again when the line is made; a lead that was lost
    meanwhile is not told."""
    game = new_game(5)
    refresh = commentary._lead_words("p0", "nobody alone")
    assert refresh(game) is None  # everyone is level at the start: no leader
    game.players[0].add_money(500)
    fact, say = refresh(game)
    assert "Ann took the lead on net worth: $6,500 now, $500 ahead of Bob" in fact
    assert say.startswith("Ann moves into the lead")
    game.players[1].add_money(900)
    assert refresh(game) is None


# ------------------------------------------------- public information only


def hand_tiles_not_on_board(game) -> set[str]:
    return {str(t) for p in game.players for t in p.hand}


def test_facts_hold_no_private_information():
    """Nothing in the prompt comes from a hand: at every point of a game the
    table, the history and every moment are free of the tiles players hold."""
    game = new_game(7)
    table = HeuristicTable(game, seed=7)
    track = commentary._snapshot(game)
    checked = 0
    from game.decisions import pending_decisions

    while game.phase != GamePhase.GAME_OVER:
        since = len(game.events)
        actor = pending_decisions(game)[0].player_id
        table.step()
        events = [e for e in game.events[since:] if not e.get("private_to")]
        moments = commentary.detect(game, events, track, actor)
        if not moments:
            continue
        prompt = words.build_user_prompt(
            moments, words.table_facts(game), words.history_facts(game), ["earlier"]
        )
        for tile in hand_tiles_not_on_board(game):
            assert not re.search(rf"(?<![0-9A-Za-z]){tile}(?![0-9A-Za-z])", prompt), (
                tile,
                prompt,
            )
        assert "your hand" not in prompt.lower()
        assert "private notes" not in prompt.lower()
        checked += 1
    assert checked > 10


def test_table_facts_are_the_calculators(played):
    game = new_game(5)
    table = HeuristicTable(game, seed=5)
    for _ in range(40):
        table.play_turn()
    text = words.table_facts(game)
    rows = words.standings(game)
    assert rows[0]["rank"] == 1
    for r in rows:
        assert f"{r['name']}: ${r['net_worth']:,} (cash ${r['cash']:,}" in text
    from game.calculator import public_chain_holders

    for chain, info in public_chain_holders(game).items():
        line = next(
            ln
            for ln in text.splitlines()
            if ln.startswith(f"- {words.chain_name(game.ruleset, chain)}:")
        )
        assert f"{info['size']} tiles" in line
        for h in info["holders"]:
            assert f"{words.player_names(game)[h['player_id']]} {h['shares']}" in line
            if h["bonus"]:
                assert f"${h['bonus']:,}" in line


def test_system_prompt_is_static_and_cacheable():
    a = words.build_system_prompt()
    assert a == words.build_system_prompt()
    assert len(a) / 4 > 600  # above the provider's minimum cacheable prefix
    assert "Ann" not in a and "Turn" not in a  # nothing of a game in it
    for needle in ("no exclamation marks", "State nothing that is not written"):
        assert needle in a
    assert words.system_prompt_id(a).startswith("sp-")


# ----------------------------------------------------- checking the answer


def test_made_up_amounts_are_caught():
    prompt = "Ann $6,000 (majority), Bob $3,000 (minority). Ann leads by $1,200."
    assert words.unsupported_amounts("Ann collects $6,000, Bob $3,000.", prompt) == []
    assert words.unsupported_amounts("Ann collects $6000.", prompt) == []
    assert words.unsupported_amounts("That is $9,000 in all.", prompt) == ["9000"]
    assert words.unsupported_amounts("Ann has 6 shares.", prompt) == []


def test_clean_line_keeps_leading_sentences_that_fit():
    assert words.clean_line(None) is None
    assert words.clean_line("   ") is None
    assert words.clean_line(' "Ann  founds\nSandpiper." ') == "Ann founds Sandpiper."
    first = "Ann takes the Sandpiper majority with that buy."
    long = first + " " + "Then a very long second sentence goes on " * 8 + "."
    assert len(long) > words.MAX_LINE_CHARS
    assert words.clean_line(long) == first
    assert words.clean_line("x" * (words.MAX_LINE_CHARS + 1)) is None


def test_style_problems():
    assert words.style_problems("Ann takes the Sandpiper majority.") == []
    assert "exclamation mark" in words.style_problems("Ann takes it!")
    assert "massive" in words.style_problems("A massive merger for Ann.")
    assert "emoji" in words.style_problems("Ann wins \U0001f389")


def test_rules_line_leads_with_the_most_important_and_never_repeats():
    moments = [
        {"priority": 3, "seq": 1, "say": "Bob moves into second place in Halcyon."},
        {"priority": 9, "seq": 2, "say": "Ann merges Halcyon into Meridian."},
        {"priority": 6, "seq": 3, "say": "Meridian is safe at 11 tiles."},
    ]
    assert (
        words.rules_line(moments, [])
        == "Ann merges Halcyon into Meridian. Meridian is safe at 11 tiles."
    )
    # the passing change alone is still a line; with others it is left out
    assert words.rules_line(moments[:1], []) == moments[0]["say"]
    assert words.rules_line(moments[:2], []) == "Ann merges Halcyon into Meridian."
    # nothing new to say: no line
    assert words.rules_line(moments[1:2], ["ann merges halcyon into meridian"]) is None


# ------------------------------------------------------- which model narrates


CATALOG = (
    '[{"provider": "openai", "model": "kimi-k3", "base_url": "https://x.invalid/v1",'
    ' "api_key_env": "KIMI_KEY"},'
    ' {"provider": "anthropic", "model": "claude-haiku-5-5"}]'
)


def test_default_model_is_the_catalogs_haiku_when_it_has_a_key(monkeypatch):
    monkeypatch.delenv("GAME_TEST_MODE", raising=False)
    monkeypatch.setenv("GAME_LLM_CATALOG", CATALOG)
    monkeypatch.setenv("KIMI_KEY", "k")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert words.resolve_model("") is None  # no key: rules-only, never Kimi
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    assert words.resolve_model("").model == "claude-haiku-5-5"
    for off in ("off", "rules", "none", "RULES"):
        assert words.resolve_model(off) is None
    assert words.resolve_model("kimi-k3").model == "kimi-k3"  # only when asked for
    assert words.resolve_model("no-such-model") is None


def test_no_haiku_in_the_catalog_means_rules_only(monkeypatch):
    monkeypatch.delenv("GAME_TEST_MODE", raising=False)
    monkeypatch.setenv(
        "GAME_LLM_CATALOG",
        '[{"provider": "openai", "model": "kimi-k3", "base_url": "https://x.invalid/v1",'
        ' "api_key_env": "KIMI_KEY"}]',
    )
    monkeypatch.setenv("KIMI_KEY", "k")
    assert words.resolve_model("") is None


def test_fake_narrator_only_in_test_mode(monkeypatch):
    monkeypatch.delenv("GAME_LLM_CATALOG", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("GAME_TEST_MODE", "1")
    assert words.resolve_model("") is None  # test mode default: rules-only
    assert words.resolve_model("llm:fake").provider == "fake"
    monkeypatch.delenv("GAME_TEST_MODE")
    assert words.resolve_model("llm:fake") is None
    out = words.fake_commentary_responder("", "- Turn 4: Ann founded X.\n", {})
    assert out == {"line": "Fake commentary, turn 4: Ann founded X."}
