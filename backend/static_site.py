"""Serve the built React app (single-service deploys).

Active only when the dist directory exists, so local dev and tests are
unchanged. Hashed build assets get long-lived cache headers; ``index.html``
is never cached so a deploy is picked up on the next load. Any other GET that
is not an API/WebSocket path falls back to ``index.html`` (client-side routes
such as ``/play/ABCD``); unknown ``/api/...`` paths stay JSON 404s.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from starlette.staticfiles import StaticFiles

BACKEND_DIR = Path(__file__).resolve().parent
IMMUTABLE = "public, max-age=31536000, immutable"
NO_CACHE = "no-cache"
# Never answered with index.html: unknown paths here are real 404s.
RESERVED_PREFIXES = ("api/", "ws/", "test/")
RESERVED_EXACT = ("api", "ws", "test")


def resolve_dist(configured: str | Path) -> Path | None:
    """Return the dist directory if it holds an index.html, else None."""
    path = Path(configured)
    if not path.is_absolute():
        path = BACKEND_DIR / path
    path = path.resolve()
    return path if (path / "index.html").is_file() else None


class _ImmutableAssets(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = IMMUTABLE
        return response


def mount_frontend(app: FastAPI, dist: Path) -> None:
    """Add asset mount + SPA fallback. Call after every other route is added."""
    index = dist / "index.html"
    # api/games.py answers browser navigations to bare /games, /bench paths
    # with the SPA (those are also client-side routes).
    app.state.spa_index = index
    if (dist / "assets").is_dir():
        app.mount("/assets", _ImmutableAssets(directory=dist / "assets"), name="assets")

    # Non-GET methods on unknown paths are plain 404s (not 405 from the GET catch-all).
    @app.api_route(
        "/{full_path:path}",
        methods=["POST", "PUT", "PATCH", "DELETE"],
        include_in_schema=False,
    )
    async def unknown_write(full_path: str):
        raise HTTPException(status_code=404, detail="Not Found")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        if full_path in RESERVED_EXACT or full_path.startswith(RESERVED_PREFIXES):
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = (dist / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(dist):
            # Top-level files (favicon, robots...) are not content-hashed.
            return FileResponse(
                candidate, headers={"Cache-Control": "public, max-age=3600"}
            )
        return FileResponse(index, headers={"Cache-Control": NO_CACHE})
