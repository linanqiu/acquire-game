"""Results directories: loading records, writing the leaderboard and report.

Layout of one results directory (stable; see docs/ai/benchmarking.md)::

    <out>/results.jsonl                one JSON record per finished game
    <out>/transcripts/<game_id>.jsonl  full transcript per game (+ .summary.json)
    <out>/leaderboard.json             {"generated_at", "boards": [board...]}
    <out>/report.md                    leaderboards + per-matchup statistics

A "bench dir" (``ACQUIRE_BENCH_DIR``) is one results directory or a parent of
several (one level deep).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from bench.leaderboard import (
    compute_leaderboard,
    record_ruleset,
    render_leaderboard_md,
)
from bench.report import build_report, render_markdown
from bench.series import load_results as _load_keyed

RESULTS_FILE = "results.jsonl"


def result_dirs(base: str | Path) -> list[Path]:
    """Results directories at ``base`` (itself and/or its subdirectories)."""
    base = Path(base)
    out = []
    if (base / RESULTS_FILE).is_file():
        out.append(base)
    if base.is_dir():
        for d in sorted(base.iterdir()):
            if d.is_dir() and (d / RESULTS_FILE).is_file():
                out.append(d)
    return out


def load_results(path: str | Path) -> list[dict]:
    """Every game record under ``path``: a ``results.jsonl`` file, a results
    directory, or a parent of results directories. Each record gains
    ``results_dir`` (where its transcript path is relative to)."""
    path = Path(path)
    files = [path] if path.is_file() else [d / RESULTS_FILE for d in result_dirs(path)]
    out = []
    for f in files:
        for rec in _load_keyed(f).values():
            rec = dict(rec)
            rec["results_dir"] = str(f.parent)
            out.append(rec)
    return out


def boards_for(records: list[dict], **kw) -> list[dict]:
    """One leaderboard per (protocol, ruleset fingerprint, prompt version)
    present: results of different rulesets are never mixed."""
    groups = sorted(
        {
            (r["protocol"], record_ruleset(r), r.get("prompt_version") or "")
            for r in records
            if r.get("protocol")
        },
        key=lambda g: (g[0], g[1][0], g[1][1] or "", g[2]),
    )
    return [
        compute_leaderboard(
            records,
            protocol=p,
            ruleset=rs[1] or rs[0],
            prompt_version=v or None,
            **kw,
        )
        for p, rs, v in groups
    ]


def write_outputs(out: str | Path, prices=None) -> list[dict]:
    """(Re)write ``leaderboard.json`` and ``report.md`` from ``results.jsonl``."""
    out = Path(out)
    records = load_results(out / RESULTS_FILE) if (out / RESULTS_FILE).exists() else []
    boards = boards_for(records)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    (out / "leaderboard.json").write_text(
        json.dumps({"generated_at": now, "boards": boards}, indent=2),
        encoding="utf-8",
    )
    by_matchup: dict[str, list[dict]] = {}
    for r in records:
        if r.get("status") != "aborted":
            by_matchup.setdefault(
                f"{r.get('track') or 'ad hoc'}: {r['matchup']}", []
            ).append(r)
    md = ["# Acquire Bench results", "", f"Generated {now}.", ""]
    for b in boards:
        md.append(render_leaderboard_md(b))
    md.append(render_markdown(build_report(by_matchup)))
    (out / "report.md").write_text("\n".join(md), encoding="utf-8")
    return boards
