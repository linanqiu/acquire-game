"""Unknown rooms / seats are refused with close code 4004 and a reason.

Found by the tier-4 entry-errors journey: the server closed the socket before
accepting it, which browsers see as an HTTP 403 handshake failure with no code or
reason, so /play/XXXX for a missing room retried for a minute and then showed an
empty lobby. Now the socket is accepted and closed with 4004 + reason.
"""

from __future__ import annotations

import pytest
from starlette.websockets import WebSocketDisconnect

from tests.protocol.helpers import create_room


def _refusal(client, path: str) -> WebSocketDisconnect:
    with (
        client.websocket_connect(path) as ws,
        pytest.raises(WebSocketDisconnect) as exc,
    ):
        ws.receive_json()
    return exc.value


def test_player_socket_unknown_room(app_client):
    err = _refusal(app_client, "/ws/player/QZQZ/someone")
    assert err.code == 4004
    assert err.reason == "Room not found"


def test_player_socket_unknown_player(app_client):
    code, _ = create_room(app_client, "Alice")
    err = _refusal(app_client, f"/ws/player/{code}/-")
    assert err.code == 4004
    assert err.reason == "Player not found"


def test_host_socket_unknown_room(app_client):
    err = _refusal(app_client, "/ws/host/QZQZ")
    assert err.code == 4004
    assert err.reason == "Room not found"


def test_known_player_still_connects(app_client):
    code, me = create_room(app_client, "Alice")
    with app_client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        assert ws.receive_json()["type"] == "lobby_update"
