"""WebSocket routes: host display and player devices."""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app_state import session_manager
from broadcast import (
    broadcast_lobby_update,
    min_to_start,
    send_host_state,
    send_player_state,
)
from config import get_settings
from lifecycle import end_game, handle_player_action, initialize_game

logger = logging.getLogger(__name__)
router = APIRouter()


async def ping_task(ws: WebSocket) -> None:
    """Send periodic pings to keep WebSocket alive through Railway's idle timeout."""
    try:
        while True:
            await asyncio.sleep(get_settings().ws_ping_interval)
            await ws.send_json({"type": "ping"})
    except Exception:  # noqa: BLE001, S110 - socket gone; the receive loop cleans up
        pass


# Close code for "this room / seat does not exist" (application range 4000-4999).
NOT_FOUND_CLOSE_CODE = 4004


async def _refuse(ws: WebSocket, reason: str) -> None:
    """Accept, then close with ``NOT_FOUND_CLOSE_CODE`` and ``reason``.

    Closing before accepting turns into an HTTP 403 handshake failure, which the
    browser reports only as a failed connection (no code, no reason): the page then
    retried for about a minute and fell back to an empty lobby. Accepting first lets
    the client read the code and show "game not found" instead.
    """
    await ws.accept()
    await ws.close(code=NOT_FOUND_CLOSE_CODE, reason=reason)


@router.websocket("/ws/host/{room_code}")
async def host_websocket(websocket: WebSocket, room_code: str):
    """WebSocket for host display (also used by spectators)."""
    room = session_manager.get_room(room_code)
    if room is None:
        await _refuse(websocket, "Room not found")
        return

    await websocket.accept()
    session_manager.connect_host(room_code, websocket)
    await send_host_state(room_code)

    ping = asyncio.create_task(ping_task(websocket))
    try:
        while True:
            data = await websocket.receive_json()
            if not isinstance(data, dict) or data.get("type") == "pong":
                continue
            action = data.get("action")
            if action == "add_bot":
                if session_manager.add_bot(room_code):
                    await broadcast_lobby_update(room_code)
            elif action == "start_game":
                room = session_manager.get_room(room_code)
                if (
                    room
                    and not room.started
                    and len(room.players) >= min_to_start(room)
                ):
                    session_manager.start_game(room_code)
                    await initialize_game(room_code)
            elif action == "end_game":
                room = session_manager.get_room(room_code)
                if room and room.started:
                    await end_game(room_code)
    except WebSocketDisconnect:
        pass
    finally:
        ping.cancel()


@router.websocket("/ws/player/{room_code}/{player_id}")
async def player_websocket(websocket: WebSocket, room_code: str, player_id: str):
    """WebSocket for a player device. Reconnecting re-sends the full state and
    any prompt still pending for this player (e.g. stock disposition)."""
    room = session_manager.get_room(room_code)
    if room is None:
        await _refuse(websocket, "Room not found")
        return
    if player_id not in room.players:
        await _refuse(websocket, "Player not found")
        return

    await websocket.accept()
    session_manager.connect_player(room_code, player_id, websocket)
    await send_player_state(room_code, player_id)

    ping = asyncio.create_task(ping_task(websocket))
    try:
        while True:
            try:
                data = await websocket.receive_json()
            except json.JSONDecodeError as e:
                await session_manager.send_to_player(
                    room_code,
                    player_id,
                    {"type": "error", "message": f"Invalid JSON: {e}"},
                )
                continue
            if isinstance(data, dict) and data.get("type") == "pong":
                continue
            try:
                await handle_player_action(room_code, player_id, data)
            except Exception as e:  # keep the connection alive
                logger.exception("Error handling player action")
                await session_manager.send_to_player(
                    room_code,
                    player_id,
                    {"type": "error", "message": f"Action failed: {e}"},
                )
    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001
        logger.warning("WebSocket error for %s/%s: %s", room_code, player_id, e)
    finally:
        ping.cancel()
        session_manager.disconnect(room_code, player_id, websocket)
