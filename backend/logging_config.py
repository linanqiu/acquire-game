"""Structured logging configuration for the Acquire application."""

import logging
import sys
from contextvars import ContextVar
from datetime import datetime, timezone

# ContextVar for request ID tracking across async contexts
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


class JSONFormatter(logging.Formatter):
    """Structured JSON log formatter for production environments."""

    def format(self, record: logging.LogRecord) -> str:
        import json

        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_var.get("-"),
        }

        if record.exc_info and record.exc_info[0] is not None:
            log_entry["exception"] = self.formatException(record.exc_info)

        # Include any extra fields attached to the record
        for key in ("game_id", "player_id", "action", "event", "duration_ms"):
            value = getattr(record, key, None)
            if value is not None:
                log_entry[key] = value

        return json.dumps(log_entry)


class DevFormatter(logging.Formatter):
    """Human-readable log formatter for development environments."""

    LEVEL_COLORS = {
        "DEBUG": "\033[36m",  # Cyan
        "INFO": "\033[32m",  # Green
        "WARNING": "\033[33m",  # Yellow
        "ERROR": "\033[31m",  # Red
        "CRITICAL": "\033[35m",  # Magenta
    }
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.LEVEL_COLORS.get(record.levelname, self.RESET)
        timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        req_id = request_id_var.get("-")
        req_id_str = f" [{req_id[:8]}]" if req_id != "-" else ""

        prefix = (
            f"{color}{timestamp} {record.levelname:<8}{self.RESET}"
            f"{req_id_str} {record.name}: "
        )
        message = record.getMessage()

        if record.exc_info and record.exc_info[0] is not None:
            message += "\n" + self.formatException(record.exc_info)

        return prefix + message


def setup_logging() -> None:
    """Configure application logging based on environment settings."""
    try:
        from config import get_settings

        _settings = get_settings()
        _environment = _settings.environment
        _log_level = _settings.log_level
    except ImportError:
        import os

        _environment = os.environ.get("ENVIRONMENT", "dev")
        _log_level = os.environ.get("LOG_LEVEL", "INFO")

    # Select formatter based on environment
    if _environment == "prod":
        formatter = JSONFormatter()
    else:
        formatter = DevFormatter()

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, _log_level.upper(), logging.INFO))

    # Remove existing handlers to avoid duplicates on re-init
    root_logger.handlers.clear()

    # Add stream handler with chosen formatter
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    root_logger.addHandler(handler)

    # Reduce noise from third-party loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("websockets").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.error").setLevel(logging.INFO)


def get_logger(name: str) -> logging.Logger:
    """Get a named logger instance."""
    return logging.getLogger(name)
