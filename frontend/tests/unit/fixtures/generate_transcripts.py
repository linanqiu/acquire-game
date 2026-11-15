"""Generate the frontend's sample fixtures by running the REAL backend.

Usage (from the repo root):

    GAME_TEST_MODE=1 python3 frontend/tests/unit/fixtures/generate_transcripts.py

Nothing here is synthesised: every file is the body of a real HTTP response from
the FastAPI app (via TestClient) after real games were played:

* a live game through the real server and a real player WebSocket: one human
  (a scripted client, same policy as the protocol tests), one LLM seat backed by
  a scripted provider (the first decisions are answered illegal, illegal, legal;
  one decision is always illegal so the rules-based player takes over), one bot;
* a small standalone benchmark run (`python -m bench run ... --games 4`) whose
  results directory the app serves at /bench/* and /games?source=bench.

Written next to this file:

    transcript-redacted.json    GET /games/{id}/transcript while the game runs
    game-summary-live.json      GET /games/{id} while the game runs
    transcript-full.json        the same game, finished
    game-summary.json           GET /games/{id}, finished
    games-list.json             GET /games?limit=3 (has a `next` cursor)
    games-list-page2.json       GET /games?limit=3&before=<next>
    leaderboard.json            GET /bench/leaderboard (from the real bench run)
    leaderboard-empty.json      GET /bench/leaderboard with no results
    series.json                 GET /bench/series/{id}
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
BACKEND = ROOT / "backend"

WORK = Path(tempfile.mkdtemp(prefix="game-fixtures-"))
os.environ["GAME_TEST_MODE"] = "1"
os.environ["GAME_TRANSCRIPT_DIR"] = str(WORK / "transcripts")
os.environ["GAME_BENCH_DIR"] = str(WORK / "bench")
os.environ["GAME_TEST_MODE_ACTION_DELAY"] = "0"
sys.path.insert(0, str(BACKEND))

ILLEGAL = {"why": "x", "action": {"action": "found_chain", "chain": "Nope"}, "note": ""}
# Scripted LLM behaviour, by the n-th LLM decision of the game (0-based).
ILLEGAL_TWICE = {1, 3}  # rejected twice, then answered legally
ALWAYS_ILLEGAL = {5}  # exhausts the retry budget -> rules-based fallback
STOP_AFTER_HUMAN_MOVES = 14  # where the "still running" snapshot is taken


def dump(name: str, body: str) -> None:
    # Re-serialise compactly but verbatim (key order kept).
    (HERE / name).write_text(json.dumps(json.loads(body), ensure_ascii=False) + "\n")


def run_bench() -> Path:
    out = WORK / "bench" / "run1"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "bench",
            "run",
            "--protocol",
            "bench-v1",
            "--models",
            "llm:fake",
            "--track",
            "vs-baseline",
            "--games",
            "4",
            "--out",
            str(out),
            "--quiet",
        ],
        cwd=BACKEND,
        env=os.environ.copy(),
        check=True,
    )
    return out


def install_scripted_llm() -> None:
    from agents.llm import config as llm_config
    from agents.llm.agent import LLMAgent
    from agents.llm.providers import FakeProvider

    state = {"decision": -1}

    def answer(system, user, schema):
        rejected = user.count("Rejected because")
        if rejected == 0:
            state["decision"] += 1
        n = state["decision"]
        if n in ALWAYS_ILLEGAL:
            return ILLEGAL
        if n in ILLEGAL_TWICE and rejected < 2:
            return ILLEGAL
        return None  # the first legal action

    entries = [
        {
            "id": "llm:fake",
            "kind": "llm",
            "label": "Fake LLM (test)",
            "description": "",
            "available": True,
        }
    ]
    llm_config.catalog_entries = lambda: entries
    llm_config.create_agent = lambda agent_id, *, name: LLMAgent(
        FakeProvider(answer), name=name, agent_id="llm:fake"
    )


def main() -> None:
    # Bench first, so the app reads the finished results.
    run_bench()

    from fastapi.testclient import TestClient

    from app_state import session_manager
    from config import get_settings
    from main import create_app
    from tests.protocol.helpers import (
        HumanClient,
        add_seat,
        configure,
        create_room,
        start,
    )

    s = get_settings()
    s.bot_decision_timeout = s.scripted_decision_timeout = s.llm_decision_timeout = 5.0
    s.test_mode_agent_action_delay = 0.0
    install_scripted_llm()
    session_manager._rooms.clear()

    with TestClient(create_app()) as client:
        code, me = create_room(client, "Dana")
        configure(client, code, 11)  # first: the seed also picks the seats' names
        add_seat(client, code, "llm:fake")
        add_seat(client, code, "bot")
        with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
            start(client, code)
            human = HumanClient(ws, me)
            moves = {"n": 0}

            def stop(state):
                if human.my_turn(state):
                    moves["n"] += 1
                return moves["n"] > STOP_AFTER_HUMAN_MOVES

            state = human.play(stop=stop, deadline_s=120)
            game_id = state["game_id"]
            r = client.get(f"/api/games/{game_id}/transcript")
            assert r.json()["redacted"] is True
            dump("transcript-redacted.json", r.text)
            dump("game-summary-live.json", client.get(f"/api/games/{game_id}").text)
            final = human.play(state=state, deadline_s=240)
            assert final["phase"] == "game_over"
            assert final["game_id"] == game_id

        r = client.get(f"/api/games/{game_id}/transcript", headers={"Accept-Encoding": "identity"})
        t = r.json()
        assert t["redacted"] is False and t["footer"], "game must be finished"
        dump("transcript-full.json", r.text)
        dump("game-summary.json", client.get(f"/api/games/{game_id}").text)

        page1 = client.get("/api/games?limit=3").json()
        assert page1["next"], "need more than 3 games for a cursor"
        dump("games-list.json", client.get("/api/games?limit=3").text)
        dump(
            "games-list-page2.json",
            client.get(f"/api/games?limit=3&before={page1['next']}").text,
        )
        board = client.get("/api/bench/leaderboard")
        dump("leaderboard.json", board.text)
        series_id = board.json()["series"][0]["series_id"]
        series = client.get(f"/api/bench/series/{series_id}")
        dump("series.json", series.text)

        # An empty bench dir
        os.environ["GAME_BENCH_DIR"] = str(WORK / "empty")
        dump("leaderboard-empty.json", client.get("/api/bench/leaderboard").text)

    summary = {
        "full_bytes": (HERE / "transcript-full.json").stat().st_size,
        "game_id": game_id,
    }
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
