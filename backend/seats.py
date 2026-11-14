"""Seat driver: every seat acts through ``apply_action``, one decision at a time.

Per room there is one ``asyncio.Lock`` that serialises every mutation (human
WebSocket/HTTP actions, the driver, snapshot loads) and at most one driver
task. The driver loop:

1. under the lock: read ``pending_decisions``; pick the first decision owned
   by an agent seat (trade responses addressed to agents first, so offers are
   answered promptly, then the flow decision); build its ``DecisionContext``;
   publish ``awaiting``;
2. release the lock and ``await agent.decide(ctx)`` with a per-kind timeout
   (LLM calls take seconds; humans keep acting meanwhile);
3. re-acquire the lock; if that decision is no longer pending (a trade was
   cancelled, a snapshot was loaded...) discard the answer and loop;
4. check the answer (an action type offered for that decision,
   ``validate_action``, per-turn runaway caps); on exception, timeout or an
   illegal answer use ``HeuristicAgent`` for this one decision and record the
   fallback (log + ``RoomRuntime.fallback_count``, visible at
   ``GET /room/{code}/debug``);
5. ``apply_action`` and publish (same code path as human actions).

It stops when no agent decision is pending (a human must act, or the game is
over); any mutation calls ``kick()`` to restart it.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from agents.base import build_context
from agents.heuristic import HeuristicAgent
from agents.scripted import default_action
from app_state import session_manager
from broadcast import (
    broadcast_game_state,
    flow_decision,
    publish_events,
    send_prompts,
)
from config import get_settings
from game.decisions import (
    TRADE_RESPONSE,
    Decision,
    apply_action,
    pending_decisions,
    validate_action,
)
from game.game import GamePhase
from protocol import to_action, validate_websocket_message

logger = logging.getLogger(__name__)


@dataclass
class RoomRuntime:
    """Driver state for one room (lives on ``GameRoom.runtime``)."""

    loop: Any
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    task: asyncio.Task | None = None
    version: int = 0  # bumped on every successful mutation
    thinking: dict | None = None  # awaiting override while an agent decides
    fallback_count: int = 0
    fallbacks: deque = field(default_factory=lambda: deque(maxlen=50))  # recent
    fallback_kinds: dict = field(default_factory=dict)  # category -> count
    agent_actions: int = 0
    # (turn number, player_id) -> {"actions": n, "proposals": n}
    turn_counts: dict = field(default_factory=dict)
    stalled: str | None = None
    heuristic: dict = field(default_factory=dict)  # player_id -> HeuristicAgent

    def debug(self) -> dict:
        return {
            "driver_running": bool(self.task and not self.task.done()),
            "version": self.version,
            "awaiting_agent": self.thinking,
            "agent_actions": self.agent_actions,
            "fallback_count": self.fallback_count,
            "fallback_kinds": dict(self.fallback_kinds),
            "fallbacks": list(self.fallbacks),
            "stalled": self.stalled,
        }


def get_runtime(room) -> RoomRuntime:
    """The room's runtime, (re)created for the running event loop."""
    loop = asyncio.get_running_loop()
    rt = room.runtime
    if rt is None or rt.loop is not loop:
        old = rt
        rt = RoomRuntime(loop=loop)
        if old is not None:  # keep counters across a loop change (tests)
            rt.fallback_count = old.fallback_count
            rt.fallbacks = old.fallbacks
            rt.fallback_kinds = old.fallback_kinds
            rt.agent_actions = old.agent_actions
        room.runtime = rt
    return rt


def test_mode() -> bool:
    return os.environ.get("ACQUIRE_TEST_MODE") == "1"


def _timeout_for(agent) -> float:
    override = getattr(agent, "decision_timeout", None)
    if isinstance(override, (int, float)) and override > 0:
        return float(override)
    s = get_settings()
    kind = getattr(agent, "kind", "bot")
    if kind == "llm":
        return s.llm_decision_timeout
    if kind == "scripted":
        return s.scripted_decision_timeout
    return s.bot_decision_timeout


def _pacing_delay() -> float:
    return 0.0 if test_mode() else max(0.0, get_settings().agent_action_delay)


# ---------------------------------------------------------------------------
# Applying (shared by humans and agents; caller holds the room lock)
# ---------------------------------------------------------------------------


async def apply_and_publish(room_code: str, player_id: str, action: dict) -> dict:
    """``apply_action`` + notifications + state broadcast. Caller holds the lock."""
    room = session_manager.get_room(room_code)
    game = room.game
    before = flow_decision(game)
    since = len(game.events)
    result = apply_action(game, player_id, action)
    if not result.get("success"):
        return result
    rt = get_runtime(room)
    rt.version += 1
    await publish_events(room_code, game, since)
    after = flow_decision(game)
    if after is not None and after != before:
        await send_prompts(room_code, game, after)
    await broadcast_game_state(room_code)
    return result


