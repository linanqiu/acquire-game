"""The deploy image must contain every backend package the app imports.

A .dockerignore line once excluded backend/bench (the benchmark package),
so /api/bench/leaderboard failed in production with ModuleNotFoundError
while every test passed. This guards the build context.
"""

import fnmatch
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BACKEND = REPO / "backend"


def _ignore_patterns() -> list[str]:
    lines = (REPO / ".dockerignore").read_text().splitlines()
    return [ln.strip() for ln in lines if ln.strip() and not ln.startswith("#")]


def _excluded(rel: str, patterns: list[str]) -> bool:
    for pat in patterns:
        pat = pat.rstrip("/")
        if fnmatch.fnmatch(rel, pat) or rel.startswith(pat + "/"):
            return True
        if pat.startswith("**/") and fnmatch.fnmatch(rel.split("/")[-1], pat[3:]):
            return True
    return False


def test_every_backend_source_package_is_in_the_build_context():
    patterns = _ignore_patterns()
    packages = sorted(
        d.name
        for d in BACKEND.iterdir()
        if d.is_dir() and (d / "__init__.py").is_file() and d.name != "tests"
    )
    assert "bench" in packages and "game" in packages
    missing = [p for p in packages if _excluded(f"backend/{p}", patterns)]
    assert missing == [], f".dockerignore drops backend packages: {missing}"


def test_backend_modules_and_rulesets_are_in_the_build_context():
    patterns = _ignore_patterns()
    for rel in ("backend/main.py", "backend/rulesets/default.json"):
        assert (REPO / rel).exists()
        assert not _excluded(rel, patterns), rel
