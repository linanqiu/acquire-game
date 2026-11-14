"""Application settings from environment variables."""

from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables.

    All settings have sensible defaults for local development.
    In production, set environment variables or use a .env file.
    """

    port: int = 8000
    environment: str = "dev"
    log_level: str = "INFO"
    # Browsers only need CORS for cross-origin use (Vite dev on another port).
    # A single-service deploy is same-origin, so this can stay at the default
    # or be narrowed to your public URL.
    allowed_origins: str = "*"
    # Built React app (env FRONTEND_DIST); relative paths resolve against
    # backend/. Served only if the directory contains index.html.
    frontend_dist: str = "../frontend/dist"
    max_players_per_game: int = 6
    game_timeout_minutes: int = 60
    ws_ping_interval: int = 30
    ws_ping_timeout: int = 10

    # Seat driver (seats.py). Per-decision timeouts by seat kind, in seconds.
    # An LLM decision may need two provider calls (answer + repair) of up to
    # 60 s each, hence the long default.
    bot_decision_timeout: float = 10.0
    scripted_decision_timeout: float = 10.0
    llm_decision_timeout: float = 130.0
    # Pause after each agent action so humans can follow (env AGENT_ACTION_DELAY).
    agent_action_delay: float = 0.4
    # Same pause in test mode (ACQUIRE_TEST_MODE=1). Small but non-zero so
    # browser tests can still observe an all-bot game in progress; in-process
    # protocol tests set it to 0.
    test_mode_agent_action_delay: float = 0.05
    # Runaway guards, per seat per turn.
    max_agent_actions_per_turn: int = 40
    max_trade_proposals_per_turn: int = 2

    @property
    def cors_origins(self) -> list[str]:
        """Parse comma-separated origins into a list."""
        if self.allowed_origins == "*":
            return ["*"]
        return [o.strip() for o in self.allowed_origins.split(",")]

    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.environment == "prod"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    """Get cached application settings."""
    return Settings()
