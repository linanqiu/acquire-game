"""Acquire Bench: named, versioned benchmark protocols and ``run_protocol``.

``acquire-bench-v1``
    4 seats. Every series is 72 games: every distinct seating of its lineup
    is played on the same deal (seed), seed after seed, until 72 games.

    * vs-baseline: lineup ``(model, bot, bot, bot)`` per model -> 4 seatings
      (the model in each position) x 18 seeds.
    * head-to-head: the models in one game; with 2 or 3 models the remaining
      seats are rules-based bots; with more than 4 models one series per
      4-combination (each model meets every other model in C(k-2, 2)
      combinations). Seatings: every distinct permutation of the lineup
      (12 for 2 models + 2 bots -> 6 seeds; 24 for 3 or 4 distinct entrants
      -> 3 seeds), so every entrant sits in every position equally often and
      in front of / behind every other entrant equally often.

    Why 72: vs-baseline, chance win rate 25%. 72 games give 80% power
    (two-sided 5%) to detect a true 40% win rate and a 95% Wilson interval of
    roughly +/-10 points at 25%. Smaller edges (30% vs 25%) need ~550 games:
    the protocol cannot see them, and the leaderboard's verdict says
    "inconclusive" rather than pretend. Mean rank and the rating use the
    whole finishing order and are less noisy than win rate.

Results are only comparable within one protocol id AND one ``prompt_version``
(``agents.llm.prompt_version()``); both are recorded in every result and the
leaderboard never mixes them. Changing seeds, seat count, schedule or game
count means a new protocol id.
"""

from __future__ import annotations

import hashlib
import itertools
import math
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from bench.prices import PriceTable
from bench.runner import SeatSpec, matchup_label, resolve_ruleset, seat_label
from bench.series import BenchError, GameSpec, SeriesResult, run_games
from game.ruleset import Ruleset

TRACKS = ("vs-baseline", "head-to-head")
BASELINE = "bot"


@dataclass(frozen=True)
class Protocol:
    id: str
    description: str
    players: int
    seeds: tuple[int, ...]
    games_per_series: int
    baseline: str = BASELINE

    def public(self) -> dict:
        return {
            "id": self.id,
            "description": self.description,
            "players": self.players,
            "games_per_matchup": self.games_per_series,
            "seeds": list(self.seeds),
        }


ACQUIRE_BENCH_V1 = Protocol(
    id="acquire-bench-v1",
    description=(
        "4 seats, fixed seeds, every seating of each lineup on the same deal, "
        "72 games per series, pinned prompt version. Tracks: vs-baseline (one "
        "model + three rules-based bots) and head-to-head (models in one game, "
        "bots fill empty seats)."
    ),
    players=4,
    seeds=(
        9001,
        9002,
        9003,
        9004,
        9005,
        9006,
        9007,
        9008,
        9009,
        9010,
        9011,
        9012,
        9013,
        9014,
        9015,
        9016,
        9017,
        9018,
    ),
    games_per_series=72,
)

PROTOCOLS: dict[str, Protocol] = {ACQUIRE_BENCH_V1.id: ACQUIRE_BENCH_V1}


def get_protocol(protocol_id: str) -> Protocol:
    try:
        return PROTOCOLS[protocol_id]
    except KeyError:
        raise BenchError(
            f"unknown protocol {protocol_id!r}; known: {', '.join(PROTOCOLS)}"
        ) from None


# --------------------------------------------------------------- scheduling


def seatings(lineup: Sequence[SeatSpec]) -> list[tuple[int, ...]]:
    """Every distinct seating of ``lineup`` as index tuples (seat -> lineup
    index), identical agents (same label) not distinguished. Deterministic
    order (lexicographic over label positions)."""
    labels = [seat_label(s) for s in lineup]
    seen: set[tuple[str, ...]] = set()
    out = []
    for perm in itertools.permutations(range(len(lineup))):
        key = tuple(labels[i] for i in perm)
        if key in seen:
            continue
        seen.add(key)
        out.append(perm)
    return out


def lineups(
    models: Sequence[SeatSpec], track: str, protocol: Protocol
) -> list[list[SeatSpec]]:
    """The lineups (one series each) of ``track`` for ``models``."""
    p = protocol.players
    if track == "vs-baseline":
        return [[m] + [protocol.baseline] * (p - 1) for m in models]
    if track == "head-to-head":
        if len(models) < 2:
            return []
        if len(models) <= p:
            return [list(models) + [protocol.baseline] * (p - len(models))]
        return [list(c) for c in itertools.combinations(models, p)]
    raise BenchError(f"unknown track {track!r}; use one of {', '.join(TRACKS)}")


