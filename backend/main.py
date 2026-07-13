"""FastAPI application for Acquire board game."""

import asyncio
import json
import logging
import os
import re
import time
import uuid
from collections import defaultdict
from typing import Optional, Union, Literal
from urllib.parse import urlparse

from fastapi import (
    Body,
    Depends,
    FastAPI,
    Header,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
    HTTPException,
    Form,
)
from pydantic import BaseModel, field_validator, ValidationError
from starlette.middleware.cors import CORSMiddleware

from config import get_settings
from health import router as health_router
from logging_config import setup_logging
from middleware import RequestLoggingMiddleware
from session.manager import SessionManager
from game.board import Tile
from game.game import Game, GamePhase
from game.action import TradeOffer
from game.rules import Rules

# Initialize logging before anything else
setup_logging()

logger = logging.getLogger(__name__)


# =============================================================================
# Pydantic Models for WebSocket Message Validation
# =============================================================================

VALID_CHAINS = [
    "Luxor",
    "Tower",
    "American",
    "Worldwide",
    "Festival",
    "Imperial",
    "Continental",
]


def _validate_chain_name(v: str) -> str:
    """Shared validator for chain names."""
    if v not in VALID_CHAINS:
        raise ValueError(f"Invalid chain: {v}. Must be one of {VALID_CHAINS}")
    return v


class PlaceTileMessage(BaseModel):
    """Validate place_tile action messages."""

    action: Literal["place_tile"]
    tile: str

    @field_validator("tile")
    @classmethod
    def validate_tile(cls, v: str) -> str:
        """Validate tile format (e.g., '1A', '12I')."""
        if not isinstance(v, str):
            raise ValueError("Tile must be a string")
        v = v.upper().strip()
        if not re.match(r"^1?[0-9][A-I]$", v):
            raise ValueError("Invalid tile format. Expected format like 1A, 5E, 12I")
        return v


class FoundChainMessage(BaseModel):
    """Validate found_chain action messages."""

    action: Literal["found_chain"]
    chain: str

    @field_validator("chain")
    @classmethod
    def validate_chain(cls, v: str) -> str:
        """Validate chain name."""
        return _validate_chain_name(v)


class MergerChoiceMessage(BaseModel):
    """Validate merger_choice action messages."""

    action: Literal["merger_choice"]
    surviving_chain: str

    @field_validator("surviving_chain")
    @classmethod
    def validate_chain(cls, v: str) -> str:
        """Validate chain name."""
        return _validate_chain_name(v)


class DispositionData(BaseModel):
    """Validate disposition data within merger_disposition."""

    sell: int = 0
    trade: int = 0
    hold: int = 0

    @field_validator("sell", "trade", "hold")
    @classmethod
    def validate_non_negative(cls, v: int) -> int:
        """Ensure values are non-negative."""
        if v < 0:
            raise ValueError("Value must be non-negative")
        return v


class MergerDispositionMessage(BaseModel):
    """Validate merger_disposition action messages."""

    action: Literal["merger_disposition"]
    defunct_chain: str
    disposition: DispositionData

    @field_validator("defunct_chain")
    @classmethod
    def validate_chain(cls, v: str) -> str:
        """Validate chain name."""
        return _validate_chain_name(v)


class BuyStocksMessage(BaseModel):
    """Validate buy_stocks action messages."""

    action: Literal["buy_stocks"]
    purchases: dict[str, int]

    @field_validator("purchases")
    @classmethod
    def validate_purchases(cls, v: dict) -> dict:
        """Validate purchases dictionary."""
        if not isinstance(v, dict):
            raise ValueError("Purchases must be a dictionary")
        total = 0
        for chain, quantity in v.items():
            if chain not in VALID_CHAINS:
                raise ValueError(f"Invalid chain: {chain}")
            if not isinstance(quantity, int) or quantity < 0:
                raise ValueError(
                    f"Invalid quantity for {chain}: must be non-negative integer"
                )
            total += quantity
        if total > 3:
            raise ValueError("Cannot buy more than 3 stocks per turn")
        return v


class EndTurnMessage(BaseModel):
    """Validate end_turn action messages."""

    action: Literal["end_turn"]


class DeclareEndGameMessage(BaseModel):
    """Validate declare_end_game action messages."""

    action: Literal["declare_end_game"]


class ProposeTradeMessage(BaseModel):
    """Validate propose_trade action messages."""

    action: Literal["propose_trade"]
    to_player_id: str
    offering_stocks: dict[str, int] = {}
    offering_money: int = 0
    requesting_stocks: dict[str, int] = {}
    requesting_money: int = 0

    @field_validator("offering_stocks", "requesting_stocks")
    @classmethod
    def validate_stocks(cls, v: dict) -> dict:
        """Validate stock dictionaries."""
        for chain, quantity in v.items():
            if chain not in VALID_CHAINS:
                raise ValueError(f"Invalid chain: {chain}")
            if not isinstance(quantity, int) or quantity < 0:
                raise ValueError(
                    f"Stock quantity for {chain} must be non-negative integer"
                )
        return v

    @field_validator("offering_money", "requesting_money")
    @classmethod
    def validate_money(cls, v: int) -> int:
        """Validate money amounts."""
        if v < 0:
            raise ValueError("Money amount must be non-negative")
        return v


class AcceptTradeMessage(BaseModel):
    """Validate accept_trade action messages."""

    action: Literal["accept_trade"]
    trade_id: str


class RejectTradeMessage(BaseModel):
    """Validate reject_trade action messages."""

    action: Literal["reject_trade"]
    trade_id: str


class CancelTradeMessage(BaseModel):
    """Validate cancel_trade action messages."""

    action: Literal["cancel_trade"]
    trade_id: str


