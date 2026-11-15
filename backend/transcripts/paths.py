"""Where transcripts and benchmark results live, and game id helpers.

Read from the environment at call time (tests and deployments can change it):

``GAME_TRANSCRIPT_DIR``  transcripts of live games. Default
                            ``backend/data/transcripts/``. Empty or ``off``
                            disables transcripts (nothing is written).
``GAME_BENCH_DIR``       benchmark results directory served at ``/bench/*``
                            and ``/games?source=bench``. Default
                            ``backend/bench_results/``. Either one results
                            directory (``results.jsonl`` + ``transcripts/``) or
                            a parent of several.
"""

from __future__ import annotations

import os
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_TRANSCRIPT_DIR = BACKEND_DIR / "data" / "transcripts"
DEFAULT_BENCH_DIR = BACKEND_DIR / "bench_results"

_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$")


def _resolve(value: str) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else (BACKEND_DIR / path)


def transcript_dir() -> Path | None:
    """Directory for live-game transcripts, or None when disabled."""
    raw = os.environ.get("GAME_TRANSCRIPT_DIR")
    if raw is None:
        return DEFAULT_TRANSCRIPT_DIR
    raw = raw.strip()
    if not raw or raw.lower() == "off":
        return None
    return _resolve(raw)


def bench_dir() -> Path:
    raw = (os.environ.get("GAME_BENCH_DIR") or "").strip()
    return _resolve(raw) if raw else DEFAULT_BENCH_DIR


def new_game_id() -> str:
    """URL-safe, unique, roughly time-sortable: ``20261114-153012-a1b2c3d4``."""
    now = datetime.now(timezone.utc)
    return f"{now:%Y%m%d-%H%M%S}-{secrets.token_hex(4)}"


def valid_game_id(value: str) -> bool:
    """True for ids that are safe as a single file name (no traversal)."""
    return isinstance(value, str) and bool(_ID_RE.match(value))


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
