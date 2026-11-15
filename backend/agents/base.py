"""Seat interface shared by heuristic, scripted and LLM agents.

See docs/architecture/seat-contract.md. Humans are seats without an Agent:
the server simply waits for their message.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    from game.decisions import Decision
    from game.game import Game


@dataclass
class DecisionContext:
    """Everything a seat may know when asked to decide. Public info + own hand only."""

    player_id: str
    decision: Decision
    legal: dict  # game.decisions.legal_actions()
    state: dict  # game.get_player_state(player_id)
    events: list[dict]  # game.decisions.public_events(game, player_id)
    calc: dict  # game.calculator.build_calculator_pack(game, player_id)
    # Recent public table chat (chat.prompt_messages; LLM seats only, else
    # empty). Unverified talk, never binding.
    chat: list[dict] = field(default_factory=list)


@runtime_checkable
class Agent(Protocol):
    """A non-human seat. `decide` returns one action dict (wire format)."""

    kind: str  # "bot" | "llm" | "scripted"

    async def decide(self, ctx: DecisionContext) -> dict: ...


# Optional extension (not part of the Protocol, so heuristic and scripted agents
# stay valid): an agent with a truthy ``accepts_rejections`` attribute is called
# as ``decide(ctx, rejected=[{"action": ..., "error": ...}, ...], deadline=t)``
# by the seat driver after the engine refused its answer, and is expected to
# answer again (or raise). ``deadline`` is a ``time.monotonic()`` instant.
def accepts_rejections(agent: object) -> bool:
    return bool(getattr(agent, "accepts_rejections", False))


def build_context(game: Game, decision: Decision) -> DecisionContext:
    """Assemble the context for `decision` from the engine. Never includes
    other players' hands or the tile bag order."""
    from game.calculator import build_calculator_pack
    from game.decisions import legal_actions, public_events

    pid = decision.player_id
    return DecisionContext(
        player_id=pid,
        decision=decision,
        legal=legal_actions(game, decision),
        state=game.get_player_state(pid),
        events=public_events(game, pid),
        calc=build_calculator_pack(game, pid),
    )
