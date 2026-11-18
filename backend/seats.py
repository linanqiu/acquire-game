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
   ``GET /room/{code}/debug``). An agent that accepts rejections (LLM seats)
   is first told why its answer was illegal and asked again, within its retry
   and time budget; only then, or on timeout / provider error, the bot decides
   and an ``agent_fallback`` message goes to the table (LLM seats);
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

from agents.base import accepts_rejections, build_context
from agents.driving import (
    SOURCE_FOR_KIND,
    category,
    check_answer,
    describe_fallback,
    fallback_action,
    llm_record,
    timeout_for,
)
import chat
from agents.heuristic import HeuristicAgent
from app_state import session_manager
from broadcast import (
    broadcast_agent_fallback,
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
    legal_actions,
    pending_decisions,
    validate_action,
)
from game.game import GamePhase
from protocol import to_action, validate_websocket_message
from transcripts.writer import TranscriptWriter

logger = logging.getLogger(__name__)
llm_logger = logging.getLogger("llm")


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
    # player_id -> {count, last_reason}; surfaced in game_state (``fallbacks``)
    seat_fallbacks: dict = field(default_factory=dict)
    agent_actions: int = 0
    # (turn number, player_id) -> {"actions": n, "proposals": n}
    turn_counts: dict = field(default_factory=dict)
    stalled: str | None = None
    heuristic: dict = field(default_factory=dict)  # player_id -> HeuristicAgent
    # Pacing: the next agent move is not applied before this (time.monotonic()).
    paced_until: float = 0.0

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
            rt.seat_fallbacks = old.seat_fallbacks
            rt.agent_actions = old.agent_actions
        room.runtime = rt
    return rt


def test_mode() -> bool:
    return os.environ.get("GAME_TEST_MODE") == "1"


# The pure driver rules live in agents/driving.py (shared with bench/).
_timeout_for = timeout_for
_category = category


def _check(game, decision: Decision, ctx, action: Any, counts: dict) -> str | None:
    # validate_action looked up here at call time (tests patch seats.validate_action)
    return check_answer(game, decision, ctx, action, counts, validate=validate_action)


def _pacing_delay(same_seat: bool = False) -> float:
    """Minimum gap after an agent move before the next agent move is applied:
    short while the same seat goes on with its turn, longer when the game
    moves to another seat (so each seat's turn reads as one quick sequence)."""
    s = get_settings()
    if test_mode():
        delay = s.test_mode_agent_action_delay
    elif same_seat:
        delay = s.agent_step_delay
    else:
        delay = s.agent_action_delay
    return max(0.0, delay)


# ---------------------------------------------------------------------------
# Applying (shared by humans and agents; caller holds the room lock)
# ---------------------------------------------------------------------------


async def apply_and_publish(
    room_code: str, player_id: str, action: dict, record: dict | None = None
) -> dict:
    """``apply_action`` + transcript + notifications + state broadcast.

    The one place every action of every seat is applied (caller holds the
    lock). ``record`` describes the decision for the transcript (``source``,
    ``kind``, ``legal``, ``fallback``, ``latency_s``, ``llm``); without it the
    action is a human's and kind/legal are derived from the pending decisions.
    """
    room = session_manager.get_room(room_code)
    game = room.game
    before = flow_decision(game)
    since = len(game.events)
    writer = room.transcript
    if writer is not None and (writer.game is not game or writer.closed):
        writer = None
    info = dict(record or {})
    if writer is not None and ("kind" not in info or "legal" not in info):
        kind, legal = _decision_info(game, player_id, action)
        info.setdefault("kind", kind)
        info.setdefault("legal", legal)
    top_before = chat.top_holders(game)
    result = apply_action(game, player_id, action)
    if not result.get("success"):
        if (
            isinstance(action, dict)
            and action.get("action") == "accept_trade"
            and str(result.get("error", "")).startswith("Trade is no longer valid")
        ):
            # The offer can never be accepted now. Its recipient tried to
            # accept, so the only remaining legal answer is a rejection:
            # apply it so the stale offer leaves both players' lists (both
            # parties and the host get `trade_rejected` + fresh state). The
            # original error is still returned to the caller.
            await apply_and_publish(
                room_code,
                player_id,
                {"action": "reject_trade", "trade_id": action.get("trade_id")},
                {"source": info.get("source", "human")},
            )
        return result
    rt = get_runtime(room)
    rt.version += 1
    if writer is not None:
        # before publishing, so `game_over` arrives with the transcript final
        writer.record_decision(
            player_id=player_id,
            kind=info.get("kind") or "out_of_turn",
            legal=info.get("legal"),
            action=action,
            source=info.get("source") or "human",
            after_seq=since - 1,
            fallback=info.get("fallback"),
            latency_s=info.get("latency_s"),
            llm=info.get("llm"),
        )
    # Table talk (never part of the game): a move resets the AI streak and
    # gives the seats its notable events concern a chance to speak; an LLM
    # seat's `say` is posted with its move.
    chat.on_action(room_code, room, game, since, top_before, player_id)
    await _post_say(room_code, room, player_id, info)
    if writer is not None and game.phase == GamePhase.GAME_OVER:
        # before publishing, so `game_over` arrives with the transcript final
        # (unless talk calls are in flight: then once they are done)
        chat.close_when_quiet(room)
    await publish_events(room_code, game, since)
    after = flow_decision(game)
    if after is not None and after != before:
        await send_prompts(room_code, game, after)
    await broadcast_game_state(room_code)
    return result


