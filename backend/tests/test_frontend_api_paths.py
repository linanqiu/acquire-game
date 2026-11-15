"""Every ``/api/...`` path the frontend calls exists in the deployed app.

In development and in every browser test, Vite's proxy strips ``/api``, so a
route mounted only without the prefix works there and 404s in the
single-service deploy. That shipped once: ``/api/health`` was missing, and
the home page told every visitor "The server is not answering yet".
"""

import re
from pathlib import Path

from starlette.routing import Match

from main import create_app

FRONTEND_SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"
LITERAL = re.compile(r"""['"`](/api/[^'"`?]*)""")
# lib/transcripts.ts builds ``/api${path}`` from these helper arguments.
GET_JSON = re.compile(r"""getJson<[^>]*>\(\s*`(/[^`?$]*(?:\$\{[^}]*\}[^`?$]*)*)""")


def _frontend_api_paths() -> set[str]:
    paths: set[str] = set()
    for f in FRONTEND_SRC.rglob("*.ts*"):
        if ".test." in f.name:
            continue
        text = f.read_text(encoding="utf-8")
        paths.update(m.group(1) for m in LITERAL.finditer(text))
        paths.update("/api" + m.group(1) for m in GET_JSON.finditer(text))
    out = set()
    for p in paths:
        # A placeholder that is a whole segment is a path parameter; one glued
        # to a segment (``leaderboard${qs}``) is a query string.
        p = re.sub(r"/\$\{[^}]*\}", "/X1", p)
        p = re.sub(r"\$\{[^}]*\}.*$", "", p).rstrip("/")
        if p != "/api" and "..." not in p:
            out.add(p)
    return out


def _matches(app, path: str) -> bool:
    for route in app.routes:
        for method in ("GET", "POST"):
            scope = {"type": "http", "path": path, "method": method}
            if route.matches(scope)[0] != Match.NONE:
                return True
    return False


def test_frontend_api_paths_are_found():
    paths = _frontend_api_paths()
    # The scan must keep seeing the calls it exists to check.
    assert {"/api/health", "/api/create", "/api/config/game"} <= paths
    assert "/api/bench/leaderboard" in paths


def test_every_frontend_api_path_is_served_under_api(tmp_path):
    app = create_app(frontend_dist=tmp_path / "no-dist")
    missing = sorted(p for p in _frontend_api_paths() if not _matches(app, p))
    assert missing == [], f"frontend calls paths the server does not serve: {missing}"
