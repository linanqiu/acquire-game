"""``python -m bench`` (run from ``backend/``).

Subcommands::

    python -m bench run --protocol acquire-bench-v1 --models llm:a,llm:b \\
        --track both --out bench_results/run1 [--games N] [--json]
    python -m bench run --matchup llm:fake,bot,bot,bot --games 8 --out DIR
    python -m bench leaderboard --out DIR [--protocol ID] [--json]
    python -m bench list-models [--json]
    python -m bench --matchup bot,bot,bot,bot --games 20      # legacy form

Exit codes: 0 every planned game finished; 1 partial (budget stop) or some
game stalled; 2 configuration error (unknown/unavailable model, bad flags,
unknown protocol, nothing to show). Progress goes to stderr; with ``--json``
stdout carries exactly one JSON document.
"""

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

EXIT_OK, EXIT_PARTIAL, EXIT_CONFIG = 0, 1, 2
SUBCOMMANDS = ("run", "leaderboard", "list-models")

HINTS = {
    "llm:claude": "set ANTHROPIC_API_KEY",
    "llm:openai": "set ACQUIRE_LLM_OPENAI_BASE_URL / _MODEL / _API_KEY",
    "llm:fake": "set ACQUIRE_TEST_MODE=1",
    "scripted": "set ACQUIRE_TEST_MODE=1",
}


def _hint(agent_id: str) -> str | None:
    return next((h for p, h in HINTS.items() if agent_id.startswith(p)), None)


def preflight(agent_id: str) -> None:
    """Fail fast with a clear message when a seat cannot be built."""
    if agent_id == "bot":
        return
    entry = registry.entry(agent_id)
    if entry is None:
        known = ", ".join(e["id"] for e in registry.catalog())
        hint = _hint(agent_id)
        raise BenchError(
            f"unknown agent {agent_id!r}. Known ids: {known}"
            + (f" (if this is a test agent: {hint})" if hint else "")
        )
    if not entry.get("available"):
        hint = _hint(agent_id)
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


def parse_models(text: str) -> list[str]:
    models = [s.strip() for s in text.split(",") if s.strip()]
    if not models:
        raise BenchError("--models is empty")
    for m in models:
        preflight(m)
    return models


def _progress(quiet: bool):
    def progress(msg: str) -> None:
        if not quiet:
            print(msg, file=sys.stderr, flush=True)

    return progress


def _budget_flags(p: argparse.ArgumentParser) -> None:
    p.add_argument("--max-concurrency", type=int, default=4)
    p.add_argument(
        "--max-usd", type=float, help="stop after this estimated spend (needs prices)"
    )
    p.add_argument(
        "--max-decisions",
        type=int,
        help="stop after this many LLM-seat decisions (all decisions in an all-bot series)",
    )
    p.add_argument("--prices", help="price table JSON (default bench/prices.json)")
    p.add_argument("--fresh", action="store_true", help="delete the results file first")
    p.add_argument("--quiet", action="store_true", help="no per-game progress")
    p.add_argument(
        "--no-transcripts",
        action="store_true",
        help="do not write per-game transcripts (on by default)",
    )


# ------------------------------------------------------------------ legacy


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
    p.add_argument(
        "--results",
        default="bench_results/results.jsonl",
        help="JSONL results file (resumable); transcripts go next to it",
    )
    p.add_argument("--report-json", help="default: <results>.report.json")
    p.add_argument("--report-md", help="default: <results>.report.md")
    _budget_flags(p)
    return p


def _legacy(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    try:
        matchups = [parse_matchup(m) for m in args.matchup]
        if args.games < 1:
            raise BenchError("--games must be >= 1")
        prices = PriceTable.load(args.prices)
        results = Path(args.results)
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
                progress=_progress(args.quiet),
                transcripts=not args.no_transcripts,
            )
        )
    except BenchError as e:
        print(f"error: {e}", file=sys.stderr)
        return EXIT_CONFIG

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
    return EXIT_OK if res.complete and not res.failed else EXIT_PARTIAL


# -------------------------------------------------------------- subcommands


def build_cli() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m bench", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    run = sub.add_parser("run", help="run a protocol (or ad-hoc matchups)")
    run.add_argument("--protocol", help="e.g. acquire-bench-v1")
    run.add_argument("--models", help="comma-separated catalog ids (protocol runs)")
    run.add_argument(
        "--track", default="both", choices=["vs-baseline", "head-to-head", "both"]
    )
    run.add_argument(
        "--matchup", action="append", help="ad-hoc matchup instead of --protocol"
    )
    run.add_argument(
        "--games",
        type=int,
        help="cap per series (protocol; default: the protocol's) or games per matchup",
    )
    run.add_argument("--seed", type=int, default=1, help="base seed (ad-hoc only)")
    run.add_argument("--out", required=True, help="results directory")
    run.add_argument("--json", action="store_true", help="JSON summary on stdout")
    _budget_flags(run)

    lb = sub.add_parser("leaderboard", help="show the leaderboard of a results dir")
    lb.add_argument("--out", required=True, help="results directory (or a parent)")
    lb.add_argument("--protocol")
    lb.add_argument("--prompt-version")
    lb.add_argument(
        "--track", default="all", choices=["all", "vs-baseline", "head-to-head"]
    )
    lb.add_argument("--json", action="store_true")

    lm = sub.add_parser("list-models", help="catalog ids and availability")
    lm.add_argument("--json", action="store_true")
    return p


