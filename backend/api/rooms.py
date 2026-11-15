"""HTTP routes: rooms, seats, agent catalog, actions."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Body, Form, HTTPException

from agents import registry
from app_state import session_manager
from broadcast import (
    broadcast_game_state,
    broadcast_lobby_update,
    lobby_players,
    min_to_start,
)
from game.game import GamePhase
from lifecycle import initialize_game
from seats import get_runtime, human_action

router = APIRouter()


def _room_or_404(room_code: str):
    room = session_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


@router.post("/create")
async def create_room(player_name: str = Form(...)):
    """Create a new game room and add the creator as first player."""
    room_code = session_manager.create_room()
    player_id = str(uuid.uuid4())
    if not session_manager.join_room(room_code, player_id, player_name):
        raise HTTPException(status_code=500, detail="Failed to create room")
    return {"room_code": room_code, "player_id": player_id, "is_host": True}


@router.post("/create-spectator")
async def create_spectator_room():
    """Create a room for spectator mode (AI seats only); watch via the host WebSocket."""
    room_code = session_manager.create_room()
    return {"room_code": room_code, "is_spectator": True}


@router.post("/join")
async def join_room(room_code: str = Form(...), player_name: str = Form(...)):
    """Join an existing room."""
    code = room_code.upper()
    room = _room_or_404(code)
    if room.started:
        raise HTTPException(status_code=400, detail="Game already started")
    if len(room.players) >= room.max_players:
        raise HTTPException(status_code=400, detail="Room is full")
    player_id = str(uuid.uuid4())
    if not session_manager.join_room(code, player_id, player_name):
        room = session_manager.get_room(code)
        if room and any(
            p.name.lower() == player_name.lower() for p in room.players.values()
        ):
            raise HTTPException(status_code=400, detail="Player name already taken")
        raise HTTPException(status_code=400, detail="Failed to join room")
    await broadcast_lobby_update(code)
    return {"room_code": code, "player_id": player_id}


# ---------------------------------------------------------------------------
# Seats
# ---------------------------------------------------------------------------


@router.get("/agents/catalog")
async def agents_catalog():
    """AI opponents the lobby can offer: `[{id, kind, label, description, available}]`."""
    return registry.catalog()


def _add_seat(
    room_code: str,
    agent_id: Any,
    name: Any = None,
    script: Any = None,
    strict: Any = None,
):
    room = _room_or_404(room_code)
    if room.started:
        raise HTTPException(status_code=400, detail="Game already started")
    if len(room.players) >= room.max_players:
        raise HTTPException(status_code=400, detail="Room is full")
    if not isinstance(agent_id, str) or not agent_id:
        raise HTTPException(status_code=422, detail="agent_id is required")
    entry = registry.entry(agent_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Unknown agent: {agent_id}")
    if not entry.get("available"):
        raise HTTPException(
            status_code=400, detail=f"Agent not available: {entry.get('label')}"
        )
    if script is not None and agent_id != "scripted":
        raise HTTPException(status_code=400, detail="Only scripted seats take a script")
    if script is not None and not (
        isinstance(script, list) and all(isinstance(a, dict) for a in script)
    ):
        raise HTTPException(status_code=422, detail="script must be a list of actions")
    if strict is not None and agent_id != "scripted":
        raise HTTPException(status_code=400, detail="Only scripted seats take strict")
    if strict is not None and not isinstance(strict, bool):
        raise HTTPException(status_code=422, detail="strict must be a boolean")
    if name is not None:
        if not isinstance(name, str) or not name.strip():
            raise HTTPException(status_code=422, detail="Invalid name")
        name = name.strip()
    else:
        label = entry.get("label") or agent_id
        if agent_id == "bot":
            name = session_manager.next_seat_name(room_code, "Bot", numbered=True)
        elif agent_id == "scripted":
            name = session_manager.next_seat_name(room_code, "Scripted", numbered=True)
        else:
            name = session_manager.next_seat_name(room_code, label, numbered=False)
    if any(p.name.lower() == name.lower() for p in room.players.values()):
        raise HTTPException(status_code=400, detail="Player name already taken")
    try:
        opts = {"script": script} if script is not None else {}
        if strict:
            opts["strict"] = True
        agent = registry.create(agent_id, name=name, **opts)
    except registry.UnknownAgentError:
        raise HTTPException(status_code=404, detail=f"Unknown agent: {agent_id}")
    except registry.UnavailableAgentError:
        raise HTTPException(status_code=400, detail=f"Agent not available: {agent_id}")
    kind = getattr(agent, "kind", entry.get("kind", "bot"))
    seat_id = session_manager.add_seat(
        room_code,
        kind=kind,
        name=name,
        agent_id=agent_id,
        # The default bot keeps its plain "BOT" badge (no label).
        agent_label=None if kind == "bot" else entry.get("label"),
        agent=agent,
    )
    if seat_id is None:
        raise HTTPException(status_code=400, detail="Cannot add seat")
    return {"player_id": seat_id, "name": name, "kind": kind}


@router.post("/room/{room_code}/add-seat")
async def add_seat(room_code: str, body: dict = Body(...)):  # noqa: B008
    """Add an AI seat: body `{"agent_id", "name"?, "script"? (scripted, test
    mode), "strict"? (scripted: an illegal or never-consumed script entry is
    reported in the room debug state and makes the seat fall back loudly)}`."""
    out = _add_seat(
        room_code,
        body.get("agent_id"),
        body.get("name"),
        body.get("script"),
        body.get("strict"),
    )
    await broadcast_lobby_update(room_code)
    return out


@router.post("/room/{room_code}/add-bot")
async def add_bot(room_code: str):
    """Alias for add-seat with agent_id "bot" (keeps the old `bot_id` field)."""
    out = _add_seat(room_code, "bot")
    await broadcast_lobby_update(room_code)
    return {"bot_id": out["player_id"], **out}


@router.post("/room/{room_code}/remove-seat/{player_id}")
async def remove_seat(room_code: str, player_id: str):
    """Remove an AI seat (lobby only)."""
    room = _room_or_404(room_code)
    if room.started:
        raise HTTPException(status_code=400, detail="Game already started")
    seat = room.players.get(player_id)
    if seat is None:
        raise HTTPException(status_code=404, detail="Player not found")
    if not seat.is_agent:
        raise HTTPException(status_code=400, detail="Only AI seats can be removed")
    session_manager.remove_seat(room_code, player_id)
    await broadcast_lobby_update(room_code)
    return {"status": "removed", "player_id": player_id}


# ---------------------------------------------------------------------------
# Game
# ---------------------------------------------------------------------------


@router.post("/room/{room_code}/start")
async def start_game(room_code: str):
    room = _room_or_404(room_code)
    if room.started:
        raise HTTPException(status_code=400, detail="Game already started")
    needed = min_to_start(room)
    if len(room.players) < needed:
        raise HTTPException(
            status_code=400, detail=f"Need at least {needed} players to start"
        )
    if not session_manager.start_game(room_code):
        raise HTTPException(status_code=400, detail="Failed to start game")
    await initialize_game(room_code)
    return {"status": "started"}


@router.post("/room/{room_code}/configure")
async def configure_room(
    room_code: str,
    seed: int | None = Body(None),
    tile_order: list[str] | None = Body(None),  # noqa: B008
):
    """Configure room settings (seed, tile order) before game starts."""
    room = _room_or_404(room_code)
    if room.started:
        raise HTTPException(
            status_code=400, detail="Cannot configure after game started"
        )
    if seed is not None:
        room.seed = seed
    if tile_order is not None:
        room.tile_order = tile_order
    return {"status": "configured"}


@router.get("/room/{room_code}/state")
async def get_room_state(room_code: str):
    room = _room_or_404(room_code)
    return {
        "room_code": room_code,
        "started": room.started,
        "players": lobby_players(room),
        "min_players": min_to_start(room),
        "max_players": room.max_players,
    }


@router.get("/room/{room_code}/debug")
async def get_room_debug(room_code: str):
    """Driver diagnostics: fallback counter and log, awaiting agent, stalls,
    and per scripted seat its script state (``scripted``)."""
    room = _room_or_404(room_code)
    rt = get_runtime(room)
    scripted = {
        pid: seat.agent.debug()
        for pid, seat in room.players.items()
        if seat.kind == "scripted" and hasattr(seat.agent, "debug")
    }
    over = room.game is not None and room.game.phase == GamePhase.GAME_OVER
    for info in scripted.values():
        # at game over, what is still queued was never consumed
        info["unconsumed_at_game_over"] = info["unconsumed"] if over else []
    problems = [
        pid
        for pid, info in scripted.items()
        if info["strict"] and (info["violations"] or info["unconsumed_at_game_over"])
    ]
    return {
        "room_code": room_code,
        "started": room.started,
        **rt.debug(),
        "scripted": scripted,
        "script_problems": problems,
    }


@router.post("/room/{room_code}/refresh/{player_id}")
async def refresh_player_state(room_code: str, player_id: str):
    """Force re-send game state via WebSocket."""
    room = session_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail=f"Room not found: {room_code}")
    if not room.started or room.game is None:
        raise HTTPException(status_code=400, detail="Game not started")
    if player_id not in room.players:
        raise HTTPException(status_code=404, detail="Player not found")
    await broadcast_game_state(room_code)
    return {"status": "ok"}


@router.post("/room/{room_code}/action/{player_id}")
async def http_game_action(room_code: str, player_id: str, data: dict):
    """Execute a game action via HTTP (same path as the WebSocket).

    Response: `{"status": "ok"|"error", "phase", "current_player",
    "your_hand", "error"?}`.
    """
    room = _room_or_404(room_code)
    if not room.started or room.game is None:
        raise HTTPException(status_code=400, detail="Game not started")
    if player_id not in room.players:
        raise HTTPException(status_code=404, detail="Player not found")

    result = await human_action(room_code, player_id, data)

    game = room.game
    response = {
        "status": "ok" if result.get("success") else "error",
        "phase": game.get_public_state().get("phase"),
        "current_player": game.get_current_player_id(),
        "your_hand": [str(t) for t in game.get_player(player_id).hand]
        if game.get_player(player_id)
        else [],
    }
    if not result.get("success"):
        response["error"] = result.get("error") or "Unknown error"
    return response
