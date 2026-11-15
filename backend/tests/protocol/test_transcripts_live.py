"""Live games through the real server write transcripts that are served over
HTTP: redacted while the game runs, complete after game over, linked by
``game_id`` in ``game_state`` / ``game_over``, and replayable."""

from __future__ import annotations

import gzip
import json
import re

import pytest

from transcripts.replay import final_scores, replay
from tests.protocol.helpers import (
    HumanClient,
    add_seat,
    configure,
    create_room,
    recv_until,
    start,
)

PROMPT_MARKERS = ("# Your seat", "Rejected because", "Legal action types")


@pytest.fixture
def tdir(tmp_path, monkeypatch):
    d = tmp_path / "transcripts"
    monkeypatch.setenv("GAME_TRANSCRIPT_DIR", str(d))
    monkeypatch.setenv("GAME_BENCH_DIR", str(tmp_path / "bench"))
    return d


def tile_pattern(tile: str) -> re.Pattern:
    # "2C" must not match inside "12C"; ids/uuids are lowercase hex
    return re.compile(r"(?<![0-9A-Za-z])" + re.escape(tile) + r"(?![0-9A-Za-z])")


def get_transcript(client, game_id: str, prefix: str = "/api") -> tuple[dict, str]:
    r = client.get(f"{prefix}/games/{game_id}/transcript")
    assert r.status_code == 200, r.text
    return r.json(), r.text


def test_unfinished_live_game_is_redacted_then_complete(app_client, tdir):
    client = app_client
    code, me = create_room(client, "Alice")
    add_seat(client, code, "llm:fake")
    add_seat(client, code, "bot")
    configure(client, code, 11)
    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        start(client, code)
        human = HumanClient(ws, me)
        # play until Alice has made a few moves (the LLM and bot too)
        moves = {"n": 0}

        def stop(state):
            if human.my_turn(state):
                moves["n"] += 1
            return moves["n"] > 4

        state = human.play(stop=stop)
        game_id = state["game_id"]
        assert game_id

        snap = client.get(f"/test/room/{code}/snapshot").json()
        hidden = [t for p in snap["players"] for t in p["hand"]]
        assert len(hidden) >= 15
        t, text = get_transcript(client, game_id)
        assert t["redacted"] is True and t["footer"] is None
        assert t["header"]["seed"] is None
        # the static system prompt (public rules) uses "5C" as an example tile
        assert t["header"]["system_prompts"]
        text = text.replace(
            json.dumps(t["header"]["system_prompts"], separators=(",", ":"))[1:-1],
            "",
        )
        assert "Rules as implemented" not in text
        for tile in hidden:
            m = tile_pattern(tile).search(text)
            assert not m, (
                f"hand tile {tile} leaked: {text[m.start() - 300 : m.end() + 50]}"
            )
        for marker in PROMPT_MARKERS:
            assert marker not in text
        decisions = [e for e in t["entries"] if e["type"] == "decision"]
        # (an LLM seat's forced end of turn is a move with no model call)
        llm = [d for d in decisions if d["source"] == "llm" and d["llm"]]
        assert llm and all("user_prompt" not in d["llm"] for d in llm)
        assert any(d["source"] == "human" for d in decisions)
        assert t["live_totals"][me]["decisions"] >= 4
        # listing shows it as live
        rows = client.get("/api/games?source=live").json()["games"]
        assert [r["status"] for r in rows if r["game_id"] == game_id] == ["live"]

        final = human.play(state=state)
        assert final["phase"] == "game_over"
        over = [m for m in human.messages if m.get("type") == "game_over"]
        assert over and over[-1]["game_id"] == game_id

    t, text = get_transcript(client, game_id, prefix="")
    assert t["redacted"] is False and t["footer"] is not None
    assert "# Your seat" in text  # the full prompts are public now
    llm = [
        e
        for e in t["entries"]
        if e["type"] == "decision" and e["source"] == "llm" and e["llm"]
    ]
    assert llm[0]["llm"]["user_prompt"] and llm[0]["llm"]["attempts"][0]["raw"]
    sp = llm[0]["llm"]["system_prompt_id"]
    assert sp in t["header"]["system_prompts"]
    game = replay(t)
    assert final_scores(game) == {
        s["player_id"]: s["score"] for s in t["footer"]["standings"]
    }
    detail = client.get(f"/api/games/{game_id}").json()
    assert detail["status"] == "finished" and detail["room_code"] == code
    assert detail["winners"] and detail["totals"][me]["decisions"] > 0


@pytest.mark.slow
def test_all_agent_room_transcript_linked_from_game_over(app_client, tdir):
    client = app_client
    code = client.post("/create-spectator").json()["room_code"]
    add_seat(client, code, "llm:fake")
    add_seat(client, code, "bot")
    add_seat(client, code, "bot")
    configure(client, code, 4)
    with client.websocket_connect(f"/ws/host/{code}") as host:
        start(client, code)
        over = recv_until(host, lambda m: m.get("type") == "game_over")
    game_id = over["game_id"]
    r = client.get(
        f"/api/games/{game_id}/transcript", headers={"Accept-Encoding": "gzip"}
    )
    assert r.status_code == 200 and r.headers.get("content-encoding") == "gzip"
    t = r.json()  # the client decompresses
    assert t["footer"]["reason"] in ("declared", "no_playable_tiles")
    assert t["header"]["source"] == "live" and t["header"]["room_code"] == code
    seqs = [e["event"]["seq"] for e in t["entries"] if e["type"] == "event"]
    assert seqs == list(range(len(seqs)))
    game = replay(t)
    assert final_scores(game) == {
        s["player_id"]: s["score"] for s in t["footer"]["standings"]
    }
    raw = (tdir / f"{game_id}.jsonl").read_bytes()
    assert gzip.compress(raw)  # file on disk is plain JSONL
    assert json.loads(raw.splitlines()[0])["type"] == "header"


def test_snapshot_load_starts_a_new_transcript(app_client, tdir):
    client = app_client
    code = client.post("/create-spectator").json()["room_code"]
    a = add_seat(client, code, "scripted")
    b = add_seat(client, code, "scripted")
    c = add_seat(client, code, "scripted")
    configure(client, code, 3)
    # a game in progress (scripted seats play fast; the host sees the id)
    with client.websocket_connect(f"/ws/host/{code}") as host:
        start(client, code)
        first = recv_until(host, lambda m: m.get("type") == "game_state")
        old_id = first["game_id"]
        snap = client.get(f"/test/room/{code}/snapshot").json()
        r = client.post(f"/test/room/{code}/load-snapshot", json={"snapshot": snap})
        assert r.status_code == 200, r.text
        state = recv_until(
            host,
            lambda m: m.get("type") == "game_state" and m.get("game_id") != old_id,
        )
    new_id = state["game_id"]
    header = json.loads((tdir / f"{new_id}.jsonl").read_text().splitlines()[0])
    assert header["loaded_from_snapshot"] is True and header["start_seq"] > 0
    assert {s["player_id"] for s in header["seats"]} == {
        a["player_id"],
        b["player_id"],
        c["player_id"],
    }
    old = client.get(f"/api/games/{old_id}").json()
    assert old["status"] in ("abandoned", "finished")