# Union type for all valid message types
WebSocketMessage = Union[
    PlaceTileMessage,
    FoundChainMessage,
    MergerChoiceMessage,
    MergerDispositionMessage,
    BuyStocksMessage,
    EndTurnMessage,
    DeclareEndGameMessage,
    ProposeTradeMessage,
    AcceptTradeMessage,
    RejectTradeMessage,
    CancelTradeMessage,
]


def validate_websocket_message(
    data: dict,
) -> tuple[Optional[WebSocketMessage], Optional[str]]:
    """Validate incoming WebSocket message data.

    Args:
        data: Raw message data dictionary

    Returns:
        Tuple of (validated_message, error_message)
        If validation succeeds, error_message is None
        If validation fails, validated_message is None
    """
    action = data.get("action")

    message_types = {
        "place_tile": PlaceTileMessage,
        "found_chain": FoundChainMessage,
        "merger_choice": MergerChoiceMessage,
        "merger_disposition": MergerDispositionMessage,
        "buy_stocks": BuyStocksMessage,
        "end_turn": EndTurnMessage,
        "declare_end_game": DeclareEndGameMessage,
        "propose_trade": ProposeTradeMessage,
        "accept_trade": AcceptTradeMessage,
        "reject_trade": RejectTradeMessage,
        "cancel_trade": CancelTradeMessage,
    }

    if action not in message_types:
        return None, f"Unknown action: {action}"

    try:
        validated = message_types[action](**data)
        return validated, None
    except ValidationError as e:
        # Extract first error message
        errors = e.errors()
        if errors:
            return None, f"Validation error: {errors[0]['msg']}"
        return None, "Validation error"


settings = get_settings()

app = FastAPI(title="Acquire Board Game", debug=not settings.is_production)

# CORS middleware (SH-003): explicit origins from settings, restricted
# methods/headers. In production, ALLOWED_ORIGINS must be configured or all
# cross-origin requests are denied (same-origin traffic is unaffected).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Request logging middleware
app.add_middleware(RequestLoggingMiddleware)

# Health check endpoints
app.include_router(health_router)

# Global session manager
session_manager = SessionManager()


# =============================================================================
# Rate Limiting (SH-002)
# =============================================================================


class RequestRateLimiter:
    """Sliding-window rate limiter usable as a FastAPI dependency.

    scope="ip"   -> one bucket per client IP (for /create, /join)
    scope="room" -> one bucket per {room_code} path parameter (for /start, /add-bot)

    State persists for the lifetime of the process (single-instance deployment).
    Raises 429 with a Retry-After header when the limit is exceeded.
    """

    def __init__(self, max_requests: int, window_seconds: float, scope: str = "ip"):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.scope = scope
        self._requests: dict[str, list[float]] = defaultdict(list)

    def _key(self, request: Request) -> str:
        if self.scope == "room":
            return f"room:{request.path_params.get('room_code', 'unknown')}"
        client_ip = request.client.host if request.client else "unknown"
        return f"ip:{client_ip}"

    def reset(self) -> None:
        """Clear all rate limit state (used by tests)."""
        self._requests.clear()

    async def __call__(self, request: Request) -> None:
        if not settings.rate_limit_enabled:
            return

        now = time.monotonic()
        key = self._key(request)
        bucket = [t for t in self._requests[key] if now - t < self.window_seconds]

        if len(bucket) >= self.max_requests:
            self._requests[key] = bucket
            retry_after = max(1, int(self.window_seconds - (now - bucket[0])) + 1)
            logger.warning(
                "Rate limit exceeded for %s on %s", key, request.url.path
            )
            raise HTTPException(
                status_code=429,
                detail="Too many requests",
                headers={"Retry-After": str(retry_after)},
            )

        bucket.append(now)
        self._requests[key] = bucket


# Per-endpoint limiter instances (state persists across requests)
create_rate_limiter = RequestRateLimiter(max_requests=5, window_seconds=60)
join_rate_limiter = RequestRateLimiter(max_requests=10, window_seconds=60)
start_rate_limiter = RequestRateLimiter(max_requests=3, window_seconds=60, scope="room")
add_bot_rate_limiter = RequestRateLimiter(
    max_requests=10, window_seconds=60, scope="room"
)

# Registry so tests can reset all limiter state between tests
ALL_RATE_LIMITERS = [
    create_rate_limiter,
    join_rate_limiter,
    start_rate_limiter,
    add_bot_rate_limiter,
]


# =============================================================================
# Authentication (SH-001)
# =============================================================================


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    """Extract token from an Authorization header value.

    Accepts both "Bearer <token>" and a raw token for convenience.
    """
    if not authorization:
        return None
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return authorization.strip() or None


async def require_room_token(
    room_code: str, authorization: Optional[str] = Header(None)
) -> str:
    """FastAPI dependency: require a valid session token for a room.

    The token must match the room's host token or any player's session token.
    Raises 401 when missing/invalid. Raises 404 when the room does not exist
    (preserves existing endpoint semantics for unknown rooms).
    """
    room = session_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    token = _extract_bearer_token(authorization)
    if token is None:
        logger.warning("Auth failure: missing session token for room %s", room_code)
        raise HTTPException(status_code=401, detail="Missing session token")
    if not room.is_valid_token(token):
        logger.warning("Auth failure: invalid session token for room %s", room_code)
        raise HTTPException(status_code=401, detail="Invalid session token")
    return token


