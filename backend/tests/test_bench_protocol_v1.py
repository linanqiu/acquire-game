"""Buyout Bench: protocol schedule, ratings, leaderboard, HTTP routes, CLI,
Python API with an injected agent."""

from __future__ import annotations

import asyncio
import json
import math
import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from agents.scripted import default_action
from bench import (
    BenchError,
    compute_leaderboard,
    get_protocol,
    load_results,
    run_protocol,
    schedule,
)
from bench.protocols import balance, lineups, seatings
from bench.rating import ANCHOR_RATING, bootstrap, bradley_terry, expected_score
from transcripts import read_transcript
from transcripts.replay import final_scores, replay

BACKEND = Path(__file__).resolve().parents[1]
P = get_protocol("bench-v1")


@pytest.fixture
def fast_calc(monkeypatch):
    monkeypatch.setattr("game.calculator.build_calculator_pack", lambda game, pid: {})


class MyAgent:
    """A custom agent nobody registered: first legal action."""

    kind = "llm"

    def __init__(self):
        self.calls = 0

    async def decide(self, ctx):
        self.calls += 1
        return default_action(ctx)


# ---------------------------------------------------------------- schedule


def test_protocol_definition_is_pinned():
    assert P.players == 4 and P.games_per_series == 72 and len(P.seeds) == 18
    assert P.public()["games_per_matchup"] == 72


@pytest.mark.parametrize(
    ("models", "track", "n_series", "perms", "seeds"),
    [
        (["a"], "vs-baseline", 1, 4, 18),
        (["a", "b"], "vs-baseline", 2, 4, 18),
        (["a", "b"], "head-to-head", 1, 12, 6),
        (["a", "b", "c"], "head-to-head", 1, 24, 3),
        (["a", "b", "c", "d"], "head-to-head", 1, 24, 3),
        (["a", "b", "c", "d", "e"], "head-to-head", 5, 24, 3),
    ],
)
def test_schedule_is_balanced(models, track, n_series, perms, seeds):
    lus = lineups(models, track, P)
    assert len(lus) == n_series
    for lu in lus:
        assert len(seatings(lu)) == perms
        specs = schedule(P, track, lu, "v1-x")
        assert len(specs) == 72
        assert sorted({s.seed for s in specs}) == list(P.seeds[:seeds])
        bal = balance(specs)
        for label, by_pos in bal.items():
            copies = lu.count(label)
            # every entrant sits in every position equally often
            assert set(by_pos) == {0, 1, 2, 3}
            assert len(set(by_pos.values())) == 1, (label, by_pos)
            assert sum(by_pos.values()) == 72 * copies
        # every seating is played on the same deal
        for seed in P.seeds[:seeds]:
            assert len([s for s in specs if s.seed == seed]) == perms
        assert len({s.key for s in specs}) == 72


def test_head_to_head_needs_two_models_and_balanced_pairs():
    assert lineups(["a"], "head-to-head", P) == []
    specs = schedule(P, "head-to-head", ["a", "b", "bot", "bot"], "v")
    ahead = sum(1 for s in specs if s.seating.index("a") < s.seating.index("b"))
    assert ahead == 36  # a acts before b in exactly half the games


# ------------------------------------------------------------------ rating


def test_bradley_terry_hand_computed_two_agents():
    games = [[("a", 1), ("bot", 2)]] * 3 + [[("a", 2), ("bot", 1)]]
    r = bradley_terry(games, prior=0)
    assert r["bot"] == ANCHOR_RATING
    assert r["a"] == pytest.approx(1500 + 400 * math.log10(3), abs=1e-6)  # 1690.85
    # ties are half wins: 1 win + 2 ties + 1 loss -> even
    games = [[("a", 1), ("bot", 2)], [("a", 1.5), ("bot", 1.5)]] * 1 + [
        [("a", 1.5), ("bot", 1.5)],
        [("a", 2), ("bot", 1)],
    ]
    assert bradley_terry(games, prior=0)["a"] == pytest.approx(1500, abs=1e-6)