def _decision_info(game, player_id: str, action: Any) -> tuple[str, dict | None]:
    """Decision kind and legal options a human action answers (transcripts).

    Out-of-turn actions that answer no pending decision (``propose_trade``
    or ``cancel_trade`` while someone else decides) get kind ``out_of_turn``.
    """
    atype = action.get("action") if isinstance(action, dict) else None
    for d in pending_decisions(game):
        if d.player_id != player_id:
            continue
        if d.kind == TRADE_RESPONSE:
            trade = (d.context or {}).get("trade") or {}
            if atype not in ("accept_trade", "reject_trade") or trade.get(
                "trade_id"
            ) != action.get("trade_id"):
                continue
        legal = legal_actions(game, d)
        if atype in legal.get("action_types", []):
            return d.kind, legal
    return "out_of_turn", None


def seat_descriptions(room) -> list[dict]:
    """Transcript header seats, in ``Game.add_player`` (room) order."""
    out = []
    for pid, seat in room.players.items():
        agent = seat.agent
        provider = getattr(agent, "provider", None)
        out.append(
            {
                "player_id": pid,
                "name": seat.name,
                "kind": seat.kind,
                "agent_id": seat.agent_id,
                "agent_label": seat.agent_label,
                "model": getattr(provider, "model", None)
                or getattr(agent, "model", None),
                "is_bot": seat.is_agent,
            }
        )
    return out


def _system_prompts(room) -> tuple[str | None, dict]:
    """``(prompt_version, {id: text})`` for the header (text only with LLM seats)."""
    try:
        from agents.llm.prompt import build_system_prompt, prompt_version
        from agents.llm.prompt import system_prompt_id as sp_id
    except ImportError:  # pragma: no cover
        return None, {}
    rs = room.game.ruleset if room.game is not None else None
    version = prompt_version(rs)
    if not any(seat.kind == "llm" for seat in room.players.values()):
        return version, {}
    text = build_system_prompt(rs)
    return version, {sp_id(text, rs): text}


def open_transcript(room, *, loaded_from_snapshot: bool = False) -> None:
    """Start the transcript of ``room.game`` (caller holds the lock) and give
    the game its ``game_id``. A previous unfinished transcript of the room is
    closed as ``abandoned``. Transcripts disabled -> ``game_id`` only."""
    from transcripts.paths import new_game_id

    old = room.transcript
    if old is not None and not old.closed:
        old.close("abandoned", detail="replaced by a new game in the room")
    room.transcript = None
    room.game_id = new_game_id()
    if room.game is None:
        return
    version, prompts = _system_prompts(room)
    room.transcript = TranscriptWriter.open(
        room.game,
        seats=seat_descriptions(room),
        source="live",
        game_id=room.game_id,
        room_code=room.room_code,
        prompt_version=version,
        system_prompts=prompts,
        loaded_from_snapshot=loaded_from_snapshot,
        prices=_prices(),
    )
    chat.write_lobby_chat(room)


_PRICES: list = []


