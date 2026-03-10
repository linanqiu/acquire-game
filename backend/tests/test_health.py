"""Tests for health check endpoints."""

import pytest
from fastapi.testclient import TestClient

from main import app, session_manager


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


class TestBasicHealth:
    """Tests for GET /health."""

    def test_health_returns_200(self, client):
        response = client.get("/health")
        assert response.status_code == 200

    def test_health_returns_ok_status(self, client):
        response = client.get("/health")
        data = response.json()
        assert data["status"] == "ok"

    def test_health_returns_timestamp(self, client):
        response = client.get("/health")
        data = response.json()
        assert "timestamp" in data
        assert len(data["timestamp"]) > 0


class TestDetailedHealth:
    """Tests for GET /health/detailed."""

    def test_detailed_returns_200(self, client):
        response = client.get("/health/detailed")
        assert response.status_code == 200

    def test_detailed_returns_all_fields(self, client):
        response = client.get("/health/detailed")
        data = response.json()
        assert data["status"] == "ok"
        assert "timestamp" in data
        assert "uptime_seconds" in data
        assert "version" in data
        assert "active_games" in data
        assert "active_connections" in data
        assert "memory_mb" in data
        assert "cpu_percent" in data

    def test_detailed_zero_games_when_empty(self, client):
        response = client.get("/health/detailed")
        data = response.json()
        assert data["active_games"] == 0
        assert data["active_connections"] == 0

    def test_detailed_counts_active_rooms(self, client):
        session_manager.create_room()
        session_manager.create_room()
        response = client.get("/health/detailed")
        data = response.json()
        assert data["active_games"] == 2

    def test_detailed_uptime_is_positive(self, client):
        response = client.get("/health/detailed")
        data = response.json()
        assert data["uptime_seconds"] > 0

    def test_detailed_memory_is_positive(self, client):
        response = client.get("/health/detailed")
        data = response.json()
        assert data["memory_mb"] > 0

    def test_detailed_no_sensitive_data(self, client):
        response = client.get("/health/detailed")
        data = response.json()
        # Ensure no sensitive fields are exposed
        assert "password" not in data
        assert "secret" not in data
        assert "token" not in data
        assert "key" not in data


class TestReadiness:
    """Tests for GET /health/ready."""

    def test_ready_returns_200(self, client):
        response = client.get("/health/ready")
        assert response.status_code == 200

    def test_ready_returns_ready_status(self, client):
        response = client.get("/health/ready")
        data = response.json()
        assert data["status"] == "ready"


class TestLiveness:
    """Tests for GET /health/live."""

    def test_live_returns_200(self, client):
        response = client.get("/health/live")
        assert response.status_code == 200

    def test_live_returns_alive_status(self, client):
        response = client.get("/health/live")
        data = response.json()
        assert data["status"] == "alive"