async def human_action(room_code: str, player_id: str, data: Any) -> dict:
    """Run one action sent by a human client (WebSocket or HTTP).

    Returns the engine result dict (``success``/``error``...). Errors are also
    sent to the player as ``{"type": "error"}``. Actions for rooms that do not
    exist or have not started are ignored (``ignored: True``, nothing sent).

    Human wire-protocol convenience (pre-dates the seat contract and the
    frontend relies on it): a successful ``buy_stocks`` from a human also ends
    their turn, as a second ``apply_action(end_turn)``. Explicit ``end_turn``
    is accepted too. Agent seats always send ``end_turn`` themselves.
    """
    room = session_manager.get_room(room_code)
    if room is None or not room.started or room.game is None:
        return {"success": False, "error": "Game not started", "ignored": True}

    if not isinstance(data, dict):
        data = {}
    validated, error = validate_websocket_message(data)
    if error is None:
        seat = room.players.get(player_id)
        if seat is not None and seat.is_agent:
            error = "This seat is played by an AI agent"
    if error is not None:
        await _send_error(room_code, player_id, error)
        return {"success": False, "error": error}

    action = to_action(validated)
    rt = get_runtime(room)
    async with rt.lock:
        game = room.game
        result = await apply_and_publish(room_code, player_id, action)
        if (
            result.get("success")
            and action["action"] == "buy_stocks"
            and room.game is game
            and game.phase == GamePhase.BUYING_STOCKS
            and game.get_current_player_id() == player_id
        ):
            end = await apply_and_publish(room_code, player_id, {"action": "end_turn"})
            if not end.get("success"):
                result = end
    if not result.get("success"):
        await _send_error(room_code, player_id, result.get("error") or "Unknown error")
    kick(room_code)
    return result


async def _send_error(room_code: str, player_id: str, message: str) -> None:
    await session_manager.send_to_player(
        room_code, player_id, {"type": "error", "message": message}
    )


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def kick(room_code: str) -> None:
    """Make sure the room's driver runs if an agent seat has a decision."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return
    if not any(p.is_agent for p in room.players.values()):
        return
    rt = get_runtime(room)
    if rt.task is None or rt.task.done():
        rt.task = asyncio.get_running_loop().create_task(_drive(room_code))


async def wait_idle(room_code: str, timeout: float = 30.0) -> None:
    """Wait for the room's driver to stop (tests / debugging)."""
    room = session_manager.get_room(room_code)
    if room is None or room.runtime is None or room.runtime.task is None:
        return
    await asyncio.wait_for(asyncio.shield(room.runtime.task), timeout)


def _pick(room, game) -> Decision | None:
    decisions = pending_decisions(game)
    if not decisions:
        return None

    def agent_seat(pid: str) -> bool:
        seat = room.players.get(pid)
        return seat is not None and seat.is_agent and seat.agent is not None

    for d in decisions[1:]:
        if d.kind == TRADE_RESPONSE and agent_seat(d.player_id):
            return d
    if agent_seat(decisions[0].player_id):
        return decisions[0]
    return None


def _turn_key(game, player_id: str) -> tuple:
    turns = sum(1 for e in game.events if e["type"] == "turn_ended")
    return (turns, player_id)


def _heuristic_for(rt: RoomRuntime, room, player_id: str) -> HeuristicAgent:
    agent = rt.heuristic.get(player_id)
    if agent is None:
        seat = room.players.get(player_id)
        agent = HeuristicAgent(name=f"fallback:{seat.name if seat else player_id}")
        rt.heuristic[player_id] = agent
    return agent


def _check(game, decision: Decision, ctx, action: Any, counts: dict) -> str | None:
    """Why ``action`` cannot be applied for ``decision`` (None if it can)."""
    if not isinstance(action, dict):
        return f"answer is not an action object: {action!r}"[:200]
    if action.get("action") not in ctx.legal.get("action_types", []):
        return f"action {action.get('action')!r} not offered for {decision.kind}"
    s = get_settings()
    if counts["actions"] >= s.max_agent_actions_per_turn:
        return "per-turn action cap reached"
    if (
        action.get("action") == "propose_trade"
        and counts["proposals"] >= s.max_trade_proposals_per_turn
    ):
        return "per-turn trade proposal cap reached"
    return validate_action(game, decision.player_id, action)


async def _drive(room_code: str) -> None:
    try:
        await _drive_loop(room_code)
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001 - never kill the server; log and stop
        logger.exception("Seat driver crashed in room %s", room_code)
        room = session_manager.get_room(room_code)
        if room is not None and room.runtime is not None:
            room.runtime.stalled = "driver crashed (see log)"
            room.runtime.thinking = None


