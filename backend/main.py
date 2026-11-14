"""FastAPI application for Acquire board game (uvicorn entry point: ``main:app``).

Layout:
    protocol.py        client message validation (pydantic)
    broadcast.py       server -> client messages (state, lobby, notifications)
    seats.py           per-room lock + seat driver; the one action path
    lifecycle.py       game start / forced end / human action entry
    agents/            heuristic, scripted and LLM seats + catalog registry
    api/rooms.py       HTTP routes
    api/ws.py          WebSocket routes
    api/testmode.py    /test/* routes (only with ACQUIRE_TEST_MODE=1)

See docs/architecture/seat-contract.md.
"""

import os

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from api.rooms import router as rooms_router
from api.ws import router as ws_router
from app_state import session_manager
from broadcast import (
    broadcast_game_state,
    broadcast_lobby_update,
    send_host_state,
    send_player_state,
)
from config import get_settings
from health import router as health_router
from lifecycle import end_game, handle_player_action, initialize_game
from logging_config import setup_logging
from middleware import RequestLoggingMiddleware
from protocol import (
    VALID_CHAINS,
    AcceptTradeMessage,
    BuyStocksMessage,
    CancelTradeMessage,
    DeclareEndGameMessage,
    EndTurnMessage,
    FoundChainMessage,
    MergerChoiceMessage,
    MergerDispositionMessage,
    PlaceTileMessage,
    ProposeTradeMessage,
    RejectTradeMessage,
    WebSocketMessage,
    validate_websocket_message,
)

# Configure logging before the app is built (module loggers are lazy, so
# importing the API modules first is fine).
setup_logging()

settings = get_settings()


def test_mode_enabled() -> bool:
    """Test-only routes exist only when ACQUIRE_TEST_MODE=1 (never in deploys)."""
    return os.environ.get("ACQUIRE_TEST_MODE") == "1"


def create_app() -> FastAPI:
    """Build the application. Test-mode routes are decided at build time."""
    application = FastAPI(title="Acquire Board Game", debug=not settings.is_production)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.add_middleware(RequestLoggingMiddleware)
    application.include_router(health_router)
    application.include_router(rooms_router)
    application.include_router(ws_router)
    if test_mode_enabled():
        from api.testmode import router as test_router

        application.include_router(test_router)
    return application


app = create_app()

__all__ = [
    "VALID_CHAINS",
    "AcceptTradeMessage",
    "BuyStocksMessage",
    "CancelTradeMessage",
    "DeclareEndGameMessage",
    "EndTurnMessage",
    "FoundChainMessage",
    "MergerChoiceMessage",
    "MergerDispositionMessage",
    "PlaceTileMessage",
    "ProposeTradeMessage",
    "RejectTradeMessage",
    "WebSocketMessage",
    "app",
    "broadcast_game_state",
    "broadcast_lobby_update",
    "create_app",
    "end_game",
    "handle_player_action",
    "initialize_game",
    "send_host_state",
    "send_player_state",
    "session_manager",
    "validate_websocket_message",
]
