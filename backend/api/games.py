"""Transcripts and Acquire Bench over HTTP (mounted bare and under ``/api``).

| Route | Returns |
|---|---|
| ``GET /games?source=live|bench&limit=50&before=<id>`` | ``{"games": [...], "next"}`` newest first |
| ``GET /games/{game_id}`` | summary + ``standings``, ``totals`` |
| ``GET /games/{game_id}/transcript`` | ``{header, entries, footer, redacted}`` (gzip) |
| ``GET /bench/leaderboard?protocol=&ruleset=&prompt_version=&track=`` | leaderboard |
| ``GET /bench/series/{series_id}`` | the series' games |

Unknown ids are JSON 404s; ids are validated before touching the disk (no path
traversal). Live transcripts come from ``ACQUIRE_TRANSCRIPT_DIR``, benchmark
results and transcripts from ``ACQUIRE_BENCH_DIR``. Unfinished games are
redacted (see transcripts/store.py). A browser navigation (``Accept:
text/html``) to a bare path gets the SPA's ``index.html`` when the frontend is
served, so client-side routes like ``/games/<id>`` survive a reload.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from app_state import session_manager
from transcripts.paths import bench_dir, transcript_dir, valid_game_id
from transcripts.store import TranscriptStore

router = APIRouter()

_ID_CHARS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.")


def _live_writers() -> dict:
    out = {}
    for room in list(session_manager._rooms.values()):
        writer = getattr(room, "transcript", None)
        if writer is not None and getattr(room, "game_id", None):
            out[room.game_id] = writer
    return out


def _transcript_dirs() -> list[Path]:
    dirs = []
    live = transcript_dir()
    if live is not None:
        dirs.append(live)
    base = bench_dir()
    dirs.append(base / "transcripts")
    if base.is_dir():
        dirs.extend(
            d / "transcripts"
            for d in sorted(base.iterdir())
            if d.is_dir() and d.name != "transcripts"
        )
    return dirs


store = TranscriptStore(_transcript_dirs, live=_live_writers)

# results.jsonl path -> (mtime, size, records)
_records_cache: dict[Path, tuple[float, int, list[dict]]] = {}


def _bench_records() -> list[dict]:
    from bench.results import RESULTS_FILE, result_dirs
    from bench.series import load_results

    records: list[dict] = []
    for d in result_dirs(bench_dir()):
        f = d / RESULTS_FILE
        try:
            st = f.stat()
        except OSError:
            continue
        cached = _records_cache.get(f)
        if cached is None or cached[:2] != (st.st_mtime, st.st_size):
            cached = (st.st_mtime, st.st_size, list(load_results(f).values()))
            _records_cache[f] = cached
        records.extend(cached[2])
    return records


def _not_found(what: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{what} not found")


def _spa(request: Request):
    """index.html for a browser navigation to a bare route (None otherwise)."""
    index = getattr(request.app.state, "spa_index", None)
    if index is None or request.url.path.startswith("/api/"):
        return None
    accept = request.headers.get("accept", "")
    if accept.startswith("text/html"):
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return None


@router.get("/games")
async def list_games(
    request: Request,
    source: str | None = Query(None, pattern="^(live|bench)$"),
    limit: int = Query(50, ge=1, le=500),
    before: str | None = None,
):
    if (page := _spa(request)) is not None:
        return page
    if before is not None and not valid_game_id(before):
        raise HTTPException(status_code=400, detail="invalid cursor")
    return store.list(source=source, limit=limit, before=before)


@router.get("/games/{game_id}")
async def get_game(request: Request, game_id: str):
    if (page := _spa(request)) is not None:
        return page
    detail = store.detail(game_id) if valid_game_id(game_id) else None
    if detail is None:
        raise _not_found("Game")
    return detail


@router.get("/games/{game_id}/transcript")
async def get_transcript(request: Request, game_id: str):
    if (page := _spa(request)) is not None:
        return page
    t = store.transcript(game_id) if valid_game_id(game_id) else None
    if t is None:
        raise _not_found("Game")
    body = json.dumps(t, separators=(",", ":"), ensure_ascii=False).encode()
    headers = {"Cache-Control": "no-cache" if t["redacted"] else "max-age=60"}
    if "gzip" in request.headers.get("accept-encoding", "") and len(body) > 1024:
        headers["Content-Encoding"] = "gzip"
        headers["Vary"] = "Accept-Encoding"
        body = gzip.compress(body, compresslevel=5)
    return Response(content=body, media_type="application/json", headers=headers)


@router.get("/bench/leaderboard")
async def bench_leaderboard(
    request: Request,
    protocol: str | None = None,
    prompt_version: str | None = None,
    ruleset: str | None = None,
    track: str = Query("all", pattern="^(all|vs-baseline|head-to-head)$"),
):
    if (page := _spa(request)) is not None:
        return page
    from bench.leaderboard import compute_leaderboard
    from bench.protocols import PROTOCOLS

    records = _bench_records()
    if protocol is not None and protocol not in PROTOCOLS:
        if not any(r.get("protocol") == protocol for r in records):
            raise _not_found("Protocol")
    if not any(r.get("protocol") for r in records):
        records = []
    return compute_leaderboard(
        records,
        protocol=protocol or (None if records else "acquire-bench-v1"),
        prompt_version=prompt_version,
        ruleset=ruleset,
        track=track,
    )


@router.get("/bench/series/{series_id}")
async def bench_series(request: Request, series_id: str):
    if (page := _spa(request)) is not None:
        return page
    if not series_id or len(series_id) > 200 or not set(series_id) <= _ID_CHARS:
        raise _not_found("Series")
    recs = [r for r in _bench_records() if r.get("series_id") == series_id]
    if not recs:
        raise _not_found("Series")
    recs.sort(key=lambda r: (r.get("seed", 0), r.get("rotation", 0)))
    first = recs[0]
    games = []
    for r in recs:
        labels = r.get("seat_labels") or r.get("seat_order") or []
        games.append(
            {
                "game_id": r.get("game_id"),
                "seed": r.get("seed"),
                "rotation": r.get("rotation"),
                "status": r.get("status"),
                "seat_order": r.get("seat_order"),
                "standings": [
                    {
                        "player_id": s["player_id"],
                        "name": labels[s["pos"]] if s["pos"] < len(labels) else None,
                        "agent_id": (r.get("seat_order") or [None] * 9)[s["pos"]],
                        "rank": s["rank"],
                        "score": s["score"],
                    }
                    for s in r.get("standings") or []
                ],
            }
        )
    return JSONResponse(
        {
            "series_id": series_id,
            "matchup": first.get("matchup"),
            "protocol": first.get("protocol"),
            "track": first.get("track"),
            "prompt_version": first.get("prompt_version"),
            "ruleset_id": first.get("ruleset_id") or "classic",
            "ruleset_fingerprint": first.get("ruleset_fingerprint"),
            "planned": first.get("series_games"),
            "games": games,
        }
    )
