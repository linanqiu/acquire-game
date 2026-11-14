"""``python -m bench`` (run from ``backend/``)."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from agents import registry
from bench.prices import PriceTable
from bench.report import build_report, render_markdown
from bench.series import BenchError, run_series

HINTS = {
    "llm:claude": "set ANTHROPIC_API_KEY",
    "llm:fake": "set ACQUIRE_TEST_MODE=1",
    "scripted": "set ACQUIRE_TEST_MODE=1",
}


def preflight(agent_id: str) -> None:
    """Fail fast with a clear message when a seat cannot be built."""
    if agent_id == "bot":
        return
    entry = registry.entry(agent_id)
    if entry is None:
        known = ", ".join(e["id"] for e in registry.catalog())
        hint = next((h for p, h in HINTS.items() if agent_id.startswith(p)), None)
        raise BenchError(
            f"unknown agent {agent_id!r}. Known ids: {known}"
            + (f" (if this is a test agent: {hint})" if hint else "")
        )
    if not entry.get("available"):
        hint = next((h for p, h in HINTS.items() if agent_id.startswith(p)), None)
        raise BenchError(
            f"agent {agent_id!r} is not available (credentials missing)"
            + (f": {hint}" if hint else "; see backend/agents/llm/config.py")
        )


def parse_matchup(text: str) -> list[str]:
    seats = [s.strip() for s in text.split(",") if s.strip()]
    if not 3 <= len(seats) <= 6:
        raise BenchError(f"a matchup needs 3-6 seats, got {len(seats)}: {text!r}")
    for s in dict.fromkeys(seats):
        preflight(s)
    return seats


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m bench", description=__doc__)
    p.add_argument(
        "--matchup",
        action="append",
        required=True,
        help="comma-separated seat agent ids, e.g. llm:fake,bot,bot,bot (repeatable)",
    )
    p.add_argument("--games", type=int, default=20, help="games per matchup")
    p.add_argument("--seed", type=int, default=1, help="base seed; game i uses seed+i")
    p.add_argument("--max-concurrency", type=int, default=4)
    p.add_argument(
        "--max-usd",
        type=float,
        help="stop after this estimated spend (needs known prices)",
    )
    p.add_argument(
        "--max-decisions",
        type=int,
        help="stop after this many LLM-seat decisions (all decisions in an all-bot series)",
    )
    p.add_argument(
        "--results",
        default="bench_results/results.jsonl",
        help="JSONL results file (resumable)",
    )
    p.add_argument("--fresh", action="store_true", help="delete the results file first")
    p.add_argument("--prices", help="price table JSON (default bench/prices.json)")
    p.add_argument("--report-json", help="default: <results>.report.json")
    p.add_argument("--report-md", help="default: <results>.report.md")
    p.add_argument("--quiet", action="store_true", help="no per-game progress")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        matchups = [parse_matchup(m) for m in args.matchup]
        if args.games < 1:
            raise BenchError("--games must be >= 1")
        prices = PriceTable.load(args.prices)
        results = Path(args.results)

        def progress(msg: str) -> None:
            if not args.quiet:
                print(msg, file=sys.stderr, flush=True)

        res = asyncio.run(
            run_series(
                matchups,
                args.games,
                seed=args.seed,
                results_path=results,
                max_concurrency=args.max_concurrency,
                max_usd=args.max_usd,
                max_decisions=args.max_decisions,
                prices=prices,
                fresh=args.fresh,
                progress=progress,
            )
        )
    except BenchError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    meta = {
        "games requested per matchup": args.games,
        "base seed": args.seed,
        "games run now / resumed from file / aborted": f"{res.ran} / {res.skipped} / {res.aborted}",
        "budget decisions counted": res.budget.decisions,
        "budget estimated spend (USD, known prices only)": f"{res.budget.usd:.4f}",
    }
    if res.stopped_reason:
        meta["STOPPED EARLY"] = f"{res.stopped_reason}; results below are PARTIAL"
    report = build_report(res.records, meta)
    json_path = Path(args.report_json or str(results) + ".report.json")
    md_path = Path(args.report_md or str(results) + ".report.md")
    md = render_markdown(report)
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    md_path.write_text(md, encoding="utf-8")
    print(md)
    print(f"(wrote {json_path} and {md_path})", file=sys.stderr)
    return 0 if res.complete and not res.failed else 1
