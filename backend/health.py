"""Health check endpoints for Acquire board game service."""

import time
from datetime import datetime, timezone

import psutil
from fastapi import APIRouter, Response
from pydantic import BaseModel

router = APIRouter(tags=["health"])

START_TIME = time.time()


class HealthResponse(BaseModel):
    status: str
    timestamp: str


class DetailedHealthResponse(BaseModel):
    status: str
    timestamp: str
    uptime_seconds: float
    version: str
    active_games: int
    active_connections: int
    memory_mb: float
    cpu_percent: float


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Basic health check for load balancers and Railway."""
    return HealthResponse(
        status="ok",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.get("/health/detailed", response_model=DetailedHealthResponse)
async def detailed_health_check():
    """Detailed health check with system metrics."""
    from main import session_manager

    process = psutil.Process()

    # Count active games (rooms)
    active_games = len(session_manager._rooms)

    # Count active WebSocket connections across all rooms
    active_connections = 0
    for room in session_manager._rooms.values():
        for player in room.players.values():
            active_connections += len(player.websockets)
        # Count host websocket if connected
        if room.host_websocket is not None:
            active_connections += 1

    return DetailedHealthResponse(
        status="ok",
        timestamp=datetime.now(timezone.utc).isoformat(),
        uptime_seconds=time.time() - START_TIME,
        version="1.0.0",
        active_games=active_games,
        active_connections=active_connections,
        memory_mb=round(process.memory_info().rss / 1024 / 1024, 2),
        cpu_percent=process.cpu_percent(),
    )


@router.get("/health/ready")
async def readiness_check(response: Response):
    """Readiness check - is the service ready to accept traffic?

    Returns 503 if not ready (e.g., during startup or maintenance).
    """
    is_ready = True

    if not is_ready:
        response.status_code = 503
        return {"status": "not_ready", "reason": "Service initializing"}

    return {"status": "ready"}


@router.get("/health/live")
async def liveness_check():
    """Liveness check - is the service alive?

    If this fails, the service should be restarted.
    """
    return {"status": "alive"}
