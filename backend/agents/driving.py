"""Pure pieces of the seat driver, shared by the server and the benchmark.

``seats.py`` (server) and ``bench/runner.py`` (headless games) both make every
decision as: ask the agent (per-kind timeout, re-ask after an illegal answer
for agents that accept rejections) -> ``check_answer`` -> heuristic fallback ->
``apply_action``. The functions here hold no room or server state, so the
benchmark can use them without importing the web server (FastAPI, sockets,
the session manager).
"""

from __future__ import annotations

from typing import Any

from config import get_settings
from game.decisions import Decision, validate_action

# Map an internal fallback category to the reason announced to players and
# written to transcripts (``engine`` mismatches are reported as ``illegal``).
PUBLIC_REASON = {
    "timeout": "timeout",
    "error": "error",
    "illegal": "illegal",
    "cap": "cap",
    "engine": "illegal",
    "script": "script",
}

# Decision source for a seat kind (transcripts).
SOURCE_FOR_KIND = {"human": "human", "bot": "bot", "scripted": "scripted", "llm": "llm"}


def timeout_for(agent: Any) -> float:
    """Seconds allowed for one whole decision of ``agent`` (retries included)."""
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


def check_answer(
    game, decision: Decision, ctx, action: Any, counts: dict, validate=None
) -> str | None:
    """Why ``action`` cannot be applied for ``decision`` (None if it can).
    ``validate`` defaults to ``game.decisions.validate_action``."""
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
    return (validate or validate_action)(game, decision.player_id, action)


def category(reason: str) -> str:
    """Fallback category (``timeout`` | ``cap`` | ``engine`` | ``script`` |
    ``error`` | ``illegal``)."""
    if reason.startswith("timeout"):
        return "timeout"
    if reason.startswith("script:"):
        return "script"
    if "cap reached" in reason:
        return "cap"
    if reason.startswith("engine:"):
        return "engine"
    if reason.startswith("error:"):
        return "error"
    return "illegal"


def describe_fallback(label: str, reason: str, attempts: int, elapsed: float) -> str:
    """The one-sentence ``agent_fallback`` / transcript message."""
    if reason == "timeout":
        what = (
            f"timed out after {elapsed:.0f} s"
            if elapsed >= 10
            else f"timed out after {elapsed:.1f} s"
        )
    elif reason == "illegal":
        what = (
            f"kept answering illegally after {attempts} tries"
            if attempts > 1
            else "gave an illegal answer"
        )
    elif reason == "cap":
        what = "went over the per-turn action limit"
    elif reason == "script":
        what = "broke its test script"
    else:
        what = "had a provider error"
    return f"{label} {what} \u2014 the rules-based player made this move."


def fallback_action(
    game, decision: Decision, ctx, heuristic, validate=None
) -> dict | None:
    """The rules-based answer for one decision: the heuristic's choice, else
    the first legal default; None when neither validates."""
    from agents.scripted import default_action

    for candidate in (heuristic.choose(ctx), default_action(ctx)):
        if (
            candidate.get("action") in ctx.legal.get("action_types", [])
            and (validate or validate_action)(game, decision.player_id, candidate)
            is None
        ):
            return candidate
    return None


def llm_record(agent: Any, ctx) -> dict | None:
    """The agent's structured record of its last decision for ``ctx`` (LLM
    seats expose ``last_decision_record``), or None."""
    fn = getattr(agent, "last_decision_record", None)
    if not callable(fn):
        return None
    try:
        return fn(ctx)
    except Exception:  # noqa: BLE001 - observability must never break a game
        return None
