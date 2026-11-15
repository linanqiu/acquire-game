"""Buyout Bench: headless benchmark harness for Buyout seats.

See docs/ai/benchmarking.md. Importing ``bench`` starts nothing and does not
import the web server.

CLI (from ``backend/``)::

    python -m bench run --protocol bench-v1 --models llm:claude-haiku-5-5 \\
        --track vs-baseline --out bench_results/haiku --json
    python -m bench leaderboard --out bench_results/haiku

Python::

    import asyncio
    from bench import run_protocol, load_results, compute_leaderboard

    res = asyncio.run(run_protocol([("mine", MyAgent)], out="out", track="vs-baseline"))
    board = compute_leaderboard(load_results("out"))
"""

from bench.leaderboard import compute_leaderboard
from bench.prices import PriceTable
from bench.protocols import (
    PROTOCOLS,
    TRACKS,
    Protocol,
    ProtocolResult,
    get_protocol,
    run_protocol,
    schedule,
)
from bench.rating import bootstrap, bradley_terry
from bench.results import load_results, write_outputs
from bench.runner import GameRecord, SeatSpec, run_game
from bench.series import BenchError, GameSpec, SeriesResult, run_games, run_series

__all__ = [
    "PROTOCOLS",
    "TRACKS",
    "BenchError",
    "GameRecord",
    "GameSpec",
    "PriceTable",
    "Protocol",
    "ProtocolResult",
    "SeatSpec",
    "SeriesResult",
    "bootstrap",
    "bradley_terry",
    "compute_leaderboard",
    "get_protocol",
    "load_results",
    "run_game",
    "run_games",
    "run_protocol",
    "run_series",
    "schedule",
    "write_outputs",
]
