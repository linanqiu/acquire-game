"""Headless benchmark harness for Acquire seats (see docs/ai/benchmarking.md).

Run from ``backend/``: ``python -m bench --matchup llm:fake,bot,bot,bot --games 8``.
"""

from bench.runner import GameRecord, run_game
from bench.series import run_series

__all__ = ["GameRecord", "run_game", "run_series"]
