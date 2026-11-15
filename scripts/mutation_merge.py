#!/usr/bin/env python3
"""Fold a ``--rerun`` result back into the full result it re-ran.

    python scripts/mutation_merge.py FULL.json RERUN.json [--slow-only]

Every mutant of RERUN replaces the entry with the same id in FULL. With
``--slow-only`` (RERUN ran the survivors against the slow tier) a mutant the
slow tier kills is recorded as ``slow_only_killed`` and keeps counting as a
survivor of the fast tier.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path


def main() -> None:
    full_path, rerun_path = Path(sys.argv[1]), Path(sys.argv[2])
    slow_only = "--slow-only" in sys.argv
    full = json.loads(full_path.read_text())
    rerun = {m["id"]: m for m in json.loads(rerun_path.read_text())["mutants"]}
    for i, m in enumerate(full["mutants"]):
        new = rerun.get(m["id"])
        if new is None:
            continue
        if slow_only:
            m["slow_tier"] = new["status"]
        else:
            keep = {k: m[k] for k in ("func", "src") if k in m}
            full["mutants"][i] = {**new, **keep}
    summary = {}
    for m in full["mutants"]:
        c = summary.setdefault(m["module"], Counter())
        c[m["status"]] += 1
    full["summary"] = {k: dict(v) for k, v in summary.items()}
    full_path.write_text(json.dumps(full, indent=1))
    print(f"merged {len(rerun)} mutants into {full_path}")


if __name__ == "__main__":
    main()