def test_bradley_terry_multiplayer_stationary_and_anchor_fixed():
    # 4-player orders; bot holds two seats (never compared with itself)
    games = [
        [("a", 1), ("b", 2), ("bot", 3), ("bot", 4)],
        [("b", 1), ("a", 2), ("bot", 3), ("bot", 4)],
        [("a", 1), ("bot", 2), ("b", 3), ("bot", 4)],
        [("bot", 1), ("a", 2), ("b", 3), ("bot", 4)],
    ]
    r = bradley_terry(games, prior=0)
    assert r["bot"] == ANCHOR_RATING
    # MLE stationarity: observed wins == expected wins for every agent
    obs = {"a": 0.0, "b": 0.0, "bot": 0.0}
    exp = {"a": 0.0, "b": 0.0, "bot": 0.0}
    for g in games:
        for i, (x, rx) in enumerate(g):
            for y, ry in g[i + 1 :]:
                if x == y:
                    continue
                obs[x] += 1.0 if rx < ry else 0.0
                obs[y] += 1.0 if ry < rx else 0.0
                exp[x] += expected_score(r[x], r[y])
                exp[y] += expected_score(r[y], r[x])
    for k in obs:
        assert exp[k] == pytest.approx(obs[k], abs=1e-6)
    assert r["a"] > r["b"] > r["bot"]
    # adding a prior keeps the anchor fixed and shrinks towards it
    rp = bradley_terry(games, prior=1)
    assert rp["bot"] == ANCHOR_RATING and 1500 < rp["a"] < r["a"]


def test_bootstrap_is_deterministic_and_brackets_estimate():
    games = [[("a", 1), ("bot", 2)]] * 6 + [[("a", 2), ("bot", 1)]] * 4
    r = bradley_terry(games)
    ci1 = bootstrap(games, samples=100, seed=7)
    assert ci1 == bootstrap(games, samples=100, seed=7)
    lo, hi = ci1["a"]
    assert lo <= r["a"] <= hi and lo < hi
    assert ci1["bot"] == (ANCHOR_RATING, ANCHOR_RATING)


def test_leaderboard_never_mixes_prompt_versions():
    def rec(pv, winner):
        return {
            "protocol": "bench-v1",
            "prompt_version": pv,
            "track": "vs-baseline",
            "series_id": f"s-{pv}",
            "status": "completed",
            "seat_order": ["m", "bot"],
            "seat_labels": ["M", "Bot"],
            "standings": [
                {"pos": winner, "player_id": "x", "score": 2, "rank": 1},
                {"pos": 1 - winner, "player_id": "y", "score": 1, "rank": 2},
            ],
            "winners": [winner],
            "finished_at": pv,
            "seats": [
                {
                    "pos": i,
                    "agent": a,
                    "decisions": 1,
                    "fallbacks": 0,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cost_usd": 0.0,
                    "latencies_ms": [],
                    "model": None,
                }
                for i, a in enumerate(["m", "bot"])
            ],
        }

    records = [rec("v1", 0)] * 3 + [rec("v2", 1)] * 2
    b2 = compute_leaderboard(records, bootstrap_samples=0)
    assert b2["prompt_version"] == "v2" and b2["games"] == 2
    m = next(a for a in b2["agents"] if a["agent_id"] == "m")
    assert m["wins"] == 0
    b1 = compute_leaderboard(records, prompt_version="v1", bootstrap_samples=0)
    assert next(a for a in b1["agents"] if a["agent_id"] == "m")["wins"] == 3
    assert b1["available"]["prompt_versions"] == ["v1", "v2"]
    assert any("v2" in w for w in b1["warnings"])


# ------------------------------------------------------- Python API + HTTP


@pytest.fixture(scope="module")
def bench_out(tmp_path_factory):
    out = tmp_path_factory.mktemp("bench") / "run"
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("game.calculator.build_calculator_pack", lambda game, pid: {})
        res = asyncio.run(
            run_protocol([("my-agent", MyAgent)], out=out, track="vs-baseline", games=4)
        )
    return out, res


