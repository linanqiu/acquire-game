#!/usr/bin/env python3
"""Summaries of ``mutation_test.py --matrix`` results.

python scripts/mutation_report.py RESULT.json [RESULT2.json ...]
    per-module scores
python scripts/mutation_report.py RESULT.json --unique PATTERN
    for tests whose node id contains PATTERN: how many mutants each
    kills, and how many it kills that no test outside PATTERN kills
python scripts/mutation_report.py BASE.json --compare FINAL.json
    mutants killed in BASE but not in FINAL (same module, line, mutation)
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path


def load(paths):
    mutants = []
    for p in paths:
        mutants += json.loads(Path(p).read_text())["mutants"]
    return mutants


def key(m):
    """Stable across line shifts: module, function, source line, mutation."""
    return (m["module"], m.get("func"), m.get("src"), m["desc"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("results", nargs="+")
    ap.add_argument("--unique")
    ap.add_argument("--compare", nargs="+")
    args = ap.parse_args()
    mutants = load(args.results)

    if args.compare:
        final = defaultdict(list)
        for m in load(args.compare):
            final[key(m)].append(m["status"])
        base = defaultdict(list)
        for m in mutants:
            base[key(m)].append(m["status"])
        lost = []
        for k, statuses in base.items():
            if k[0] not in {kk[0] for kk in final}:
                continue
            killed_before = sum(s in ("killed", "timeout") for s in statuses)
            killed_after = sum(s in ("killed", "timeout") for s in final.get(k, []))
            if k in final and killed_after < killed_before:
                lost.append(k)
        for k in sorted(lost):
            print("LOST", *k)
        print(f"{len(lost)} mutants lost")
        return

    if args.unique:
        kills = defaultdict(set)
        for i, m in enumerate(mutants):
            for t in m.get("killers", []):
                kills[t].add(i)
        inside = {t for t in kills if args.unique in t}
        unique = Counter()
        for i, m in enumerate(mutants):
            ks = set(m.get("killers", []))
            if ks and ks <= inside and not m.get("heavy_only"):
                for t in ks:
                    unique[t] += 1
        for t in sorted(inside):
            print(f"{len(kills[t]):5} {unique[t]:4}  {t}")
        exclusively = [
            m for m in mutants if m.get("killers") and set(m["killers"]) <= inside
        ]
        print(
            f"{len(exclusively)} mutants killed only by tests matching {args.unique!r}"
        )
        for m in exclusively:
            print(
                f"   {m['module']}:{m['line']} {m['desc']}  <- {sorted(m['killers'])[:3]}"
            )
        return

    summary = defaultdict(Counter)
    for m in mutants:
        summary[m["module"]][m["status"]] += 1
        if m.get("slow_tier") in ("killed", "timeout"):
            summary[m["module"]]["slow_only"] += 1
    print(
        f"{'module':28} total killed timeout survived uncovered score"
        "  (survivors the slow tier kills)"
    )
    for mod, c in sorted(summary.items()):
        total = sum(v for k, v in c.items() if k not in ("error", "slow_only"))
        score = 100 * (c["killed"] + c["timeout"]) / total if total else 0
        print(
            f"{mod:28} {total:5} {c['killed']:6} {c['timeout']:7} {c['survived']:8}"
            f" {c['uncovered']:9} {score:5.1f}  ({c['slow_only']})"
        )


if __name__ == "__main__":
    main()
