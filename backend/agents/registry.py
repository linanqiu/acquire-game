"""Catalog of AI opponents and the factory that builds them.

``catalog()`` is what ``GET /agents/catalog`` serves; ``create()`` builds the
Agent for an ``add-seat`` request. The LLM package (``agents.llm``) is
optional: when it cannot be imported, only the heuristic bot is offered.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from agents.heuristic import HeuristicAgent
from agents.scripted import ScriptedAgent

logger = logging.getLogger(__name__)

BOT_ENTRY = {
    "id": "bot",
    "kind": "bot",
    "label": "Bot",
    "description": "Rule-based opponent. Plays instantly.",
    "available": True,
}
SCRIPTED_ENTRY = {
    "id": "scripted",
    "kind": "scripted",
    "label": "Scripted",
    "description": "Test-mode opponent that plays a fixed script, then the first legal action.",
    "available": True,
}


class UnknownAgentError(KeyError):
    """No catalog entry with that id."""


class UnavailableAgentError(RuntimeError):
    """The catalog entry exists but cannot be used (e.g. missing credentials)."""


def test_mode() -> bool:
    return os.environ.get("GAME_TEST_MODE") == "1"


def _llm_entries() -> list[dict]:
    try:
        from agents.llm import config as llm_config
    except ImportError:
        return []
    try:
        return [dict(e) for e in llm_config.catalog_entries()]
    except Exception:
        logger.exception("Failed to load LLM catalog")
        return []


def catalog() -> list[dict]:
    """AI opponents the lobby can offer: `[{id, kind, label, description, available}]`."""
    entries = [dict(BOT_ENTRY)]
    entries.extend(_llm_entries())
    if test_mode():
        entries.append(dict(SCRIPTED_ENTRY))
        entries.extend(_bot_version_entries())
    return entries


def _bot_version_entries() -> list[dict]:
    """Test mode: every bot generation other than the default, as "bot:vN"
    (agents/bot_versions.py), so a journey can seat a given generation."""
    from agents.bot_versions import DEFAULT_VERSION, VERSIONS

    return [
        {
            "id": f"bot:{v}",
            "kind": "bot",
            "label": f"Bot {v}",
            "description": f"Test mode: rules-based bot generation {v}. {p.summary}",
            "available": True,
        }
        for v, p in VERSIONS.items()
        if v != DEFAULT_VERSION
    ]


def entry(agent_id: str) -> dict | None:
    """The catalog entry for ``agent_id`` (None if unknown)."""
    return next((e for e in catalog() if e["id"] == agent_id), None)


def create(agent_id: str, *, name: str, **opts: Any):
    """Build the Agent for catalog id ``agent_id``.

    Raises:
        UnknownAgentError: unknown id (including ``scripted`` outside test mode)
        UnavailableAgentError: known but not available
    """
    if agent_id == "bot" or agent_id.startswith("bot:"):
        # ``seed``: the bot's RNG seed; defaults to its name. "bot:v1" etc.
        # pick a bot generation (agents/bot_versions.py; default: the best).
        version = agent_id.split(":", 1)[1] if ":" in agent_id else opts.get("version")
        try:
            return HeuristicAgent(name=name, seed=opts.get("seed"), version=version)
        except ValueError as e:
            raise UnknownAgentError(agent_id) from e
    if agent_id == "scripted":
        if not test_mode():
            raise UnknownAgentError(agent_id)
        return ScriptedAgent(
            script=opts.get("script"),
            name=name,
            strict=bool(opts.get("strict", False)),
        )

    found = entry(agent_id)
    if found is None:
        raise UnknownAgentError(agent_id)
    if not found.get("available"):
        raise UnavailableAgentError(agent_id)
    try:
        from agents.llm import config as llm_config
    except ImportError as e:  # pragma: no cover - entry() would be None
        raise UnknownAgentError(agent_id) from e
    try:
        return llm_config.create_agent(agent_id, name=name)
    except KeyError as e:
        raise UnknownAgentError(agent_id) from e
    except RuntimeError as e:
        raise UnavailableAgentError(agent_id) from e
