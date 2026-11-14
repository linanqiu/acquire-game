"""Room lifecycle: starting and force-ending games, and the human action entry."""

from __future__ import annotations

import os

from app_state import session_manager
from game.game import Game
from seats import human_action, run_locked


async def initialize_game(room_code: str) -> None:
    """Create and start the Game for a room, broadcast it, start the driver.

    Seed: per-room config first, ``ACQUIRE_GAME_SEED`` as fallback.
    """
    room = session_manager.get_room(room_code)
    if room is None:
        return

    def build(room):
        seed = room.seed
        tile_order = room.tile_order
        if seed is None and tile_order is None:
            seed_str = os.environ.get("ACQUIRE_GAME_SEED")
            seed = int(seed_str) if seed_str else None
        game = Game(seed=seed, tile_order=tile_order)
        for player_id, seat in room.players.items():
            game.add_player(player_id, seat.name, is_bot=seat.is_agent or seat.is_bot)
        game.start_game()
        room.game = game

    await run_locked(room_code, build)
    # Events from start_game (e.g. an opening hand replaced) are announced
    # with the first state; run_locked publishes only for an existing game.
    room = session_manager.get_room(room_code)
    if room is not None and room.game is not None:
        from broadcast import publish_events

        await publish_events(room_code, room.game, 0)


async def end_game(room_code: str) -> None:
    """Host-forced end of game (host WebSocket ``end_game``)."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return
    await run_locked(room_code, lambda room: room.game.end_game())


async def handle_player_action(room_code: str, player_id: str, data: dict) -> None:
    """Process one client action message (WebSocket path)."""
    await human_action(room_code, player_id, data)
