"""Single-service serving: built frontend, /api prefix, SPA fallback."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from main import create_app

INDEX = "<!doctype html><html><body><div id='root'>BUYOUT-INDEX</div></body></html>"


@pytest.fixture
def dist(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text(INDEX)
    (tmp_path / "assets" / "app-abc123.js").write_text("console.log('hi')")
    (tmp_path / "favicon.svg").write_text("<svg/>")
    return tmp_path


@pytest.fixture
def client(dist, monkeypatch):
    monkeypatch.delenv("GAME_TEST_MODE", raising=False)
    with TestClient(create_app(frontend_dist=dist)) as c:
        yield c


@pytest.fixture
def nodist_client(tmp_path, monkeypatch):
    monkeypatch.delenv("GAME_TEST_MODE", raising=False)
    with TestClient(create_app(frontend_dist=tmp_path / "missing")) as c:
        yield c


def test_index_at_root_is_not_cached(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "BUYOUT-INDEX" in r.text
    assert r.headers["cache-control"] == "no-cache"


@pytest.mark.parametrize("path", ["/play/ABCD", "/host/ABCD", "/some/deep/route"])
def test_spa_fallback(client, path):
    r = client.get(path)
    assert r.status_code == 200
    assert "BUYOUT-INDEX" in r.text
    assert r.headers["cache-control"] == "no-cache"


def test_hashed_asset_is_long_lived(client):
    r = client.get("/assets/app-abc123.js")
    assert r.status_code == 200
    assert "console.log" in r.text
    assert "immutable" in r.headers["cache-control"]


def test_missing_asset_is_404(client):
    assert client.get("/assets/nope.js").status_code == 404


def test_top_level_file_served(client):
    r = client.get("/favicon.svg")
    assert r.status_code == 200
    assert r.text == "<svg/>"


def test_path_traversal_falls_back_to_index(client):
    r = client.get("/..%2f..%2fetc/passwd")
    assert r.status_code == 200
    assert "BUYOUT-INDEX" in r.text


def test_api_prefixed_and_bare_routes(client):
    for path in ("/api/agents/catalog", "/agents/catalog"):
        r = client.get(path)
        assert r.status_code == 200, path
        assert isinstance(r.json(), (list, dict))


def test_api_unknown_is_json_404(client):
    for path in ("/api/x", "/api/room/ZZZZ/nothing", "/api"):
        r = client.get(path)
        assert r.status_code == 404, path
        assert r.headers["content-type"].startswith("application/json")


def test_api_create_game_and_state(client):
    r = client.post("/api/create", data={"player_name": "Ann"})
    assert r.status_code == 200, r.text
    code = r.json()["room_code"]
    assert client.get(f"/api/room/{code}/state").status_code == 200
    assert client.get(f"/room/{code}/state").status_code == 200


def test_health_and_docs_still_work(client):
    assert client.get("/health").status_code == 200
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200


def test_websocket_route_still_connects(client):
    code = client.post("/api/create", data={"player_name": "Ann"}).json()["room_code"]
    with client.websocket_connect(f"/ws/host/{code}") as ws:
        assert ws.receive_json()


def test_unknown_websocket_path_is_not_index(client):
    # The WebSocket route (not the SPA fallback) answers: it accepts and closes with
    # 4004 "Room not found" (see api/ws.py `_refuse`).
    with (
        client.websocket_connect("/ws/host/NOPE") as ws,
        pytest.raises(WebSocketDisconnect) as exc,
    ):
        ws.receive_json()
    assert exc.value.code == 4004


def test_no_dist_mode_unchanged(nodist_client):
    assert nodist_client.get("/").status_code == 404
    assert nodist_client.get("/play/ABCD").status_code == 404
    assert nodist_client.get("/health").status_code == 200
    assert nodist_client.get("/agents/catalog").status_code == 200
    assert nodist_client.get("/api/agents/catalog").status_code == 200


def test_dist_without_index_is_ignored(tmp_path, monkeypatch):
    monkeypatch.delenv("GAME_TEST_MODE", raising=False)
    (tmp_path / "assets").mkdir()
    with TestClient(create_app(frontend_dist=tmp_path)) as c:
        assert c.get("/").status_code == 404


def test_testmode_routes_also_under_api(dist, monkeypatch):
    monkeypatch.setenv("GAME_TEST_MODE", "1")
    with TestClient(create_app(frontend_dist=dist)) as c:
        code = c.post("/api/create", data={"player_name": "Ann"}).json()["room_code"]
        assert c.get(f"/test/room/{code}/snapshot").status_code != 404
        assert c.get(f"/api/test/room/{code}/snapshot").status_code != 404
