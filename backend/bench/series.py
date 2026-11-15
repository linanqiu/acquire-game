"""Series runner: many games, seat rotation, budget guard, resume, transcripts.

``run_games`` is the engine: it plays a list of ``GameSpec`` (seating, seed,
key) with bounded concurrency, appends each finished game to a JSONL results
file (a rerun skips keys already there), writes one transcript per game under
``<results dir>/transcripts/`` and stops cleanly when a budget trips.

``run_series`` (ad-hoc matchups, ``python -m bench --matchup ...``): game
``i`` of a matchup uses seed ``base_seed + i`` and rotation ``i % n``: agent
``k`` of the matchup sits at position ``(k + rotation) % n``. The same ``i``
gives the same seed and rotation in every matchup, so matchups can be
compared on paired games. ``bench.protocols.run_protocol`` builds its own
schedule on top of ``run_games``.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from bench.prices import PriceTable
from bench.runner import (
    SeatSpec,
    matchup_label,
    resolve_ruleset,
    run_game,
    seat_label,
)
from game.ruleset import Ruleset


class BenchError(RuntimeError):
    """A configuration problem the user must fix (reported without traceback)."""


def rotate(seats: list[SeatSpec], rotation: int) -> list[SeatSpec]:
    """Seating order where matchup agent ``k`` sits at ``(k + rotation) % n``."""
    n = len(seats)
    seating: list[SeatSpec] = [None] * n  # type: ignore[list-item]
    for k, spec in enumerate(seats):
        seating[(k + rotation) % n] = spec
    return seating


def game_key(
    matchup: str, seed: int, rotation: int, ruleset: Ruleset | None = None
) -> str:
    """Unique key of a planned game; with ``ruleset`` it names the variant, so
    one results file can hold the same matchup under several rulesets."""
    key = f"{matchup}|seed={seed}|rot={rotation}"
    if ruleset is not None:
        key += f"|rs={ruleset.id}:{ruleset.fingerprint}"
    return key


def plan(
    seats: list[SeatSpec],
    games: int,
    base_seed: int,
    ruleset: Ruleset | None = None,
) -> list[tuple[int, int, str]]:
    """``[(seed, rotation, key)]`` for the first ``games`` games of a matchup."""
    label = matchup_label(seats)
    n = len(seats)
    return [
        (base_seed + i, i % n, game_key(label, base_seed + i, i % n, ruleset))
        for i in range(games)
    ]


def adhoc_series_id(matchup: str, ruleset: Ruleset | None = None) -> str:
    basis = matchup if ruleset is None else f"{matchup}|rs={ruleset.fingerprint}"
    return "matchup-" + hashlib.sha256(basis.encode()).hexdigest()[:10]


@dataclass
class GameSpec:
    """One planned game. ``seating`` is in turn order; ``meta`` is copied into
    the results record and the transcript header's ``bench`` object."""

    key: str
    seating: list[SeatSpec]
    seed: int
    rotation: int
    matchup: str  # label of the lineup (not of the seating)
    series_id: str
    meta: dict = field(default_factory=dict)
    ruleset: Ruleset | None = None  # None: the server's default (see run_game)


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
    records: dict[str, list[dict]]  # matchup / series label -> records in plan order
    planned: int = 0
    skipped: int = 0  # already in the results file
    ran: int = 0
    aborted: int = 0
    failed: int = 0  # stalled games (recorded, never retried silently)
    stopped_reason: str | None = None
    budget: Budget = field(default_factory=Budget)
    results_path: Path | None = None

    @property
    def complete(self) -> bool:
        return self.stopped_reason is None

    @property
    def status(self) -> str:
        """complete | stopped (budget) | stalled (some game stalled)."""
        if self.stopped_reason is not None:
            return "stopped"
        if self.failed:
            return "stalled"
        return "complete"


def _append(path: Path, rec: dict) -> None:
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec) + "\n")


def load_results(path: Path) -> dict[str, dict]:
    """``{key: record}`` from a results JSONL file (torn lines skipped)."""
    done: dict[str, dict] = {}
    if not Path(path).exists():
        return done
    for line in Path(path).read_text(encoding="utf-8").splitlines():
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


def check_prices(specs: list[SeatSpec], prices: PriceTable) -> None:
    for spec in specs:
        model = _model_for(spec)
        if model is not None and not prices.known(model):
            raise BenchError(
                f"--max-usd needs known prices but model {model!r} "
                f"({seat_label(spec)}) has none in the price table; fill "
                "bench/prices.json or use --max-decisions"
            )


