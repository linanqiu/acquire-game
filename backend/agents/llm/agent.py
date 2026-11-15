"""``LLMAgent``: a Buyout seat backed by a language model.

An illegal or unparseable answer is sent back to the model (its answer, the
exact reason, every earlier rejected answer, the legal options restated) up to
``max_illegal_retries`` times, all within the decision's time budget. The agent
only returns an action dict; it holds no game reference and never mutates
state. On provider failure, timeout or an exhausted retry budget it raises
``AgentDecisionError`` (with a ``reason``); the server's driver catches that and
lets the rules-based bot take that one decision.
"""

from __future__ import annotations

import asyncio
import copy
import json
import time
from collections import deque
from dataclasses import replace
from functools import lru_cache
from typing import Any

from agents.llm.decision_log import DecisionLog
from agents.llm.errors import AgentDecisionError, ProviderError
from game.ruleset import Ruleset, ruleset_from_state
from agents.llm.prompt import (
    PromptBudget,
    build_system_prompt,
    build_user_prompt,
    system_prompt_id,
)
from agents.llm.providers import Provider, ProviderResult
from agents.llm.schema import (
    NOTE_MAX_CHARS,
    build_schema,
    check_against_legal,
    parse_answer,
)


@lru_cache(maxsize=16)
def _cached_system_prompt(fingerprint: str, ruleset: Ruleset) -> str:
    return build_system_prompt(ruleset)


def _system_prompt(rs: Ruleset) -> str:
    """The system prompt for ``rs``, cached per ruleset fingerprint."""
    return _cached_system_prompt(rs.fingerprint, rs)


DEFAULT_TIMEOUT_S = 45.0
DEFAULT_MAX_TOKENS = 6000
DEFAULT_MAX_ILLEGAL_RETRIES = 4


