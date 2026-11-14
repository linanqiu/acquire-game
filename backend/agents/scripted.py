"""Scripted agent: deterministic opponents for tests.

``ScriptedAgent(script=[...action dicts...])`` answers each decision with the
next script entry, in order, when that entry fits the decision:

* the entry's ``action`` type is not legal for this decision (e.g. a
  ``buy_stocks`` entry while a trade response is asked) -> the entry stays
  queued and the deterministic default is played instead;
* the entry's type fits but the details are illegal (tile not in hand, chain
  not offered, counts that don't add up...) -> the entry is dropped and the
  default is played.

Default (script exhausted or entry unusable), no randomness: first legal tile,
first offered chain, sell every defunct share, buy nothing and end the turn,
reject trades.

Strict mode (``strict=True``, opt-in; the lenient behaviour above stays the
default) is for tests that must fail when their script is wrong: an entry whose
type fits but whose details are illegal is NOT silently dropped. It is
recorded in ``violations`` and ``decide`` raises ``ScriptViolation`` (reason
``"script"``), which the seat driver turns into a fallback with the distinct
reason ``script``. Entries still queued when the game ends are reported by
``unconsumed()`` / ``assert_consumed()`` and by the room's debug state.
"""

from __future__ import annotations

import logging
from typing import Any

from agents.base import DecisionContext

logger = logging.getLogger(__name__)


class ScriptViolation(Exception):
    """A strict scripted seat could not play its script entry (see module doc).
    ``reason`` is what the seat driver reports as the fallback reason."""

    reason = "script"


def default_action(ctx: DecisionContext) -> dict:
    """The first legal answer to ``ctx.decision`` (deterministic)."""
    legal = ctx.legal
    kind = ctx.decision.kind
    if kind == "place_tile":
        tiles = legal.get("tiles") or []
        if tiles:
            return {"action": "place_tile", "tile": tiles[0]["tile"]}
        if "declare_end_game" in legal.get("action_types", []):
            return {"action": "declare_end_game"}
        return {"action": "place_tile", "tile": None}
    if kind == "found_chain":
        chains = legal.get("chains") or [None]
        return {"action": "found_chain", "chain": chains[0]}
    if kind == "choose_survivor":
        chains = legal.get("chains") or [None]
        return {"action": "merger_choice", "surviving_chain": chains[0]}
    if kind == "stock_disposition":
        return {
            "action": "merger_disposition",
            "defunct_chain": legal.get("defunct_chain"),
            "disposition": {"sell": legal.get("stock_count", 0), "trade": 0, "hold": 0},
        }
    if kind == "buy_stocks":
        return {"action": "end_turn"}
    if kind == "trade_response":
        trade = legal.get("trade") or {}
        return {"action": "reject_trade", "trade_id": trade.get("trade_id")}
    types = legal.get("action_types") or ["end_turn"]
    return {"action": types[0]}


def _int(v: Any) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else None


def fits(ctx: DecisionContext, action: dict) -> bool:
    """Best-effort legality check of ``action`` against ``ctx.legal`` alone."""
    legal = ctx.legal
    kind = action.get("action")
    if kind == "place_tile":
        tile = str(action.get("tile", "")).strip().upper()
        return tile in {o["tile"] for o in legal.get("tiles", [])}
    if kind == "found_chain":
        return action.get("chain") in legal.get("chains", [])
    if kind == "merger_choice":
        return action.get("surviving_chain") in legal.get("chains", [])
    if kind == "merger_disposition":
        d = action.get("disposition") or {}
        sell, trade = _int(d.get("sell", 0)), _int(d.get("trade", 0))
        hold = _int(d.get("hold", d.get("keep", 0)))
        if None in (sell, trade, hold):
            return False
        return (
            action.get("defunct_chain") == legal.get("defunct_chain")
            and sell + trade + hold == legal.get("stock_count")
            and trade % 2 == 0
            and trade <= legal.get("max_trade", 0)
        )
    if kind == "buy_stocks":
        opts = {o["chain"]: o for o in legal.get("options", [])}
        purchases = action.get("purchases") or {}
        if not isinstance(purchases, dict):
            return False
        total = cost = 0
        for chain, n in purchases.items():
            if _int(n) is None or (n and chain not in opts):
                return False
            if n:
                if n > opts[chain]["available"]:
                    return False
                total += n
                cost += n * opts[chain]["price"]
        return total <= legal.get("max_total", 0) and cost <= legal.get("money", 0)
    if kind in ("accept_trade", "reject_trade"):
        trade_id = (legal.get("trade") or {}).get("trade_id")
        if action.get("trade_id") != trade_id:
            return False
        return kind == "reject_trade" or bool(legal.get("can_accept"))
    # end_turn, declare_end_game, propose_trade: type check is all we can do
    return True


class ScriptedAgent:
    """Plays ``script`` entries in order; deterministic default otherwise."""

    kind = "scripted"

    def __init__(
        self,
        script: list[dict] | None = None,
        name: str = "Scripted",
        *,
        strict: bool = False,
    ):
        self.name = name
        self.strict = bool(strict)
        self.script: list[dict] = [dict(a) for a in (script or [])]
        self.played: list[dict] = []  # every action returned, for test assertions
        # strict mode: {"kind": "illegal_entry", "entry", "decision", "player_id"}
        self.violations: list[dict] = []

    async def decide(self, ctx: DecisionContext) -> dict:
        action = self._next(ctx)
        self.played.append(action)
        return action

    # ------------------------------------------------------------- strictness

    def unconsumed(self) -> list[dict]:
        """Script entries not played yet (after the game: never consumed)."""
        return [dict(a) for a in self.script]

    def assert_consumed(self) -> None:
        """Raise ``ScriptViolation`` if a violation happened or entries remain."""
        if self.violations:
            raise ScriptViolation(
                f"scripted seat {self.name}: {len(self.violations)} illegal "
                f"script entries, the first: {self.violations[0]['entry']!r}"
            )
        if self.script:
            raise ScriptViolation(
                f"scripted seat {self.name}: {len(self.script)} script "
                f"entries never consumed, the first: {self.script[0]!r}"
            )

    def debug(self) -> dict:
        """State for the room debug route."""
        return {
            "name": self.name,
            "strict": self.strict,
            "played": len(self.played),
            "unconsumed": self.unconsumed(),
            "violations": [dict(v) for v in self.violations],
        }

    def _next(self, ctx: DecisionContext) -> dict:
        if self.script:
            entry = self.script[0]
            types = ctx.legal.get("action_types", [])
            if isinstance(entry, dict) and entry.get("action") in types:
                self.script.pop(0)
                if fits(ctx, entry):
                    return dict(entry)
                logger.info(
                    "scripted seat %s: dropping illegal entry %r for %s",
                    self.name,
                    entry,
                    ctx.decision.kind,
                )
                if self.strict:
                    self.violations.append(
                        {
                            "kind": "illegal_entry",
                            "entry": entry,
                            "decision": ctx.decision.kind,
                            "player_id": ctx.player_id,
                        }
                    )
                    raise ScriptViolation(
                        f"illegal script entry {entry!r} for {ctx.decision.kind}"
                    )
        return default_action(ctx)
