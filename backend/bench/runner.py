"""Headless single-game runner.

Plays one full game with no server and no sockets, making each decision the
way the server's seat driver (``seats._drive_loop``) does:

    pending_decisions -> build_context -> agent.decide (timeout; an illegal
      answer is sent back to agents that accept rejections, within their
      retry and time budget) -> check -> heuristic fallback -> apply_action

The pure pieces (answer check, fallback category, timeouts, fallback answer)
come from ``agents.driving``, shared with the server, so they cannot drift;
this module does not import the web server. Mirrored here because the
original needs a room: decision picking (trade responses first, then the flow
decision) and the lock-free re-ask loop.

Every game can write a transcript (``transcript_dir``): the same
``TranscriptWriter`` the server uses, ``source: "bench"``.
"""

from __future__ import annotations

import asyncio
import statistics
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from agents import registry
from agents.base import Agent, accepts_rejections, build_context
from agents.driving import (
    PUBLIC_REASON,
    SOURCE_FOR_KIND,
    category,
    check_answer,
    describe_fallback,
    fallback_action,
    llm_record,
    timeout_for,
)
from agents.heuristic import HeuristicAgent
from bench.prices import PriceTable
from config import get_ruleset
from game.decisions import TRADE_RESPONSE, apply_action, pending_decisions
from game.game import Game, GamePhase
from game.ranking import competition_ranks
from game.ruleset import Ruleset, load_ruleset
from transcripts.paths import new_game_id, utc_now
from transcripts.writer import TranscriptWriter

# A seat: a catalog id ("bot", "llm:..."), an Agent instance (reused for every
# game: fine for stateless agents and concurrency 1), or ``(label, factory)``
# where ``factory()`` builds a fresh Agent per game (preferred).
SeatSpec = str | Agent | tuple[str, Callable[[], Agent]]

MAX_DECISIONS_PER_GAME = 20_000  # runaway guard; a real game is ~1-2k
_TOKEN_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
)


def resolve_ruleset(ruleset: Ruleset | str | Path | None = None) -> Ruleset:
    """The ruleset a benchmark game uses: ``ruleset`` (an object, a name in
    ``backend/rulesets`` or a path), else the server's configured default
    (env ``GAME_RULESET``, falling back to classic)."""
    if ruleset is None:
        return get_ruleset()
    if isinstance(ruleset, Ruleset):
        return ruleset
    return load_ruleset(str(ruleset))


def seat_label(spec: SeatSpec) -> str:
    if isinstance(spec, str):
        return spec
    if isinstance(spec, tuple):
        return spec[0]
    return str(getattr(spec, "label", None) or type(spec).__name__)


def matchup_label(seats: list[SeatSpec]) -> str:
    return ",".join(seat_label(s) for s in seats)


def display_label(spec: SeatSpec) -> str:
    """Human-readable label: the catalog label for catalog ids."""
    if isinstance(spec, str):
        if spec == "bot":
            return "Rules-based bot"
        entry = registry.entry(spec)
        return (entry or {}).get("label") or spec
    return seat_label(spec)


def build_agent(spec: SeatSpec, *, pos: int, seed: int) -> Agent:
    """A fresh agent for seat ``pos`` of game ``seed`` (deterministic RNGs)."""
    name = f"Seat {pos + 1}"
    if isinstance(spec, str):
        if spec == "bot":
            return HeuristicAgent(name=name, seed=f"{seed}:{pos}")
        return registry.create(spec, name=name)
    if isinstance(spec, tuple):
        return spec[1]()
    return spec


def _model_of(agent: Any) -> str | None:
    provider = getattr(agent, "provider", None)
    return getattr(provider, "model", None) or getattr(agent, "model", None)


