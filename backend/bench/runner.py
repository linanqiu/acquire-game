"""Headless single-game runner.

Plays one full game with no server and no sockets, making each decision the
way the server's seat driver (``seats._drive_loop``) does:

    pending_decisions -> build_context -> agent.decide (timeout)
      -> check (``seats._check``) -> heuristic fallback -> apply_action

The pure pieces (``_check``, ``_category``, ``_timeout_for``) are imported
from ``seats`` so validation, per-turn caps, timeouts and fallback categories
cannot drift. What is mirrored (because the original needs a room): decision
picking (trade responses addressed to agents first, then the flow decision),
and the fallback candidate order (HeuristicAgent, then ``default_action``).
"""

from __future__ import annotations

import asyncio
import statistics
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from agents import registry
from agents.base import Agent, build_context
from agents.heuristic import HeuristicAgent
from agents.scripted import default_action
from bench.prices import PriceTable
from game.decisions import (
    TRADE_RESPONSE,
    apply_action,
    pending_decisions,
    validate_action,
)
from game.game import Game, GamePhase
from seats import _category, _check, _timeout_for

# (label, factory) lets callers inject an Agent built fresh for every game.
SeatSpec = str | Agent | tuple[str, Callable[[], Agent]]

MAX_DECISIONS_PER_GAME = 20_000  # runaway guard; a real game is ~1-2k
_TOKEN_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
)


def seat_label(spec: SeatSpec) -> str:
    if isinstance(spec, str):
        return spec
    if isinstance(spec, tuple):
        return spec[0]
    return str(getattr(spec, "label", None) or type(spec).__name__)


def matchup_label(seats: list[SeatSpec]) -> str:
    return ",".join(seat_label(s) for s in seats)


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
    repairs: int = 0  # decisions whose first answer was illegal (agent-reported)
    retries: int = 0  # extra model calls spent on illegal answers (agent-reported)
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
            "standings": self.standings,
            "winners": self.winners,
            "turns": self.turns,
            "end_reason": self.end_reason,
            "decisions": self.decisions,
            "seats": [s.to_dict() for s in self.seats],
        }


def assign_ranks(scores: list[int]) -> list[float]:
    """Rank per score (1 = best); ties share the average of their positions."""
    order = sorted(scores, reverse=True)
    ranks = []
    for s in scores:
        first = order.index(s) + 1
        count = order.count(s)
        ranks.append(first + (count - 1) / 2)
    return ranks


def _pick(game: Game):
    decisions = pending_decisions(game)
    if not decisions:
        return None
    for d in decisions[1:]:
        if d.kind == TRADE_RESPONSE:
            return d
    return decisions[0]


def _fallback_action(game: Game, decision, ctx, heuristic: HeuristicAgent):
    for candidate in (heuristic.choose(ctx), default_action(ctx)):
        if (
            candidate.get("action") in ctx.legal.get("action_types", [])
            and validate_action(game, decision.player_id, candidate) is None
        ):
            return candidate
    return None


def counts_for(game: Game, decision, turn_counts: dict) -> dict:
    key = (
        sum(1 for e in game.events if e["type"] == "turn_ended"),
        decision.player_id,
    )
    return turn_counts.setdefault(key, {"actions": 0, "proposals": 0})


async def _obtain(agent, game: Game, decision, ctx, counts: dict):
    """Ask ``agent`` and check its answer: ``(action, failure, elapsed_s)``.

    The ONE place that mirrors the server driver's decide -> check step. If the
    driver gains a re-ask loop (``agent.decide(ctx, rejected=[...])`` after an
    illegal answer or an engine refusal), add it here, or call the driver's
    function once it exists. Retry counts reach the report through the agent's
    ``totals`` (read defensively in ``run_game``), not through this function.
    """
    action: Any = None
    failure: str | None = None
    started = time.monotonic()
    try:
        action = await asyncio.wait_for(agent.decide(ctx), _timeout_for(agent))
    except asyncio.TimeoutError:
        failure = f"timeout after {time.monotonic() - started:.1f}s"
    except asyncio.CancelledError:
        raise
    except Exception as e:  # noqa: BLE001 - any agent failure falls back
        failure = f"error: {type(e).__name__}: {e}"[:300]
    elapsed = time.monotonic() - started
    if failure is None:
        failure = _check(game, decision, ctx, action, counts)
    return action, failure, elapsed


def _snapshot(agent: Any) -> dict | None:
    totals = getattr(agent, "totals", None)
    return dict(totals) if isinstance(totals, dict) else None


async def run_game(
    seats: list[SeatSpec],
    seed: int,
    *,
    prices: PriceTable | None = None,
    stop: Callable[[], bool] | None = None,
    observer: Callable[[dict], None] | None = None,
) -> GameRecord:
    """Play one game headlessly.

    ``seats`` are in seating (turn) order. ``stop`` is polled before every
    decision; when it returns True the game is abandoned with status
    ``aborted``. ``observer`` gets ``{"kind", "usd"}`` after each decision
    (used by the series budget guard).
    """
    prices = prices or PriceTable.load()
    n = len(seats)
    agents = [build_agent(spec, pos=i, seed=seed) for i, spec in enumerate(seats)]
    labels = [seat_label(s) for s in seats]
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

    game = Game(seed=seed)
    for i in range(n):
        game.add_player(ids[i], f"Seat {i + 1}", is_bot=True)
    game.start_game()

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
        action, failure, elapsed = await _obtain(agent, game, decision, ctx, counts)
        if failure is not None:
            category = _category(failure)
            st.fallbacks += 1
            st.fallback_reasons[category] = st.fallback_reasons.get(category, 0) + 1
            note = getattr(agent, "note_fallback", None)
            if callable(note):
                note(failure)
            action = _fallback_action(
                game, decision, ctx, heuristics[decision.player_id]
            )
            if action is None:
                status, detail = "stalled", f"no legal fallback for {decision.kind}"
                break
        result = apply_action(game, decision.player_id, action)
        if not result.get("success"):
            # validated but refused by the engine: engine/validator mismatch
            st.fallbacks += 1
            st.fallback_reasons["engine"] = st.fallback_reasons.get("engine", 0) + 1
            action = _fallback_action(
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

        # accounting
        st.decisions += 1
        st.latency_total_s += elapsed
        if st.kind != "bot":
            st.latencies_ms.append(round(elapsed * 1000, 2))
        usd: float | None = 0.0
        after = _snapshot(agent)
        if before is not None and after is not None:
            delta = {k: after.get(k, 0) - before.get(k, 0) for k in _TOKEN_FIELDS}
            for k in _TOKEN_FIELDS:
                setattr(st, k, getattr(st, k) + delta[k])
            st.repairs += after.get("repairs", 0) - before.get("repairs", 0)
            st.retries += after.get("retries", 0) - before.get("retries", 0)
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

    scores = [p.money for p in game.players] if status == "completed" else [0] * n
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
    )
