"""Tests for health check endpoints."""

import pytest
from fastapi.testclient import TestClient

from app_state import session_manager
from main import app


@pytest.fixture
def client():
    """Create FastAPI test client."""
    return TestClient(app)


@pytest.fixture(autouse=True)
def clean_rooms():
    """Ensure clean state for each test."""
    session_manager._rooms.clear()
    yield
    session_manager._rooms.clear()


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok" and data["timestamp"]


def test_detailed_health_counts_rooms_and_exposes_no_secrets(client):
    data = client.get("/health/detailed").json()
    assert data["status"] == "ok"
    assert (data["active_games"], data["active_connections"]) == (0, 0)
    assert data["uptime_seconds"] > 0 and data["memory_mb"] > 0
    for field in ("timestamp", "version", "cpu_percent"):
        assert field in data
    assert not {"password", "secret", "token", "key"} & set(data)

    session_manager.create_room()
    session_manager.create_room()
    assert client.get("/health/detailed").json()["active_games"] == 2


@pytest.mark.parametrize(
    "path, status", [("/health/ready", "ready"), ("/health/live", "alive")]
)
def test_probes(client, path, status):
    response = client.get(path)
    assert response.status_code == 200 and response.json()["status"] == status
