"""``LLMAgent``: an Acquire seat backed by a language model.

v0 is ONE model call per decision (plus at most one repair call when the first
answer is structurally illegal). The agent only returns an action dict; it holds
no game reference and never mutates state. On provider failure, timeout or a
second illegal answer it raises ``AgentDecisionError``; the server's driver
catches that and falls back to the heuristic agent for that one decision.
"""

from __future__ import annotations

import asyncio
import copy
import time
from collections import deque
from dataclasses import replace
from typing import Any

from agents.llm.decision_log import DecisionLog
from agents.llm.errors import AgentDecisionError, ProviderError
from agents.llm.prompt import PromptBudget, build_system_prompt, build_user_prompt
from agents.llm.providers import Provider, ProviderResult
from agents.llm.schema import (
    NOTE_MAX_CHARS,
    build_schema,
    check_against_legal,
    parse_answer,
)

DEFAULT_TIMEOUT_S = 45.0
DEFAULT_MAX_TOKENS = 6000


class LLMAgent:
    kind = "llm"

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
        self.budget = budget or PromptBudget()
        self.notes: deque[str] = deque(maxlen=notes_limit)
        self.log = log or DecisionLog(agent_id, getattr(provider, "model", ""))
        self._proposals: dict[Any, int] = {}

    # ------------------------------------------------------------------ API

    def recent_decisions(self, n: int = 20) -> list[dict]:
        return self.log.recent(n)

    @property
    def totals(self) -> dict:
        return dict(self.log.totals)

    def note_fallback(self, reason: str = "") -> None:
        """Called by the driver when it replaced this agent's answer."""
        self.log.annotate_last(fallback=True, fallback_reason=reason)

    async def decide(self, ctx) -> dict:
        kind = ctx.decision.kind
        legal = self._effective_legal(ctx)
        view = self._trade_view(ctx)
        others = tuple(p for p in (view or {}).get("players", {}) if p != ctx.player_id)
        try:
            schema = build_schema(legal, other_player_ids=others)
        except ValueError as exc:
            self._log_failure(ctx, 0, "", "", [], f"no answerable action: {exc}", 0.0)
            raise AgentDecisionError(str(exc)) from exc

        system = build_system_prompt()
        user = build_user_prompt(
            replace(ctx, legal=legal), list(self.notes), budget=self.budget
        )

        t0 = time.monotonic()
        results: list[ProviderResult] = []
        raws: list[str] = []
        error: str | None = None
        action = note = why = None
        repaired = False
        prompt = user
        for attempt in (1, 2):
            try:
                res = await self._call(system, prompt, schema)
            except ProviderError as exc:
                self._log_failure(
                    ctx,
                    len(raws),
                    system,
                    user,
                    raws,
                    f"provider error: {exc}",
                    time.monotonic() - t0,
                    results,
                )
                raise AgentDecisionError(f"provider error: {exc}") from exc
            results.append(res)
            raws.append(res.raw)
            action, note, why = parse_answer(res.data)
            error = (
                "the answer has no valid 'action' object"
                if action is None
                else check_against_legal(action, legal, view=view)
            )
            if error is None:
                break
            if attempt == 1:
                repaired = True
                prompt = self._repair_prompt(user, res.raw, error)

        if error is not None:
            self._log_failure(
                ctx,
                len(raws),
                system,
                user,
                raws,
                f"illegal answer after repair: {error}",
                time.monotonic() - t0,
                results,
            )
            raise AgentDecisionError(f"illegal answer after repair: {error}")

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
            repaired=repaired,
            full={"system": system, "user": user, "responses": raws},
        )
        return action

    # ------------------------------------------------------------ internals

    async def _call(self, system: str, user: str, schema: dict) -> ProviderResult:
        try:
            # Hard ceiling in case a provider ignores its own timeout.
            return await asyncio.wait_for(
                self.provider.complete(
                    system=system,
                    user=user,
                    schema=schema,
                    max_tokens=self.max_tokens,
                    timeout=self.timeout,
                ),
                timeout=self.timeout + self.timeout_grace,
            )
        except asyncio.TimeoutError as exc:
            raise ProviderError(
                f"timed out after {self.timeout:.0f}s", timeout=True
            ) from exc

    @staticmethod
    def _repair_prompt(user: str, raw: str, error: str) -> str:
        return (
            user
            + "\n# Your previous answer was REJECTED\n"
            + f"Your answer was:\n{raw[:1500]}\n"
            + f"Problem: {error}\n"
            + "Answer again with ONE JSON object whose action is exactly one of the legal "
            + "options above and fixes this problem.\n"
        )

    def _log_failure(
        self, ctx, calls, system, user, raws, error, latency, results=()
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