# HTTP Routes
@app.post("/create")
async def create_room(
    player_name: str = Form(...),
    _rate_limit: None = Depends(create_rate_limiter),
):
    """Create a new game room and add the creator as first player."""
    room_code = session_manager.create_room()

    # Add creator as first player
    player_id = str(uuid.uuid4())
    success = session_manager.join_room(room_code, player_id, player_name)

    if not success:
        raise HTTPException(status_code=500, detail="Failed to create room")

    room = session_manager.get_room(room_code)
    return {
        "room_code": room_code,
        "player_id": player_id,
        "is_host": True,
        "session_token": room.players[player_id].session_token,
    }


@app.post("/create-spectator")
async def create_spectator_room(_rate_limit: None = Depends(create_rate_limiter)):
    """Create a new game room for spectator mode (bots only).

    The caller does not join as a player - they can watch via the host WebSocket.
    Use /room/{room_code}/add-bot to add bots, then start the game.
    """
    room_code = session_manager.create_room()

    room = session_manager.get_room(room_code)
    return {
        "room_code": room_code,
        "is_spectator": True,
        "host_token": room.host_token,
    }


@app.post("/join")
async def join_room(
    room_code: str = Form(...),
    player_name: str = Form(...),
    _rate_limit: None = Depends(join_rate_limiter),
):
    """Join an existing room."""
    room = session_manager.get_room(room_code.upper())
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    if room.started:
        raise HTTPException(status_code=400, detail="Game already started")

    if len(room.players) >= room.max_players:
        raise HTTPException(status_code=400, detail="Room is full")

    player_id = str(uuid.uuid4())
    success = session_manager.join_room(room_code.upper(), player_id, player_name)

    if not success:
        # Check if it was a duplicate name
        room = session_manager.get_room(room_code.upper())
        if room and any(
            p.name.lower() == player_name.lower() for p in room.players.values()
        ):
            raise HTTPException(status_code=400, detail="Player name already taken")
        raise HTTPException(status_code=400, detail="Failed to join room")

    room = session_manager.get_room(room_code.upper())
    return {
        "room_code": room_code.upper(),
        "player_id": player_id,
        "session_token": room.players[player_id].session_token,
    }


@app.post("/room/{room_code}/add-bot")
async def add_bot(
    room_code: str,
    _token: str = Depends(require_room_token),
    _rate_limit: None = Depends(add_bot_rate_limiter),
):
    """Add a bot to the room. Requires a valid session token (SH-001)."""
    room = session_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    if room.started:
        raise HTTPException(status_code=400, detail="Game already started")

    bot_id = session_manager.add_bot(room_code)
    if bot_id is None:
        raise HTTPException(
            status_code=400, detail="Cannot add bot (room full or game started)"
        )

    # Notify connected clients about new bot
    await broadcast_lobby_update(room_code)

    return {"bot_id": bot_id}


@app.post("/room/{room_code}/start")
async def start_game(
    room_code: str,
    _token: str = Depends(require_room_token),
    _rate_limit: None = Depends(start_rate_limiter),
):
    """Start the game. Requires a valid session token (SH-001)."""
    room = session_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    if room.started:
        raise HTTPException(status_code=400, detail="Game already started")

    if len(room.players) < room.min_players:
        raise HTTPException(
            status_code=400, detail=f"Need at least {room.min_players} players to start"
        )

    success = session_manager.start_game(room_code)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to start game")

    # Initialize game state
    await initialize_game(room_code)

    # Broadcast game start to all clients
    await broadcast_game_state(room_code)

    return {"status": "started"}


@app.post("/room/{room_code}/configure")
async def configure_room(
    room_code: str,
    seed: Optional[int] = Body(None),
    tile_order: Optional[list[str]] = Body(None),
):
    """Configure room settings (seed, tile order) before game starts."""
    room = session_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    if room.started:
        raise HTTPException(
            status_code=400, detail="Cannot configure after game started"
        )

    if seed is not None:
        room.seed = seed
    if tile_order is not None:
        room.tile_order = tile_order

    return {"status": "configured"}


@app.get("/room/{room_code}/state")
async def get_room_state(room_code: str):
    """Get current room state."""
    room = session_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    players = [
        {"player_id": p.player_id, "name": p.name, "is_bot": p.is_bot}
        for p in room.players.values()
    ]

    return {
        "room_code": room_code,
        "started": room.started,
        "players": players,
        "min_players": room.min_players,
        "max_players": room.max_players,
    }


@app.post("/room/{room_code}/refresh/{player_id}")
async def refresh_player_state(room_code: str, player_id: str):
    """Force re-send game state to a specific player via WebSocket."""
    room = session_manager.get_room(room_code)
    if room is None:
        all_rooms = list(session_manager._rooms.keys())
        raise HTTPException(
            status_code=404,
            detail=f"Room not found: {room_code}. Active rooms: {all_rooms}",
        )
    if not room.started or room.game is None:
        raise HTTPException(status_code=400, detail="Game not started")
    if player_id not in room.players:
        raise HTTPException(status_code=404, detail="Player not found")

    try:
        await broadcast_game_state(room_code)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Broadcast failed: {e}")
    return {"status": "ok"}