def _prices():
    """The bench price table (for ``cost_usd`` in footers), loaded once."""
    if not _PRICES:
        try:
            from bench.prices import PriceTable

            _PRICES.append(PriceTable.load())
        except Exception:  # noqa: BLE001 - costs are optional
            _PRICES.append(None)
    return _PRICES[0]


def _sync_transcript(room, game) -> None:
    """After a non-seat mutation (host forced end...): write its events."""
    writer = room.transcript
    if writer is None or writer.closed or writer.game is not game:
        return
    writer.sync()
    if game.phase == GamePhase.GAME_OVER:
        writer.close_from_game()


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
    validated, error = validate_websocket_message(data, room.game.ruleset)
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


async def _drive(room_code: str) -> None:
    try:
        await _drive_loop(room_code)
    except asyncio.CancelledError:
        raise
    except Exception:
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
            if seat.kind == "llm":
                ctx.chat = chat.prompt_messages(room)
            rt.thinking = {
                "player_id": decision.player_id,
                "kind": seat.kind,
                "decision": decision.kind,
            }
            await broadcast_game_state(room_code)

        # 2. ask the agent without holding the lock; an illegal answer is sent
        #    back to agents that accept rejections (retry budget and time
        #    budget are shared by every attempt at this decision)
        started = time.monotonic()
        deadline = started + _timeout_for(agent)
        retry_ok = accepts_rejections(agent)
        max_rejections = 1 + max(0, int(getattr(agent, "max_illegal_retries", 0)))
        rejected: list[dict] = []
        superseded = False
        while True:
            action: Any = None
            failure: str | None = None
            reason: str | None = None
            attempts = len(rejected) + 1
            remaining = deadline - time.monotonic()
            try:
                if remaining <= 0:
                    raise asyncio.TimeoutError
                kwargs = (
                    {"rejected": list(rejected), "deadline": deadline}
                    if retry_ok and rejected
                    else ({"deadline": deadline} if retry_ok else {})
                )
                action = await asyncio.wait_for(agent.decide(ctx, **kwargs), remaining)
            except asyncio.TimeoutError:
                reason = "timeout"
                failure = f"timeout after {time.monotonic() - started:.1f}s"
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - any agent failure falls back
                reason = getattr(e, "reason", None) or "error"
                attempts = max(attempts, int(getattr(e, "attempts", 0) or 0))
                if reason == "timeout":
                    failure = f"timeout after {time.monotonic() - started:.1f}s"
                elif reason == "illegal":
                    failure = f"illegal: {e}"[:300]
                elif reason == "script":  # strict scripted seat (tests)
                    failure = f"script: {e}"[:300]
                else:
                    failure = f"error: {type(e).__name__}: {e}"[:300]

            # Pacing: keep the previous agent move on screen for a moment. The
            # agent already decided meanwhile, so a slow seat waits no longer.
            wait = rt.paced_until - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)

            # 3. re-check and apply
            async with rt.lock:
                if (
                    room.game is not game
                    or session_manager.get_room(room_code) is not room
                ):
                    rt.thinking = None
                    superseded = True
                    break
                if decision not in pending_decisions(game):
                    rt.thinking = None
                    await broadcast_game_state(room_code)  # clears `awaiting`
                    superseded = True
                    break
                key = _turn_key(game, decision.player_id)
                counts = rt.turn_counts.setdefault(key, {"actions": 0, "proposals": 0})
                if failure is None:
                    failure = _check(game, decision, ctx, action, counts)
                    if failure is not None:
                        reason = _category(failure)
                        if (
                            reason == "illegal"
                            and retry_ok
                            and len(rejected) + 1 < max_rejections
                        ):
                            # not a fallback yet: tell the agent and ask again
                            rejected.append({"action": action, "error": failure})
                            continue
                        attempts = len(rejected) + 1
                rt.thinking = None
                fb = None
                record = {
                    "kind": decision.kind,
                    "legal": ctx.legal,
                    "source": SOURCE_FOR_KIND.get(seat.kind, seat.kind),
                    "latency_s": time.monotonic() - started,
                }
                if failure is not None:
                    action = _fallback(rt, room, game, decision, seat, agent, failure)
                    fb = _announcement(
                        room, seat, decision, reason or "error", attempts, started
                    )
                    if action is None:
                        rt.stalled = f"no legal fallback for {decision.kind}"
                        logger.error("Room %s: %s", room_code, rt.stalled)
                        await broadcast_game_state(room_code)
                        return
                    await _announce(room_code, rt, seat, fb)
                    record["source"] = "fallback"
                    record["fallback"] = {
                        "reason": fb["reason"],
                        "message": fb["message"],
                        "detail": failure,
                    }
                record["llm"] = llm_record(agent, ctx)
                result = await apply_and_publish(
                    room_code, decision.player_id, action, record
                )
                if not result.get("success"):
                    # validated but the engine refused: engine/validator mismatch
                    logger.error(
                        "Room %s: engine rejected validated action %r: %s",
                        room_code,
                        action,
                        result.get("error"),
                    )
                    action = _fallback(
                        rt,
                        room,
                        game,
                        decision,
                        seat,
                        agent,
                        f"engine: {result.get('error')}",
                    )
                    if action is not None:
                        await _announce(
                            room_code,
                            rt,
                            seat,
                            _announcement(
                                room, seat, decision, "illegal", attempts, started
                            ),
                        )
                    if action is not None:
                        record["source"] = "fallback"
                        record["fallback"] = {
                            "reason": "illegal",
                            "message": "the engine refused a validated answer; "
                            "the rules-based player made this move",
                            "detail": f"engine: {result.get('error')}",
                        }
                        record["llm"] = llm_record(agent, ctx)
                    result = (
                        await apply_and_publish(
                            room_code, decision.player_id, action, record
                        )
                        if action is not None
                        else {"success": False}
                    )
                    if not result.get("success"):
                        rt.stalled = f"engine rejected every answer for {decision.kind}"
                        await broadcast_game_state(room_code)
                        return
                after = flow_decision(game)
                rt.paced_until = time.monotonic() + _pacing_delay(
                    after is not None and after.player_id == decision.player_id
                )
                rt.agent_actions += 1
                counts["actions"] += 1
                if action.get("action") == "propose_trade":
                    counts["proposals"] += 1
                if len(rt.turn_counts) > 64:
                    for k in list(rt.turn_counts)[:-16]:
                        del rt.turn_counts[k]
                break
        if superseded:
            continue

        await asyncio.sleep(0)  # let humans' handlers in between actions


