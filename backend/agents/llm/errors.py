"""Exceptions raised by the LLM seat package."""

from __future__ import annotations


class ProviderError(Exception):
    """A model provider call failed (network, HTTP status, timeout, bad payload)."""

    def __init__(self, message: str, *, timeout: bool = False):
        super().__init__(message)
        self.timeout = timeout


class AgentDecisionError(Exception):
    """The agent could not produce a legal action (provider failure, timeout,
    or illegal answer twice). The server's driver catches this (and any other
    exception from ``decide``) and falls back to the heuristic agent."""
