"""Acquire Bench on a chosen ruleset: every game record, transcript header,
series id/key and leaderboard names the ruleset; results of different ruleset
fingerprints are never mixed; a transcript replays under its own ruleset."""

from __future__ import annotations

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from agents.scripted import default_action
from bench import compute_leaderboard, load_results, run_protocol
from bench.cli import main as bench_main
from bench.runner import resolve_ruleset, run_game
from bench.series import run_series
from game.ruleset import Ruleset, classic, load_ruleset
from transcripts import read_transcript
from transcripts.replay import ReplayError, final_scores, replay

MINI = load_ruleset("mini")
VALLEY = load_ruleset("valley")
CLASSIC = classic()


@pytest.fixture(autouse=True)
def fast_calc(monkeypatch):
    monkeypatch.setattr("game.calculator.build_calculator_pack", lambda game, pid: {})


class MyAgent:
    kind = "llm"

    async def decide(self, ctx):
        return default_action(ctx)


def protocol_run(out, ruleset, games=4):
    return asyncio.run(
        run_protocol(
            [("my-agent", MyAgent)],
            out=out,
            track="vs-baseline",
            games=games,
            ruleset=ruleset,
        )
    )


# ------------------------------------------------------------ single game


def test_game_record_and_transcript_header_name_the_ruleset(tmp_path):
    rec = asyncio.run(
        run_game(["bot", "bot", "bot"], 3, transcript_dir=tmp_path, ruleset="mini")
    )
    assert rec.status == "completed"
    d = rec.to_dict()
    assert d["ruleset_id"] == "mini" and d["ruleset_fingerprint"] == MINI.fingerprint
    t = read_transcript(rec.transcript)
    h = t["header"]
    assert h["ruleset_id"] == "mini" and h["ruleset_fingerprint"] == MINI.fingerprint
    assert h["ruleset"] == MINI.to_dict()
    # prompt version separates rulesets even when no LLM plays
    assert h["prompt_version"] != protocol_prompt_version(CLASSIC)


def protocol_prompt_version(rs):
    from agents.llm.prompt import prompt_version

    return prompt_version(rs)


def test_default_ruleset_is_the_servers_configured_one(tmp_path, monkeypatch):
    from config import get_settings

    assert resolve_ruleset(None) == CLASSIC
    monkeypatch.setattr(get_settings(), "game_ruleset", "mini")
    assert resolve_ruleset(None) == MINI
    rec = asyncio.run(run_game(["bot", "bot", "bot"], 2, transcript_dir=tmp_path))
    assert rec.ruleset_id == "mini"
    assert resolve_ruleset("valley") == VALLEY  # explicit wins
    assert resolve_ruleset(VALLEY) is VALLEY


def test_replay_reproduces_standings_under_the_transcripts_own_ruleset(tmp_path):
    """Server default is classic; the game was played on valley."""
    rec = asyncio.run(
        run_game(["bot", "bot", "bot"], 4, transcript_dir=tmp_path, ruleset="valley")
    )
    assert rec.status == "completed"
    t = read_transcript(rec.transcript)
    game = replay(t)
    assert game.ruleset == VALLEY
    assert final_scores(game) == {s["player_id"]: s["score"] for s in rec.standings}
    # a replay that forgot the ruleset would have refused valley's chains
    t["header"]["ruleset"] = None
    t["header"]["ruleset_fingerprint"] = None
    with pytest.raises(ReplayError):
        replay(t)


def test_replay_rejects_a_tampered_ruleset_fingerprint(tmp_path):
    rec = asyncio.run(
        run_game(["bot", "bot", "bot"], 4, transcript_dir=tmp_path, ruleset="mini")
    )
    t = read_transcript(rec.transcript)
    t["header"]["ruleset_fingerprint"] = "0" * 12
    with pytest.raises(ReplayError, match="fingerprint"):
        replay(t)


def test_transcripts_without_a_ruleset_are_classic(tmp_path):
    rec = asyncio.run(run_game(["bot", "bot", "bot"], 4, transcript_dir=tmp_path))
    t = read_transcript(rec.transcript)
    for k in ("ruleset", "ruleset_id", "ruleset_fingerprint"):
        t["header"].pop(k)  # as written before rulesets existed
    game = replay(t)
    assert game.ruleset == CLASSIC
    assert final_scores(game) == {s["player_id"]: s["score"] for s in rec.standings}


# ------------------------------------------------------------- series


