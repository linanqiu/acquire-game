"""Tier 1: every bot generation stays playable (agents/bot_versions.py) and
the self-play tournament harness (bench/bot_tournament.py) runs.

Games are played through ``build_context`` -> ``HeuristicAgent.choose`` ->
``apply_action``, the path every bot seat takes.
"""

from __future__ import annotations

import json

import pytest

from agents import registry
from agents.bot_versions import DEFAULT_VERSION, VERSIONS, get_policy
from agents.heuristic import HeuristicAgent
from bench import bot_tournament as bt


@pytest.mark.parametrize("version", sorted(VERSIONS))
@pytest.mark.parametrize("difficulty", ["easy", "medium", "hard"])
def test_every_version_plays_full_games(version, difficulty):
    for seed in (1, 2):
        g = bt.play_game(seed, [version] * 4, difficulty)
        assert len(g["final"]) == 4 and min(g["ranks"]) == 1
        assert sum(g["final"]) > 0


def test_mixed_tables_of_three_to_six_seats():
    versions = sorted(VERSIONS)
    for seats in bt.mixed_seatings(versions, sizes=(3, 6))[:: len(versions)]:
        g = bt.play_game(7, seats)
        assert len(g["final"]) == len(seats)


def test_version_choice_and_default():
    assert HeuristicAgent().version == DEFAULT_VERSION
    assert get_policy().version == DEFAULT_VERSION
    for v in VERSIONS:
        assert registry.create(f"bot:{v}", name="x").version == v
        assert registry.create("bot", name="x", version=v).version == v
    with pytest.raises(ValueError):
        get_policy("v0")
    with pytest.raises(registry.UnknownAgentError):
        registry.create("bot:v0", name="x")


def test_test_mode_catalog_offers_the_other_generations(monkeypatch):
    monkeypatch.delenv("GAME_TEST_MODE", raising=False)
    assert not any(e["id"].startswith("bot:") for e in registry.catalog())
    monkeypatch.setenv("GAME_TEST_MODE", "1")
    ids = {e["id"] for e in registry.catalog()}
    assert {f"bot:{v}" for v in VERSIONS if v != DEFAULT_VERSION} <= ids
    assert f"bot:{DEFAULT_VERSION}" not in ids  # that one is "+ ADD BOT"
    assert registry.entry("bot:v1")["kind"] == "bot"


def test_tournament_harness_runs_a_tiny_pairing(capsys):
    first, second = DEFAULT_VERSION, "v1"
    assert bt.main([first, second, "--seeds", "3"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["games_played"] == 10  # 2 x 2v2 + 8 x 1v3
    p = out["paired"]
    assert (p["games_2v2"], p["games_1v3"], p["seeds"]) == (2, 8, 1)
    for v in (first, second):
        s = out["summary"][v]
        assert s["seat_games"] == 20
        assert set(s["profile"]) == set(bt.PROFILE_KEYS)
        assert 1 <= s["rank"] <= 4
    # margins are zero-sum between the two versions in 4-seat games
    assert out["summary"][first]["margin"] == -out["summary"][second]["margin"]


def test_tournament_is_repeatable():
    a = bt.play_game(11, ["v1", "v2", "v1", "v2"])
    b = bt.play_game(11, ["v1", "v2", "v1", "v2"])
    assert a == b
