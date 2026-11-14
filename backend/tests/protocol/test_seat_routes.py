"""(i) test-mode routes, (j) catalog / add-seat / remove-seat."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app_state import session_manager
from tests.protocol.helpers import add_seat, create_room, join_room, start

REPO = Path(__file__).resolve().parents[3]


@pytest.fixture
def prod_client(monkeypatch):
    """App built with test mode OFF."""
    monkeypatch.delenv("ACQUIRE_TEST_MODE", raising=False)
    from main import create_app

    session_manager._rooms.clear()
    with TestClient(create_app()) as c:
        yield c
    session_manager._rooms.clear()


class TestTestModeOff:
    def test_default_is_off(self, monkeypatch):
        monkeypatch.delenv("ACQUIRE_TEST_MODE", raising=False)
        from main import test_mode_enabled

        assert test_mode_enabled() is False

    def test_deploy_config_never_enables_test_mode(self):
        for path in [REPO / "railway.toml", *(REPO / "deploy").rglob("*")]:
            if path.is_file():
                assert "ACQUIRE_TEST_MODE" not in path.read_text(errors="ignore"), path

    def test_test_routes_absent(self, prod_client):
        code, _ = create_room(prod_client)
        assert prod_client.get(f"/test/room/{code}/snapshot").status_code == 404
        r = prod_client.post(f"/test/room/{code}/load-snapshot", json={"snapshot": {}})
        assert r.status_code == 404

    def test_scripted_not_offered_or_accepted(self, prod_client):
        ids = [e["id"] for e in prod_client.get("/agents/catalog").json()]
        assert "scripted" not in ids
        code, _ = create_room(prod_client)
        r = prod_client.post(f"/room/{code}/add-seat", json={"agent_id": "scripted"})
        assert r.status_code == 404

    def test_test_routes_present_in_test_mode(self, app_client):
        code, _ = create_room(app_client)
        add_seat(app_client, code, "bot")
        add_seat(app_client, code, "bot")
        start(app_client, code)
        snap = app_client.get(f"/test/room/{code}/snapshot").json()
        assert snap["version"] == 1 and len(snap["players"]) == 3


class TestCatalog:
    def test_shape_and_bot_entry(self, app_client):
        catalog = app_client.get("/agents/catalog").json()
        assert isinstance(catalog, list)
        for e in catalog:
            assert set(e) >= {"id", "kind", "label", "description", "available"}
        bot = next(e for e in catalog if e["id"] == "bot")
        assert bot["kind"] == "bot" and bot["available"] is True
        assert "scripted" in [e["id"] for e in catalog]

    def test_llm_import_failure_keeps_bot(self, monkeypatch):
        import builtins

        from agents import registry

        real_import = builtins.__import__

        def no_llm(name, *a, **kw):
            if name.startswith("agents.llm"):
                raise ImportError("no llm")
            return real_import(name, *a, **kw)

        monkeypatch.setattr(builtins, "__import__", no_llm)
        assert [e["id"] for e in registry.catalog()][0] == "bot"


class TestAddRemoveSeat:
    def _fake_llm(self, monkeypatch, available=True):
        from agents.llm import config as llm_config

        monkeypatch.setattr(
            llm_config,
            "catalog_entries",
            lambda: [
                {
                    "id": "llm:x",
                    "kind": "llm",
                    "label": "Model X",
                    "description": "",
                    "available": available,
                }
            ],
        )

        class Dummy:
            kind = "llm"

            async def decide(self, ctx):  # pragma: no cover - never started
                raise RuntimeError

        monkeypatch.setattr(llm_config, "create_agent", lambda aid, *, name: Dummy())

    def test_add_seat_and_lobby_update(self, app_client, monkeypatch):
        self._fake_llm(monkeypatch)
        code, me = create_room(app_client)
        with app_client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
            assert ws.receive_json()["type"] == "lobby_update"
            out = add_seat(app_client, code, "llm:x")
            assert out["kind"] == "llm" and out["name"] == "Model X"
            msg = ws.receive_json()
            assert msg["type"] == "lobby_update"
            seat = next(p for p in msg["players"] if p["player_id"] == out["player_id"])
            assert seat == {
                "player_id": out["player_id"],
                "name": "Model X",
                "is_bot": True,
                "kind": "llm",
                "agent_label": "Model X",
            }
            human = next(p for p in msg["players"] if p["player_id"] == me)
            assert human["kind"] == "human" and human["is_bot"] is False
            # duplicate label gets a number
            assert add_seat(app_client, code, "llm:x")["name"] == "Model X 2"
            ws.receive_json()
            r = app_client.post(f"/room/{code}/remove-seat/{out['player_id']}")
            assert r.status_code == 200
            msg = ws.receive_json()
            assert msg["type"] == "lobby_update"
            assert out["player_id"] not in [p["player_id"] for p in msg["players"]]

    def test_add_bot_alias(self, app_client):
        code, _ = create_room(app_client)
        r = app_client.post(f"/room/{code}/add-bot")
        assert r.status_code == 200
        body = r.json()
        assert body["bot_id"] == body["player_id"] and body["name"] == "Bot 1"
        state = app_client.get(f"/room/{code}/state").json()
        seat = next(p for p in state["players"] if p["player_id"] == body["bot_id"])
        assert seat["kind"] == "bot" and seat["is_bot"] is True

    def test_unknown_and_unavailable(self, app_client, monkeypatch):
        self._fake_llm(monkeypatch, available=False)
        code, _ = create_room(app_client)
        r = app_client.post(f"/room/{code}/add-seat", json={"agent_id": "nope"})
        assert r.status_code == 404
        r = app_client.post(f"/room/{code}/add-seat", json={"agent_id": "llm:x"})
        assert r.status_code == 400
        r = app_client.post(f"/room/{code}/add-seat", json={})
        assert r.status_code == 422
        r = app_client.post("/room/ZZZZ/add-seat", json={"agent_id": "bot"})
        assert r.status_code == 404

    def test_full_room(self, app_client):
        code, _ = create_room(app_client)
        for _ in range(5):
            add_seat(app_client, code, "bot")
        r = app_client.post(f"/room/{code}/add-seat", json={"agent_id": "bot"})
        assert r.status_code == 400
        assert "full" in r.json()["detail"].lower()

    def test_after_start(self, app_client):
        code, me = create_room(app_client)
        bot = add_seat(app_client, code, "bot")
        add_seat(app_client, code, "bot")
        start(app_client, code)
        r = app_client.post(f"/room/{code}/add-seat", json={"agent_id": "bot"})
        assert r.status_code == 400
        r = app_client.post(f"/room/{code}/remove-seat/{bot['player_id']}")
        assert r.status_code == 400

    def test_two_seats_cannot_start(self, app_client):
        """The engine needs 3 players; the room used to 500 and get stuck."""
        code, _ = create_room(app_client)
        add_seat(app_client, code, "bot")
        r = app_client.post(f"/room/{code}/start")
        assert r.status_code == 400
        assert app_client.get(f"/room/{code}/state").json()["started"] is False

    def test_cannot_remove_human_or_unknown(self, app_client):
        code, me = create_room(app_client)
        other = join_room(app_client, code, "Bob")
        assert app_client.post(f"/room/{code}/remove-seat/{other}").status_code == 400
        assert app_client.post(f"/room/{code}/remove-seat/{me}").status_code == 400
        assert app_client.post(f"/room/{code}/remove-seat/xyz").status_code == 404

    def test_script_only_for_scripted(self, app_client):
        code, _ = create_room(app_client)
        r = app_client.post(
            f"/room/{code}/add-seat", json={"agent_id": "bot", "script": []}
        )
        assert r.status_code == 400

    def test_human_cannot_act_for_agent_seat(self, app_client):
        code, me = create_room(app_client)
        bot = add_seat(app_client, code, "bot")
        add_seat(app_client, code, "bot")
        start(app_client, code)
        r = app_client.post(
            f"/room/{code}/action/{bot['player_id']}", json={"action": "end_turn"}
        )
        assert r.json()["status"] == "error"
        assert "AI" in r.json()["error"]
