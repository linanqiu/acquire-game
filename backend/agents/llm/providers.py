"""Model providers: one async ``complete`` call that returns a JSON object.

Three implementations:

* ``AnthropicProvider``   - official ``anthropic`` SDK, structured outputs
  (``output_config.format``) force schema-conforming JSON; the static system
  prompt carries a ``cache_control`` breakpoint.
* ``OpenAICompatProvider`` - plain ``httpx`` against ``/chat/completions``
  (DeepSeek, OpenRouter, Ollama, vLLM, ...).
* ``FakeProvider``        - scripted / callable answers for tests and the
  browser-test "fake LLM" seat.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import time
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

import httpx

from agents.llm.errors import ProviderError


@dataclass
class ProviderResult:
    """One parsed model answer plus accounting.

    ``input_tokens`` counts uncached input only; prompt-cache reads/writes are
    reported separately (Anthropic bills them at different rates).
    """

    data: dict
    raw: str
    input_tokens: int = 0
    output_tokens: int = 0
    latency_s: float = 0.0
    model: str = ""
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0


@runtime_checkable
class Provider(Protocol):
    model: str

    async def complete(
        self,
        *,
        system: str,
        user: str,
        schema: dict,
        max_tokens: int,
        timeout: float,
    ) -> ProviderResult: ...


def extract_json_object(text: str) -> dict:
    """Parse the first JSON object in ``text`` (tolerates ``` fences / chatter)."""
    s = text.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s[3:]
        if s.rstrip().endswith("```"):
            s = s.rstrip()[:-3]
    start = s.find("{")
    if start < 0:
        raise ProviderError("response contains no JSON object")
    try:
        obj, _ = json.JSONDecoder().raw_decode(s[start:])
    except json.JSONDecodeError as exc:
        raise ProviderError(f"response is not valid JSON: {exc}") from exc
    if not isinstance(obj, dict):
        raise ProviderError("response JSON is not an object")
    return obj


# ---------------------------------------------------------------------------
# Anthropic
# ---------------------------------------------------------------------------


class AnthropicProvider:
    """Anthropic Messages API with structured outputs.

    Notes (per the current API): forced ``tool_choice`` is rejected by the
    newest models, so the JSON answer is forced with
    ``output_config.format = json_schema`` instead. Sampling parameters are not
    sent (rejected on current models). Thinking is left at the model default
    (adaptive); ``effort`` bounds how much of the budget it spends.
    """

    def __init__(
        self,
        *,
        model: str,
        api_key: str | None = None,
        effort: str | None = "medium",
        base_url: str | None = None,
        max_retries: int = 1,
        client: Any = None,
    ):
        self.model = model
        self.effort = effort
        if client is None:
            import anthropic  # lazy: catalog/tests work without the SDK installed

            kwargs: dict[str, Any] = {"api_key": api_key, "max_retries": max_retries}
            if base_url:
                kwargs["base_url"] = base_url
            client = anthropic.AsyncAnthropic(**kwargs)
        self._client = client

    def build_request(
        self, *, system: str, user: str, schema: dict, max_tokens: int, timeout: float
    ) -> dict:
        output_config: dict[str, Any] = {
            "format": {"type": "json_schema", "schema": schema}
        }
        if self.effort:
            output_config["effort"] = self.effort
        return {
            "model": self.model,
            "max_tokens": max_tokens,
            # Static rules prompt first, cached; the volatile position goes in `user`.
            "system": [
                {
                    "type": "text",
                    "text": system,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            "messages": [{"role": "user", "content": user}],
            "output_config": output_config,
            "timeout": timeout,
        }

    async def complete(
        self, *, system: str, user: str, schema: dict, max_tokens: int, timeout: float
    ) -> ProviderResult:
        request = self.build_request(
            system=system,
            user=user,
            schema=schema,
            max_tokens=max_tokens,
            timeout=timeout,
        )
        t0 = time.monotonic()
        try:
            resp = await self._client.messages.create(**request)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # SDK errors: status, connection, timeout
            is_timeout = "Timeout" in type(exc).__name__
            raise ProviderError(
                f"anthropic call failed: {type(exc).__name__}: {exc}",
                timeout=is_timeout,
            ) from exc
        latency = time.monotonic() - t0

        stop = getattr(resp, "stop_reason", None)
        if stop == "refusal":
            raise ProviderError("model refused the request (stop_reason=refusal)")
        if stop == "max_tokens":
            raise ProviderError("response truncated (stop_reason=max_tokens)")
        text = "".join(
            b.text
            for b in getattr(resp, "content", [])
            if getattr(b, "type", "") == "text"
        )
        data = extract_json_object(text)
        usage = getattr(resp, "usage", None)

        def _n(name: str) -> int:
            return int(getattr(usage, name, 0) or 0)

        return ProviderResult(
            data=data,
            raw=text,
            input_tokens=_n("input_tokens"),
            output_tokens=_n("output_tokens"),
            latency_s=latency,
            model=getattr(resp, "model", None) or self.model,
            cache_read_tokens=_n("cache_read_input_tokens"),
            cache_write_tokens=_n("cache_creation_input_tokens"),
        )


# ---------------------------------------------------------------------------
# OpenAI-compatible
# ---------------------------------------------------------------------------


class OpenAICompatProvider:
    """``POST {base_url}/chat/completions`` over plain httpx.

    ``json_mode``: ``"json_schema"`` (strict schema, OpenAI/OpenRouter/Ollama),
    ``"json_object"`` (widest support, e.g. DeepSeek; the schema is appended to
    the system prompt) or ``"none"`` (prompt only).
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str | None,
        model: str,
        json_mode: str = "json_object",
        transport: httpx.AsyncBaseTransport | None = None,
        extra_body: dict | None = None,
    ):
        if json_mode not in ("json_schema", "json_object", "none"):
            raise ValueError(f"unknown json_mode {json_mode!r}")
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.json_mode = json_mode
        self.extra_body = dict(extra_body or {})
        self._transport = transport

    def build_request(
        self, *, system: str, user: str, schema: dict, max_tokens: int
    ) -> dict:
        sys_text = system
        if self.json_mode != "json_schema":
            sys_text += (
                "\n\nReply with a single JSON object and nothing else. It must "
                "conform to this JSON Schema:\n"
                + json.dumps(schema, separators=(",", ":"))
            )
        body: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": [
                {"role": "system", "content": sys_text},
                {"role": "user", "content": user},
            ],
        }
        if self.json_mode == "json_schema":
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "game_decision", "schema": schema},
            }
        elif self.json_mode == "json_object":
            body["response_format"] = {"type": "json_object"}
        body.update(self.extra_body)
        return body

    async def complete(
        self, *, system: str, user: str, schema: dict, max_tokens: int, timeout: float
    ) -> ProviderResult:
        body = self.build_request(
            system=system, user=user, schema=schema, max_tokens=max_tokens
        )
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        t0 = time.monotonic()
        try:
            async with httpx.AsyncClient(
                transport=self._transport, timeout=timeout
            ) as client:
                resp = await client.post(
                    f"{self.base_url}/chat/completions", json=body, headers=headers
                )
        except httpx.TimeoutException as exc:
            raise ProviderError(f"request timed out: {exc}", timeout=True) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"http error: {type(exc).__name__}: {exc}") from exc
        latency = time.monotonic() - t0
        if resp.status_code >= 400:
            raise ProviderError(f"HTTP {resp.status_code}: {resp.text[:300]}")
        try:
            payload = resp.json()
            choice = payload["choices"][0]
            text = choice["message"]["content"] or ""
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise ProviderError(f"unexpected response shape: {exc}") from exc
        if choice.get("finish_reason") == "length":
            raise ProviderError("response truncated (finish_reason=length)")
        data = extract_json_object(text)
        usage = payload.get("usage") or {}
        return ProviderResult(
            data=data,
            raw=text,
            input_tokens=int(usage.get("prompt_tokens") or 0),
            output_tokens=int(usage.get("completion_tokens") or 0),
            latency_s=latency,
            model=payload.get("model") or self.model,
        )


# ---------------------------------------------------------------------------
# Fake
# ---------------------------------------------------------------------------


def schema_first_answer(schema: dict) -> Any:
    """Build the 'first legal' instance of a (narrowed) answer schema."""
    if "anyOf" in schema:
        return schema_first_answer(schema["anyOf"][0])
    if "const" in schema:
        return schema["const"]
    if "enum" in schema:
        return schema["enum"][0]
    t = schema.get("type")
    if t == "object":
        return {
            k: schema_first_answer(v) for k, v in schema.get("properties", {}).items()
        }
    if t == "array":
        return []
    if t == "integer" or t == "number":
        return 0
    if t == "boolean":
        return False
    return "fake"


class FakeProvider:
    """Scripted provider.

    ``responses`` is a list consumed in order (the last one repeats unless
    ``strict=True``) or a callable ``(system, user, schema) -> dict | str |
    Exception`` (may be async). Items may be a dict (JSON answer), a str (raw
    text, parsed as JSON), an Exception instance (raised; ``ProviderError`` is
    passed through, others wrapped) or a callable. With no responses it answers
    with the first legal action by walking the schema.
    """

    def __init__(
        self,
        responses: Any = None,
        *,
        model: str = "fake",
        delay: float = 0.0,
        strict: bool = False,
    ):
        self.model = model
        self.delay = delay
        self.strict = strict
        self._responses = responses
        self._i = 0
        self.calls: list[dict] = []

    async def complete(
        self, *, system: str, user: str, schema: dict, max_tokens: int, timeout: float
    ) -> ProviderResult:
        self.calls.append(
            {
                "system": system,
                "user": user,
                "schema": schema,
                "max_tokens": max_tokens,
                "timeout": timeout,
            }
        )
        if self.delay:
            await asyncio.sleep(self.delay)
        item = self._next_item()
        if callable(item):
            item = item(system, user, schema)
            if inspect.isawaitable(item):
                item = await item
        if item is None:
            item = schema_first_answer(schema)
        if isinstance(item, ProviderError):
            raise item
        if isinstance(item, Exception):
            raise ProviderError(f"fake provider error: {item}") from item
        if isinstance(item, str):
            raw = item
            data = extract_json_object(item)
        else:
            data = item
            raw = json.dumps(item)
        return ProviderResult(
            data=data,
            raw=raw,
            input_tokens=(len(system) + len(user)) // 4,
            output_tokens=len(raw) // 4,
            latency_s=self.delay,
            model=self.model,
        )

    def _next_item(self) -> Any:
        r = self._responses
        if not isinstance(r, list):
            return r
        if self._i < len(r):
            item = r[self._i]
            self._i += 1
            return item
        if self.strict or not r:
            raise ProviderError("fake provider script exhausted")
        return r[-1]