@app.post("/room/{room_code}/action/{player_id}")
async def http_game_action(room_code: str, player_id: str, data: dict):
    """Execute a game action via HTTP instead of WebSocket.

    This provides a reliable alternative to WebSocket for sending game actions.
    The response includes the updated game state, bypassing WebSocket delivery.

    Supported actions: place_tile, found_chain, buy_stocks, end_turn,
    merger_choice, merger_disposition
    """
    room = session_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    if not room.started or room.game is None:
        raise HTTPException(status_code=400, detail="Game not started")
    if player_id not in room.players:
        raise HTTPException(status_code=404, detail="Player not found")

    # Capture any errors sent via WS during action processing
    action_errors: list[str] = []
    original_send = session_manager.send_to_player

    async def capture_errors(rc, pid, msg):
        if pid == player_id and isinstance(msg, dict) and msg.get("type") == "error":
            action_errors.append(msg.get("message", "Unknown error"))
        await original_send(rc, pid, msg)

    session_manager.send_to_player = capture_errors
    try:
        await handle_player_action(room_code, player_id, data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        session_manager.send_to_player = original_send

    # Return the current game state so caller doesn't depend on WebSocket
    game = room.game
    if game is None:
        return {"status": "ok"}

    game_state = game.get_public_state()
    player_state = game.get_player_state(player_id)
    response = {
        "status": "ok",
        "phase": game_state.get("phase"),
        "current_player": game_state.get("current_player"),
        "your_hand": player_state.get("hand", []),
    }

    # Include error info if the action failed
    if action_errors:
        response["error"] = action_errors[0]
        response["status"] = "error"

    return response


def websocket_origin_allowed(websocket: WebSocket) -> bool:
    """Validate the Origin header on WebSocket handshakes (SH-003).

    CORS does not apply to WebSockets, so origins are checked explicitly.
    Browsers always send Origin; non-browser clients may omit it (they are not
    subject to CORS anyway and must still present a valid session token).
    Enforced only in production so local/LAN development keeps working.
    """
    origin = websocket.headers.get("origin")
    if not origin:
        return True
    if not settings.is_production:
        return True
    if origin in settings.cors_origins:
        return True
    # Same-origin handshake (e.g. SPA served by this backend in one container)
    host = websocket.headers.get("host", "")
    if host and urlparse(origin).netloc == host:
        return True
    return False


# WebSocket keepalive ping task
async def ping_task(ws: WebSocket) -> None:
    """Send periodic pings to keep WebSocket alive through Railway's idle timeout."""
    try:
        while True:
            await asyncio.sleep(settings.ws_ping_interval)
            await ws.send_json({"type": "ping"})
    except Exception:
        pass


# WebSocket endpoints
@app.websocket("/ws/host/{room_code}")
async def host_websocket(
    websocket: WebSocket, room_code: str, token: Optional[str] = Query(None)
):
    """WebSocket for host display. Requires a valid session token (SH-001)."""
    if not websocket_origin_allowed(websocket):
        logger.warning("Rejected host WebSocket from disallowed origin")
        await websocket.close(code=4003, reason="Origin not allowed")
        return

    room = session_manager.get_room(room_code)
    if room is None:
        await websocket.close(code=4004, reason="Room not found")
        return

    # Host must present either the room's host token or a player session token
    if not room.is_valid_token(token):
        logger.warning("Auth failure: host WebSocket for room %s", room_code)
        await websocket.close(code=4001, reason="Invalid session token")
        return

    await websocket.accept()
    session_manager.connect_host(room_code, websocket)

    # Send current state
    await send_host_state(room_code)

    ping = asyncio.create_task(ping_task(websocket))
    try:
        while True:
            data = await websocket.receive_json()

            # Handle pong responses to keepalive pings
            if data.get("type") == "pong":
                continue

            action = data.get("action")

            if action == "add_bot":
                bot_id = session_manager.add_bot(room_code)
                if bot_id:
                    await broadcast_lobby_update(room_code)

            elif action == "start_game":
                room = session_manager.get_room(room_code)
                if room and not room.started and len(room.players) >= room.min_players:
                    session_manager.start_game(room_code)
                    await initialize_game(room_code)
                    await broadcast_game_state(room_code)

            elif action == "end_game":
                room = session_manager.get_room(room_code)
                if room and room.started:
                    await end_game(room_code)

    except WebSocketDisconnect:
        pass
    finally:
        ping.cancel()


@app.websocket("/ws/player/{room_code}/{player_id}")
async def player_websocket(
    websocket: WebSocket,
    room_code: str,
    player_id: str,
    token: Optional[str] = Query(None),
):
    """WebSocket for player device. Requires a valid session token (SH-001)."""
    if not websocket_origin_allowed(websocket):
        logger.warning("Rejected player WebSocket from disallowed origin")
        await websocket.close(code=4003, reason="Origin not allowed")
        return

    room = session_manager.get_room(room_code)
    if room is None:
        await websocket.close(code=4004, reason="Room not found")
        return

    if player_id not in room.players:
        await websocket.close(code=4004, reason="Player not found")
        return

    # Strict session token validation: token must match this player's token
    if token is None or room.players[player_id].session_token != token:
        logger.warning(
            "Auth failure: player WebSocket for room %s player %s",
            room_code,
            player_id,
        )
        await websocket.close(code=4001, reason="Invalid session token")
        return

    await websocket.accept()
    session_manager.connect_player(room_code, player_id, websocket)

    # Send current state to player
    await send_player_state(room_code, player_id)

    ping = asyncio.create_task(ping_task(websocket))
    try:
        while True:
            try:
                data = await websocket.receive_json()
            except json.JSONDecodeError as e:
                # Malformed JSON - send error but keep connection alive
                await session_manager.send_to_player(
                    room_code,
                    player_id,
                    {"type": "error", "message": f"Invalid JSON: {e}"},
                )
                continue

            # Handle pong responses to keepalive pings
            if data.get("type") == "pong":
                continue

            try:
                await handle_player_action(room_code, player_id, data)
            except Exception as e:
                # Log error but keep connection alive
                print(f"Error handling player action: {e}")
                await session_manager.send_to_player(
                    room_code,
                    player_id,
                    {"type": "error", "message": f"Action failed: {e}"},
                )

    except WebSocketDisconnect:
        pass  # Normal disconnect, cleanup happens in finally
    except Exception as e:
        # Unexpected error - log it
        print(f"WebSocket error for {room_code}/{player_id}: {e}")
    finally:
        ping.cancel()
        # Always cleanup, regardless of how we exit the loop
        session_manager.disconnect(room_code, player_id, websocket)


async def handle_player_action(room_code: str, player_id: str, data: dict) -> None:
    """Process player actions and broadcast updates.

    Args:
        room_code: The room code
        player_id: The player's ID
        data: The raw message data from the WebSocket
    """
    room = session_manager.get_room(room_code)
    if room is None or not room.started:
        return

    # Validate the incoming message
    validated_msg, error = validate_websocket_message(data)
    if error is not None:
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": error}
        )
        return

    action = data.get("action")

    if action == "place_tile":
        # validated_msg is PlaceTileMessage, tile is already validated and normalized
        await handle_place_tile(room_code, player_id, validated_msg.tile)

    elif action == "found_chain":
        # validated_msg is FoundChainMessage, chain is already validated
        await handle_found_chain(room_code, player_id, validated_msg.chain)

    elif action == "merger_choice":
        # validated_msg is MergerChoiceMessage
        await handle_merger_choice(room_code, player_id, validated_msg.surviving_chain)

    elif action == "merger_disposition":
        # validated_msg is MergerDispositionMessage
        disposition = {
            "sell": validated_msg.disposition.sell,
            "trade": validated_msg.disposition.trade,
            "hold": validated_msg.disposition.hold,
        }
        await handle_merger_disposition(
            room_code, player_id, validated_msg.defunct_chain, disposition
        )

    elif action == "buy_stocks":
        # validated_msg is BuyStocksMessage
        await handle_buy_stocks(room_code, player_id, validated_msg.purchases)

    elif action == "end_turn":
        await handle_end_turn(room_code, player_id)

    elif action == "declare_end_game":
        await handle_declare_end_game(room_code, player_id)

    elif action == "propose_trade":
        # validated_msg is ProposeTradeMessage
        await handle_propose_trade(
            room_code,
            player_id,
            validated_msg.to_player_id,
            validated_msg.offering_stocks,
            validated_msg.offering_money,
            validated_msg.requesting_stocks,
            validated_msg.requesting_money,
        )

    elif action == "accept_trade":
        # validated_msg is AcceptTradeMessage
        await handle_accept_trade(room_code, player_id, validated_msg.trade_id)

    elif action == "reject_trade":
        # validated_msg is RejectTradeMessage
        await handle_reject_trade(room_code, player_id, validated_msg.trade_id)

    elif action == "cancel_trade":
        # validated_msg is CancelTradeMessage
        await handle_cancel_trade(room_code, player_id, validated_msg.trade_id)


