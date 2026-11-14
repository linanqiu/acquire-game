"""CLI: ``python -m fixtures_gen`` (run from ``backend/``).

Searches for real games reaching each fixture state and writes
``frontend/tests/e2e/fixtures/snapshots/<name>.json`` plus ``index.json``.
Output is deterministic: running it twice yields byte-identical files.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from fixtures_gen.generate import DEFAULT_OUT_DIR, SEED_BUDGET, generate_all, write_all


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m fixtures_gen")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--seed-budget", type=int, default=SEED_BUDGET)
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    start = time.perf_counter()
    docs, unreachable = generate_all(args.seed_budget, verbose=args.verbose)
    write_all(docs, args.out)
    elapsed = time.perf_counter() - start

    for name in sorted(docs):
        doc = docs[name]
        missed = doc["criteria"]["missed"]
        note = f"  (ideal criteria not met: {', '.join(missed)})" if missed else ""
        print(
            f"{name}: seed={doc['recipe']['seed']} "
            f"players={len(doc['recipe']['players'])} "
            f"actions={len(doc['recipe']['actions'])} "
            f"turns={doc['turns_completed']}{note}"
        )
    for name in unreachable:
        print(f"{name}: NOT REACHED within seed budget {args.seed_budget}")
    print(f"wrote {len(docs)} fixtures to {args.out} in {elapsed:.1f}s")
    return 1 if unreachable else 0


if __name__ == "__main__":
    sys.exit(main())
