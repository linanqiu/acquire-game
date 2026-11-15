"""Buyout Bench on a chosen ruleset: every game record, transcript header,
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
from game.ruleset import Ruleset, default_ruleset, load_ruleset
from transcripts import read_transcript
from transcripts.replay import ReplayError, final_scores, replay

MINI = load_ruleset("mini")
VALLEY = load_ruleset("valley")
DEFAULT_RS = default_ruleset()


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
    assert h["prompt_version"] != protocol_prompt_version(DEFAULT_RS)


def protocol_prompt_version(rs):
    from agents.llm.prompt import prompt_version

    return prompt_version(rs)


def test_default_ruleset_is_the_servers_configured_one(tmp_path, monkeypatch):
    from config import get_settings

    assert resolve_ruleset(None) == DEFAULT_RS
    monkeypatch.setattr(get_settings(), "game_ruleset", "mini")
    assert resolve_ruleset(None) == MINI
    rec = asyncio.run(run_game(["bot", "bot", "bot"], 2, transcript_dir=tmp_path))
    assert rec.ruleset_id == "mini"
    assert resolve_ruleset("valley") == VALLEY  # explicit wins
    assert resolve_ruleset(VALLEY) is VALLEY


def test_replay_reproduces_standings_under_the_transcripts_own_ruleset(tmp_path):
    """Server default is default; the game was played on valley."""
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


def test_transcripts_without_a_ruleset_are_default(tmp_path):
    rec = asyncio.run(run_game(["bot", "bot", "bot"], 4, transcript_dir=tmp_path))
    t = read_transcript(rec.transcript)
    for k in ("ruleset", "ruleset_id", "ruleset_fingerprint"):
        t["header"].pop(k)  # as written before rulesets existed
    game = replay(t)
    assert game.ruleset == DEFAULT_RS
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
    # same matchup on default is a different series with different keys: it is
    # played, not skipped as "already done"
    again = asyncio.run(
        run_series(
            [["bot", "bot", "bot"]],
            2,
            results_path=res_path,
            ruleset=DEFAULT_RS,
            seed=3,
        )
    )
    assert again.ran == 2 and again.skipped == 0
    by_rs = {}
    for r in load_results(res_path):
        by_rs.setdefault(r["ruleset_id"], set()).add(r["series_id"])
    assert set(by_rs) == {"mini", "default"}
    assert by_rs["mini"].isdisjoint(by_rs["default"])


# ----------------------------------------------------- protocol + board


@pytest.fixture(scope="module")
def mixed_out(tmp_path_factory):
    """One results directory holding the same protocol run on mini and default."""
    out = tmp_path_factory.mktemp("bench") / "run"
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("game.calculator.build_calculator_pack", lambda game, pid: {})
        mini = protocol_run(out, "mini")
        default_res = protocol_run(out, None, games=2)
    return out, mini, default_res


def test_protocol_on_mini_records_ruleset_everywhere(mixed_out):
    out, mini, default_res = mixed_out
    assert mini.status == "complete" and default_res.status == "complete"
    assert mini.ruleset_id == "mini" and default_res.ruleset_id == "default"
    assert mini.summary()["ruleset_fingerprint"] == MINI.fingerprint
    assert mini.prompt_version != default_res.prompt_version
    recs = load_results(out)
    assert len(recs) == 6  # 4 on mini + 2 on default
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
        {r["series_id"] for r in recs if r["ruleset_id"] == "default"}
    )
    # the board returned by run_protocol is the mini board, not a mix
    assert mini.leaderboard["ruleset"]["id"] == "mini"
    assert mini.leaderboard["games"] == 4
    report = (out / "report.md").read_text()
    assert "ruleset `mini`" in report and "ruleset `default`" in report


def test_leaderboard_never_mixes_rulesets(mixed_out):
    out, mini, default_res = mixed_out
    recs = load_results(out)
    expected = {"mini": 4, "default": 2}
    for name, fp in (("mini", MINI.fingerprint), ("default", DEFAULT_RS.fingerprint)):
        for sel in (name, fp):
            board = compute_leaderboard(recs, ruleset=sel, bootstrap_samples=0)
            assert board["ruleset"]["id"] == name
            assert board["ruleset"]["fingerprint"] == fp
            assert (board["ruleset_id"], board["ruleset_fingerprint"]) == (name, fp)
            assert board["games"] == expected[name]
            assert {s["series_id"] for s in board["series"]} == {
                r["series_id"] for r in recs if r["ruleset_id"] == name
            }
            assert all(a["games"] == expected[name] for a in board["agents"])
    # default: the group of the most recent record (timestamps have a
    # resolution of one second, so make "most recent" explicit)
    stamped = [
        dict(r, finished_at="2999-01-01T00:00:00+00:00")
        if r["ruleset_id"] == "default"
        else r
        for r in recs
    ]
    board = compute_leaderboard(stamped, bootstrap_samples=0)
    assert board["ruleset"]["id"] == "default" and board["games"] == 2
    assert board["available"]["rulesets"] == sorted(
        [
            {"id": "default", "fingerprint": DEFAULT_RS.fingerprint},
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


def test_records_without_ruleset_fields_count_as_default(mixed_out):
    out, _, _ = mixed_out
    legacy = []
    for r in load_results(out):
        if r["ruleset_id"] == "default":
            r = {
                k: v
                for k, v in r.items()
                if k not in ("ruleset_id", "ruleset_fingerprint")
            }
            legacy.append(r)
    board = compute_leaderboard(legacy, bootstrap_samples=0)
    assert board["ruleset"]["id"] == "default"
    assert board["ruleset"]["fingerprint"] == DEFAULT_RS.fingerprint
    assert board["games"] == 2


def test_http_leaderboard_ruleset_param_and_game_summaries(mixed_out, monkeypatch):
    out, mini, default_res = mixed_out
    monkeypatch.setenv("GAME_BENCH_DIR", str(out.parent))
    from main import create_app

    with TestClient(create_app()) as c:
        for prefix in ("", "/api"):
            body = c.get(f"{prefix}/bench/leaderboard?ruleset=mini").json()
            assert body["ruleset"]["id"] == "mini" and body["games"] == 4
            assert body["prompt_version"] == mini.prompt_version
            avail = {r["id"] for r in body["available"]["rulesets"]}
            assert avail == {"mini", "default"}
            body = c.get(f"{prefix}/bench/leaderboard?ruleset=default").json()
            assert body["ruleset"]["id"] == "default"
            assert body["prompt_version"] == default_res.prompt_version
            rows = c.get(f"{prefix}/games?source=bench&limit=50").json()["games"]
            by_rs = {r["ruleset_id"]: r["ruleset_title"] for r in rows}
            assert by_rs == {"mini": MINI.title, "default": DEFAULT_RS.title}
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


def test_bench_llm_seat_transcript_header_has_the_prompt_for_its_ruleset(
    tmp_path, monkeypatch
):
    from agents.llm.prompt import build_system_prompt, prompt_version, system_prompt_id

    monkeypatch.setenv("GAME_TEST_MODE", "1")
    rec = asyncio.run(
        run_game(["llm:fake", "bot", "bot"], 3, transcript_dir=tmp_path, ruleset="mini")
    )
    assert rec.status == "completed"
    h = read_transcript(rec.transcript)["header"]
    text = build_system_prompt(MINI)
    assert h["system_prompts"] == {system_prompt_id(text, MINI): text}
    assert h["prompt_version"] == prompt_version(MINI)
    # mini uses five of the default chains; the other two must not appear
    assert not any(
        name in text for name in set(DEFAULT_RS.chain_ids) - set(MINI.chain_ids)
    )