async def initialize_game(room_code: str):
    """Initialize game state for a room using Game class."""
    room = session_manager.get_room(room_code)
    if room is None:
        return

    # Per-room config takes priority, env var as fallback
    seed = room.seed
    tile_order = room.tile_order
    if seed is None and tile_order is None:
        seed_str = os.environ.get("ACQUIRE_GAME_SEED")
        seed = int(seed_str) if seed_str else None
    game = Game(seed=seed, tile_order=tile_order)

    # Add all players to the game
    for player_id, connection in room.players.items():
        game.add_player(player_id, connection.name, is_bot=connection.is_bot)

    # Start the game (shuffles tiles, deals to players)
    game.start_game()

    # Store Game instance in room
    room.game = game

    # Process bot turns if the first player is a bot
    await process_bot_turns(room_code)


async def handle_place_tile(room_code: str, player_id: str, tile_str: str):
    """Handle tile placement action using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Check if it's this player's turn
    if game.get_current_player_id() != player_id:
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Not your turn"}
        )
        return

    # Check phase
    if game.phase != GamePhase.PLAYING:
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Not in playing phase"}
        )
        return

    # Parse tile
    try:
        tile = Tile.from_string(tile_str)
    except (ValueError, IndexError):
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Invalid tile"}
        )
        return

    player = game.get_player(player_id)
    if player is None:
        return

    # Check if all tiles in hand are unplayable (special rule)
    unplayable_result = game.handle_all_tiles_unplayable(player)
    if unplayable_result is not None:
        # Broadcast the all-unplayable event to all players
        await session_manager.broadcast_to_room(
            room_code,
            {
                "type": "all_tiles_unplayable",
                "player_id": player_id,
                "player_name": player.name,
                "revealed_hand": unplayable_result["revealed_hand"],
                "removed_tiles": unplayable_result["removed_tiles"],
                "new_tiles_count": len(unplayable_result["new_tiles"]),
            },
        )

        # Also notify the player of their new hand
        await session_manager.send_to_player(
            room_code,
            player_id,
            {
                "type": "tiles_replaced",
                "removed_tiles": unplayable_result["removed_tiles"],
                "new_hand": [str(t) for t in player.hand],
            },
        )

        # Broadcast updated state and return - player needs to try again with new tiles
        await broadcast_game_state(room_code)

        # Return error so client knows to retry with new hand
        await session_manager.send_to_player(
            room_code,
            player_id,
            {
                "type": "error",
                "message": "Your tiles were replaced. Please select a new tile to play.",
            },
        )
        return

    # Play the tile using Game class
    result = game.play_tile(player_id, tile)

    if not result.success:
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.error or "Unknown error"},
        )
        return

    # Handle different results
    if result.next_action == "found_chain":
        # Player needs to choose which chain to found
        await session_manager.send_to_player(
            room_code,
            player_id,
            {
                "type": "choose_chain",
                "available_chains": result.available_chains or [],
            },
        )

    elif result.next_action == "choose_merger_survivor":
        # Tie - player must choose survivor
        await session_manager.send_to_player(
            room_code,
            player_id,
            {
                "type": "choose_merger_survivor",
                "tied_chains": result.tied_chains or [],
            },
        )

    elif result.next_action == "stock_disposition":
        # Someone needs to handle stock disposition during merger
        await notify_or_handle_stock_disposition(room_code)

    await broadcast_game_state(room_code)


async def handle_found_chain(room_code: str, player_id: str, chain_name: str):
    """Handle chain founding using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Use Game.found_chain() method
    result = game.found_chain(player_id, chain_name)

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    await broadcast_game_state(room_code)