def test_adhoc_series_on_mini_records_ruleset_in_keys_and_records(tmp_path):
    res_path = tmp_path / "results.jsonl"
    res = asyncio.run(
        run_series(
            [["bot", "bot", "bot"]], 2, results_path=res_path, ruleset=MINI, seed=3
        )
    )
    assert res.status == "complete" and res.ran == 2
    recs = load_results(res_path)
    assert len(recs) == 2
    for r in recs:
        assert r["ruleset_id"] == "mini"
        assert r["ruleset_fingerprint"] == MINI.fingerprint
        assert f"rs=mini:{MINI.fingerprint}" in r["key"]
        t = read_transcript(res_path.parent / r["transcript"])
        assert t["header"]["ruleset_fingerprint"] == MINI.fingerprint
        assert final_scores(replay(t)) == {
            s["player_id"]: s["score"] for s in r["standings"]
        }
    # same matchup on classic is a different series with different keys: it is
    # played, not skipped as "already done"
    again = asyncio.run(
        run_series(
            [["bot", "bot", "bot"]],
            2,
            results_path=res_path,
            ruleset=CLASSIC,
            seed=3,
        )
    )
    assert again.ran == 2 and again.skipped == 0
    by_rs = {}
    for r in load_results(res_path):
        by_rs.setdefault(r["ruleset_id"], set()).add(r["series_id"])
    assert set(by_rs) == {"mini", "classic"}
    assert by_rs["mini"].isdisjoint(by_rs["classic"])


# ----------------------------------------------------- protocol + board


@pytest.fixture(scope="module")
def mixed_out(tmp_path_factory):
    """One results directory holding the same protocol run on mini and classic."""
    out = tmp_path_factory.mktemp("bench") / "run"
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("game.calculator.build_calculator_pack", lambda game, pid: {})
        mini = protocol_run(out, "mini")
        classic_res = protocol_run(out, None)
    return out, mini, classic_res


def test_protocol_on_mini_records_ruleset_everywhere(mixed_out):
    out, mini, classic_res = mixed_out
    assert mini.status == "complete" and classic_res.status == "complete"
    assert mini.ruleset_id == "mini" and classic_res.ruleset_id == "classic"
    assert mini.summary()["ruleset_fingerprint"] == MINI.fingerprint
    assert mini.prompt_version != classic_res.prompt_version
    recs = load_results(out)
    assert len(recs) == 8
    minis = [r for r in recs if r["ruleset_id"] == "mini"]
    assert len(minis) == 4
    for r in minis:
        assert r["ruleset_fingerprint"] == MINI.fingerprint
        assert ".mini." in r["series_id"]
        assert r["prompt_version"] == mini.prompt_version
        t = read_transcript(out / r["transcript"])
        assert t["header"]["bench"]["series_id"] == r["series_id"]
        assert t["header"]["ruleset"]["id"] == "mini"
    assert {r["series_id"] for r in minis}.isdisjoint(
        {r["series_id"] for r in recs if r["ruleset_id"] == "classic"}
    )
    # the board returned by run_protocol is the mini board, not a mix
    assert mini.leaderboard["ruleset"]["id"] == "mini"
    assert mini.leaderboard["games"] == 4
    report = (out / "report.md").read_text()
    assert "ruleset `mini`" in report and "ruleset `classic`" in report


def test_leaderboard_never_mixes_rulesets(mixed_out):
    out, mini, classic_res = mixed_out
    recs = load_results(out)
    for name, fp in (("mini", MINI.fingerprint), ("classic", CLASSIC.fingerprint)):
        for sel in (name, fp):
            board = compute_leaderboard(recs, ruleset=sel, bootstrap_samples=0)
            assert board["ruleset"]["id"] == name
            assert board["ruleset"]["fingerprint"] == fp
            assert board["games"] == 4
            assert {s["series_id"] for s in board["series"]} == {
                r["series_id"] for r in recs if r["ruleset_id"] == name
            }
            assert all(a["games"] == 4 for a in board["agents"])
    board = compute_leaderboard(recs, bootstrap_samples=0)  # newest group only
    assert board["games"] == 4
    assert board["available"]["rulesets"] == sorted(
        [
            {"id": "classic", "fingerprint": CLASSIC.fingerprint},
            {"id": "mini", "fingerprint": MINI.fingerprint},
        ],
        key=lambda d: d["id"],
    )
    assert any("other rulesets" in w for w in board["warnings"])
    assert compute_leaderboard(recs, ruleset="nope", bootstrap_samples=0)["games"] == 0


