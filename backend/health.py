"""Health check endpoints for Railway deployment and monitoring."""

import time
from datetime import datetime, timezone

import psutil
from fastapi import APIRouter

router = APIRouter(tags=["health"])

START_TIME = time.time()


@router.get("/health")
async def health_check():
    """Basic health check for Railway and load balancers."""
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@router.get("/health/detailed")
async def detailed_health_check():
    """Detailed health check with system metrics."""
    from main import session_manager

    process = psutil.Process()

    # Count active WebSocket connections across all rooms
    active_connections = 0
    for room in session_manager._rooms.values():
        if room.host_websocket is not None:
            active_connections += 1
        for player in room.players.values():
            active_connections += len(player.websockets)

    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "uptime_seconds": round(time.time() - START_TIME, 1),
        "version": "1.0.0",
        "active_games": len(session_manager._rooms),
        "active_connections": active_connections,
        "memory_mb": round(process.memory_info().rss / 1024 / 1024, 1),
        "cpu_percent": process.cpu_percent(),
    }


@router.get("/health/ready")
async def readiness_check():
    """Readiness check - is the service ready to accept traffic?"""
    return {"status": "ready"}


@router.get("/health/live")
async def liveness_check():
    """Liveness check - is the service alive?"""
    return {"status": "alive"}