def percentile(values: list[float], q: float) -> float | None:
    """Nearest-rank-interpolated percentile (linear), None for no data."""
    if not values:
        return None
    s = sorted(values)
    k = (len(s) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


@dataclass
class SeatStats:
    pos: int
    player_id: str
    agent: str  # label
    kind: str
    model: str | None = None
    decisions: int = 0
    fallbacks: int = 0
    fallback_reasons: dict[str, int] = field(default_factory=dict)
    repairs: int = 0  # decisions whose first answer was rejected
    retries: int = 0  # rejected answers (agent-internal and engine re-asks)
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    latency_total_s: float = 0.0
    latencies_ms: list[float] = field(default_factory=list)  # non-bot seats only
    trades_proposed: int = 0
    trades_accepted: int = 0  # responses given by this seat
    trades_rejected: int = 0
    declarations: int = 0
    cost_usd: float | None = None  # None = unknown

    def to_dict(self) -> dict:
        lat = self.latencies_ms
        d = dict(self.__dict__)
        d["latency_p50_ms"] = percentile(lat, 0.5)
        d["latency_p95_ms"] = percentile(lat, 0.95)
        d["latency_mean_ms"] = statistics.fmean(lat) if lat else None
        return d


@dataclass
class GameRecord:
    seed: int
    status: str  # completed | aborted | stalled
    seat_order: list[str]  # agent labels by position
    seats: list[SeatStats]
    standings: list[dict]  # {pos, player_id, score, rank}; best first
    winners: list[int]  # positions (several on a tie)
    turns: int = 0
    end_reason: str | None = None
    detail: str | None = None
    key: str = ""
    matchup: str = ""
    game_id: str | None = None
    transcript: str | None = None  # path of the transcript file (None: off)
    started_at: str | None = None
    finished_at: str | None = None
    seat_labels: list[str] = field(default_factory=list)  # display labels
    ruleset_id: str | None = None
    ruleset_fingerprint: str | None = None

    @property
    def decisions(self) -> int:
        return sum(s.decisions for s in self.seats)

    @property
    def completed(self) -> bool:
        return self.status == "completed"

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "matchup": self.matchup,
            "seed": self.seed,
            "status": self.status,
            "detail": self.detail,
            "seat_order": self.seat_order,
            "seat_labels": self.seat_labels,
            "standings": self.standings,
            "winners": self.winners,
            "turns": self.turns,
            "end_reason": self.end_reason,
            "decisions": self.decisions,
            "seats": [s.to_dict() for s in self.seats],
            "game_id": self.game_id,
            "transcript": self.transcript,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "ruleset_id": self.ruleset_id,
            "ruleset_fingerprint": self.ruleset_fingerprint,
        }


def assign_ranks(scores: list[int]) -> list[int]:
    """Rank per score (1 = best), as the engine ranks final standings:
    competition ranking, ties share the best rank (1, 1, 3)."""
    return competition_ranks(scores)


def _pick(game: Game):
    decisions = pending_decisions(game)
    if not decisions:
        return None
    for d in decisions[1:]:
        if d.kind == TRADE_RESPONSE:
            return d
    return decisions[0]


def counts_for(game: Game, decision, turn_counts: dict) -> dict:
    key = (
        sum(1 for e in game.events if e["type"] == "turn_ended"),
        decision.player_id,
    )
    return turn_counts.setdefault(key, {"actions": 0, "proposals": 0})


async def _obtain(agent, game: Game, decision, ctx, counts: dict):
    """Ask ``agent`` and check its answer, re-asking like the server driver.

    Returns ``(action, failure, elapsed_s, rejected)``: ``failure`` is None for
    a legal answer; ``rejected`` lists the answers the driver refused and sent
    back (agents that accept rejections; retry budget ``1 +
    max_illegal_retries`` answers, one deadline for the whole decision).
    """
    started = time.monotonic()
    deadline = started + timeout_for(agent)
    retry_ok = accepts_rejections(agent)
    max_answers = 1 + max(0, int(getattr(agent, "max_illegal_retries", 0) or 0))
    rejected: list[dict] = []
    while True:
        action: Any = None
        failure: str | None = None
        remaining = deadline - time.monotonic()
        try:
            if remaining <= 0:
                raise asyncio.TimeoutError
            if retry_ok:
                kwargs: dict = {"deadline": deadline}
                if rejected:
                    kwargs["rejected"] = list(rejected)
            else:
                kwargs = {}
            action = await asyncio.wait_for(agent.decide(ctx, **kwargs), remaining)
        except asyncio.TimeoutError:
            failure = f"timeout after {time.monotonic() - started:.1f}s"
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - any agent failure falls back
            reason = getattr(e, "reason", None) or "error"
            if reason == "timeout":
                failure = f"timeout after {time.monotonic() - started:.1f}s"
            elif reason == "illegal":
                failure = f"illegal: {e}"[:300]
            elif reason == "script":  # strict scripted seat
                failure = f"script: {e}"[:300]
            else:
                failure = f"error: {type(e).__name__}: {e}"[:300]
        if failure is None:
            failure = check_answer(game, decision, ctx, action, counts)
            if (
                failure is not None
                and category(failure) == "illegal"
                and retry_ok
                and len(rejected) + 1 < max_answers
            ):
                rejected.append({"action": action, "error": failure})
                continue
        return action, failure, time.monotonic() - started, rejected


def _snapshot(agent: Any) -> dict | None:
    totals = getattr(agent, "totals", None)
    return dict(totals) if isinstance(totals, dict) else None


