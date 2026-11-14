"""Catalog of selectable LLM opponents and the factory that builds them.

Public API (used by the server):

* ``catalog_entries() -> list[dict]``: ``id, kind, label, description, available``.
* ``create_agent(agent_id, *, name) -> LLMAgent``: ``KeyError`` for an unknown
  id, ``RuntimeError`` if the entry is unavailable (no credentials).

Environment (read at call time, so tests and deployments can change it):

``ANTHROPIC_API_KEY``                 key for the built-in Anthropic entries
``ACQUIRE_LLM_OPENAI_BASE_URL``       e.g. https://api.deepseek.com/v1  (enables the entry)
``ACQUIRE_LLM_OPENAI_API_KEY``        bearer key (optional for localhost servers)
``ACQUIRE_LLM_OPENAI_MODEL``          model name for that endpoint
``ACQUIRE_LLM_OPENAI_JSON_MODE``      json_object (default) | json_schema | none
``ACQUIRE_LLM_CATALOG``               JSON list that REPLACES the default entries
``ACQUIRE_TEST_MODE=1``               adds ``llm:fake`` (no network, first legal action)
``ACQUIRE_LLM_LOG_DIR``               see decision_log.py

``ACQUIRE_LLM_CATALOG`` entry fields: ``id, label, description, provider``
(``anthropic`` | ``openai``), ``model``; optional ``api_key_env`` (env var name
holding the key), ``api_key`` (inline, discouraged), ``base_url``,
``base_url_env``, ``timeout`` (s), ``max_tokens``, ``effort``, ``json_mode``.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from urllib.parse import urlparse

from agents.llm.agent import DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT_S, LLMAgent
from agents.llm.providers import (
    AnthropicProvider,
    FakeProvider,
    OpenAICompatProvider,
    Provider,
)

logger = logging.getLogger("acquire.llm")

FAKE_ID = "llm:fake"


@dataclass(frozen=True)
class CatalogEntry:
    id: str
    label: str
    description: str
    provider: str  # "anthropic" | "openai" | "fake"
    model: str = ""
    api_key_env: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    base_url_env: str | None = None
    timeout: float = DEFAULT_TIMEOUT_S
    max_tokens: int = DEFAULT_MAX_TOKENS
    effort: str | None = "medium"
    json_mode: str = "json_object"

    def resolved_key(self) -> str | None:
        if self.api_key:
            return self.api_key
        return os.environ.get(self.api_key_env or "") or None

    def resolved_base_url(self) -> str | None:
        if self.base_url:
            return self.base_url
        return os.environ.get(self.base_url_env or "") or None

    def available(self) -> bool:
        if self.provider == "fake":
            return test_mode()
        if self.provider == "anthropic":
            return bool(self.resolved_key())
        if self.provider == "openai":
            url = self.resolved_base_url()
            if not url or not self.model:
                return False
            if self.resolved_key():
                return True
            host = urlparse(url).hostname or ""
            return host in (
                "localhost",
                "127.0.0.1",
                "::1",
            )  # local servers need no key
        return False

    def public(self) -> dict:
        return {
            "id": self.id,
            "kind": "llm",
            "label": self.label,
            "description": self.description,
            "available": self.available(),
        }


def test_mode() -> bool:
    return os.environ.get("ACQUIRE_TEST_MODE") == "1"


def _default_entries() -> list[CatalogEntry]:
    entries = [
        CatalogEntry(
            id="llm:claude-haiku-5-5",
            label="Claude Haiku 5.5",
            description="Fast and inexpensive Claude. A quick, decent opponent.",
            provider="anthropic",
            model="claude-haiku-5-5",
            api_key_env="ANTHROPIC_API_KEY",
            timeout=30.0,
        ),
        CatalogEntry(
            id="llm:claude-sonnet-5-5",
            label="Claude Sonnet 5.5",
            description="Balanced Claude: strong play at moderate cost and latency.",
            provider="anthropic",
            model="claude-sonnet-5-5",
            api_key_env="ANTHROPIC_API_KEY",
        ),
        CatalogEntry(
            id="llm:claude-opus-5-5",
            label="Claude Opus 5.5",
            description="Strongest Claude: the toughest opponent, slower and costlier.",
            provider="anthropic",
            model="claude-opus-5-5",
            api_key_env="ANTHROPIC_API_KEY",
            timeout=60.0,
        ),
    ]
    base = os.environ.get("ACQUIRE_LLM_OPENAI_BASE_URL")
    model = os.environ.get("ACQUIRE_LLM_OPENAI_MODEL")
    if base and model:
        entries.append(
            CatalogEntry(
                id=f"llm:openai:{model}",
                label=model,
                description=f"OpenAI-compatible endpoint ({urlparse(base).hostname}).",
                provider="openai",
                model=model,
                api_key_env="ACQUIRE_LLM_OPENAI_API_KEY",
                base_url_env="ACQUIRE_LLM_OPENAI_BASE_URL",
                json_mode=os.environ.get("ACQUIRE_LLM_OPENAI_JSON_MODE", "json_object"),
            )
        )
    return entries


def _entry_from_json(d: dict) -> CatalogEntry:
    provider = d["provider"]
    if provider not in ("anthropic", "openai"):
        raise ValueError(f"unknown provider {provider!r}")
    if provider == "anthropic":
        d = {"api_key_env": "ANTHROPIC_API_KEY", **d}
    model = d["model"]
    return CatalogEntry(
        id=d.get("id") or f"llm:{model}",
        label=d.get("label") or model,
        description=d.get("description", ""),
        provider=provider,
        model=model,
        api_key_env=d.get("api_key_env"),
        api_key=d.get("api_key"),
        base_url=d.get("base_url"),
        base_url_env=d.get("base_url_env"),
        timeout=float(d.get("timeout", DEFAULT_TIMEOUT_S)),
        max_tokens=int(d.get("max_tokens", DEFAULT_MAX_TOKENS)),
        effort=d.get("effort", "medium"),
        json_mode=d.get("json_mode", "json_object"),
    )


def _fake_entry() -> CatalogEntry:
    return CatalogEntry(
        id=FAKE_ID,
        label="Fake LLM (test)",
        description="Test-only seat that exercises the LLM code path offline "
        "and always plays the first legal action.",
        provider="fake",
        model="fake",
    )


def load_entries() -> list[CatalogEntry]:
    raw = os.environ.get("ACQUIRE_LLM_CATALOG")
    entries: list[CatalogEntry] | None = None
    if raw:
        try:
            parsed = json.loads(raw)
            entries = [_entry_from_json(d) for d in parsed]
        except (ValueError, KeyError, TypeError) as exc:
            logger.warning("ignoring invalid ACQUIRE_LLM_CATALOG: %s", exc)
    if entries is None:
        entries = _default_entries()
    if test_mode():
        entries = [e for e in entries if e.id != FAKE_ID] + [_fake_entry()]
    return entries


def catalog_entries() -> list[dict]:
    return [e.public() for e in load_entries()]


def _build_provider(entry: CatalogEntry) -> Provider:
    if entry.provider == "fake":
        return FakeProvider(model="fake")
    if entry.provider == "anthropic":
        return AnthropicProvider(
            model=entry.model, api_key=entry.resolved_key(), effort=entry.effort
        )
    return OpenAICompatProvider(
        base_url=entry.resolved_base_url() or "",
        api_key=entry.resolved_key(),
        model=entry.model,
        json_mode=entry.json_mode,
    )


def create_agent(agent_id: str, *, name: str) -> LLMAgent:
    for entry in load_entries():
        if entry.id == agent_id:
            break
    else:
        raise KeyError(agent_id)
    if not entry.available():
        raise RuntimeError(
            f"LLM opponent {agent_id!r} is not available (credentials missing)"
        )
    return LLMAgent(
        _build_provider(entry),
        name=name,
        agent_id=entry.id,
        timeout=entry.timeout,
        max_tokens=entry.max_tokens,
    )
