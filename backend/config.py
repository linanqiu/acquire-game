"""Application settings from environment variables."""

from functools import lru_cache

from pydantic_settings import BaseSettings

# Origins allowed by default during local development (SH-003)
DEV_CORS_ORIGINS = [
    "http://localhost:5173",  # Vite dev server
    "http://localhost:3000",  # Alternative dev port
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
]


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
    # Room cleanup (SH-005): rooms inactive this long are deleted by a
    # background task that runs every room_cleanup_interval_seconds.
    room_timeout_minutes: int = 30
    room_cleanup_interval_seconds: int = 60

    @property
    def cors_origins(self) -> list[str]:
        """Resolve the allowed CORS origins for the current environment (SH-003).

        - An explicit ALLOWED_ORIGINS value (comma-separated) is used as-is.
        - The default "*" resolves to localhost dev origins in development.
        - In production, "*" resolves to an empty list: cross-origin access is
          denied unless origins are configured explicitly. Same-origin traffic
          (e.g. the SPA served by this backend) does not need CORS.
        """
        if self.allowed_origins == "*":
            if self.is_production:
                return []
            return list(DEV_CORS_ORIGINS)
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.environment.lower() in ("prod", "production")

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    """Get cached application settings."""
    return Settings()
