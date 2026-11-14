"""Exceptions raised by the LLM seat package."""

from __future__ import annotations


class ProviderError(Exception):
    """A model provider call failed (network, HTTP status, timeout, bad payload)."""

    def __init__(self, message: str, *, timeout: bool = False):
        super().__init__(message)
        self.timeout = timeout


class AgentDecisionError(Exception):
    """The agent could not produce a legal action. The server's driver catches
    this (and any other exception from ``decide``) and lets the rules-based bot
    take that one decision.

    ``reason`` is the fallback category: ``"timeout"`` | ``"error"`` (provider
    failure, nothing answerable) | ``"illegal"`` (the model kept answering
    illegally until its retry budget ran out). ``attempts`` is the number of
    model answers spent on the decision.
    """

    def __init__(self, message: str, *, reason: str = "error", attempts: int = 0):
        super().__init__(message)
        self.reason = reason
        self.attempts = attempts
