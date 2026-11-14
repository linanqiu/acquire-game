"""Series runner: N games per matchup, seat rotation, budget guard, resume.

Game ``i`` of a matchup uses seed ``base_seed + i`` and rotation ``i % n``:
agent ``k`` of the matchup sits at position ``(k + rotation) % n``. The same
``i`` gives the same seed and rotation in every matchup, so matchups can be
compared on paired games. Each finished game is appended to a JSONL file; a
rerun skips game keys already in it.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from bench.prices import PriceTable
from bench.runner import SeatSpec, matchup_label, run_game, seat_label


class BenchError(RuntimeError):
    """A configuration problem the user must fix (reported without traceback)."""


def rotate(seats: list[SeatSpec], rotation: int) -> list[SeatSpec]:
    """Seating order where matchup agent ``k`` sits at ``(k + rotation) % n``."""
    n = len(seats)
    seating: list[SeatSpec] = [None] * n  # type: ignore[list-item]
    for k, spec in enumerate(seats):
        seating[(k + rotation) % n] = spec
    return seating


def game_key(matchup: str, seed: int, rotation: int) -> str:
    return f"{matchup}|seed={seed}|rot={rotation}"


def plan(
    seats: list[SeatSpec], games: int, base_seed: int
) -> list[tuple[int, int, str]]:
    """``[(seed, rotation, key)]`` for the first ``games`` games of a matchup."""
    label = matchup_label(seats)
    n = len(seats)
    return [
        (base_seed + i, i % n, game_key(label, base_seed + i, i % n))
        for i in range(games)
    ]


@dataclass
class Budget:
    max_decisions: int | None = None
    max_usd: float | None = None
    count_all: bool = False  # count bot decisions too (series without paid seats)
    decisions: int = 0
    usd: float = 0.0
    reason: str | None = None

    def add(self, event: dict) -> None:
        if self.count_all or event["kind"] != "bot":
            self.decisions += 1
        if event.get("usd"):
            self.usd += event["usd"]
        if self.reason is None:
            if self.max_decisions is not None and self.decisions >= self.max_decisions:
                self.reason = f"--max-decisions {self.max_decisions} reached"
            elif self.max_usd is not None and self.usd >= self.max_usd:
                self.reason = f"--max-usd {self.max_usd} reached"

    @property
    def exhausted(self) -> bool:
        return self.reason is not None


@dataclass
class SeriesResult:
    records: dict[str, list[dict]]  # matchup label -> records in plan order
    planned: int = 0
    skipped: int = 0  # already in the results file
    ran: int = 0
    aborted: int = 0
    failed: int = 0  # stalled games (recorded, never retried silently)
    stopped_reason: str | None = None
    budget: Budget = field(default_factory=Budget)

    @property
    def complete(self) -> bool:
        return self.stopped_reason is None


def _append(path: Path, rec: dict) -> None:
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec) + "\n")


def load_results(path: Path) -> dict[str, dict]:
    done: dict[str, dict] = {}
    if not path.exists():
        return done
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue  # a torn last line from a killed run
        if rec.get("key"):
            done[rec["key"]] = rec
    return done


async def run_series(
    matchups: list[list[SeatSpec]],
    games: int,
    *,
    seed: int = 1,
    results_path: str | Path,
    max_concurrency: int = 4,
    max_usd: float | None = None,
    max_decisions: int | None = None,
    prices: PriceTable | None = None,
    fresh: bool = False,
    progress: Callable[[str], None] | None = None,
) -> SeriesResult:
    prices = prices or PriceTable.load()
    path = Path(results_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if fresh and path.exists():
        path.unlink()
    done = load_results(path)

    if max_usd is not None:
        for seats in matchups:
            for spec in seats:
                model = _model_for(spec)
                if model is not None and not prices.known(model):
                    raise BenchError(
                        f"--max-usd needs known prices but model {model!r} "
                        f"({seat_label(spec)}) has none in the price table; fill "
                        "bench/prices.json or use --max-decisions"
                    )

    paid = any(
        (not isinstance(s, str) or s != "bot") for seats in matchups for s in seats
    )
    budget = Budget(max_decisions, max_usd, count_all=not paid)
    result = SeriesResult(records={}, budget=budget)
    sem = asyncio.Semaphore(max(1, max_concurrency))
    pending: list[asyncio.Task] = []

    async def play(seats, seed_, rot, key):
        async with sem:
            if budget.exhausted:
                return
            rec = await run_game(
                rotate(seats, rot),
                seed_,
                prices=prices,
                stop=lambda: budget.exhausted,
                observer=budget.add,
            )
        rec.key = key
        rec.matchup = matchup_label(seats)
        if rec.status == "aborted":
            result.aborted += 1
            return
        d = rec.to_dict()
        d["rotation"] = rot
        _append(path, d)
        done[key] = d
        result.ran += 1
        if rec.status != "completed":
            result.failed += 1
        if progress:
            progress(f"[{result.ran}] {key}: {rec.status}, {rec.turns} turns")

    for seats in matchups:
        for seed_, rot, key in plan(seats, games, seed):
            result.planned += 1
            if key in done:
                result.skipped += 1
                continue
            pending.append(asyncio.create_task(play(seats, seed_, rot, key)))
    if pending:
        await asyncio.gather(*pending)

    if budget.exhausted:
        result.stopped_reason = budget.reason
    for seats in matchups:
        label = matchup_label(seats)
        result.records[label] = [
            done[key] for _, _, key in plan(seats, games, seed) if key in done
        ]
    return result


def _model_for(spec: SeatSpec) -> str | None:
    """Model behind a seat spec, for price pre-checks (None = not a paid model)."""
    from agents import registry

    if isinstance(spec, str):
        if spec in ("bot", "scripted"):
            return None
        try:
            agent = registry.create(spec, name="preflight")
        except Exception:  # noqa: BLE001 - reported by the CLI's own preflight
            return None
        provider = getattr(agent, "provider", None)
        return getattr(provider, "model", None)
    return None
