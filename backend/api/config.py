"""HTTP route: the server's configured game ruleset (served bare and under /api).

``GET /config/game`` lets the lobby / home page show the configured variant
(title, theme words, chains, colours, board size, numbers) before any game
exists. The body is ``Ruleset.public_dict()``: the ruleset file's contents
plus ``fingerprint`` -- the same object every ``game_state`` carries as
``ruleset`` -- plus ``brand``, the product name (env ``GAME_BRAND_NAME``,
default "Buyout"). The brand is not part of the ruleset or its fingerprint:
a ruleset's ``title`` is its theme's name, the brand is the product's.
"""

from __future__ import annotations

from fastapi import APIRouter

from config import get_ruleset, get_settings

router = APIRouter()


@router.get("/config/game")
async def game_config() -> dict:
    """The configured ruleset (env ``GAME_RULESET``, default ``default``) and brand."""
    return {**get_ruleset().public_dict(), "brand": get_settings().game_brand_name}