async def run_games(
    specs: list[GameSpec],
    *,
    results_path: str | Path,
    max_concurrency: int = 4,
    max_usd: float | None = None,
    max_decisions: int | None = None,
    prices: PriceTable | None = None,
    fresh: bool = False,
    progress: Callable[[str], None] | None = None,
    transcripts: bool = True,
    transcript_dir: str | Path | None = None,
    prompt_version: str | None = None,
) -> tuple[SeriesResult, dict[str, dict]]:
    """Play ``specs`` (skipping keys already in ``results_path``).

    Returns the result counters and ``{key: record}`` of every game in the
    results file. Transcripts go to ``transcript_dir`` (default
    ``<results dir>/transcripts``); each record carries ``game_id`` and
    ``transcript`` (path relative to the results directory when inside it).
    """
    prices = prices or PriceTable.load()
    path = Path(results_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if fresh and path.exists():
        path.unlink()
    done = load_results(path)
    tdir = None
    if transcripts:
        tdir = Path(transcript_dir) if transcript_dir else path.parent / "transcripts"

    if max_usd is not None:
        check_prices([s for spec in specs for s in spec.seating], prices)

    paid = any(
        (not isinstance(s, str) or s != "bot") for spec in specs for s in spec.seating
    )
    budget = Budget(max_decisions, max_usd, count_all=not paid)
    result = SeriesResult(records={}, budget=budget, results_path=path)
    sem = asyncio.Semaphore(max(1, max_concurrency))
    pending: list[asyncio.Task] = []

    async def play(spec: GameSpec):
        async with sem:
            if budget.exhausted:
                return
            rec = await run_game(
                spec.seating,
                spec.seed,
                prices=prices,
                stop=lambda: budget.exhausted,
                observer=budget.add,
                transcript_dir=tdir,
                bench_meta={
                    "series_id": spec.series_id,
                    "matchup": spec.matchup,
                    "rotation": spec.rotation,
                    **spec.meta,
                },
                prompt_version=prompt_version,
                ruleset=spec.ruleset,
            )
        rec.key = spec.key
        rec.matchup = spec.matchup
        if rec.status == "aborted":
            result.aborted += 1
            return
        d = rec.to_dict()
        d["rotation"] = spec.rotation
        d["series_id"] = spec.series_id
        d.update(spec.meta)
        if d.get("transcript"):
            t = Path(d["transcript"])
            try:
                d["transcript"] = str(t.resolve().relative_to(path.parent.resolve()))
            except ValueError:
                d["transcript"] = str(t)
        _append(path, d)
        done[spec.key] = d
        result.ran += 1
        if rec.status != "completed":
            result.failed += 1
        if progress:
            progress(f"[{result.ran}] {spec.key}: {rec.status}, {rec.turns} turns")

    for spec in specs:
        result.planned += 1
        if spec.key in done:
            result.skipped += 1
            continue
        pending.append(asyncio.create_task(play(spec)))
    if pending:
        await asyncio.gather(*pending)

    if budget.exhausted:
        result.stopped_reason = budget.reason
    return result, done


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
    transcripts: bool = True,
    transcript_dir: str | Path | None = None,
    ruleset: Ruleset | str | Path | None = None,
) -> SeriesResult:
    """``games`` games per matchup (ad hoc; see ``run_protocol`` for the
    benchmark protocol). ``result.records`` maps each matchup label to its
    records in plan order. ``ruleset``: name, path or object (default: the
    server's configured ruleset); part of every game key and series id."""
    rs = resolve_ruleset(ruleset)
    specs = []
    for seats in matchups:
        label = matchup_label(seats)
        for seed_, rot, key in plan(seats, games, seed, rs):
            specs.append(
                GameSpec(
                    key=key,
                    seating=rotate(seats, rot),
                    seed=seed_,
                    rotation=rot,
                    matchup=label,
                    series_id=adhoc_series_id(label, rs),
                    ruleset=rs,
                )
            )
    result, done = await run_games(
        specs,
        results_path=results_path,
        max_concurrency=max_concurrency,
        max_usd=max_usd,
        max_decisions=max_decisions,
        prices=prices,
        fresh=fresh,
        progress=progress,
        transcripts=transcripts,
        transcript_dir=transcript_dir,
    )
    for seats in matchups:
        label = matchup_label(seats)
        result.records[label] = [
            done[key] for _, _, key in plan(seats, games, seed, rs) if key in done
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
    if isinstance(spec, tuple):
        return None
    provider = getattr(spec, "provider", None)
    return getattr(provider, "model", None)
