"""Provider adapters (mocked: no network)."""

import json
from types import SimpleNamespace

import httpx
import pytest
from agents.llm.errors import ProviderError
from agents.llm.providers import (
    AnthropicProvider,
    FakeProvider,
    OpenAICompatProvider,
    extract_json_object,
)

pytestmark = pytest.mark.asyncio

SCHEMA = {
    "type": "object",
    "properties": {"action": {"type": "string", "enum": ["end_turn"]}},
    "required": ["action"],
    "additionalProperties": False,
}
CALL = {
    "system": "SYS",
    "user": "USER",
    "schema": SCHEMA,
    "max_tokens": 500,
    "timeout": 7.0,
}


# --- extract_json_object ------------------------------------------------------


async def test_extract_json_object_variants():
    assert extract_json_object('{"a": 1}') == {"a": 1}
    assert extract_json_object('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json_object('Sure! {"a": {"b": 2}} hope that helps') == {
        "a": {"b": 2}
    }
    for bad in ("no json", "[1,2]", "{broken", ""):
        with pytest.raises(ProviderError):
            extract_json_object(bad)


# --- Anthropic ------------------------------------------------------------------


class FakeMessages:
    def __init__(self, response=None, exc=None):
        self.response, self.exc, self.requests = response, exc, []

    async def create(self, **kw):
        self.requests.append(kw)
        if self.exc:
            raise self.exc
        return self.response


def anthropic_response(text, stop="end_turn", **usage):
    return SimpleNamespace(
        content=[
            SimpleNamespace(type="thinking", thinking=""),
            SimpleNamespace(type="text", text=text),
        ],
        stop_reason=stop,
        model="claude-sonnet-5-5",
        usage=SimpleNamespace(
            input_tokens=usage.get("i", 120),
            output_tokens=usage.get("o", 30),
            cache_read_input_tokens=usage.get("cr", 1000),
            cache_creation_input_tokens=usage.get("cw", 0),
        ),
    )


def make_anthropic(response=None, exc=None, **kw):
    msgs = FakeMessages(response, exc)
    prov = AnthropicProvider(
        model="claude-sonnet-5-5", client=SimpleNamespace(messages=msgs), **kw
    )
    return prov, msgs


async def test_anthropic_request_shape():
    prov, msgs = make_anthropic(
        anthropic_response('{"action":"end_turn"}'), effort="low"
    )
    await prov.complete(**CALL)
    (req,) = msgs.requests
    assert req["model"] == "claude-sonnet-5-5"
    assert req["max_tokens"] == 500 and req["timeout"] == 7.0
    # static system prompt is a cached block
    assert req["system"] == [
        {"type": "text", "text": "SYS", "cache_control": {"type": "ephemeral"}}
    ]
    assert req["messages"] == [{"role": "user", "content": "USER"}]
    # JSON forced with structured outputs, not tool_choice; no sampling params
    assert req["output_config"]["format"] == {"type": "json_schema", "schema": SCHEMA}
    assert req["output_config"]["effort"] == "low"
    for banned in ("tool_choice", "temperature", "top_p", "top_k", "thinking"):
        assert banned not in req


async def test_anthropic_effort_optional():
    prov, msgs = make_anthropic(anthropic_response("{}"), effort=None)
    await prov.complete(**CALL)
    assert "effort" not in msgs.requests[0]["output_config"]


async def test_anthropic_parses_text_block_and_usage():
    prov, _ = make_anthropic(anthropic_response('{"action":"end_turn"}', cw=50))
    res = await prov.complete(**CALL)
    assert res.data == {"action": "end_turn"}
    assert res.raw == '{"action":"end_turn"}'
    assert (res.input_tokens, res.output_tokens) == (120, 30)
    assert (res.cache_read_tokens, res.cache_write_tokens) == (1000, 50)
    assert res.model == "claude-sonnet-5-5" and res.latency_s >= 0


@pytest.mark.parametrize("stop", ["refusal", "max_tokens"])
async def test_anthropic_bad_stop_reasons(stop):
    prov, _ = make_anthropic(anthropic_response('{"action":"end_turn"}', stop=stop))
    with pytest.raises(ProviderError, match=stop):
        await prov.complete(**CALL)


async def test_anthropic_non_json_text():
    prov, _ = make_anthropic(anthropic_response("I think end turn."))
    with pytest.raises(ProviderError):
        await prov.complete(**CALL)


async def test_anthropic_sdk_errors_become_provider_errors():
    class APITimeoutError(Exception):
        pass

    prov, _ = make_anthropic(exc=APITimeoutError("deadline"))
    with pytest.raises(ProviderError) as ei:
        await prov.complete(**CALL)
    assert ei.value.timeout is True

    prov, _ = make_anthropic(exc=RuntimeError("529 overloaded"))
    with pytest.raises(ProviderError, match="529") as ei:
        await prov.complete(**CALL)
    assert ei.value.timeout is False


async def test_anthropic_constructs_real_sdk_client_lazily():
    prov = AnthropicProvider(model="claude-haiku-5-5", api_key="sk-test", max_retries=0)
    assert prov._client.max_retries == 0


# --- OpenAI-compatible ------------------------------------------------------------


def openai_provider(handler, **kw):
    return OpenAICompatProvider(
        base_url="https://llm.example/v1/",
        api_key="sekret",
        model="deepseek-chat",
        transport=httpx.MockTransport(handler),
        **kw,
    )