def _emit(obj: dict | list) -> None:
    print(json.dumps(obj, indent=2, default=str))


def _cmd_run(args) -> int:
    from bench.protocols import run_protocol
    from bench.results import write_outputs

    try:
        if bool(args.protocol) == bool(args.matchup):
            raise BenchError("give either --protocol (with --models) or --matchup")
        prices = PriceTable.load(args.prices)
        progress = _progress(args.quiet)
        out = Path(args.out)
        if args.protocol:
            if not args.models:
                raise BenchError("--protocol needs --models")
            models = parse_models(args.models)
            res = asyncio.run(
                run_protocol(
                    models,
                    out=out,
                    protocol=args.protocol,
                    track=args.track,
                    games=args.games,
                    max_concurrency=args.max_concurrency,
                    max_usd=args.max_usd,
                    max_decisions=args.max_decisions,
                    prices=prices,
                    fresh=args.fresh,
                    transcripts=not args.no_transcripts,
                    progress=progress,
                )
            )
            summary = res.summary()
            code = res.exit_code
        else:
            matchups = [parse_matchup(m) for m in args.matchup]
            games = args.games or 20
            if games < 1:
                raise BenchError("--games must be >= 1")
            sr = asyncio.run(
                run_series(
                    matchups,
                    games,
                    seed=args.seed,
                    results_path=out / "results.jsonl",
                    max_concurrency=args.max_concurrency,
                    max_usd=args.max_usd,
                    max_decisions=args.max_decisions,
                    prices=prices,
                    fresh=args.fresh,
                    progress=progress,
                    transcripts=not args.no_transcripts,
                )
            )
            write_outputs(out, prices=prices)
            code = EXIT_OK if sr.status == "complete" else EXIT_PARTIAL
            summary = {
                "status": sr.status,
                "exit_code": code,
                "protocol": None,
                "out": str(out),
                "games": {
                    "planned": sr.planned,
                    "ran": sr.ran,
                    "skipped": sr.skipped,
                    "aborted": sr.aborted,
                    "stalled": sr.failed,
                },
                "stopped_reason": sr.stopped_reason,
                "report": build_report(sr.records),
            }
    except BenchError as e:
        if args.json:
            _emit({"status": "config_error", "exit_code": EXIT_CONFIG, "error": str(e)})
        print(f"error: {e}", file=sys.stderr)
        return EXIT_CONFIG

    if args.json:
        _emit(summary)
    else:
        print((out / "report.md").read_text(encoding="utf-8"))
        print(
            f"status: {summary['status']}; wrote {out}/results.jsonl, "
            f"{out}/leaderboard.json, {out}/report.md",
            file=sys.stderr,
        )
    return code


def _cmd_leaderboard(args) -> int:
    from bench.leaderboard import compute_leaderboard, render_leaderboard_md
    from bench.results import load_results

    records = load_results(args.out)
    if not any(r.get("protocol") for r in records):
        msg = f"no protocol results under {args.out}"
        if args.json:
            _emit({"status": "config_error", "exit_code": EXIT_CONFIG, "error": msg})
        print(f"error: {msg}", file=sys.stderr)
        return EXIT_CONFIG
    board = compute_leaderboard(
        records,
        protocol=args.protocol,
        prompt_version=args.prompt_version,
        track=args.track,
    )
    if args.json:
        _emit(board)
    else:
        print(render_leaderboard_md(board))
    return EXIT_OK


def _cmd_list_models(args) -> int:
    rows = []
    for e in registry.catalog():
        rows.append(
            {
                "id": e["id"],
                "kind": e["kind"],
                "label": e["label"],
                "available": bool(e.get("available")),
                "hint": None if e.get("available") else _hint(e["id"]),
            }
        )
    if args.json:
        _emit(rows)
    else:
        for r in rows:
            state = "available" if r["available"] else f"unavailable ({r['hint']})"
            print(f"{r['id']:<28} {r['label']:<24} {state}")
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] not in SUBCOMMANDS:
        if argv and argv[0] in ("-h", "--help"):
            build_cli().print_help()
            return EXIT_OK
        return _legacy(argv)
    try:
        args = build_cli().parse_args(argv)
    except SystemExit as e:  # argparse error -> configuration error
        return EXIT_CONFIG if e.code else EXIT_OK
    if args.cmd == "run":
        return _cmd_run(args)
    if args.cmd == "leaderboard":
        return _cmd_leaderboard(args)
    return _cmd_list_models(args)