async def handle_merger_choice(room_code: str, player_id: str, surviving_chain: str):
    """Handle player choosing merger survivor in case of tie using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Use Game.choose_merger_survivor() method
    result = game.choose_merger_survivor(player_id, surviving_chain)

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    # Check if stock disposition is needed
    if result.get("next_action") == "stock_disposition":
        pending = game.pending_action
        if pending and pending.get("type") == "stock_disposition":
            await session_manager.send_to_player(
                room_code,
                pending.get("player_id"),
                {
                    "type": "stock_disposition_required",
                    "defunct_chain": pending.get("defunct_chain"),
                    "surviving_chain": pending.get("surviving_chain"),
                    "stock_count": pending.get("stock_count"),
                    "available_to_trade": pending.get("available_to_trade"),
                },
            )

    await broadcast_game_state(room_code)


async def handle_merger_disposition(
    room_code: str, player_id: str, defunct_chain: str, disposition: dict
):
    """Handle player's sell/trade/hold decision during merger using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Use Game.handle_stock_disposition() method
    # Note: "hold" in WebSocket message maps to "keep" in Game method
    result = game.handle_stock_disposition(
        player_id,
        sell=disposition.get("sell", 0),
        trade=disposition.get("trade", 0),
        keep=disposition.get("hold", 0),
    )

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    # Check if another player needs to handle stock disposition
    if result.get("next_action") == "stock_disposition":
        await notify_or_handle_stock_disposition(room_code)

    # Resume bot turn processing after disposition is handled.
    # When a bot triggered the merger and a human had to dispose their stock,
    # the bot is still the current player and needs to continue (buy stocks,
    # end turn). Without this call, the bot gets stuck at BUYING_STOCKS.
    try:
        await process_bot_turns(room_code)
    except Exception as e:
        print(f"Error resuming bot turns after disposition: {e}")

    await broadcast_game_state(room_code)


async def handle_buy_stocks(room_code: str, player_id: str, purchases: dict):
    """Handle stock purchase action using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Convert purchases dict to list of chain names
    # e.g., {"Luxor": 2, "Tower": 1} -> ["Luxor", "Luxor", "Tower"]
    purchase_list = []
    for chain_name, quantity in purchases.items():
        purchase_list.extend([chain_name] * quantity)

    # Use Game.buy_stocks() method
    result = game.buy_stocks(player_id, purchase_list)

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    # Move to end of turn (buy_stocks doesn't automatically advance)
    await handle_end_turn(room_code, player_id)


async def handle_end_turn(room_code: str, player_id: str):
    """Handle end of turn using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Use Game.end_turn() method
    result = game.end_turn(player_id)

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    # Check for game end condition
    if result.get("can_end_game"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "can_end_game", "message": "You may choose to end the game"},
        )

    # Process bot turns if the next player is a bot
    # (must run BEFORE broadcasting so the client sees the final state,
    #  not an intermediate PLAYING state that gets immediately corrected)
    await process_bot_turns(room_code)

    await broadcast_game_state(room_code)


async def handle_declare_end_game(room_code: str, player_id: str):
    """Handle a player declaring the game over.

    This is used when end-game conditions are met and the current player
    chooses to end the game (rather than continuing to play).
    """
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Use Game.declare_end_game() method
    result = game.declare_end_game(player_id)

    if not result.success:
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.error or "Unknown error"},
        )
        return

    # Build final scores from standings
    final_scores = {}
    for entry in result.standings:
        final_scores[entry.player_id] = {
            "name": entry.name,
            "money": entry.money,
        }

    winner_id = result.winner.player_id if result.winner else None

    # Broadcast final results
    await session_manager.broadcast_to_room(
        room_code,
        {
            "type": "game_over",
            "scores": final_scores,
            "winner": winner_id,
            "declared_by": player_id,
        },
    )

    await session_manager.send_to_host(
        room_code,
        {
            "type": "game_over",
            "scores": final_scores,
            "winner": winner_id,
            "declared_by": player_id,
        },
    )

    # Broadcast game state so frontend gets phase='game_over' update
    await broadcast_game_state(room_code)


# =============================================================================
# Player-to-Player Trading Handlers
# =============================================================================


async def handle_propose_trade(
    room_code: str,
    player_id: str,
    to_player_id: str,
    offering_stocks: dict,
    offering_money: int,
    requesting_stocks: dict,
    requesting_money: int,
):
    """Handle a player proposing a trade using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Create trade offer
    trade = TradeOffer(
        from_player_id=player_id,
        to_player_id=to_player_id,
        offering_stocks=offering_stocks,
        offering_money=offering_money,
        requesting_stocks=requesting_stocks,
        requesting_money=requesting_money,
    )

    # Use Game.propose_trade() method
    result = game.propose_trade(trade)

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    # Notify both players
    trade_notification = {
        "type": "trade_proposed",
        "trade": trade.to_dict(),
    }
    await session_manager.send_to_player(room_code, player_id, trade_notification)
    await session_manager.send_to_player(room_code, to_player_id, trade_notification)


async def handle_accept_trade(room_code: str, player_id: str, trade_id: str):
    """Handle a player accepting a trade using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Get trade info before accepting (for notifications)
    trade = game.pending_trades.get(trade_id)
    if trade is None:
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Trade not found"}
        )
        return

    from_player_id = trade.from_player_id
    to_player_id = trade.to_player_id

    # Use Game.accept_trade() method
    result = game.accept_trade(player_id, trade_id)

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    # Notify both players
    trade_notification = {
        "type": "trade_accepted",
        "trade_id": trade_id,
        "from_player": from_player_id,
        "to_player": to_player_id,
    }
    await session_manager.send_to_player(room_code, from_player_id, trade_notification)
    await session_manager.send_to_player(room_code, to_player_id, trade_notification)

    # Broadcast updated game state
    await broadcast_game_state(room_code)