def ok_body(content='{"action":"end_turn"}', finish="stop"):
    return {
        "model": "deepseek-chat-2",
        "choices": [{"message": {"content": content}, "finish_reason": finish}],
        "usage": {"prompt_tokens": 321, "completion_tokens": 12},
    }


async def test_openai_request_json_object_mode():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=ok_body())

    res = await openai_provider(handler).complete(**CALL)
    assert seen["url"] == "https://llm.example/v1/chat/completions"
    assert seen["auth"] == "Bearer sekret"
    body = seen["body"]
    assert body["model"] == "deepseek-chat" and body["max_tokens"] == 500
    assert body["response_format"] == {"type": "json_object"}
    assert body["messages"][0]["role"] == "system" and body["messages"][0][
        "content"
    ].startswith("SYS")
    assert (
        "JSON Schema" in body["messages"][0]["content"]
    )  # schema embedded for json_object
    assert body["messages"][1] == {"role": "user", "content": "USER"}
    assert res.data == {"action": "end_turn"}
    assert (res.input_tokens, res.output_tokens) == (321, 12)
    assert res.model == "deepseek-chat-2"


async def test_openai_json_schema_mode():
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=ok_body())

    await openai_provider(handler, json_mode="json_schema").complete(**CALL)
    rf = seen["body"]["response_format"]
    assert rf["type"] == "json_schema" and rf["json_schema"]["schema"] == SCHEMA
    assert seen["body"]["messages"][0]["content"] == "SYS"


async def test_openai_mode_none_and_no_key_and_extra_body():
    seen = {}

    def handler(request):
        seen["headers"] = request.headers
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=ok_body())

    prov = OpenAICompatProvider(
        base_url="http://localhost:11434/v1",
        api_key=None,
        model="llama",
        json_mode="none",
        extra_body={"temperature": 0.2},
        transport=httpx.MockTransport(handler),
    )
    await prov.complete(**CALL)
    assert "authorization" not in seen["headers"]
    assert "response_format" not in seen["body"] and seen["body"]["temperature"] == 0.2


async def test_openai_rejects_unknown_json_mode():
    with pytest.raises(ValueError):
        OpenAICompatProvider(base_url="x", api_key=None, model="m", json_mode="yaml")


async def test_openai_parses_fenced_json():
    prov = openai_provider(
        lambda r: httpx.Response(
            200, json=ok_body('```json\n{"action":"end_turn"}\n```')
        )
    )
    assert (await prov.complete(**CALL)).data == {"action": "end_turn"}


@pytest.mark.parametrize(
    "handler,match",
    [
        (lambda r: httpx.Response(500, text="upstream down"), "HTTP 500"),
        (lambda r: httpx.Response(401, text="bad key"), "HTTP 401"),
        (lambda r: httpx.Response(200, text="<html>"), "unexpected response shape"),
        (
            lambda r: httpx.Response(200, json={"choices": []}),
            "unexpected response shape",
        ),
        (lambda r: httpx.Response(200, json=ok_body("hello")), "no JSON object"),
        (
            lambda r: httpx.Response(200, json=ok_body('{"a":', finish="length")),
            "truncated",
        ),
    ],
)
async def test_openai_error_paths(handler, match):
    with pytest.raises(ProviderError, match=match):
        await openai_provider(handler).complete(**CALL)


async def test_openai_timeout_and_connect_errors():
    def slow(request):
        raise httpx.ReadTimeout("too slow", request=request)

    with pytest.raises(ProviderError) as ei:
        await openai_provider(slow).complete(**CALL)
    assert ei.value.timeout is True

    def down(request):
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(ProviderError) as ei:
        await openai_provider(down).complete(**CALL)
    assert ei.value.timeout is False


# --- Fake -----------------------------------------------------------------------


async def test_fake_provider_script_callable_and_errors():
    p = FakeProvider([{"a": 1}, '{"b": 2}', ProviderError("x"), RuntimeError("y")])
    assert (await p.complete(**CALL)).data == {"a": 1}
    assert (await p.complete(**CALL)).data == {"b": 2}
    with pytest.raises(ProviderError, match="x"):
        await p.complete(**CALL)
    with pytest.raises(ProviderError, match="y"):
        await p.complete(**CALL)
    assert len(p.calls) == 4 and p.calls[0]["user"] == "USER"

    async def cb(system, user, schema):
        return {"echo": user}

    assert (await FakeProvider(cb).complete(**CALL)).data == {"echo": "USER"}
    assert (await FakeProvider(lambda s, u, sc: {"n": 1}).complete(**CALL)).data == {
        "n": 1
    }
    with pytest.raises(ProviderError, match="exhausted"):
        await FakeProvider([], strict=True).complete(**CALL)
    first = await FakeProvider().complete(**CALL)
    assert first.data == {"action": "end_turn"}


@pytest.mark.parametrize(
    "usage",
    [
        {
            "prompt_tokens": 1000,
            "completion_tokens": 50,
            "prompt_tokens_details": {"cached_tokens": 800},
        },
        {"prompt_tokens": 1000, "completion_tokens": 50, "cached_tokens": 800},
    ],
)
async def test_openai_cached_prompt_tokens_are_reported_apart(usage):
    def handler(request):
        return httpx.Response(200, json={**ok_body(), "usage": usage})

    res = await openai_provider(handler).complete(**CALL)
    assert (res.input_tokens, res.cache_read_tokens, res.output_tokens) == (
        200,
        800,
        50,
    )