async def _drive_loop(room_code: str) -> None:
    while True:
        room = session_manager.get_room(room_code)
        if room is None or room.game is None:
            return
        rt = get_runtime(room)

        # 1. pick a decision and publish `awaiting`
        async with rt.lock:
            game = room.game
            decision = _pick(room, game)
            if decision is None:
                if rt.thinking is not None:
                    rt.thinking = None
                    await broadcast_game_state(room_code)
                return
            seat = room.players[decision.player_id]
            agent = seat.agent
            ctx = build_context(game, decision)
            rt.thinking = {
                "player_id": decision.player_id,
                "kind": seat.kind,
                "decision": decision.kind,
            }
            await broadcast_game_state(room_code)

        # 2. ask the agent without holding the lock
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

        # 3. re-check and apply
        async with rt.lock:
            rt.thinking = None
            if room.game is not game or session_manager.get_room(room_code) is not room:
                continue
            if decision not in pending_decisions(game):
                await broadcast_game_state(room_code)  # clears `awaiting`
                continue
            key = _turn_key(game, decision.player_id)
            counts = rt.turn_counts.setdefault(key, {"actions": 0, "proposals": 0})
            if failure is None:
                failure = _check(game, decision, ctx, action, counts)
            if failure is not None:
                action = _fallback(rt, room, game, decision, seat, agent, failure)
                if action is None:
                    rt.stalled = f"no legal fallback for {decision.kind}"
                    logger.error("Room %s: %s", room_code, rt.stalled)
                    await broadcast_game_state(room_code)
                    return
            result = await apply_and_publish(room_code, decision.player_id, action)
            if not result.get("success"):
                # validated but the engine refused: engine/validator mismatch
                logger.error(
                    "Room %s: engine rejected validated action %r: %s",
                    room_code,
                    action,
                    result.get("error"),
                )
                action = _fallback(
                    rt, room, game, decision, seat, agent, f"engine: {result.get('error')}"
                )
                result = (
                    await apply_and_publish(room_code, decision.player_id, action)
                    if action is not None
                    else {"success": False}
                )
                if not result.get("success"):
                    rt.stalled = f"engine rejected every answer for {decision.kind}"
                    await broadcast_game_state(room_code)
                    return
            rt.agent_actions += 1
            counts["actions"] += 1
            if action.get("action") == "propose_trade":
                counts["proposals"] += 1
            if len(rt.turn_counts) > 64:
                for k in list(rt.turn_counts)[:-16]:
                    del rt.turn_counts[k]

        delay = _pacing_delay()
        if delay:
            await asyncio.sleep(delay)
        else:
            await asyncio.sleep(0)  # let humans' handlers in between actions


def _category(reason: str) -> str:
    if reason.startswith("timeout"):
        return "timeout"
    if "cap reached" in reason:
        return "cap"
    if reason.startswith("engine:"):
        return "engine"
    if reason.startswith("error:"):
        return "error"
    return "illegal"


def _fallback(rt, room, game, decision, seat, agent, reason: str) -> dict | None:
    """Heuristic answer for one decision; records the fallback."""
    rt.fallback_count += 1
    category = _category(reason)
    rt.fallback_kinds[category] = rt.fallback_kinds.get(category, 0) + 1
    rt.fallbacks.append(
        {
            "player_id": decision.player_id,
            "seat_kind": seat.kind,
            "decision": decision.kind,
            "reason": reason,
            "category": category,
            "at": time.time(),
        }
    )
    logger.warning(
        "Room %s: %s seat %s fell back to heuristic for %s: %s",
        room.room_code,
        seat.kind,
        seat.name,
        decision.kind,
        reason,
    )
    note = getattr(agent, "note_fallback", None)
    if callable(note):
        try:
            note(reason)
        except Exception:  # noqa: BLE001
            logger.exception("note_fallback failed")
    ctx = build_context(game, decision)
    for candidate in (
        _heuristic_for(rt, room, decision.player_id).choose(ctx),
        default_action(ctx),
    ):
        if (
            candidate.get("action") in ctx.legal.get("action_types", [])
            and validate_action(game, decision.player_id, candidate) is None
        ):
            return candidate
    return None


# ---------------------------------------------------------------------------
# Non-seat mutations (host / lobby operations) under the same lock
# ---------------------------------------------------------------------------


async def run_locked(room_code: str, fn) -> Any:
    """Run ``fn(room)`` (may be async) under the room lock, then publish any
    events it produced and broadcast the state. Used for host-forced end of
    game and snapshot loads."""
    room = session_manager.get_room(room_code)
    if room is None:
        return None
    rt = get_runtime(room)
    async with rt.lock:
        since = len(room.game.events) if room.game is not None else 0
        old_game = room.game
        out = fn(room)
        if asyncio.iscoroutine(out):
            out = await out
        rt.version += 1
        game = room.game
        if game is not None:
            if game is old_game:
                await publish_events(room_code, game, since)
            await send_prompts(room_code, game, flow_decision(game))
            await broadcast_game_state(room_code)
    kick(room_code)
    return out