async def handle_reject_trade(room_code: str, player_id: str, trade_id: str):
    """Handle a player rejecting a trade using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Get trade info before rejecting (for notifications)
    trade = game.pending_trades.get(trade_id)
    if trade is None:
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Trade not found"}
        )
        return

    from_player_id = trade.from_player_id
    to_player_id = trade.to_player_id

    # Use Game.reject_trade() method
    result = game.reject_trade(player_id, trade_id)

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    # Notify both players
    trade_notification = {
        "type": "trade_rejected",
        "trade_id": trade_id,
        "rejected_by": player_id,
    }
    await session_manager.send_to_player(room_code, from_player_id, trade_notification)
    await session_manager.send_to_player(room_code, to_player_id, trade_notification)


async def handle_cancel_trade(room_code: str, player_id: str, trade_id: str):
    """Handle a player canceling a trade using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Get trade info before canceling (for notifications)
    trade = game.pending_trades.get(trade_id)
    if trade is None:
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Trade not found"}
        )
        return

    from_player_id = trade.from_player_id
    to_player_id = trade.to_player_id

    # Use Game.cancel_trade() method
    result = game.cancel_trade(player_id, trade_id)

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    # Notify both players
    trade_notification = {
        "type": "trade_canceled",
        "trade_id": trade_id,
        "canceled_by": player_id,
    }
    await session_manager.send_to_player(room_code, from_player_id, trade_notification)
    await session_manager.send_to_player(room_code, to_player_id, trade_notification)


