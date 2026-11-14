"""HTTP route: the server's configured game ruleset (served bare and under /api).

``GET /config/game`` lets the lobby / home page show the configured variant
(title, theme words, chains, colours, board size, numbers) before any game
exists. The body is ``Ruleset.public_dict()``: the ruleset file's contents
plus ``fingerprint`` -- the same object every ``game_state`` carries as
``ruleset``.
"""

from __future__ import annotations

from fastapi import APIRouter

from config import get_ruleset

router = APIRouter()


@router.get("/config/game")
async def game_config() -> dict:
    """The configured ruleset (env ``GAME_RULESET``, default ``classic``)."""
    return get_ruleset().public_dict()