def test_python_api_with_injected_agent(bench_out, fast_calc):
    out, res = bench_out
    assert res.status == "complete" and res.exit_code == 0
    assert res.result.ran == 4
    for name in ("results.jsonl", "leaderboard.json", "report.md"):
        assert (out / name).is_file()
    records = load_results(out)
    assert len(records) == 4
    assert {r["prompt_version"] for r in records} == {res.prompt_version}
    assert all(r["protocol"] == "bench-v1" for r in records)
    # the custom agent sat in each of the 4 positions once
    assert sorted(r["seat_order"].index("my-agent") for r in records) == [0, 1, 2, 3]
    board = res.leaderboard
    ids = {a["agent_id"] for a in board["agents"]}
    assert ids == {"my-agent", "bot"}
    bot = next(a for a in board["agents"] if a["agent_id"] == "bot")
    assert bot["rating"] == ANCHOR_RATING and bot["cost_per_game"] == 0
    # transcripts replay to the recorded standings
    for r in records:
        t = read_transcript(out / r["transcript"])
        assert t["header"]["bench"]["series_id"] == r["series_id"]
        assert t["header"]["game_id"] == r["game_id"]
        scores = final_scores(replay(t))
        assert scores == {s["player_id"]: s["score"] for s in r["standings"]}
    # resume: nothing re-runs
    again = asyncio.run(
        run_protocol([("my-agent", MyAgent)], out=out, track="vs-baseline", games=4)
    )
    assert again.result.ran == 0 and again.result.skipped == 4


def test_run_protocol_config_errors(tmp_path):
    with pytest.raises(BenchError):
        asyncio.run(run_protocol([], out=tmp_path))
    with pytest.raises(BenchError):
        asyncio.run(run_protocol(["a"], out=tmp_path, protocol="nope"))
    with pytest.raises(BenchError):
        asyncio.run(run_protocol(["a"], out=tmp_path, track="sideways"))


@pytest.fixture
def api(bench_out, monkeypatch, tmp_path):
    out, res = bench_out
    monkeypatch.setenv("GAME_BENCH_DIR", str(out.parent))
    monkeypatch.setenv("GAME_TRANSCRIPT_DIR", str(tmp_path / "live"))
    from main import create_app

    with TestClient(create_app()) as c:
        yield c, out, res


@pytest.mark.parametrize("prefix", ["", "/api"])
def test_http_routes_shapes_pagination_and_404(api, prefix):
    client, out, res = api
    page = client.get(f"{prefix}/games?source=bench&limit=3").json()
    assert len(page["games"]) == 3 and page["next"] == page["games"][-1]["game_id"]
    row = page["games"][0]
    assert set(row) == {
        "game_id",
        "source",
        "status",
        "started_at",
        "ended_at",
        "room_code",
        "series_id",
        "seats",
        "winners",
        "turns",
        "ruleset_id",
        "ruleset_title",
    }
    assert row["status"] == "finished" and row["source"] == "bench"
    assert set(row["seats"][0]) == {"player_id", "name", "kind", "agent_label", "model"}
    rest = client.get(
        f"{prefix}/games?source=bench&limit=3&before={page['next']}"
    ).json()
    assert len(rest["games"]) == 1 and rest["next"] is None
    assert not {g["game_id"] for g in rest["games"]} & {
        g["game_id"] for g in page["games"]
    }
    assert client.get(f"{prefix}/games?source=live").json()["games"] == []

    gid = row["game_id"]
    detail = client.get(f"{prefix}/games/{gid}").json()
    assert detail["standings"] and set(detail["totals"]) == {"p1", "p2", "p3", "p4"}
    r = client.get(
        f"{prefix}/games/{gid}/transcript", headers={"Accept-Encoding": "gzip"}
    )
    assert r.headers["content-encoding"] == "gzip"
    t = r.json()
    assert (
        set(t) == {"header", "entries", "footer", "redacted"} and t["redacted"] is False
    )

    board = client.get(f"{prefix}/bench/leaderboard?protocol=bench-v1").json()
    assert board["protocol"]["id"] == "bench-v1"
    a = board["agents"][0]
    for k in (
        "agent_id",
        "label",
        "model",
        "games",
        "wins",
        "win_rate",
        "ci_low",
        "ci_high",
        "mean_rank",
        "rating",
        "rating_ci",
        "fallback_rate",
        "retry_rate",
        "tokens_per_game",
        "cost_per_game",
        "latency_p50_s",
        "verdict",
    ):
        assert k in a
    (series,) = board["series"]
    assert set(series) >= {"series_id", "matchup", "games", "started_at", "finished"}
    # finished = every planned game of the (capped) run is done; a capped
    # series is not a full protocol series
    assert series["games"] == 4 and series["finished"] is True
    assert series["full_protocol"] is False
    s = client.get(f"{prefix}/bench/series/{series['series_id']}").json()
    assert s["protocol"] == "bench-v1" and len(s["games"]) == 4
    assert set(s["games"][0]) >= {"game_id", "seed", "rotation", "standings"}

    for bad in (
        "/games/nope-123",
        "/games/nope-123/transcript",
        "/games/..%2F..%2Fetc%2Fpasswd",
        "/games/..%2Fresults/transcript",
        "/bench/series/does-not-exist",
        "/bench/leaderboard?protocol=unknown-proto",
    ):
        r = client.get(prefix + bad)
        assert r.status_code == 404, bad
        assert r.headers["content-type"].startswith("application/json")