async def end_game(room_code: str):
    """End the game and calculate final scores using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Use Game.end_game() method
    result = game.end_game()

    if not result.get("success"):
        return

    # Build final scores from standings
    standings = result.get("standings", [])
    final_scores = {}
    for entry in standings:
        final_scores[entry["player_id"]] = {
            "name": entry["name"],
            "money": entry["money"],
        }

    winner = result.get("winner", {})
    winner_id = winner.get("player_id") if winner else None

    # Broadcast final results
    await session_manager.broadcast_to_room(
        room_code, {"type": "game_over", "scores": final_scores, "winner": winner_id}
    )

    await session_manager.send_to_host(
        room_code, {"type": "game_over", "scores": final_scores, "winner": winner_id}
    )


async def notify_or_handle_stock_disposition(room_code: str):
    """Handle stock disposition for the pending player (bot or human).

    If the player is a bot, automatically generates and submits their disposition.
    If the player is human, sends them the disposition_required message.
    Continues processing until we reach a human or no more dispositions needed.
    """
    import asyncio

    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Safety counter to prevent infinite loops
    max_iterations = 50
    iterations = 0

    while iterations < max_iterations:
        iterations += 1

        # Check if there's a pending stock disposition
        pending = game.pending_action
        if not pending or pending.get("type") != "stock_disposition":
            break

        disposition_player_id = pending.get("player_id")
        if not disposition_player_id:
            break

        defunct_chain = pending.get("defunct_chain")

        # Check if this player is a bot
        player_conn = room.players.get(disposition_player_id)
        if player_conn is None or not player_conn.is_bot:
            # Human player needs to dispose - send message and wait
            await session_manager.send_to_player(
                room_code,
                disposition_player_id,
                {
                    "type": "stock_disposition_required",
                    "defunct_chain": defunct_chain,
                    "surviving_chain": pending.get("surviving_chain"),
                    "stock_count": pending.get("stock_count"),
                    "available_to_trade": pending.get("available_to_trade"),
                },
            )
            break

        # Bot needs to dispose - generate decision and execute directly
        bot = game.bots.get(disposition_player_id)
        if bot is None:
            break

        surviving_chain = pending.get("surviving_chain")
        stock_count = pending.get("stock_count")

        # Get bot's disposition decision
        decision = bot.choose_stock_disposition(
            defunct_chain, surviving_chain, stock_count, game.board, game.hotel
        )

        # Execute the disposition using Game method directly
        result = game.handle_stock_disposition(
            disposition_player_id,
            sell=decision.get("sell", 0),
            trade=decision.get("trade", 0),
            keep=decision.get("keep", 0),
        )

        # Broadcast state after bot's disposition
        await broadcast_game_state(room_code)

        # Small delay to prevent overwhelming clients
        await asyncio.sleep(0.1)

        # If disposition failed, break
        if not result.get("success"):
            break

        # Loop continues to check if another player needs to dispose


async def process_bot_turns(room_code: str):
    """Process bot turns automatically using Game.execute_bot_turn().

    This function handles bot players by using the Game class's bot execution.
    """
    import asyncio

    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Safety counter to prevent infinite loops
    max_iterations = 100
    iterations = 0

    while iterations < max_iterations:
        iterations += 1

        # Check if game is over
        if game.phase == GamePhase.GAME_OVER:
            break

        current_player_id = game.get_current_player_id()
        if current_player_id is None:
            break

        player_conn = room.players.get(current_player_id)

        # Check if current player is a bot
        if player_conn is None or not player_conn.is_bot:
            # Human player's turn - handle unplayable tiles before waiting
            if game.phase == GamePhase.PLAYING:
                player = game.get_player(current_player_id)
                if player:
                    # Replace tiles if ALL are unplayable (Acquire rule)
                    unplayable_result = game.handle_all_tiles_unplayable(player)
                    if unplayable_result:
                        await session_manager.broadcast_to_room(
                            room_code,
                            {
                                "type": "all_tiles_unplayable",
                                "player_id": current_player_id,
                                "player_name": player.name,
                                "revealed_hand": unplayable_result["revealed_hand"],
                                "removed_tiles": unplayable_result["removed_tiles"],
                                "new_tiles_count": len(unplayable_result["new_tiles"]),
                            },
                        )
                        await broadcast_game_state(room_code)

                    # Skip to buy phase if still no playable tiles
                    playable = [
                        t
                        for t in player.hand
                        if Rules.can_place_tile(game.board, t, game.hotel)
                    ]
                    if not playable:
                        game.phase = GamePhase.BUYING_STOCKS
                        await broadcast_game_state(room_code)
            break

        # This is a bot's turn - use Game.execute_bot_turn()
        try:
            game.execute_bot_turn(current_player_id)
        except Exception as e:
            print(f"Error executing bot turn for {current_player_id}: {e}")
            break

        # Broadcast the state after bot's turn
        await broadcast_game_state(room_code)

        # Check if a merger during the bot's turn requires human stock disposition
        if game.phase == GamePhase.MERGING:
            pending = game.pending_action
            if pending and pending.get("type") == "stock_disposition":
                disposition_player_id = pending.get("player_id")
                player_conn_disp = room.players.get(disposition_player_id, None)
                if player_conn_disp and not player_conn_disp.is_bot:
                    # Human needs to handle disposition - notify them and stop
                    await notify_or_handle_stock_disposition(room_code)
                    break

        # Small delay to prevent overwhelming clients
        await asyncio.sleep(0.1)


async def broadcast_game_state(room_code: str):
    """Send updated state to all clients using Game.get_public_state()."""
    room = session_manager.get_room(room_code)
    if room is None:
        return

    game = room.game

    if game is None:
        return

    # Get public state from Game class
    game_state = game.get_public_state()

    # Build chain info in the format expected by WebSocket clients
    chains_info = []
    for chain_name, chain_data in game_state["chains"].items():
        chains_info.append(
            {
                "name": chain_name,
                "size": chain_data["size"],
                "price": chain_data["stock_price"],
                "stocks_available": chain_data["available_stocks"],
            }
        )

    hotel_state = {
        "chains": chains_info,
        "available_stocks": {
            name: data["available_stocks"]
            for name, data in game_state["chains"].items()
        },
        "active_chains": [
            name for name, data in game_state["chains"].items() if data["active"]
        ],
    }

    # Build turn order from players list
    turn_order = [p["player_id"] for p in game_state["players"]]

    public_state = {
        "type": "game_state",
        "board": game_state["board"],
        "hotel": hotel_state,
        "turn_order": turn_order,
        "current_player": game_state["current_player"],
        "phase": game_state["phase"],
        "players": {
            p["player_id"]: {
                "name": p["name"],
                "money": p["money"],
                "stocks": p["stocks"],
                "hand_size": p["tile_count"],
            }
            for p in game_state["players"]
        },
        "tiles_remaining": game_state["tiles_remaining"],
    }

    # Send to host
    await session_manager.send_to_host(room_code, public_state)

    # Send to each player with their private hand info
    for player_info in game_state["players"]:
        player_id = player_info["player_id"]
        player_state = game.get_player_state(player_id)
        ws_state = {
            **public_state,
            "your_hand": player_state.get("hand", []),
            "end_game_available": player_state.get("end_game_available", False),
        }
        await session_manager.send_to_player(room_code, player_id, ws_state)


async def broadcast_lobby_update(room_code: str):
    """Broadcast lobby state to all connected clients."""
    room = session_manager.get_room(room_code)
    if room is None:
        return

    players = [
        {"player_id": p.player_id, "name": p.name, "is_bot": p.is_bot}
        for p in room.players.values()
    ]

    message = {
        "type": "lobby_update",
        "players": players,
        "can_start": len(players) >= room.min_players,
    }

    await session_manager.send_to_host(room_code, message)
    await session_manager.broadcast_to_room(room_code, message)


async def send_host_state(room_code: str):
    """Send current state to host."""
    room = session_manager.get_room(room_code)
    if room is None:
        return

    if room.started and room.game:
        await broadcast_game_state(room_code)
    else:
        await broadcast_lobby_update(room_code)


async def send_player_state(room_code: str, player_id: str):
    """Send current state to a specific player."""
    room = session_manager.get_room(room_code)
    if room is None:
        return

    if room.started and room.game:
        await broadcast_game_state(room_code)

        # Re-send stock disposition notification if this player has a pending one
        game = room.game
        if game.phase == GamePhase.MERGING:
            pending = game.pending_action
            if (
                pending
                and pending.get("type") == "stock_disposition"
                and pending.get("player_id") == player_id
            ):
                await session_manager.send_to_player(
                    room_code,
                    player_id,
                    {
                        "type": "stock_disposition_required",
                        "defunct_chain": pending.get("defunct_chain"),
                        "surviving_chain": pending.get("surviving_chain"),
                        "stock_count": pending.get("stock_count"),
                        "available_to_trade": pending.get("available_to_trade"),
                    },
                )

        # Re-send can_end_game notification if applicable
        if game.can_declare_end_game():
            current = game.get_current_player()
            if current and current.player_id == player_id:
                await session_manager.send_to_player(
                    room_code,
                    player_id,
                    {
                        "type": "can_end_game",
                        "message": "You may choose to end the game",
                    },
                )
    else:
        await broadcast_lobby_update(room_code)