def series_id(
    protocol: Protocol,
    track: str,
    lineup,
    prompt_version: str,
    ruleset: Ruleset | None = None,
) -> str:
    """Id of one series: protocol, ruleset, track, lineup, prompt version."""
    rs = ruleset if ruleset is not None else resolve_ruleset()
    labels = [seat_label(s) for s in lineup]
    slug = re.sub(r"[^A-Za-z0-9]+", "-", "_".join(labels)).strip("-")[:60]
    digest = hashlib.sha256(
        "|".join(
            [protocol.id, rs.id, rs.fingerprint, track, *labels, prompt_version]
        ).encode()
    ).hexdigest()[:8]
    return f"{protocol.id}.{rs.id}.{track}.{slug}.{prompt_version}.{digest}"


def schedule(
    protocol: Protocol,
    track: str,
    lineup: Sequence[SeatSpec],
    prompt_version: str,
    *,
    games: int | None = None,
    ruleset: Ruleset | None = None,
) -> list[GameSpec]:
    """The games of one series, seed-major: seed 1 under every seating, then
    seed 2... ``games`` caps the series (balanced only when a multiple of the
    number of seatings)."""
    perms = seatings(lineup)
    n_seeds = math.ceil(protocol.games_per_series / len(perms))
    if n_seeds > len(protocol.seeds):
        raise BenchError(f"protocol {protocol.id} has too few seeds")
    rs = ruleset if ruleset is not None else resolve_ruleset()
    sid = series_id(protocol, track, lineup, prompt_version, rs)
    label = matchup_label(list(lineup))
    planned = n_seeds * len(perms)
    if games is not None:
        planned = min(planned, max(0, games))
    specs = []
    for seed in protocol.seeds[:n_seeds]:
        for idx, perm in enumerate(perms):
            if len(specs) >= planned:
                break
            specs.append(
                GameSpec(
                    key=f"{sid}|seed={seed}|seating={idx}",
                    seating=[lineup[i] for i in perm],
                    seed=seed,
                    rotation=idx,
                    matchup=label,
                    series_id=sid,
                    ruleset=rs,
                    meta={
                        "protocol": protocol.id,
                        "ruleset_id": rs.id,
                        "ruleset_fingerprint": rs.fingerprint,
                        "track": track,
                        "prompt_version": prompt_version,
                        "series_games": planned,
                        "seating_index": idx,
                        "lineup": [seat_label(s) for s in lineup],
                    },
                )
            )
    return specs


def balance(specs: Sequence[GameSpec]) -> dict[str, dict[int, int]]:
    """``{agent label: {position: games}}`` of a schedule (balance check)."""
    out: dict[str, dict[int, int]] = {}
    for spec in specs:
        for pos, s in enumerate(spec.seating):
            d = out.setdefault(seat_label(s), {})
            d[pos] = d.get(pos, 0) + 1
    return out


# ------------------------------------------------------------------ running


@dataclass
class ProtocolResult:
    """What ``run_protocol`` did. ``status``: complete | stopped | stalled."""

    protocol: str
    prompt_version: str
    ruleset_id: str
    ruleset_fingerprint: str
    tracks: list[str]
    out: Path
    series: list[str]
    result: SeriesResult
    warnings: list[str] = field(default_factory=list)
    leaderboard: dict | None = None

    @property
    def status(self) -> str:
        return self.result.status

    @property
    def exit_code(self) -> int:
        return 0 if self.status == "complete" else 1

    def summary(self) -> dict:
        """The CLI's ``--json`` summary."""
        r = self.result
        return {
            "status": self.status,
            "exit_code": self.exit_code,
            "protocol": self.protocol,
            "prompt_version": self.prompt_version,
            "ruleset_id": self.ruleset_id,
            "ruleset_fingerprint": self.ruleset_fingerprint,
            "tracks": self.tracks,
            "out": str(self.out),
            "series": self.series,
            "games": {
                "planned": r.planned,
                "ran": r.ran,
                "skipped": r.skipped,
                "aborted": r.aborted,
                "stalled": r.failed,
            },
            "stopped_reason": r.stopped_reason,
            "budget": {"decisions": r.budget.decisions, "usd": r.budget.usd},
            "warnings": self.warnings,
            "files": {
                "results": str(self.out / "results.jsonl"),
                "transcripts": str(self.out / "transcripts"),
                "leaderboard": str(self.out / "leaderboard.json"),
                "report": str(self.out / "report.md"),
            },
            "leaderboard": self.leaderboard,
        }


def current_prompt_version(ruleset: Ruleset | None = None) -> str:
    from agents.llm.prompt import prompt_version

    return prompt_version(ruleset)