class LLMAgent:
    kind = "llm"
    # The driver may pass ``rejected=`` / ``deadline=`` to ``decide``.
    accepts_rejections = True

    def __init__(
        self,
        provider: Provider,
        *,
        name: str = "LLM",
        agent_id: str = "llm",
        timeout: float = DEFAULT_TIMEOUT_S,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        max_proposals_per_turn: int = 1,
        notes_limit: int = 6,
        timeout_grace: float = 2.0,
        max_illegal_retries: int = DEFAULT_MAX_ILLEGAL_RETRIES,
        decision_budget: float | None = None,
        budget: PromptBudget | None = None,
        log: DecisionLog | None = None,
    ):
        self.provider = provider
        self.name = name
        self.agent_id = agent_id
        self.timeout = timeout
        self.max_tokens = max_tokens
        self.max_proposals_per_turn = max_proposals_per_turn
        self.timeout_grace = timeout_grace
        self.max_illegal_retries = max_illegal_retries
        # Overall seconds per decision when the caller passes no ``deadline``.
        self.decision_budget = decision_budget
        self._history: list[dict] = []  # rejected answers of the current decision
        self.budget = budget or PromptBudget()
        self.notes: deque[str] = deque(maxlen=notes_limit)
        self.log = log or DecisionLog(agent_id, getattr(provider, "model", ""))
        self._proposals: dict[Any, int] = {}
        # Structured record of the current/last decision (transcripts); see
        # ``last_decision_record``.
        self._record: dict | None = None
        self._record_ctx: Any = None

    # ------------------------------------------------------------------ API

    def last_decision_record(self, ctx: Any = None) -> dict | None:
        """Everything about the latest decision, for transcripts.

        ``{"model", "system_prompt_id", "system_prompt", "user_prompt",
        "attempts": [{"raw", "parsed", "error", "latency_s", "input_tokens",
        "output_tokens", "cache_read_tokens", "cache_write_tokens",
        "retry_prompt"}], "why", "note", "outcome": "answered"|"failed"|None,
        "error"}``. Attempts span every ``decide`` call for the same decision
        (the driver's ``rejected=`` re-asks included): an answer the engine
        refused gets the engine's error, an answer cut off by a timeout keeps
        ``raw: None``. With ``ctx`` given, returns None unless the record is
        for that same context object (guards against a stale record). The
        result is a copy.
        """
        rec = self._record
        if rec is None or (ctx is not None and self._record_ctx is not ctx):
            return None
        out = dict(rec)
        out["attempts"] = [dict(a) for a in rec["attempts"]]
        return out

    def recent_decisions(self, n: int = 20) -> list[dict]:
        return self.log.recent(n)

    @property
    def totals(self) -> dict:
        return dict(self.log.totals)

    def note_fallback(self, reason: str = "") -> None:
        """Called by the driver when it replaced this agent's answer."""
        self.log.annotate_last(fallback=True, fallback_reason=reason)
        rec = self._record
        if rec is not None:
            rec["fallback_reason"] = reason
            if rec["attempts"] and rec["attempts"][-1]["error"] is None:
                # the answer looked legal to the agent; the driver refused it
                rec["attempts"][-1]["error"] = reason

    async def decide(
        self,
        ctx,
        rejected: list[dict] | None = None,
        *,
        deadline: float | None = None,
    ) -> dict:
        """One legal action for ``ctx``.

        Total model answers per decision: 1 + ``max_illegal_retries``.

        ``rejected`` is how the driver says "the engine refused your last
        answer": ``[{"action": ..., "error": ...}, ...]``, oldest first. Each
        entry counts as a used attempt, and this agent's own earlier
        structurally-rejected answers for the same decision are remembered and
        listed too. A call without ``rejected`` starts a new decision.
        ``deadline`` is a ``time.monotonic()`` instant: no model call starts
        after it, and the call in flight is capped to the time left.
        """
        kind = ctx.decision.kind
        legal = self._effective_legal(ctx)
        view = self._trade_view(ctx)
        others = tuple(p for p in (view or {}).get("players", {}) if p != ctx.player_id)
        engine_rejected = [dict(r) for r in (rejected or [])]
        if not engine_rejected:
            self._history = []
        history = self._history
        if deadline is None and self.decision_budget:
            deadline = time.monotonic() + self.decision_budget
        rs = ruleset_from_state(ctx.state)
        system = _system_prompt(rs)
        user = build_user_prompt(
            replace(ctx, legal=legal), list(self.notes), budget=self.budget
        )
        rec = self._start_record(ctx, system, user, engine_rejected, rs)
        try:
            schema = build_schema(
                legal,
                other_player_ids=others,
                chains=rs.chain_ids,
                max_shares=rs.stocks_per_chain,
            )
        except ValueError as exc:
            self._log_failure(ctx, 0, "", "", [], f"no answerable action: {exc}", 0.0)
            rec["outcome"], rec["error"] = "failed", f"no answerable action: {exc}"
            raise AgentDecisionError(str(exc)) from exc

        t0 = time.monotonic()
        results: list[ProviderResult] = []
        raws: list[str] = []
        attempts: list[dict] = []
        max_answers = 1 + max(0, self.max_illegal_retries)
        action = note = why = None
        prompt = user

        def used() -> int:
            return len(history) + len(engine_rejected) + len(attempts)

        def fail(message: str, reason: str) -> AgentDecisionError:
            rec["outcome"], rec["error"] = "failed", message
            self._log_failure(
                ctx,
                len(raws),
                system,
                user,
                raws,
                message,
                time.monotonic() - t0,
                results,
                attempts,
            )
            return AgentDecisionError(message, reason=reason, attempts=used())

        while True:
            earlier = [
                *history,
                *engine_rejected,
                *({"action": a["action"], "error": a["error"]} for a in attempts),
            ]
            if earlier:
                prompt = self._retry_prompt(user, earlier, legal)
            if used() >= max_answers:
                last = str(earlier[-1]["error"])[:300] if earlier else "no answer"
                raise fail(
                    f"illegal answers: {used()} tries, the last was rejected: {last}",
                    "illegal",
                )
            call_timeout = None
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise fail(
                        f"decision time budget exhausted after {used()} tries",
                        "timeout",
                    )
                call_timeout = min(self.timeout, remaining)
            t_call = time.monotonic()
            # Recorded before the call so an attempt cut off by the decision
            # timeout (task cancelled) still shows up in the transcript.
            rec_attempt = {
                "raw": None,
                "parsed": None,
                "error": "no answer (the call was cut off by the decision timeout)",
                "latency_s": None,
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_read_tokens": 0,
                "cache_write_tokens": 0,
                "retry_prompt": prompt if earlier else None,
            }
            rec["attempts"].append(rec_attempt)
            try:
                res = await self._call(system, prompt, schema, call_timeout)
            except ProviderError as exc:
                rec_attempt["error"] = f"provider error: {exc}"
                rec_attempt["latency_s"] = round(time.monotonic() - t_call, 4)
                raise fail(
                    f"provider error: {exc}", "timeout" if exc.timeout else "error"
                ) from exc
            results.append(res)
            raws.append(res.raw)
            action, note, why = parse_answer(res.data)
            error = (
                "the answer has no valid 'action' object"
                if action is None
                else check_against_legal(action, legal, view=view)
            )
            rec_attempt.update(
                raw=res.raw,
                parsed=res.data if isinstance(res.data, dict) else None,
                error=error,
                latency_s=round(time.monotonic() - t_call, 4),
                input_tokens=int(res.input_tokens or 0),
                output_tokens=int(res.output_tokens or 0),
                cache_read_tokens=int(res.cache_read_tokens or 0),
                cache_write_tokens=int(res.cache_write_tokens or 0),
            )
            attempts.append(
                {
                    "n": used() + 1,
                    "action": action if action is not None else res.raw[:300],
                    "error": error,
                    "latency_s": round(time.monotonic() - t_call, 4),
                }
            )
            if error is None:
                break

        rec.update(outcome="answered", why=why, note=note, error=None)
        if note:
            self.notes.append(note[:NOTE_MAX_CHARS])
        if action["action"] == "propose_trade":
            key = self._turn_key(ctx)
            self._proposals[key] = self._proposals.get(key, 0) + 1
        self.log.record(
            decision_kind=kind,
            player_id=ctx.player_id,
            system_chars=len(system),
            user_chars=len(user),
            calls=len(results),
            input_tokens=sum(r.input_tokens for r in results),
            output_tokens=sum(r.output_tokens for r in results),
            cache_read_tokens=sum(r.cache_read_tokens for r in results),
            cache_write_tokens=sum(r.cache_write_tokens for r in results),
            latency_s=round(time.monotonic() - t0, 4),
            action=action,
            why=why,
            note=note,
            repaired=used() > 1,
            attempts=attempts,
            engine_rejections=len(engine_rejected),
            full={"system": system, "user": user, "responses": raws},
        )
        # If the engine refuses this answer, the retry lists these too.
        history.extend(
            {"action": a["action"], "error": a["error"]} for a in attempts if a["error"]
        )
        return action

    # ------------------------------------------------------------ internals

    def _start_record(
        self, ctx, system: str, user: str, engine_rejected, rs: Ruleset
    ) -> dict:
        """Begin (first call) or continue (driver re-ask) the decision record."""
        rec = self._record
        if engine_rejected and rec is not None and self._record_ctx is ctx:
            last = rec["attempts"][-1] if rec["attempts"] else None
            if last is not None and last["error"] is None:
                last["error"] = str(engine_rejected[-1].get("error"))
            rec["outcome"] = None
            return rec
        model = getattr(self.provider, "model", "") or ""
        rec = {
            "model": model,
            "system_prompt_id": system_prompt_id(system, rs),
            "system_prompt": system,
            "user_prompt": user,
            "attempts": [],
            "why": None,
            "note": None,
            "outcome": None,
            "error": None,
        }
        self._record, self._record_ctx = rec, ctx
        return rec

    async def _call(
        self, system: str, user: str, schema: dict, timeout: float | None = None
    ) -> ProviderResult:
        timeout = self.timeout if timeout is None else timeout
        try:
            # Hard ceiling in case a provider ignores its own timeout.
            return await asyncio.wait_for(
                self.provider.complete(
                    system=system,
                    user=user,
                    schema=schema,
                    max_tokens=self.max_tokens,
                    timeout=timeout,
                ),
                timeout=timeout + self.timeout_grace,
            )
        except asyncio.TimeoutError as exc:
            raise ProviderError(
                f"timed out after {timeout:.0f}s", timeout=True
            ) from exc

    @staticmethod
    def _retry_prompt(user: str, earlier: list[dict], legal: dict) -> str:
        lines = [
            "",
            "# Your earlier answers to this decision were REJECTED",
            "Do NOT repeat any of them.",
        ]
        for i, r in enumerate(earlier, 1):
            raw = r["action"]
            if not isinstance(raw, str):
                raw = json.dumps(raw, default=str)
            lines.append(f"Answer {i}: {raw[:600]}")
            lines.append(f"  Rejected because: {r['error']}")
        types = list(legal.get("action_types", []))
        lines += [
            f"Legal action types: {types}",
            (
                "Answer again with ONE JSON object whose action is exactly one of "
                "the legal options listed above, and that avoids every problem "
                "listed here."
            ),
            "",
        ]
        return user + "\n".join(lines)

    def _log_failure(
        self, ctx, calls, system, user, raws, error, latency, results=(), attempts=()
    ) -> None:
        self.log.record(
            decision_kind=ctx.decision.kind,
            player_id=ctx.player_id,
            system_chars=len(system),
            user_chars=len(user),
            calls=max(calls, 1),
            input_tokens=sum(r.input_tokens for r in results),
            output_tokens=sum(r.output_tokens for r in results),
            cache_read_tokens=sum(r.cache_read_tokens for r in results),
            cache_write_tokens=sum(r.cache_write_tokens for r in results),
            latency_s=round(latency, 4),
            action=None,
            why="",
            repaired=calls > 1,
            attempts=list(attempts),
            error=error,
            full={"system": system, "user": user, "responses": list(raws)},
        )

    @staticmethod
    def _turn_key(ctx) -> tuple:
        ended = sum(
            1
            for e in (ctx.events or [])
            if isinstance(e, dict) and e.get("type") == "turn_ended"
        )
        return (
            ended,
            ctx.state.get("tiles_remaining"),
            ctx.state.get("current_player"),
        )

    def _effective_legal(self, ctx) -> dict:
        """The legal dict as shown to the model: ``propose_trade`` is removed
        once this agent has used its per-turn proposal allowance (enforced here,
        not just requested in the prompt) or when nobody can be proposed to."""
        legal = ctx.legal
        types = list(legal.get("action_types", []))
        if "propose_trade" not in types:
            return legal
        used = self._proposals.get(self._turn_key(ctx), 0)
        no_one = len((self._trade_view(ctx) or {}).get("players", {})) < 2
        if used >= self.max_proposals_per_turn or no_one:
            legal = copy.copy(legal)
            legal["action_types"] = [t for t in types if t != "propose_trade"]
        return legal

    @staticmethod
    def _trade_view(ctx) -> dict | None:
        players = (ctx.calc or {}).get("players")
        if not players:
            return None
        return {
            "self_id": ctx.player_id,
            "players": {
                p["player_id"]: {"cash": p.get("cash"), "shares": p.get("shares", {})}
                for p in players
            },
        }

    def __repr__(self) -> str:  # pragma: no cover
        return f"LLMAgent({self.agent_id!r}, name={self.name!r}, model={getattr(self.provider, 'model', '?')!r})"


__all__ = ["AgentDecisionError", "LLMAgent"]