async def _post_say(room_code: str, room, player_id: str, record: dict) -> None:
    """Post the ``say`` an LLM seat attached to the move just applied (table
    talk; never when the rules-based player made the move)."""
    if record.get("source") != "llm":
        return
    say = (record.get("llm") or {}).get("say")
    if not isinstance(say, str) or not say.strip():
        return
    writer = room.transcript
    index = writer.decisions - 1 if writer is not None and writer.decisions else None
    try:
        await chat.post_message(
            room_code, player_id, say, source="say", decision_index=index
        )
    except chat.ChatError as exc:
        logger.info("Room %s: say of %s dropped: %s", room_code, player_id, exc)


def _announcement(room, seat, decision, reason: str, attempts: int, started) -> dict:
    """The ``agent_fallback`` message for a fallback of an LLM seat."""
    label = seat.agent_label or seat.name
    elapsed = time.monotonic() - started
    return {
        "player_id": seat.player_id,
        "player_name": seat.name,
        "agent_label": label,
        "reason": reason,
        "decision": decision.kind,
        "message": describe_fallback(label, reason, attempts, elapsed),
    }


async def _announce(room_code: str, rt, seat, info: dict) -> None:
    """Record the per-seat fallback and (LLM seats only) tell the table."""
    rec = rt.seat_fallbacks.setdefault(
        seat.player_id, {"count": 0, "last_reason": None}
    )
    rec["count"] += 1
    rec["last_reason"] = info["reason"]
    if seat.kind != "llm":
        return
    llm_logger.warning(
        "fallback agent=%s seat=%s decision=%s reason=%s: %s",
        seat.agent_id,
        seat.name,
        info["decision"],
        info["reason"],
        info["message"],
    )
    await broadcast_agent_fallback(room_code, **info)


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
        except Exception:
            logger.exception("note_fallback failed")
    ctx = build_context(game, decision)
    return fallback_action(
        game,
        decision,
        ctx,
        _heuristic_for(rt, room, decision.player_id),
        validate=validate_action,
    )


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
                _sync_transcript(room, game)
                await publish_events(room_code, game, since)
            await send_prompts(room_code, game, flow_decision(game))
            await broadcast_game_state(room_code)
    kick(room_code)
    return out
