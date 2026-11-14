"""LLM opponent catalog: availability by environment, test-mode fake, factory."""

import json

import pytest
from agents.llm import catalog_entries, create_agent
from agents.llm.agent import LLMAgent
from agents.llm.providers import AnthropicProvider, FakeProvider, OpenAICompatProvider

from tests.llm_support import bot_game, buy_ctx, place_ctx

ENV_VARS = (
    "ANTHROPIC_API_KEY",
    "ACQUIRE_LLM_OPENAI_BASE_URL",
    "ACQUIRE_LLM_OPENAI_API_KEY",
    "ACQUIRE_LLM_OPENAI_MODEL",
    "ACQUIRE_LLM_OPENAI_JSON_MODE",
    "ACQUIRE_LLM_CATALOG",
    "ACQUIRE_TEST_MODE",
)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for v in ENV_VARS:
        monkeypatch.delenv(v, raising=False)


def by_id(entries):
    return {e["id"]: e for e in entries}


def test_default_entries_unavailable_without_key():
    entries = catalog_entries()
    ids = [e["id"] for e in entries]
    assert ids == [
        "llm:claude-haiku-5-5",
        "llm:claude-sonnet-5-5",
        "llm:claude-opus-5-5",
    ]
    for e in entries:
        assert set(e) == {"id", "kind", "label", "description", "available"}
        assert (
            e["kind"] == "llm"
            and e["available"] is False
            and e["label"]
            and e["description"]
        )


def test_anthropic_entries_available_with_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    assert all(e["available"] for e in catalog_entries())
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    assert not any(e["available"] for e in catalog_entries())


def test_openai_compat_entry_from_env(monkeypatch):
    monkeypatch.setenv("ACQUIRE_LLM_OPENAI_BASE_URL", "https://api.deepseek.com/v1")
    assert len(catalog_entries()) == 3  # needs a model too
    monkeypatch.setenv("ACQUIRE_LLM_OPENAI_MODEL", "deepseek-chat")
    e = by_id(catalog_entries())["llm:openai:deepseek-chat"]
    assert e["available"] is False  # remote endpoint needs a key
    monkeypatch.setenv("ACQUIRE_LLM_OPENAI_API_KEY", "k")
    assert by_id(catalog_entries())["llm:openai:deepseek-chat"]["available"] is True


def test_openai_compat_local_server_needs_no_key(monkeypatch):
    monkeypatch.setenv("ACQUIRE_LLM_OPENAI_BASE_URL", "http://localhost:11434/v1")
    monkeypatch.setenv("ACQUIRE_LLM_OPENAI_MODEL", "llama3")
    assert by_id(catalog_entries())["llm:openai:llama3"]["available"] is True


def test_catalog_json_overrides_defaults(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    monkeypatch.setenv("MY_KEY", "k2")
    monkeypatch.setenv(
        "ACQUIRE_LLM_CATALOG",
        json.dumps(
            [
                {
                    "id": "llm:mine",
                    "label": "Mine",
                    "provider": "anthropic",
                    "model": "claude-opus-5-5",
                },
                {
                    "id": "llm:router",
                    "label": "Router",
                    "provider": "openai",
                    "model": "x/y",
                    "base_url": "https://openrouter.ai/api/v1",
                    "api_key_env": "MY_KEY",
                    "timeout": 90,
                },
                {
                    "id": "llm:nokey",
                    "provider": "openai",
                    "model": "m",
                    "base_url": "https://a.b/v1",
                    "api_key_env": "NOPE",
                },
            ]
        ),
    )
    entries = by_id(catalog_entries())
    assert list(entries) == ["llm:mine", "llm:router", "llm:nokey"]
    assert entries["llm:mine"]["available"] and entries["llm:router"]["available"]
    assert entries["llm:nokey"]["available"] is False
    agent = create_agent("llm:router", name="Routy")
    assert isinstance(agent.provider, OpenAICompatProvider) and agent.timeout == 90.0


def test_invalid_catalog_json_falls_back_to_defaults(monkeypatch):
    for bad in (
        "not json",
        '[{"id": "x"}]',
        '[{"provider":"carrier-pigeon","model":"m"}]',
    ):
        monkeypatch.setenv("ACQUIRE_LLM_CATALOG", bad)
        assert len(catalog_entries()) == 3


def test_fake_only_in_test_mode(monkeypatch):
    assert "llm:fake" not in by_id(catalog_entries())
    with pytest.raises(KeyError):
        create_agent("llm:fake", name="x")
    monkeypatch.setenv("ACQUIRE_TEST_MODE", "1")
    fake = by_id(catalog_entries())["llm:fake"]
    assert fake["label"] == "Fake LLM (test)" and fake["available"] is True
    monkeypatch.setenv("ACQUIRE_TEST_MODE", "0")
    assert "llm:fake" not in by_id(catalog_entries())


def test_fake_added_even_when_catalog_overridden(monkeypatch):
    monkeypatch.setenv("ACQUIRE_TEST_MODE", "1")
    monkeypatch.setenv("ACQUIRE_LLM_CATALOG", "[]")
    assert list(by_id(catalog_entries())) == ["llm:fake"]


def test_create_agent_errors_and_types(monkeypatch):
    with pytest.raises(KeyError):
        create_agent("llm:nope", name="x")
    with pytest.raises(RuntimeError, match="not available"):
        create_agent("llm:claude-sonnet-5-5", name="x")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    a = create_agent("llm:claude-sonnet-5-5", name="Sonny")
    assert isinstance(a, LLMAgent) and a.kind == "llm" and a.name == "Sonny"
    assert isinstance(a.provider, AnthropicProvider)
    assert (
        a.provider.model == "claude-sonnet-5-5"
        and a.agent_id == "llm:claude-sonnet-5-5"
    )
    assert create_agent("llm:claude-haiku-5-5", name="H").timeout == 30.0


@pytest.mark.asyncio
async def test_fake_agent_plays_first_legal_action(monkeypatch):
    monkeypatch.setenv("ACQUIRE_TEST_MODE", "1")
    agent = create_agent("llm:fake", name="Fakey")
    assert isinstance(agent.provider, FakeProvider)
    game = bot_game(seed=1, min_turns=40)
    ctx = place_ctx(game)
    assert (await agent.decide(ctx)) == {
        "action": "place_tile",
        "tile": ctx.legal["tiles"][0]["tile"],
    }
    assert (await agent.decide(buy_ctx(game)))["action"] == "buy_stocks"
