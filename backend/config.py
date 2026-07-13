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
    allowed_origins: str = "*"
    max_players_per_game: int = 6
    game_timeout_minutes: int = 60
    ws_ping_interval: int = 30
    ws_ping_timeout: int = 10
    # Rate limiting (SH-002). Disable only for load testing.
    rate_limit_enabled: bool = True

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
