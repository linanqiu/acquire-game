"""Game-specific logging convenience functions."""

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
    """Log a game event with structured context."""
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
    """Log a new game creation."""
    log_game_event(game_id, "game_created", player_id=host_id)


def log_player_joined(game_id: str, player_id: str, player_name: str) -> None:
    """Log a player joining a game."""
    log_game_event(
        game_id, "player_joined", player_id=player_id, player_name=player_name
    )


def log_action(
    game_id: str, player_id: str, action_type: str, action_data: dict | None = None
) -> None:
    """Log a player action within a game."""
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
    """Log a game ending."""
    log_game_event(
        game_id,
        "game_ended",
        player_id=winner_id,
        final_scores=final_scores or {},
    )
