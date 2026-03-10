"""Game-specific logging convenience functions.

Provides structured logging helpers for game events. These functions
attach game-relevant context (game_id, player_id, action) as extra
fields so they appear in structured JSON logs.
"""

from typing import Any

from logging_config import get_logger

logger = get_logger("game")


def log_game_event(
    game_id: str,
    event: str,
    player_id: str | None = None,
    action: str | None = None,
    **extra: Any,
) -> None:
    """Log a generic game event with structured context.

    Args:
        game_id: The game/room identifier.
        event: Description of the event.
        player_id: Optional player involved in the event.
        action: Optional action type associated with the event.
        **extra: Additional key-value pairs to include in the log.
    """
    extra_fields = {"game_id": game_id, "event": event}
    if player_id is not None:
        extra_fields["player_id"] = player_id
    if action is not None:
        extra_fields["action"] = action
    extra_fields.update(extra)

    logger.info(
        "Game event: %s [game=%s, player=%s]",
        event,
        game_id,
        player_id or "-",
        extra=extra_fields,
    )


def log_game_created(game_id: str, host_id: str) -> None:
    """Log a new game creation.

    Args:
        game_id: The game/room identifier.
        host_id: The player ID of the game host.
    """
    log_game_event(game_id, "game_created", player_id=host_id)


def log_player_joined(game_id: str, player_id: str, player_name: str) -> None:
    """Log a player joining a game.

    Args:
        game_id: The game/room identifier.
        player_id: The joining player's ID.
        player_name: The joining player's display name.
    """
    log_game_event(
        game_id, "player_joined", player_id=player_id, player_name=player_name
    )


def log_action(
    game_id: str, player_id: str, action_type: str, action_data: dict | None = None
) -> None:
    """Log a player action within a game.

    Args:
        game_id: The game/room identifier.
        player_id: The player performing the action.
        action_type: The type of action (e.g., 'place_tile', 'buy_stocks').
        action_data: Optional dict of action-specific data.
    """
    log_game_event(
        game_id,
        "player_action",
        player_id=player_id,
        action=action_type,
        action_data=action_data or {},
    )


def log_game_ended(
    game_id: str, winner_id: str | None, final_scores: dict | None = None
) -> None:
    """Log a game ending.

    Args:
        game_id: The game/room identifier.
        winner_id: The player ID of the winner, or None for a tie.
        final_scores: Optional dict mapping player IDs to final scores.
    """
    log_game_event(
        game_id,
        "game_ended",
        player_id=winner_id,
        final_scores=final_scores or {},
    )