def test_same_ruleset_id_with_other_numbers_is_another_leaderboard(mixed_out):
    out, _, _ = mixed_out
    d = MINI.to_dict()
    d["starting_cash"] += 500
    tweaked = Ruleset.from_dict(d)
    assert tweaked.id == "mini" and tweaked.fingerprint != MINI.fingerprint
    recs = load_results(out)
    extra = []
    for r in recs:
        if r["ruleset_id"] == "mini":
            r = dict(r, ruleset_fingerprint=tweaked.fingerprint, key=r["key"] + "x")
            r["finished_at"] = "2999-01-01T00:00:00+00:00"
            extra.append(r)
    board = compute_leaderboard(recs + extra, ruleset="mini", bootstrap_samples=0)
    assert board["ruleset"]["fingerprint"] == tweaked.fingerprint  # newest wins
    assert board["games"] == len(extra) == 4  # the original four are not mixed in
    old = compute_leaderboard(
        recs + extra, ruleset=MINI.fingerprint, bootstrap_samples=0
    )
    assert old["games"] == 4 and old["ruleset"]["fingerprint"] == MINI.fingerprint


def test_records_without_ruleset_fields_count_as_classic(mixed_out):
    out, _, _ = mixed_out
    legacy = []
    for r in load_results(out):
        if r["ruleset_id"] == "classic":
            r = {
                k: v
                for k, v in r.items()
                if k not in ("ruleset_id", "ruleset_fingerprint")
            }
            legacy.append(r)
    board = compute_leaderboard(legacy, bootstrap_samples=0)
    assert board["ruleset"]["id"] == "classic"
    assert board["ruleset"]["fingerprint"] == CLASSIC.fingerprint
    assert board["games"] == 4


def test_http_leaderboard_ruleset_param_and_game_summaries(mixed_out, monkeypatch):
    out, mini, classic_res = mixed_out
    monkeypatch.setenv("ACQUIRE_BENCH_DIR", str(out.parent))
    from main import create_app

    with TestClient(create_app()) as c:
        for prefix in ("", "/api"):
            body = c.get(f"{prefix}/bench/leaderboard?ruleset=mini").json()
            assert body["ruleset"]["id"] == "mini" and body["games"] == 4
            assert body["prompt_version"] == mini.prompt_version
            avail = {r["id"] for r in body["available"]["rulesets"]}
            assert avail == {"mini", "classic"}
            body = c.get(f"{prefix}/bench/leaderboard?ruleset=classic").json()
            assert body["ruleset"]["id"] == "classic"
            assert body["prompt_version"] == classic_res.prompt_version
            rows = c.get(f"{prefix}/games?source=bench&limit=50").json()["games"]
            by_rs = {r["ruleset_id"]: r["ruleset_title"] for r in rows}
            assert by_rs == {"mini": MINI.title, "classic": CLASSIC.title}
            mini_row = next(r for r in rows if r["ruleset_id"] == "mini")
            detail = c.get(f"{prefix}/games/{mini_row['game_id']}").json()
            assert detail["ruleset_id"] == "mini"
            assert detail["ruleset_title"] == MINI.title
            assert detail["ruleset_fingerprint"] == MINI.fingerprint
            sid = next(
                r["series_id"] for r in load_results(out) if r["ruleset_id"] == "mini"
            )
            ser = c.get(f"{prefix}/bench/series/{sid}").json()
            assert ser["ruleset_id"] == "mini"


# --------------------------------------------------------------------- CLI


def test_cli_ruleset_flag_runs_matchup_on_that_ruleset(tmp_path, capsys):
    out = tmp_path / "o"
    code = bench_main(
        ["run", "--matchup", "bot,bot,bot", "--games", "2", "--out", str(out)]
        + ["--ruleset", "mini", "--quiet", "--json"]
    )
    assert code == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary["ruleset_id"] == "mini"
    assert {r["ruleset_id"] for r in load_results(out)} == {"mini"}


def test_cli_rejects_an_unknown_ruleset(tmp_path, capsys):
    code = bench_main(
        ["run", "--matchup", "bot,bot,bot", "--out", str(tmp_path / "o")]
        + ["--ruleset", "nope", "--json"]
    )
    assert code == 2
    assert "bad --ruleset" in capsys.readouterr().err