def _prompt_info(
    agents: list, prompt_version: str | None, ruleset: Ruleset
) -> tuple[str | None, dict]:
    """Header ``prompt_version`` and ``system_prompts`` (text only when an
    LLM seat plays; the text is the one built for ``ruleset``)."""
    try:
        from agents.llm.prompt import build_system_prompt, system_prompt_id
        from agents.llm.prompt import prompt_version as current
    except ImportError:  # pragma: no cover
        return prompt_version, {}
    version = prompt_version or current(ruleset)
    if not any(getattr(a, "kind", "") == "llm" for a in agents):
        return version, {}
    text = build_system_prompt(ruleset)
    return version, {system_prompt_id(text, ruleset): text}


async def run_game(
    seats: list[SeatSpec],
    seed: int,
    *,
    prices: PriceTable | None = None,
    stop: Callable[[], bool] | None = None,
    observer: Callable[[dict], None] | None = None,
    transcript_dir: str | Path | None = None,
    bench_meta: dict | None = None,
    prompt_version: str | None = None,
    game_id: str | None = None,
    ruleset: Ruleset | str | Path | None = None,
) -> GameRecord:
    """Play one game headlessly.

    ``seats`` are in seating (turn) order. ``stop`` is polled before every
    decision; when it returns True the game is abandoned with status
    ``aborted``. ``observer`` gets ``{"kind", "usd"}`` after each decision
    (used by the series budget guard). With ``transcript_dir`` a transcript
    ``<transcript_dir>/<game_id>.jsonl`` is written (``bench_meta`` becomes the
    header's ``bench`` object: series_id, matchup, seed, rotation, ...).
    ``ruleset``: the game variant (see ``resolve_ruleset``); recorded in the
    game record and the transcript header.
    """
    rs = resolve_ruleset(ruleset)
    prices = prices or PriceTable.load()
    n = len(seats)
    agents = [build_agent(spec, pos=i, seed=seed) for i, spec in enumerate(seats)]
    labels = [seat_label(s) for s in seats]
    shown = [display_label(s) for s in seats]
    ids = [f"p{i + 1}" for i in range(n)]
    stats = [
        SeatStats(
            pos=i,
            player_id=ids[i],
            agent=labels[i],
            kind=getattr(agents[i], "kind", "bot"),
            model=_model_of(agents[i]),
        )
        for i in range(n)
    ]
    heuristics = {
        ids[i]: HeuristicAgent(name=f"fallback:{i}", seed=f"{seed}:fb:{i}")
        for i in range(n)
    }
    by_id = {ids[i]: i for i in range(n)}
    started_at = utc_now()
    game_id = game_id or new_game_id()

    game = Game(seed=seed, ruleset=rs)
    for i in range(n):
        game.add_player(ids[i], f"Seat {i + 1}", is_bot=True)
    game.start_game()

    writer = None
    if transcript_dir is not None:
        version, prompts = _prompt_info(agents, prompt_version, rs)
        writer = TranscriptWriter.open(
            game,
            seats=[
                {
                    "player_id": ids[i],
                    "name": f"Seat {i + 1}",
                    "kind": stats[i].kind,
                    "agent_id": labels[i],
                    "agent_label": shown[i],
                    "model": stats[i].model,
                    "is_bot": True,
                }
                for i in range(n)
            ],
            source="bench",
            directory=transcript_dir,
            game_id=game_id,
            bench={"seed": seed, **(bench_meta or {})},
            prompt_version=version,
            system_prompts=prompts,
            prices=prices,
        )

    turn_counts: dict[tuple, dict] = {}
    status, detail = "completed", None
    total = 0
    while game.phase != GamePhase.GAME_OVER:
        if stop is not None and stop():
            status, detail = "aborted", "stopped by budget guard"
            break
        decision = _pick(game)
        if decision is None:
            status, detail = "stalled", f"no pending decision in phase {game.phase}"
            break
        total += 1
        if total > MAX_DECISIONS_PER_GAME:
            status, detail = "stalled", "decision cap per game exceeded"
            break

        i = by_id[decision.player_id]
        st, agent = stats[i], agents[i]
        ctx = build_context(game, decision)
        before = _snapshot(agent)

        counts = counts_for(game, decision, turn_counts)
        action, failure, elapsed, rejected = await _obtain(
            agent, game, decision, ctx, counts
        )
        source = SOURCE_FOR_KIND.get(st.kind, st.kind)
        fallback = None
        if failure is not None:
            cat = category(failure)
            st.fallbacks += 1
            st.fallback_reasons[cat] = st.fallback_reasons.get(cat, 0) + 1
            note = getattr(agent, "note_fallback", None)
            if callable(note):
                note(failure)
            action = fallback_action(
                game, decision, ctx, heuristics[decision.player_id]
            )
            if action is None:
                status, detail = "stalled", f"no legal fallback for {decision.kind}"
                break
            reason = PUBLIC_REASON.get(cat, "error")
            source = "fallback"
            fallback = {
                "reason": reason,
                "message": describe_fallback(
                    shown[i], reason, len(rejected) + 1, elapsed
                ),
                "detail": failure,
            }
        after_seq = len(game.events) - 1
        result = apply_action(game, decision.player_id, action)
        if not result.get("success"):
            # validated but refused by the engine: engine/validator mismatch
            st.fallbacks += 1
            st.fallback_reasons["engine"] = st.fallback_reasons.get("engine", 0) + 1
            action = fallback_action(
                game, decision, ctx, heuristics[decision.player_id]
            )
            result = (
                apply_action(game, decision.player_id, action)
                if action is not None
                else {"success": False}
            )
            if not result.get("success"):
                status, detail = (
                    "stalled",
                    f"engine rejected every answer for {decision.kind}",
                )
                break
            source = "fallback"
            fallback = {
                "reason": "illegal",
                "message": "the engine refused a validated answer; "
                "the rules-based player made this move",
                "detail": "engine mismatch",
            }

        llm = llm_record(agent, ctx)
        if writer is not None:
            writer.record_decision(
                player_id=decision.player_id,
                kind=decision.kind,
                legal=ctx.legal,
                action=action,
                source=source,
                after_seq=after_seq,
                fallback=fallback,
                latency_s=elapsed,
                llm=llm,
            )

        # accounting
        st.decisions += 1
        st.latency_total_s += elapsed
        if st.kind != "bot":
            st.latencies_ms.append(round(elapsed * 1000, 2))
        if llm is not None:
            bad = sum(1 for a in llm.get("attempts") or [] if a.get("error"))
        else:
            bad = len(rejected) + (
                1 if failure and category(failure) == "illegal" else 0
            )
        st.retries += bad
        st.repairs += int(bad > 0)
        usd: float | None = 0.0
        after = _snapshot(agent)
        if before is not None and after is not None:
            delta = {k: after.get(k, 0) - before.get(k, 0) for k in _TOKEN_FIELDS}
            for k in _TOKEN_FIELDS:
                setattr(st, k, getattr(st, k) + delta[k])
            st.calls += after.get("calls", 0) - before.get("calls", 0)
            usd = prices.cost(st.model, *(delta[k] for k in _TOKEN_FIELDS))
        counts["actions"] += 1
        kind = action.get("action")
        if kind == "propose_trade":
            counts["proposals"] += 1
            st.trades_proposed += 1
        elif kind == "accept_trade":
            st.trades_accepted += 1
        elif kind == "reject_trade":
            st.trades_rejected += 1
        elif kind == "declare_end_game":
            st.declarations += 1
        if observer is not None:
            observer({"kind": st.kind, "usd": usd})
        await asyncio.sleep(0)  # let other games run

    # cost per seat: bots are free; LLM seats need known prices
    for st, agent in zip(stats, agents, strict=True):
        if _snapshot(agent) is None:
            st.cost_usd = 0.0 if st.kind in ("bot", "scripted") else None
        else:
            st.cost_usd = prices.cost(
                st.model,
                st.input_tokens,
                st.output_tokens,
                st.cache_read_tokens,
                st.cache_write_tokens,
            )

    standings: list[dict] = []
    winners: list[int] = []
    if status == "completed":
        by_pid = {p.player_id: p.money for p in game.players}
        scores = [by_pid[ids[i]] for i in range(n)]
        ranks = assign_ranks(scores)
        standings = sorted(
            (
                {"pos": i, "player_id": ids[i], "score": scores[i], "rank": ranks[i]}
                for i in range(n)
            ),
            key=lambda r: (r["rank"], r["pos"]),
        )
        best = max(scores)
        winners = [i for i in range(n) if scores[i] == best]

    if writer is not None:
        if status == "completed":
            writer.close_from_game()
        else:
            writer.close("abandoned", detail=f"{status}: {detail}")

    end_reason = next(
        (e.get("reason") for e in reversed(game.events) if e["type"] == "game_ended"),
        None,
    )
    return GameRecord(
        seed=seed,
        status=status,
        seat_order=labels,
        seats=stats,
        standings=standings,
        winners=winners,
        turns=sum(1 for e in game.events if e["type"] == "turn_ended"),
        end_reason=end_reason,
        detail=detail,
        matchup=matchup_label(seats),
        game_id=game_id,
        transcript=str(writer.path) if writer is not None else None,
        started_at=started_at,
        finished_at=utc_now(),
        seat_labels=shown,
        ruleset_id=rs.id,
        ruleset_fingerprint=rs.fingerprint,
    )
