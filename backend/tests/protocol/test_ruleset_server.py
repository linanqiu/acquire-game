"""A server configured with ``GAME_RULESET=mini`` plays whole games on mini."""

from __future__ import annotations

import pytest

from app_state import session_manager
from config import get_ruleset
from game.ruleset import classic, load_ruleset
from tests.protocol.helpers import (
    HumanClient,
    add_seat,
    configure,
    create_room,
    debug,
    start,
)

MINI = load_ruleset("mini")


@pytest.fixture
def mini_server(monkeypatch, fast_settings):
    monkeypatch.setattr(fast_settings, "game_ruleset", "mini")
    assert get_ruleset() == MINI


def test_config_game_route_returns_the_configured_ruleset(app_client, monkeypatch):
    for path in ("/config/game", "/api/config/game"):
        body = app_client.get(path).json()
        assert body == classic().public_dict()
    from config import get_settings

    monkeypatch.setattr(get_settings(), "game_ruleset", "mini")
    for path in ("/config/game", "/api/config/game"):
        r = app_client.get(path)
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == "mini" and body["fingerprint"] == MINI.fingerprint
        assert body["board"] == {"columns": 9, "rows": 7}
        assert [c["id"] for c in body["chains"]] == MINI.chain_ids


def test_protocol_validation_uses_the_configured_ruleset(mini_server):
    from protocol import validate_websocket_message

    ok, err = validate_websocket_message({"action": "place_tile", "tile": "9g"})
    assert err is None and ok.tile == "9G"
    for bad in ("10A", "1H", "12I"):
        _, err = validate_websocket_message({"action": "place_tile", "tile": bad})
        assert err and "1A, 5E, 9G" in err
    _, err = validate_websocket_message({"action": "found_chain", "chain": "Luxor"})
    assert "Invalid chain" in err
    ok, err = validate_websocket_message({"action": "found_chain", "chain": "harbor"})
    assert err is None
    _, err = validate_websocket_message(
        {"action": "buy_stocks", "purchases": {"harbor": 5}}
    )
    assert "more than 4" in err
    ok, err = validate_websocket_message(
        {"action": "buy_stocks", "purchases": {"harbor": 4}}
    )
    assert err is None


@pytest.mark.slow
def test_mini_server_plays_full_game_with_human_bot_and_scripted(
    app_client, mini_server
):
    client = app_client
    code, me = create_room(client, "Alice")
    room = session_manager.get_room(code)
    assert room.ruleset == MINI and room.max_players == MINI.max_players
    add_seat(client, code, "bot")
    add_seat(client, code, "scripted")
    configure(client, code, 4)

    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        human = HumanClient(ws, me)
        assert human.recv()["type"] == "lobby_update"
        start(client, code)
        final = human.play(max_actions=800)

    assert final["phase"] == "game_over"
    assert human.errors == []
    assert final["ruleset"]["id"] == "mini"
    assert final["ruleset"]["fingerprint"] == MINI.fingerprint
    assert {c["name"] for c in final["hotel"]["chains"]} == set(MINI.chain_ids)
    for cell in final["board"]["cells"]:
        assert int(cell[:-1]) <= 9 and cell[-1] in "ABCDEFG"
    assert any(a["action"] == "found_chain" for a in human.actions)
    assert any(
        e["type"] == "stocks_purchased"
        for e in session_manager.get_room(code).game.events
    )
    game = session_manager.get_room(code).game
    assert game.ruleset == MINI
    assert all(set(p.stocks) == set(MINI.chain_ids) for p in game.players)
    assert debug(client, code)["fallback_count"] == 0


@pytest.mark.slow
def test_mini_server_all_agent_game(app_client, mini_server):
    from tests.protocol.helpers import watch_until_game_over

    client = app_client
    code = client.post("/create-spectator").json()["room_code"]
    add_seat(client, code, "bot")
    add_seat(client, code, "bot")
    add_seat(client, code, "scripted")
    configure(client, code, 9)
    log: list[dict] = []
    with client.websocket_connect(f"/ws/host/{code}") as host:
        start(client, code)
        final = watch_until_game_over(host, log)
    assert final["ruleset"]["id"] == "mini"
    assert len(final["players"]) == 3
    assert debug(client, code)["fallback_count"] == 0
