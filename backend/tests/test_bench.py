"""Benchmark harness tests (offline).

Games are played for real (engine + HeuristicAgent + the seats.py checks); only
the calculator pack, the slow part of building a context and unused by the
bot, is stubbed in the default tier. Tests that need the full LLM prompt path
run unstubbed and are marked ``slow``.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from agents.base import DecisionContext
from agents.scripted import default_action
from bench import report
from bench.prices import PriceTable
from bench.runner import assign_ranks, percentile, run_game
from bench.series import BenchError, Budget, plan, rotate, run_series


@pytest.fixture(autouse=True)
def _no_transcripts(monkeypatch):
    """Transcripts are tested in test_transcripts.py / test_bench_protocol_v1.py;
    here they would only cost time."""
    monkeypatch.setattr(
        "transcripts.writer.TranscriptWriter.open", lambda *a, **k: None
    )


@pytest.fixture
def fast_calc(monkeypatch):
    monkeypatch.setattr("game.calculator.build_calculator_pack", lambda game, pid: {})


class FirstLegal:
    """Paid-looking test agent: first legal action, reports token totals."""

    kind = "llm"

    def __init__(self, model="mystery-model"):
        self.provider = SimpleNamespace(model=model)
        self.totals = {
            "decisions": 0,
            "calls": 0,
            "repairs": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
        }

    async def decide(self, ctx: DecisionContext) -> dict:
        self.totals["calls"] += 1
        self.totals["input_tokens"] += 1000
        self.totals["output_tokens"] += 10
        return default_action(ctx)


class Failing:
    """Alternates between raising and answering an action that is not offered."""

    kind = "llm"

    def __init__(self):
        self.n = 0
        self.notes = []

    async def decide(self, ctx):
        self.n += 1
        if self.n % 2:
            raise RuntimeError("provider exploded")
        return (
            {"action": "buy_stocks", "purchases": {}}
            if ctx.decision.kind == "place_tile"
            else {"nonsense": 1}
        )

    def note_fallback(self, reason):
        self.notes.append(reason)


def llm_seat(label="stub", **kw):
    return (label, lambda: FirstLegal(**kw))


def outcome(rec):
    d = rec.to_dict()
    return {
        k: d[k]
        for k in (
            "seed",
            "status",
            "seat_order",
            "standings",
            "winners",
            "turns",
            "decisions",
        )
    }


def run(coro):
    return asyncio.run(coro)


# ----------------------------------------------------------------- game runner


def test_bot_game_completes_and_is_deterministic(fast_calc):
    a = run(run_game(["bot"] * 4, 7))
    b = run(run_game(["bot"] * 4, 7))
    c = run(run_game(["bot"] * 4, 8))
    assert a.status == "completed" and a.turns > 10
    assert outcome(a) == outcome(b)
    assert outcome(a) != outcome(c)
    assert sum(s.fallbacks for s in a.seats) == 0
    assert a.standings[0]["rank"] == 1
    assert a.winners and all(
        a.standings[0]["score"] == s["score"]
        for s in a.standings
        if s["pos"] in a.winners
    )


def test_failing_agent_falls_back_by_reason_and_game_completes(fast_calc):
    failing = Failing()
    rec = run(run_game([("fail", lambda: failing), "bot", "bot", "bot"], 3))
    assert rec.status == "completed"
    st = rec.seats[0]
    assert st.fallbacks == st.decisions and st.decisions > 5
    assert set(st.fallback_reasons) == {"error", "illegal"}
    assert sum(st.fallback_reasons.values()) == st.fallbacks
    assert (
        len(failing.notes) == st.fallbacks
    )  # note_fallback called like the server does
    assert all(s.fallbacks == 0 for s in rec.seats[1:])


def test_token_accounting_and_unknown_price(fast_calc):
    rec = run(run_game([llm_seat(), "bot", "bot", "bot"], 2, prices=PriceTable({})))
    st = rec.seats[0]
    assert (
        st.input_tokens == 1000 * st.decisions and st.output_tokens == 10 * st.decisions
    )
    assert st.cost_usd is None  # unknown model: not invented
    assert rec.seats[1].cost_usd == 0.0
    priced = PriceTable(
        {
            "mystery-model": {
                "input": 1.0,
                "output": 2.0,
                "cache_read": 0.5,
                "cache_write": 1.0,
            }
        }
    )
    rec = run(run_game([llm_seat(), "bot", "bot", "bot"], 2, prices=priced))
    assert rec.seats[0].cost_usd == pytest.approx(
        (1000 * 1.0 + 10 * 2.0) * rec.seats[0].decisions / 1e6
    )
    assert len(rec.seats[0].latencies_ms) == rec.seats[0].decisions


# --------------------------------------------------------------------- series


def test_rotation_is_balanced_and_seeds_paired_across_matchups():
    seats = ["a", "b", "c", "d"]
    positions = {s: [] for s in seats}
    for i in range(8):
        for pos, spec in enumerate(rotate(seats, i % 4)):
            positions[spec].append(pos)
    for s in seats:
        assert sorted(positions[s]) == [0, 0, 1, 1, 2, 2, 3, 3]
    p1 = plan(["bot"] * 4, 6, 100)
    p2 = plan(["llm:fake", "bot", "bot", "bot"], 6, 100)
    assert [(s, r) for s, r, _ in p1] == [(s, r) for s, r, _ in p2]
    assert len({k for _, _, k in p1 + p2}) == 12


def test_series_deterministic_and_resumable(fast_calc, tmp_path):
    path = tmp_path / "r.jsonl"
    m = [llm_seat("x"), "bot", "bot", "bot"]
    first = run(run_series([m], 2, seed=5, results_path=path, prices=PriceTable({})))
    assert first.ran == 2 and first.skipped == 0 and first.complete
    lines = path.read_text().splitlines()
    assert len(lines) == 2
    again = run(run_series([m], 2, seed=5, results_path=path, prices=PriceTable({})))
    assert again.ran == 0 and again.skipped == 2
    assert len(path.read_text().splitlines()) == 2
    # extend the series: only the new games run
    more = run(run_series([m], 3, seed=5, results_path=path, prices=PriceTable({})))
    assert more.ran == 1 and more.skipped == 2
    # same seeds, fresh file: identical outcomes (concurrency does not matter)
    other = tmp_path / "o.jsonl"
    fresh = run(
        run_series(
            [m], 2, seed=5, results_path=other, max_concurrency=4, prices=PriceTable({})
        )
    )
    keep = ("seed", "standings", "winners", "turns", "decisions", "seat_order")
    a = [{k: r[k] for k in keep} for r in first.records["x,bot,bot,bot"]]
    b = [{k: r[k] for k in keep} for r in fresh.records["x,bot,bot,bot"]]
    assert a == b
    assert [r["rotation"] for r in a_all(first)] == [0, 1]


def a_all(res):
    return next(iter(res.records.values()))


def test_torn_last_line_is_ignored(fast_calc, tmp_path):
    path = tmp_path / "r.jsonl"
    m = ["bot"] * 3
    run(run_series([m], 1, seed=1, results_path=path))
    with path.open("a") as fh:
        fh.write('{"key": "torn')
    res = run(run_series([m], 1, seed=1, results_path=path))
    assert res.skipped == 1 and res.ran == 0


def test_budget_guard_stops_cleanly_with_partial_results(fast_calc, tmp_path):
    path = tmp_path / "r.jsonl"
    m = [llm_seat(), "bot", "bot", "bot"]
    res = run(
        run_series(
            [m], 6, seed=1, results_path=path, max_concurrency=1, max_decisions=60
        )
    )
    assert not res.complete and "max-decisions" in res.stopped_reason
    assert 0 < res.ran < 6
    assert res.aborted >= 1
    assert (
        len(path.read_text().splitlines()) == res.ran
    )  # aborted games are not recorded
    assert len(a_all(res)) == res.ran
    # a rerun without the cap finishes the rest
    rest = run(run_series([m], 6, seed=1, results_path=path))
    assert rest.complete and rest.skipped == res.ran and len(a_all(rest)) == 6


def test_max_usd_requires_known_prices(tmp_path, monkeypatch):
    monkeypatch.setenv("GAME_TEST_MODE", "1")
    with pytest.raises(BenchError, match="known prices"):
        run(
            run_series(
                [["llm:fake", "bot", "bot"]],
                1,
                results_path=tmp_path / "r.jsonl",
                max_usd=1.0,
                prices=PriceTable({}),
            )
        )


def test_budget_usd_accumulates():
    b = Budget(max_usd=0.10)
    b.add({"kind": "llm", "usd": 0.06})
    assert not b.exhausted
    b.add({"kind": "llm", "usd": 0.05})
    assert b.exhausted and "max-usd" in b.reason
    c = Budget(max_decisions=2)
    c.add({"kind": "bot", "usd": 0.0})
    assert c.decisions == 0  # bots are free unless the whole series is bots
    c.count_all = True
    c.add({"kind": "bot", "usd": 0.0})
    c.add({"kind": "bot", "usd": 0.0})
    assert c.exhausted


# --------------------------------------------------------------------- report


def test_wilson_interval_hand_computed():
    lo, hi = report.wilson(5, 20)
    assert lo == pytest.approx(0.1119, abs=1e-3) and hi == pytest.approx(
        0.4687, abs=1e-3
    )
    lo, hi = report.wilson(0, 10)
    assert lo == 0.0 and hi == pytest.approx(0.2775, abs=1e-3)
    assert report.wilson(0, 0) == (0.0, 1.0)


def test_rank_math_and_percentiles():
    assert assign_ranks([10, 30, 20, 5]) == [3, 1, 2, 4]
    assert assign_ranks([30, 30, 20, 10]) == [1, 1, 3, 4]  # competition ranking
    assert percentile([1, 2, 3, 4, 5], 0.5) == 3
    assert percentile([10, 20], 0.95) == pytest.approx(19.5)
    assert percentile([], 0.5) is None
    m, h = report.mean_ci([1.0, 2.0, 3.0])
    assert m == 2.0 and h == pytest.approx(1.96 * 1 / 3**0.5)


def _rec(seed, scores, labels, fallbacks=None, cost=None):
    n = len(scores)
    ranks = assign_ranks(scores)
    best = max(scores)
    seats = []
    for i in range(n):
        seats.append(
            {
                "pos": i,
                "agent": labels[i],
                "decisions": 10,
                "fallbacks": (fallbacks or {}).get(i, 0),
                "fallback_reasons": {"error": (fallbacks or {}).get(i, 0)}
                if (fallbacks or {}).get(i)
                else {},
                "repairs": 1 if labels[i] != "bot" else 0,
                "calls": 10,
                "input_tokens": 100 if labels[i] != "bot" else 0,
                "output_tokens": 10 if labels[i] != "bot" else 0,
                "cache_read_tokens": 0,
                "cache_write_tokens": 0,
                "latencies_ms": [10.0, 20.0] if labels[i] != "bot" else [],
                "trades_proposed": 0,
                "trades_accepted": 0,
                "trades_rejected": 0,
                "declarations": 0,
                "cost_usd": 0.0 if labels[i] == "bot" else cost,
            }
        )
    return {
        "status": "completed",
        "seed": seed,
        "turns": 50,
        "end_reason": "declared",
        "seat_order": labels,
        "winners": [i for i in range(n) if scores[i] == best],
        "standings": sorted(
            ({"pos": i, "score": scores[i], "rank": ranks[i]} for i in range(n)),
            key=lambda r: r["rank"],
        ),
        "seats": seats,
    }


def test_aggregate_hand_computed_case():
    labels = ["llm", "bot", "bot", "bot"]
    recs = [
        _rec(1, [100, 80, 60, 40], labels, fallbacks={0: 2}, cost=0.5),  # llm wins
        _rec(2, [50, 70, 60, 40], labels, cost=0.25),  # llm 3rd
    ]
    m = report.aggregate_matchup("llm,bot,bot,bot", recs)
    llm = next(a for a in m["agents"] if a["agent"] == "llm")
    bot = next(a for a in m["agents"] if a["agent"] == "bot")
    assert llm["wins"] == 1 and llm["win_rate"] == 0.5 and llm["seat_games"] == 2
    assert llm["mean_rank"] == 2.0  # (1 + 3) / 2
    # margins: game1 100 - mean(80,60,40)=100-60=40; game2 50 - mean(70,60,40)=-6.67
    assert llm["margin_vs_bot"] == pytest.approx((40 + (50 - 170 / 3)) / 2)
    assert llm["fallback_rate"] == pytest.approx(2 / 20)
    assert llm["repair_rate"] == pytest.approx(2 / 20)
    assert llm["latency_mean_ms"] == 15.0 and llm["latency_p95_ms"] == pytest.approx(
        20.0
    )
    assert llm["cost_usd"] == pytest.approx(0.75)
    assert llm["cost_per_game_usd"] == pytest.approx(0.375)
    assert llm["cost_per_decision_usd"] == pytest.approx(0.75 / 20)
    assert llm["verdict"] == "inconclusive"
    assert bot["seat_games"] == 6 and bot["wins"] == 1  # bot at pos 1 won game 2
    assert any("too few" in w for w in m["warnings"])  # honest about n=2


def test_unknown_cost_reported_as_unknown():
    labels = ["llm", "bot", "bot", "bot"]
    m = report.aggregate_matchup("x", [_rec(1, [1, 2, 3, 4], labels, cost=None)])
    llm = next(a for a in m["agents"] if a["agent"] == "llm")
    assert llm["cost_usd"] is None and not llm["cost_known"]
    md = report.render_markdown(
        report.build_report({"x": [_rec(1, [1, 2, 3, 4], labels, cost=None)]})
    )
    assert "unknown" in md and "too few" in md


def test_verdict_flags_real_edge_only_with_enough_games():
    labels = ["llm", "bot", "bot", "bot"]
    wins = [_rec(i, [100, 1, 2, 3], labels) for i in range(40)]
    m = report.aggregate_matchup("x", wins)
    llm = next(a for a in m["agents"] if a["agent"] == "llm")
    assert llm["verdict"] == "above chance"
    assert not any("too few" in w for w in m["warnings"])
    few = report.aggregate_matchup(
        "x", [wins[0]] + [_rec(i, [1, 100, 2, 3], labels) for i in range(3)]
    )
    assert (
        next(a for a in few["agents"] if a["agent"] == "llm")["verdict"]
        == "inconclusive"
    )
    assert report.games_to_detect(0.40, 0.25) == 71


def test_prices_file_prices_the_built_in_models_and_nothing_else():
    t = PriceTable.load()
    # $0.10 in / $0.50 out per million tokens
    assert t.cost("claude-haiku-5-5", 1_000_000, 100_000) == pytest.approx(0.15)
    assert t.cost("claude-sonnet-5-5", 1_000_000, 100_000) == pytest.approx(3.0)
    assert t.cost("fake", 1000, 100) == 0.0
    assert t.cost("not-listed", 1, 1) is None
    assert t.known("claude-sonnet-5-5") and not t.known("not-listed")


# ------------------------------------------------------------ real LLM path


@pytest.mark.slow
def test_fake_llm_series_has_zero_fallbacks(tmp_path, monkeypatch):
    monkeypatch.setenv("GAME_TEST_MODE", "1")
    res = run(
        run_series(
            [["llm:fake", "bot", "bot", "bot"]],
            2,
            seed=1,
            results_path=tmp_path / "r.jsonl",
        )
    )
    recs = a_all(res)
    assert len(recs) == 2 and res.complete
    llm_seats = [s for r in recs for s in r["seats"] if s["agent"] == "llm:fake"]
    assert llm_seats and all(s["fallbacks"] == 0 for s in llm_seats)
    assert all(s["input_tokens"] > 0 and s["cost_usd"] == 0.0 for s in llm_seats)
    m = report.aggregate_matchup("llm:fake,bot,bot,bot", recs)
    assert (
        next(a for a in m["agents"] if a["agent"] == "llm:fake")["fallback_rate"] == 0.0
    )


@pytest.mark.slow
def test_four_bot_series_deterministic_unstubbed(tmp_path):
    def go(name):
        res = run(run_series([["bot"] * 4], 2, seed=11, results_path=tmp_path / name))
        return [(r["seed"], r["standings"], r["turns"]) for r in a_all(res)]

    assert go("a.jsonl") == go("b.jsonl")