async def run_protocol(
    models: Sequence[SeatSpec],
    *,
    out: str | Path,
    protocol: str | Protocol = ACQUIRE_BENCH_V1.id,
    track: str = "both",
    games: int | None = None,
    max_concurrency: int = 4,
    max_usd: float | None = None,
    max_decisions: int | None = None,
    prices: PriceTable | None = None,
    fresh: bool = False,
    transcripts: bool = True,
    progress: Callable[[str], None] | None = None,
    prompt_version: str | None = None,
    write_outputs: bool = True,
    ruleset: Ruleset | str | Path | None = None,
) -> ProtocolResult:
    """Run a benchmark protocol for ``models`` into ``out`` (resumable).

    ``models``: catalog ids (``"llm:claude-haiku-5-5"``), ``(label, factory)``
    tuples (``factory()`` -> a fresh Agent per game; benchmark your own agent
    without touching the catalog) or Agent instances (reused across games, so
    concurrency drops to 1). ``track``: ``vs-baseline`` | ``head-to-head`` |
    ``both``. ``games``: cap per series (default: the protocol's 72).

    Writes ``<out>/results.jsonl``, ``<out>/transcripts/<game_id>.jsonl``,
    ``<out>/leaderboard.json`` and ``<out>/report.md`` (unless
    ``write_outputs=False``). Raises ``BenchError`` on configuration errors
    (unknown protocol/track, no models, duplicate labels, unknown prices
    with ``max_usd``) before any game starts.

    ``ruleset``: name in ``backend/rulesets``, path or ``Ruleset`` (default:
    the server's configured ruleset, ``GAME_RULESET``, else classic). Results
    of different rulesets are never mixed: the ruleset is part of every game
    key, series id, prompt version and leaderboard.
    """
    rs = resolve_ruleset(ruleset)
    proto = protocol if isinstance(protocol, Protocol) else get_protocol(protocol)
    tracks = list(TRACKS) if track == "both" else [track]
    for t in tracks:
        if t not in TRACKS:
            raise BenchError(
                f"unknown track {t!r}; use vs-baseline, head-to-head or both"
            )
    models = list(models)
    if not models:
        raise BenchError("no models given")
    labels = [seat_label(m) for m in models]
    if len(set(labels)) != len(labels):
        raise BenchError(f"duplicate model labels: {labels}")
    if proto.baseline in labels:
        raise BenchError(f"{proto.baseline!r} is the baseline; it is always included")
    if games is not None and games < 1:
        raise BenchError("--games must be >= 1")
    version = prompt_version or current_prompt_version(rs)
    warnings: list[str] = []
    if any(not isinstance(m, (str, tuple)) for m in models) and max_concurrency > 1:
        warnings.append(
            "an Agent instance is reused across games: running one game at a time "
            "(pass a (label, factory) tuple to run games concurrently)"
        )
        max_concurrency = 1

    specs: list[GameSpec] = []
    series: list[str] = []
    for t in tracks:
        lus = lineups(models, t, proto)
        if t == "head-to-head" and not lus:
            warnings.append("head-to-head needs at least 2 models: track skipped")
        for lu in lus:
            s = schedule(proto, t, lu, version, games=games, ruleset=rs)
            n_perm = len(seatings(lu))
            if len(s) % n_perm:
                warnings.append(
                    f"{s[0].series_id if s else t}: {len(s)} games is not a multiple "
                    f"of the {n_perm} seatings, so seat positions are not balanced"
                )
            specs.extend(s)
            if s:
                series.append(s[0].series_id)

    out = Path(out)
    result, _ = await run_games(
        specs,
        results_path=out / "results.jsonl",
        max_concurrency=max_concurrency,
        max_usd=max_usd,
        max_decisions=max_decisions,
        prices=prices,
        fresh=fresh,
        progress=progress,
        transcripts=transcripts,
        transcript_dir=out / "transcripts",
        prompt_version=version,
    )
    pr = ProtocolResult(
        protocol=proto.id,
        prompt_version=version,
        ruleset_id=rs.id,
        ruleset_fingerprint=rs.fingerprint,
        tracks=tracks,
        out=out,
        series=series,
        result=result,
        warnings=warnings,
    )
    if write_outputs:
        from bench.results import write_outputs as _write

        boards = _write(out, prices=prices)
        pr.leaderboard = next(
            (
                b
                for b in boards
                if b["protocol"]["id"] == proto.id
                and b["prompt_version"] == version
                and b["ruleset"]["fingerprint"] == rs.fingerprint
            ),
            None,
        )
    return pr
