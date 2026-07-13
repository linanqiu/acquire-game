"""Tests for SH-003: CORS configuration and WebSocket origin validation."""

import pytest
from starlette.websockets import WebSocketDisconnect

import main
from config import DEV_CORS_ORIGINS, Settings


class TestSettingsCorsOrigins:
    """Origin resolution in Settings.cors_origins."""

    def test_default_dev_origins_include_localhost(self):
        settings = Settings(environment="dev", allowed_origins="*")
        origins = settings.cors_origins
        assert "http://localhost:5173" in origins
        assert "http://localhost:3000" in origins
        assert "http://127.0.0.1:5173" in origins
        assert "*" not in origins

    def test_production_wildcard_resolves_to_no_origins(self):
        settings = Settings(environment="prod", allowed_origins="*")
        assert settings.cors_origins == []

    def test_explicit_origins_parsed_from_csv(self):
        settings = Settings(
            environment="prod",
            allowed_origins="https://acquire.example.com, https://www.acquire.example.com",
        )
        assert settings.cors_origins == [
            "https://acquire.example.com",
            "https://www.acquire.example.com",
        ]

    def test_empty_csv_entries_ignored(self):
        settings = Settings(allowed_origins="https://a.example.com,,")
        assert settings.cors_origins == ["https://a.example.com"]

    def test_is_production_accepts_prod_and_production(self):
        assert Settings(environment="prod").is_production
        assert Settings(environment="production").is_production
        assert Settings(environment="Production").is_production
        assert not Settings(environment="dev").is_production


class TestCorsHeaders:
    """CORS headers on REST responses (dev defaults active in tests)."""

    def test_preflight_allowed_origin(self, client):
        response = client.options(
            "/create",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert response.status_code == 200
        assert (
            response.headers["access-control-allow-origin"]
            == "http://localhost:5173"
        )
        assert response.headers["access-control-allow-credentials"] == "true"
        allowed_methods = response.headers["access-control-allow-methods"]
        assert "POST" in allowed_methods

    def test_preflight_disallowed_origin_rejected(self, client):
        response = client.options(
            "/create",
            headers={
                "Origin": "http://evil.example.com",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert "access-control-allow-origin" not in response.headers

    def test_simple_request_gets_cors_header_for_allowed_origin(
        self, client, clean_session_manager
    ):
        response = client.post(
            "/create",
            data={"player_name": "Alice"},
            headers={"Origin": "http://localhost:5173"},
        )
        assert response.status_code == 200
        assert (
            response.headers["access-control-allow-origin"]
            == "http://localhost:5173"
        )

    def test_dev_origins_match_config_constant(self):
        settings = Settings(environment="dev", allowed_origins="*")
        assert settings.cors_origins == DEV_CORS_ORIGINS


class TestWebSocketOriginValidation:
    """Origin checks on WebSocket handshakes."""

    def _create_room(self, client):
        data = client.post("/create", data={"player_name": "Alice"}).json()
        return data["room_code"], data["player_id"], data["session_token"]

    def test_dev_allows_any_origin(self, client, clean_session_manager):
        room_code, player_id, token = self._create_room(client)
        with client.websocket_connect(
            f"/ws/player/{room_code}/{player_id}?token={token}",
            headers={"Origin": "http://anything.example.com"},
        ) as ws:
            assert ws.receive_json()["type"] == "lobby_update"

    def test_production_rejects_disallowed_origin(
        self, client, clean_session_manager, monkeypatch
    ):
        room_code, player_id, token = self._create_room(client)
        monkeypatch.setattr(main.settings, "environment", "prod")
        monkeypatch.setattr(
            main.settings, "allowed_origins", "https://acquire.example.com"
        )
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(
                f"/ws/player/{room_code}/{player_id}?token={token}",
                headers={"Origin": "http://evil.example.com"},
            ):
                pass
        assert exc_info.value.code == 4003

    def test_production_allows_configured_origin(
        self, client, clean_session_manager, monkeypatch
    ):
        room_code, player_id, token = self._create_room(client)
        monkeypatch.setattr(main.settings, "environment", "prod")
        monkeypatch.setattr(
            main.settings, "allowed_origins", "https://acquire.example.com"
        )
        with client.websocket_connect(
            f"/ws/player/{room_code}/{player_id}?token={token}",
            headers={"Origin": "https://acquire.example.com"},
        ) as ws:
            assert ws.receive_json()["type"] == "lobby_update"

    def test_production_allows_same_origin_handshake(
        self, client, clean_session_manager, monkeypatch
    ):
        """Single-container serving: Origin host equals the Host header."""
        room_code, player_id, token = self._create_room(client)
        monkeypatch.setattr(main.settings, "environment", "prod")
        monkeypatch.setattr(main.settings, "allowed_origins", "*")
        with client.websocket_connect(
            f"/ws/player/{room_code}/{player_id}?token={token}",
            headers={"Origin": "http://testserver", "Host": "testserver"},
        ) as ws:
            assert ws.receive_json()["type"] == "lobby_update"

    def test_production_allows_missing_origin(
        self, client, clean_session_manager, monkeypatch
    ):
        """Non-browser clients omit Origin; they are gated by the token."""
        room_code, player_id, token = self._create_room(client)
        monkeypatch.setattr(main.settings, "environment", "prod")
        monkeypatch.setattr(
            main.settings, "allowed_origins", "https://acquire.example.com"
        )
        with client.websocket_connect(
            f"/ws/player/{room_code}/{player_id}?token={token}"
        ) as ws:
            assert ws.receive_json()["type"] == "lobby_update"

    def test_host_websocket_origin_checked(
        self, client, clean_session_manager, monkeypatch
    ):
        data = client.post("/create-spectator").json()
        monkeypatch.setattr(main.settings, "environment", "prod")
        monkeypatch.setattr(
            main.settings, "allowed_origins", "https://acquire.example.com"
        )
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(
                f"/ws/host/{data['room_code']}?token={data['host_token']}",
                headers={"Origin": "http://evil.example.com"},
            ):
                pass
        assert exc_info.value.code == 4003
