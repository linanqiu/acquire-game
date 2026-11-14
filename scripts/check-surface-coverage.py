#!/usr/bin/env python3
"""Check docs/tests/surface-coverage.md (TP-006).

Fails (exit 1) when:
  * a surface row has an empty "Covered by" cell and no explicit `GAP: <reason>`;
  * a row is covered only by unit tests (they do not count) and has no `GAP:`;
  * a referenced test file or test title no longer exists;
  * a route in frontend/src/App.tsx is missing from the map;
  * a page or component that has a `data-testid` is not named in the map;
  * the summary counts at the bottom of the map are out of date.

Prints the list of explicit gaps, so they stay visible. Standard library only.

A reference is written in backticks as `<file> : <test title>`:
  * `screens/foo.spec.ts : title`      -> frontend/tests/e2e/screens/foo.spec.ts
    (also `journeys/` and `transcripts/`); the title may be any substring of a test title
  * `backend/tests/x.py : test_name`   -> a `def test_name...` in that file (prefix match)
  * `src/components/x.test.tsx : title` -> a unit test (does not count as covered)
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAP = ROOT / "docs" / "tests" / "surface-coverage.md"
E2E = ROOT / "frontend" / "tests" / "e2e"
SRC = ROOT / "frontend" / "src"

REF_RE = re.compile(r"`([^`]+?) : ([^`]+)`")
TS_TITLE_RE = re.compile(
    r"""\b(?:test|it)(?:\.\w+)?\(\s*(['"`])((?:\\.|(?!\1).)*)\1""", re.S
)


def resolve(path: str) -> tuple[Path, str]:
    """Return (file, kind) with kind in {'py', 'ts', 'unit'}."""
    if path.startswith(("backend/", "frontend/")):
        p = ROOT / path
    elif path.startswith("src/"):
        p = ROOT / "frontend" / path
    else:
        p = E2E / path
    if path.startswith("src/") or path.endswith((".test.tsx", ".test.ts")):
        kind = "unit"
    elif p.suffix == ".py":
        kind = "py"
    else:
        kind = "ts"
    return p, kind


_title_cache: dict[Path, list[str]] = {}


def titles_of(p: Path, kind: str) -> list[str]:
    if p not in _title_cache:
        text = p.read_text(encoding="utf-8")
        if kind == "py":
            _title_cache[p] = re.findall(r"def (test\w*)", text)
        else:
            _title_cache[p] = [
                re.sub(r"\s+", " ", m.group(2).replace("\\'", "'").replace('\\"', '"'))
                for m in TS_TITLE_RE.finditer(text)
            ]
    return _title_cache[p]


def check_ref(path: str, title: str) -> tuple[str | None, str]:
    """Return (error or None, kind)."""
    p, kind = resolve(path.strip())
    if not p.is_file():
        return f"file not found: {path}", kind
    title = re.sub(r"\s+", " ", title.strip())
    ts = titles_of(p, kind)
    if kind == "py":
        ok = any(t.startswith(title) for t in ts)
    else:
        ok = any(title in t for t in ts)
    if not ok:
        return f"no test titled like {title!r} in {path}", kind
    return None, kind


def split_row(line: str) -> list[str]:
    cells = line.strip().strip("|").split("|")
    return [c.strip() for c in cells]


def main() -> int:
    text = MAP.read_text(encoding="utf-8")
    errors: list[str] = []
    gaps: list[tuple[str, str, str]] = []
    surfaces = covered = 0
    covered_refs = 0

    lines = text.splitlines()
    covered_col: int | None = None
    counted = True
    for i, line in enumerate(lines, 1):
        if not line.startswith("|"):
            covered_col = None
            continue
        cells = split_row(line)
        if covered_col is None:
            # header row (next line is the |---| separator)
            lower = [c.lower() for c in cells]
            if "covered by" in lower:
                covered_col = lower.index("covered by")
                # Fixture rows must name tests but are not surfaces of their own.
                counted = lower[0] != "fixture"
            else:
                covered_col = -1  # table without the column: ignore
            continue
        if covered_col == -1 or set(line.replace("|", "").strip()) <= {"-", ":", " "}:
            continue
        if covered_col >= len(cells):
            errors.append(f"line {i}: row has no 'Covered by' cell: {line[:60]}")
            continue
        ident, cell = cells[0], cells[covered_col]
        # Fixture rows in the appendix are named by fixture; component rows by component.
        surfaces += 1 if counted else 0
        refs = REF_RE.findall(cell)
        gap = re.search(r"GAP:\s*(.*)", cell)
        non_unit = 0
        for path, title in refs:
            err, kind = check_ref(path, title)
            if err:
                errors.append(f"line {i} [{ident}]: {err}")
            elif kind != "unit":
                non_unit += 1
        if gap:
            reason = gap.group(1).strip()
            if len(reason) < 12:
                errors.append(f"line {i} [{ident}]: GAP needs a real reason")
            if counted:
                gaps.append((ident, cells[1] if len(cells) > 1 else "", reason))
        if non_unit:
            covered += 1 if counted else 0
            covered_refs += non_unit
        elif not gap:
            why = (
                "covered only by unit tests (add a browser/protocol test or `GAP:`)"
                if refs
                else "empty 'Covered by' cell (add a test or `GAP: <reason>`)"
            )
            errors.append(f"line {i} [{ident}]: {why}")

    # Every route in App.tsx must be in the map.
    app = (SRC / "App.tsx").read_text(encoding="utf-8")
    for route in re.findall(r'<Route\s+path="([^"]+)"', app):
        if f"`{route}`" not in text:
            errors.append(f"route `{route}` from frontend/src/App.tsx is missing from the map")

    # Every page / component with a test id must be named in the map.
    named = set(re.findall(r"[A-Za-z][A-Za-z0-9]+", text))
    for f in sorted(SRC.rglob("*.tsx")):
        if f.name.endswith(".test.tsx"):
            continue
        rel = f.relative_to(SRC)
        if rel.parts[0] not in ("pages", "components"):
            continue
        if re.search(r"data-testid|testId", f.read_text(encoding="utf-8")):
            if f.stem not in named:
                errors.append(f"{rel} has test ids but `{f.stem}` is not named in the map")

    # Journeys = spec files in journeys/ (the static guard is not a journey).
    journeys = [
        p
        for p in (E2E / "journeys").glob("*.spec.ts")
        if p.name != "no-shortcuts.spec.ts"
    ]

    # Summary lines must match what we computed.
    expected = {
        "Surfaces": surfaces,
        "Covered": covered,
        "GAP": len(gaps),
        "Journeys": len(journeys),
    }
    for key, value in expected.items():
        m = re.search(rf"^- {key}: (\d+)\b", text, re.M)
        if not m:
            errors.append(f"summary line '- {key}: N' missing from the map (expected {value})")
        elif int(m.group(1)) != value:
            errors.append(f"summary '{key}' says {m.group(1)}, the table says {value}")

    print(
        f"{covered} of {surfaces} surfaces covered ({covered_refs} test references); "
        f"{len(gaps)} explicit gaps; {len(journeys)} journeys"
    )
    if gaps:
        print("\nGaps (explicit, with reason):")
        for ident, name, reason in gaps:
            print(f"  {ident:7} {name[:48]:48} {reason[:90]}")
    if errors:
        print("\nFAILED:")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
