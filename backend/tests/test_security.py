"""Tests for SH-001: session token enforcement on REST and WebSocket endpoints."""

import pytest
from starlette.websockets import WebSocketDisconnect


def _create_room(client, name="Alice"):
    """Create a room and return (room_code, player_id, session_token)."""
    response = client.post("/create", data={"player_name": name})
    assert response.status_code == 200
    data = response.json()
    return data["room_code"], data["player_id"], data["session_token"]


def _fill_room(client, room_code, names=("Bob", "Charlie")):
    """Join extra players so the room can start. Returns their join payloads."""
    payloads = []
    for name in names:
        response = client.post(
            "/join", data={"room_code": room_code, "player_name": name}
        )
        assert response.status_code == 200
        payloads.append(response.json())
    return payloads


class TestTokenIssuance:
    """Tokens are returned from /create, /join, and /create-spectator."""

    def test_create_returns_session_token(self, client, clean_session_manager):
        room_code, player_id, token = _create_room(client)
        assert token
        room = clean_session_manager.get_room(room_code)
        assert room.players[player_id].session_token == token

    def test_join_returns_session_token(self, client, clean_session_manager):
        room_code, _, _ = _create_room(client)
        (joined,) = _fill_room(client, room_code, names=("Bob",))
        assert joined["session_token"]
        room = clean_session_manager.get_room(room_code)
        assert (
            room.players[joined["player_id"]].session_token == joined["session_token"]
        )

    def test_tokens_are_unique_per_player(self, client, clean_session_manager):
        room_code, _, creator_token = _create_room(client)
        (joined,) = _fill_room(client, room_code, names=("Bob",))
        assert joined["session_token"] != creator_token

    def test_create_spectator_returns_host_token(self, client, clean_session_manager):
        response = client.post("/create-spectator")
        assert response.status_code == 200
        data = response.json()
        assert data["host_token"]
        room = clean_session_manager.get_room(data["room_code"])
        assert room.host_token == data["host_token"]


class TestRestTokenEnforcement:
    """Protected REST endpoints require a valid token."""

    def test_start_without_token_returns_401(self, client, clean_session_manager):
        room_code, _, _ = _create_room(client)
        _fill_room(client, room_code)
        response = client.post(f"/room/{room_code}/start")
        assert response.status_code == 401
        room = clean_session_manager.get_room(room_code)
        assert not room.started

    def test_start_with_invalid_token_returns_401(self, client, clean_session_manager):
        room_code, _, _ = _create_room(client)
        _fill_room(client, room_code)
        response = client.post(
            f"/room/{room_code}/start",
            headers={"Authorization": "Bearer not-a-real-token"},
        )
        assert response.status_code == 401

    def test_start_with_valid_token_succeeds(self, client, clean_session_manager):
        room_code, _, token = _create_room(client)
        _fill_room(client, room_code)
        response = client.post(
            f"/room/{room_code}/start",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        assert clean_session_manager.get_room(room_code).started

    def test_add_bot_without_token_returns_401(self, client, clean_session_manager):
        room_code, _, _ = _create_room(client)
        response = client.post(f"/room/{room_code}/add-bot")
        assert response.status_code == 401

    def test_add_bot_with_valid_token_succeeds(self, client, clean_session_manager):
        room_code, _, token = _create_room(client)
        response = client.post(
            f"/room/{room_code}/add-bot",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        assert response.json()["bot_id"]

    def test_add_bot_accepts_raw_token_header(self, client, clean_session_manager):
        """Authorization header without the Bearer prefix is also accepted."""
        room_code, _, token = _create_room(client)
        response = client.post(
            f"/room/{room_code}/add-bot", headers={"Authorization": token}
        )
        assert response.status_code == 200

    def test_host_token_authorizes_spectator_room(self, client, clean_session_manager):
        """Spectator flow: host token can add bots and start the game."""
        data = client.post("/create-spectator").json()
        room_code, host_token = data["room_code"], data["host_token"]
        headers = {"Authorization": f"Bearer {host_token}"}

        for _ in range(3):
            assert (
                client.post(f"/room/{room_code}/add-bot", headers=headers).status_code
                == 200
            )
        response = client.post(f"/room/{room_code}/start", headers=headers)
        assert response.status_code == 200

    def test_token_from_other_room_rejected(self, client, clean_session_manager):
        room_a, _, token_a = _create_room(client, name="Alice")
        room_b, _, _ = _create_room(client, name="Zoe")
        response = client.post(
            f"/room/{room_b}/add-bot",
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert response.status_code == 401

    def test_unknown_room_returns_404(self, client, clean_session_manager):
        response = client.post(
            "/room/ZZZZ/start", headers={"Authorization": "Bearer whatever"}
        )
        assert response.status_code == 404


class TestWebSocketTokenEnforcement:
    """WebSocket connections require a valid session token."""

    def test_player_ws_without_token_rejected(self, client, clean_session_manager):
        room_code, player_id, _ = _create_room(client)
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(f"/ws/player/{room_code}/{player_id}"):
                pass
        assert exc_info.value.code == 4001

    def test_player_ws_with_wrong_token_rejected(self, client, clean_session_manager):
        room_code, player_id, _ = _create_room(client)
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(
                f"/ws/player/{room_code}/{player_id}?token=wrong"
            ):
                pass
        assert exc_info.value.code == 4001

    def test_player_ws_with_other_players_token_rejected(
        self, client, clean_session_manager
    ):
        room_code, player_id, _ = _create_room(client)
        (joined,) = _fill_room(client, room_code, names=("Bob",))
        other_token = joined["session_token"]
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(
                f"/ws/player/{room_code}/{player_id}?token={other_token}"
            ):
                pass
        assert exc_info.value.code == 4001

    def test_player_ws_with_valid_token_connects(self, client, clean_session_manager):
        room_code, player_id, token = _create_room(client)
        with client.websocket_connect(
            f"/ws/player/{room_code}/{player_id}?token={token}"
        ) as ws:
            message = ws.receive_json()
            assert message["type"] == "lobby_update"

    def test_player_ws_unknown_room_still_4004(self, client, clean_session_manager):
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect("/ws/player/ZZZZ/nobody?token=x"):
                pass
        assert exc_info.value.code == 4004

    def test_host_ws_without_token_rejected(self, client, clean_session_manager):
        room_code, _, _ = _create_room(client)
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(f"/ws/host/{room_code}"):
                pass
        assert exc_info.value.code == 4001

    def test_host_ws_with_host_token_connects(self, client, clean_session_manager):
        data = client.post("/create-spectator").json()
        with client.websocket_connect(
            f"/ws/host/{data['room_code']}?token={data['host_token']}"
        ) as ws:
            message = ws.receive_json()
            assert message["type"] == "lobby_update"

    def test_host_ws_with_player_token_connects(self, client, clean_session_manager):
        room_code, _, token = _create_room(client)
        with client.websocket_connect(f"/ws/host/{room_code}?token={token}") as ws:
            message = ws.receive_json()
            assert message["type"] == "lobby_update"
