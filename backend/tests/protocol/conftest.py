"""Fixtures for tier-2 protocol tests: the real app in-process, no browser.

Tests talk to the server only through HTTP routes and WebSockets
(``fastapi.testclient``) and act only on what the server sends them.
"""

from __future__ import annotations

import signal

import pytest
from fastapi.testclient import TestClient

from app_state import session_manager
from config import get_settings


@pytest.fixture
def test_mode(monkeypatch):
    monkeypatch.setenv("ACQUIRE_TEST_MODE", "1")


@pytest.fixture
def fast_settings(monkeypatch):
    """Short driver timeouts for tests."""
    s = get_settings()
    monkeypatch.setattr(s, "bot_decision_timeout", 5.0)
    monkeypatch.setattr(s, "scripted_decision_timeout", 5.0)
    monkeypatch.setattr(s, "llm_decision_timeout", 5.0)
    return s


@pytest.fixture
def app_client(test_mode, fast_settings):
    """TestClient on a fresh app built with test mode on (one event loop)."""
    from main import create_app

    session_manager._rooms.clear()
    with TestClient(create_app()) as c:
        yield c
    session_manager._rooms.clear()


@pytest.fixture(autouse=True)
def hard_timeout():
    """Fail (instead of hanging) if a blocking WebSocket receive never returns."""

    def _boom(signum, frame):
        raise TimeoutError("protocol test exceeded hard timeout")

    old = signal.signal(signal.SIGALRM, _boom)
    signal.alarm(60)
    yield
    signal.alarm(0)
    signal.signal(signal.SIGALRM, old)