def test_empty_bench_dir_gives_empty_leaderboard(tmp_path, monkeypatch):
    monkeypatch.setenv("GAME_BENCH_DIR", str(tmp_path / "none"))
    from main import create_app

    with TestClient(create_app()) as c:
        b = c.get("/api/bench/leaderboard").json()
    assert b["protocol"]["id"] == "bench-v1"
    assert b["agents"] == [] and b["series"] == [] and b["updated_at"] is None


# --------------------------------------------------------------------- CLI


def run_cli(*args, env_extra=None, timeout=120):
    env = {**os.environ, **(env_extra or {})}
    env.pop("ANTHROPIC_API_KEY", None)
    return subprocess.run(
        [sys.executable, "-m", "bench", *args],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def test_cli_unavailable_model_exits_2_fast(tmp_path):
    p = run_cli(
        "run",
        "--protocol",
        "bench-v1",
        "--models",
        "llm:claude-haiku-5-5",
        "--out",
        str(tmp_path / "o"),
        "--json",
    )
    assert p.returncode == 2
    out = json.loads(p.stdout)
    assert out["status"] == "config_error" and "ANTHROPIC_API_KEY" in out["error"]
    assert not (tmp_path / "o" / "results.jsonl").exists()


@pytest.mark.slow
def test_cli_protocol_run_end_to_end(tmp_path):
    out = tmp_path / "o"
    p = run_cli(
        "run",
        "--protocol",
        "bench-v1",
        "--models",
        "llm:fake",
        "--track",
        "vs-baseline",
        "--games",
        "2",
        "--out",
        str(out),
        "--json",
        env_extra={"GAME_TEST_MODE": "1"},
    )
    assert p.returncode == 0, p.stderr
    s = json.loads(p.stdout)  # stdout is exactly one JSON document
    assert s["status"] == "complete" and s["exit_code"] == 0
    assert s["games"] == {
        "planned": 2,
        "ran": 2,
        "skipped": 0,
        "aborted": 0,
        "stalled": 0,
    }
    assert s["prompt_version"].startswith("v")
    board = s["leaderboard"]
    assert {a["agent_id"] for a in board["agents"]} == {"llm:fake", "bot"}
    assert len(list((out / "transcripts").glob("*.jsonl"))) == 2
    lb = run_cli("leaderboard", "--out", str(out), "--json")
    assert lb.returncode == 0 and json.loads(lb.stdout)["games"] == 2
    lm = run_cli("list-models", "--json", env_extra={"GAME_TEST_MODE": "1"})
    assert any(m["id"] == "llm:fake" and m["available"] for m in json.loads(lm.stdout))
    # a budget stop is a partial run: exit 1
    p2 = run_cli(
        "run",
        "--protocol",
        "bench-v1",
        "--models",
        "llm:fake",
        "--track",
        "vs-baseline",
        "--games",
        "4",
        "--out",
        str(tmp_path / "o2"),
        "--max-decisions",
        "5",
        "--json",
        env_extra={"GAME_TEST_MODE": "1"},
    )
    assert p2.returncode == 1 and json.loads(p2.stdout)["status"] == "stopped"


def test_importing_bench_does_not_import_the_server():
    code = (
        "import sys, bench; "
        "bad = [m for m in ('fastapi', 'starlette', 'main', 'seats', 'app_state') "
        "if m in sys.modules]; print(bad)"
    )
    p = subprocess.run(
        [sys.executable, "-c", code], cwd=BACKEND, capture_output=True, text=True
    )
    assert p.stdout.strip() == "[]", p.stdout + p.stderr
