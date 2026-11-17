"""A server configured with ``GAME_RULESET=mini`` plays whole games on mini."""

from __future__ import annotations

import pytest

from app_state import session_manager
from config import get_ruleset
from game.ruleset import default_ruleset, load_ruleset
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
        assert body == {**default_ruleset().public_dict(), "brand": "Buyout"}
    from config import get_settings

    monkeypatch.setattr(get_settings(), "game_ruleset", "mini")
    for path in ("/config/game", "/api/config/game"):
        r = app_client.get(path)
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == "mini" and body["fingerprint"] == MINI.fingerprint
        assert body["board"] == {"columns": 9, "rows": 7}
        assert [c["id"] for c in body["chains"]] == MINI.chain_ids
        assert body["brand"] == "Buyout"


def test_config_game_route_brand_is_its_own_setting(app_client, monkeypatch):
    """The product name (GAME_BRAND_NAME) is separate from the theme title and
    does not change the ruleset or its fingerprint."""
    from config import get_settings

    monkeypatch.setattr(get_settings(), "game_brand_name", "Testbrand")
    body = app_client.get("/api/config/game").json()
    assert body["brand"] == "Testbrand"
    assert body["title"] == default_ruleset().title == "Grand Hotels"
    assert body["fingerprint"] == default_ruleset().fingerprint


def test_protocol_validation_uses_the_configured_ruleset(mini_server):
    from protocol import validate_websocket_message

    ok, err = validate_websocket_message({"action": "place_tile", "tile": "9g"})
    assert err is None and ok.tile == "9G"
    for bad in ("10A", "1H", "12I"):
        _, err = validate_websocket_message({"action": "place_tile", "tile": bad})
        assert err and "1A, 5E, 9G" in err
    _, err = validate_websocket_message({"action": "found_chain", "chain": "juniper"})
    assert "Invalid chain" in err
    ok, err = validate_websocket_message(
        {"action": "found_chain", "chain": "sandpiper"}
    )
    assert err is None
    _, err = validate_websocket_message(
        {"action": "buy_stocks", "purchases": {"sandpiper": 5}}
    )
    assert "more than 4" in err
    ok, err = validate_websocket_message(
        {"action": "buy_stocks", "purchases": {"sandpiper": 4}}
    )
    assert err is None


def _found_when_possible(human, state):
    """The human plays a tile that founds a chain when its hand has one (the
    bot founds chains eagerly too, so a first-tile human may never get to),
    otherwise the default first playable tile. Founding is read from the
    public board: a tile touching a lone tile and no chain."""
    if state["awaiting"]["decision"] != "place_tile" or state.get("end_game_available"):
        return None
    cells = state["board"]["cells"]
    play = state.get("tile_playability") or {}
    for t in state["your_hand"]:
        if not play.get(t, {}).get("playable", True):
            continue
        col, row = int(t[:-1]), t[-1]
        near = [
            cells.get(f"{c}{r}")
            for c, r in (
                (col - 1, row),
                (col + 1, row),
                (col, chr(ord(row) - 1)),
                (col, chr(ord(row) + 1)),
            )
        ]
        near = [n for n in near if n]
        if near and all(n.get("chain") is None for n in near):
            return {"action": "place_tile", "tile": t}
    return None


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
        final = human.play(max_actions=800, on_state=_found_when_possible)

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


def test_live_llm_seat_on_mini_transcript_carries_the_text_it_used(
    app_client, mini_server, tmp_path, monkeypatch
):
    """An unpatched ``llm:fake`` seat in a room on ``mini``: the transcript's
    header ``system_prompts`` is the mini prompt (no default chain names), the
    decisions' prompt ids point at it, and the header names the ruleset."""
    from agents.llm.prompt import build_system_prompt, prompt_version, system_prompt_id
    from tests.protocol.helpers import watch_until_game_over

    monkeypatch.setenv("GAME_TRANSCRIPT_DIR", str(tmp_path / "t"))
    client = app_client
    code = client.post("/create-spectator").json()["room_code"]
    add_seat(client, code, "llm:fake")
    add_seat(client, code, "bot")
    configure(client, code, 4)
    with client.websocket_connect(f"/ws/host/{code}") as host:
        start(client, code)
        watch_until_game_over(host)
    game_id = session_manager.get_room(code).game_id
    t = client.get(f"/api/games/{game_id}/transcript").json()
    h = t["header"]
    text = build_system_prompt(MINI)
    sp = system_prompt_id(text, MINI)
    assert h["system_prompts"] == {sp: text}
    assert h["prompt_version"] == prompt_version(MINI)
    assert h["prompt_version"] != prompt_version(default_ruleset())
    assert h["ruleset_id"] == "mini" and h["ruleset"] == MINI.to_dict()
    llm = [e["llm"] for e in t["entries"] if e["type"] == "decision" and e["llm"]]
    assert llm and {d["system_prompt_id"] for d in llm} == {sp}
    # mini uses five of the default chains; the other two must not appear
    for name in set(default_ruleset().chain_ids) - set(MINI.chain_ids):
        assert name not in text
        assert all(name not in d["user_prompt"] for d in llm)
    detail = client.get(f"/api/games/{game_id}").json()
    assert detail["ruleset_id"] == "mini" and detail["ruleset_title"] == MINI.title
