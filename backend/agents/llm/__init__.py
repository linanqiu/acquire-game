"""LLM opponents as first-class seats (see docs/roadmap/epics/09-llm-bot.md)."""

from agents.llm.agent import LLMAgent
from agents.llm.config import catalog_entries, create_agent
from agents.llm.errors import AgentDecisionError, ProviderError
from agents.llm.providers import (
    AnthropicProvider,
    FakeProvider,
    OpenAICompatProvider,
    Provider,
    ProviderResult,
)

__all__ = [
    "AgentDecisionError",
    "AnthropicProvider",
    "FakeProvider",
    "LLMAgent",
    "OpenAICompatProvider",
    "Provider",
    "ProviderError",
    "ProviderResult",
    "catalog_entries",
    "create_agent",
]
