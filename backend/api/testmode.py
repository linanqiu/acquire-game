"""Test-mode-only routes (registered only when ``ACQUIRE_TEST_MODE=1``).

* ``POST /test/room/{code}/load-snapshot`` body
  ``{"snapshot": {...}, "seat_map"?: {snapshot_player_id: room_player_id}}``
* ``GET /test/room/{code}/snapshot`` -> ``to_snapshot`` of the live game
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException

from app_state import session_manager
from game.snapshot import from_snapshot, to_snapshot
from seats import get_runtime, run_locked

router = APIRouter(prefix="/test")


def remap_player_ids(data: Any, mapping: dict[str, str]) -> Any:
    """Deep copy of ``data`` with every string equal to an old player id (as a
    value or a dict key) replaced by the new id. Player ids appear in players,
    pending_action, merger state, trades, bots and events."""
    if isinstance(data, str):
        return mapping.get(data, data)
    if isinstance(data, list):
        return [remap_player_ids(v, mapping) for v in data]
    if isinstance(data, dict):
        return {
            mapping.get(k, k) if isinstance(k, str) else k: remap_player_ids(v, mapping)
            for k, v in data.items()
        }
    return data


def prepare_snapshot(room, snapshot: dict, seat_map: dict | None) -> dict:
    """Map snapshot seats onto the room's seats (raises ValueError)."""
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("players"), list):
        raise ValueError("snapshot.players missing")  # noqa: TRY004 - 400
    snap_ids = [p.get("player_id") for p in snapshot["players"]]
    room_ids = list(room.players)
    if seat_map is None:
        if len(snap_ids) != len(room_ids):
            raise ValueError(
                f"Snapshot has {len(snap_ids)} players, room has {len(room_ids)} seats"
            )
        mapping = dict(zip(snap_ids, room_ids))
    else:
        if not isinstance(seat_map, dict):
            raise ValueError("seat_map must be an object")
        mapping = dict(seat_map)
        unknown = [k for k in mapping if k not in snap_ids]
        if unknown:
            raise ValueError(f"seat_map keys not in snapshot: {unknown}")
        targets = [v for v in mapping.values()]
        if any(v not in room_ids for v in targets) or len(set(targets)) != len(targets):
            raise ValueError("seat_map values must be distinct room player ids")
        final = [mapping.get(s, s) for s in snap_ids]
        if sorted(final) != sorted(room_ids):
            raise ValueError(
                "After mapping, snapshot players must equal the room's seats"
            )
    out = remap_player_ids(snapshot, mapping)
    # Room seat names and AI seats win over the snapshot's.
    for p in out["players"]:
        seat = room.players[p["player_id"]]
        p["name"] = seat.name
    out["bots"] = {
        pid: {"difficulty": "medium", "rng_shared": True}
        for pid, seat in room.players.items()
        if seat.is_agent
    }
    return out


@router.post("/room/{room_code}/load-snapshot")
async def load_snapshot(room_code: str, body: dict = Body(...)):  # noqa: B008
    room = session_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    try:
        prepared = prepare_snapshot(room, body.get("snapshot"), body.get("seat_map"))
        game = from_snapshot(prepared)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Bad snapshot: {e}")

    def install(room):
        room.game = game
        room.started = True
        rt = room.runtime
        rt.thinking = None
        rt.stalled = None
        rt.turn_counts.clear()

    get_runtime(room)
    await run_locked(room_code, install)
    return {
        "status": "loaded",
        "phase": game.get_public_state()["phase"],
        "current_player": game.get_current_player_id(),
        "players": [p.player_id for p in game.players],
    }


@router.get("/room/{room_code}/snapshot")
async def get_snapshot(room_code: str):
    room = session_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.game is None:
        raise HTTPException(status_code=400, detail="Game not started")
    rt = get_runtime(room)
    async with rt.lock:
        return to_snapshot(room.game)
