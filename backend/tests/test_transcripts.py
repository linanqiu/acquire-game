"""Transcript writer / store / replay (offline, no server)."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

import bench.runner as runner_mod
from agents.llm.agent import LLMAgent
from agents.llm.providers import FakeProvider
from bench.runner import run_game
from game.game import Game
from transcripts import TranscriptStore, TranscriptWriter, read_transcript, redact
from transcripts.replay import final_scores, replay
from transcripts.store import HIDDEN_ERROR, has_footer, totals_from_entries

ILLEGAL = {"why": "x", "action": {"action": "found_chain", "chain": "Nope"}, "note": ""}


@pytest.fixture
def fast_calc(monkeypatch):
    monkeypatch.setattr("game.calculator.build_calculator_pack", lambda game, pid: {})


def play(seats, seed, tmp_path, **kw):
    return asyncio.run(run_game(seats, seed, transcript_dir=tmp_path, **kw))


def lines(path) -> list[dict]:
    return [json.loads(x) for x in Path(path).read_text().splitlines() if x.strip()]


def stop_after(n: int):
    calls = {"n": 0}

    def stop():
        calls["n"] += 1
        return calls["n"] > n

    return stop


# ------------------------------------------------------------------ format


def test_full_bot_game_every_action_once_in_order_and_replays(fast_calc, tmp_path):
    rec = play(["bot", "bot", "bot", "bot"], 5, tmp_path)
    assert rec.status == "completed" and rec.game_id
    ls = lines(rec.transcript)
    assert ls[0]["type"] == "header" and ls[-1]["type"] == "footer"
    assert ls[0]["source"] == "bench" and ls[0]["seed"] == 5
    body = ls[1:-1]
    assert {x["type"] for x in body} == {"event", "decision", "state"}
    seqs = [x["event"]["seq"] for x in body if x["type"] == "event"]
    assert seqs == list(range(len(seqs)))  # contiguous, each event once
    decisions = [x for x in body if x["type"] == "decision"]
    assert [d["index"] for d in decisions] == list(range(len(decisions)))
    assert len(decisions) == rec.decisions
    # ordering: decision after the events before it, state after its events
    last_seq = -1
    pending_state = None
    for x in body:
        if x["type"] == "event":
            last_seq = x["event"]["seq"]
        elif x["type"] == "decision":
            assert pending_state is None
            assert x["after_seq"] == last_seq
            pending_state = x
        else:
            assert x["after_seq"] == last_seq
            pending_state = None
    t = read_transcript(rec.transcript)
    game = replay(t)
    assert final_scores(game) == {
        s["player_id"]: s["score"] for s in t["footer"]["standings"]
    }
    assert t["footer"]["reason"] in ("declared", "no_playable_tiles")
    totals = t["footer"]["totals"]
    assert sum(v["decisions"] for v in totals.values()) == len(decisions)
    assert all(v["cost_usd"] == 0.0 for v in totals.values())
    side = json.loads((tmp_path / f"{rec.game_id}.summary.json").read_text())
    assert side["status"] == "finished" and side["turns"] == rec.turns


def test_crash_leaves_valid_unfinished_file(tmp_path):
    game = Game(seed=1)
    for i in range(3):
        game.add_player(f"p{i}", f"P{i}")
    game.start_game()
    w = TranscriptWriter.open(
        game,
        seats=[{"player_id": f"p{i}", "name": f"P{i}"} for i in range(3)],
        directory=tmp_path,
    )
    # process "dies": no close; plus a torn line at the end
    with open(w.path, "a") as fh:
        fh.write('{"type":"decision","ind')
    t = read_transcript(w.path)
    assert t["header"]["game_id"] == w.game_id and t["footer"] is None
    assert not has_footer(w.path)
    store = TranscriptStore([tmp_path])
    (row,) = store.list()["games"]
    assert row["status"] == "abandoned" and row["game_id"] == w.game_id
    assert store.transcript(w.game_id)["redacted"] is True


def test_writer_errors_never_raise_and_disable(tmp_path, monkeypatch):
    game = Game(seed=1)
    for i in range(3):
        game.add_player(f"p{i}", f"P{i}")
    game.start_game()
    blocker = tmp_path / "file"
    blocker.write_text("x")
    assert (
        TranscriptWriter.open(game, seats=[], directory=blocker / "sub") is None
    )  # cannot create the directory
    w = TranscriptWriter.open(
        game, seats=[{"player_id": "p0", "name": "P0"}], directory=tmp_path
    )
    w._fh.close()  # every later write fails
    w.record_decision(
        player_id="p0",
        kind="x",
        action={"action": "end_turn"},
        source="bot",
        after_seq=0,
    )
    w.close("abandoned")
    assert w.broken
    monkeypatch.setenv("GAME_TRANSCRIPT_DIR", "off")
    assert TranscriptWriter.open(game, seats=[]) is None
    monkeypatch.setenv("GAME_TRANSCRIPT_DIR", "")
    assert TranscriptWriter.open(game, seats=[]) is None


# -------------------------------------------------------------- LLM records


def llm_seat(provider, **kw):
    return ("llm:test", lambda: LLMAgent(provider, agent_id="llm:test", **kw))


def first_llm_decisions(path) -> list[dict]:
    return [
        x for x in lines(path) if x["type"] in ("decision",) and x["player_id"] == "p1"
    ]


def test_illegal_illegal_legal_records_three_attempts(tmp_path):
    def answer(system, user, schema):
        return ILLEGAL if user.count("Rejected because") < 2 else None

    prov = FakeProvider(answer)
    rec = play([llm_seat(prov), "bot", "bot"], 3, tmp_path, stop=stop_after(4))
    assert rec.status == "aborted"
    d = first_llm_decisions(rec.transcript)[0]
    assert d["source"] == "llm" and d["fallback"] is None
    llm = d["llm"]
    assert llm["model"] == "fake" and "# Your seat" in llm["user_prompt"]
    a = llm["attempts"]
    assert len(a) == 3
    assert a[0]["error"] and a[1]["error"] and a[2]["error"] is None
    assert a[0]["retry_prompt"] is None
    assert a[1]["retry_prompt"].count("Rejected because") == 1
    assert a[2]["retry_prompt"].count("Rejected because") == 2
    assert all(x["raw"] for x in a) and a[0]["parsed"]["action"]["chain"] == "Nope"
    assert a[2]["input_tokens"] > 0
    header = lines(rec.transcript)[0]
    assert llm["system_prompt_id"] in header["system_prompts"]
    assert rec.seats[0].retries >= 2
    footer = lines(rec.transcript)[-1]
    assert footer["reason"] == "abandoned"
    assert footer["totals"]["p1"]["retries"] >= 2  # rejected answers


def test_fallback_records_failed_attempts_reason_and_bot_action(tmp_path):
    prov = FakeProvider([ILLEGAL])  # always illegal
    rec = play(
        [llm_seat(prov, max_illegal_retries=2), "bot", "bot"],
        3,
        tmp_path,
        stop=stop_after(2),
    )
    d = first_llm_decisions(rec.transcript)[0]
    assert d["source"] == "fallback"
    assert d["fallback"]["reason"] == "illegal"
    assert "rules-based player" in d["fallback"]["message"]
    assert d["action"]["action"] in d["legal"]["action_types"]
    assert len(d["llm"]["attempts"]) == 3
    assert all(a["error"] for a in d["llm"]["attempts"])
    assert d["llm"]["outcome"] == "failed"


def test_engine_rejection_is_recorded_on_the_attempt(tmp_path, monkeypatch):
    real = runner_mod.check_answer
    state = {"n": 0}

    def picky(game, decision, ctx, action, counts):
        if decision.player_id == "p1" and state["n"] < 1:
            state["n"] += 1
            return "engine refuses #1"
        return real(game, decision, ctx, action, counts)

    monkeypatch.setattr(runner_mod, "check_answer", picky)
    rec = play(
        [llm_seat(FakeProvider()), "bot", "bot"], 3, tmp_path, stop=stop_after(2)
    )
    d = first_llm_decisions(rec.transcript)[0]
    a = d["llm"]["attempts"]
    assert d["source"] == "llm" and len(a) == 2
    assert a[0]["error"] == "engine refuses #1" and a[1]["error"] is None
    assert "engine refuses #1" in a[1]["retry_prompt"]


def test_timeout_keeps_the_cut_off_attempt(tmp_path):
    prov = FakeProvider(delay=1.0)
    rec = play(
        [llm_seat(prov), "bot", "bot"],
        3,
        tmp_path,
        stop=stop_after(1),
    )
    # (decision_timeout below the provider delay)
    d = first_llm_decisions(rec.transcript)[0]
    assert d["source"] == "fallback" and d["fallback"]["reason"] == "timeout"
    assert d["llm"]["attempts"][0]["raw"] is None


@pytest.fixture(autouse=True)
def _short_llm_timeout(monkeypatch):
    from config import get_settings

    monkeypatch.setattr(get_settings(), "llm_decision_timeout", 0.3)


# ---------------------------------------------------------------- redaction


def test_redaction_strips_private_and_prompt_fields(tmp_path):
    rec = play(
        [llm_seat(FakeProvider()), "bot", "bot"], 3, tmp_path, stop=stop_after(6)
    )
    t = read_transcript(rec.transcript)
    r = redact(t)
    text = json.dumps(r)
    assert r["header"]["seed"] is None and r["header"]["tile_order"] is None
    assert not any(
        e["type"] == "event" and e["event"].get("private_to") for e in r["entries"]
    )
    assert any(
        e["type"] == "event" and e["event"].get("private_to") for e in t["entries"]
    )
    for e in r["entries"]:
        if e["type"] == "decision":
            assert "tiles" not in (e["legal"] or {})
            if e["llm"]:
                assert not {"user_prompt", "why", "note"} & set(e["llm"])
                for a in e["llm"]["attempts"]:
                    assert not {"raw", "retry_prompt"} & set(a)
                    assert a["parsed"] is None and "rejected" in a
                    assert a["error"] in (None, HIDDEN_ERROR)
    assert "# Your seat" not in text


def test_redaction_hides_every_trace_of_a_hand_and_keeps_the_public_record():
    """One decision line with everything that can quote a tile in hand (7C)."""
    secret = "7C"
    t = {
        "header": {"seed": 4, "tile_order": [secret], "seats": []},
        "entries": [
            {"type": "event", "event": {"type": "tiles_dealt", "private_to": "p1"}},
            {"type": "event", "event": {"type": "turn_ended", "private_to": None}},
            {"type": "chat", "text": "public"},
            {
                "type": "decision",
                "player_id": "p1",
                "legal": {"action_types": ["place_tile"], "tiles": [secret]},
                "fallback": {"reason": "illegal", "detail": f"tile {secret}"},
                "llm": {
                    "user_prompt": secret,
                    "why": secret,
                    "note": secret,
                    "error": secret,
                    "model": "m",
                    "attempts": [
                        {
                            "raw": secret,
                            "retry_prompt": secret,
                            "parsed": secret,
                            "error": f"{secret} is not legal",
                            "ms": 5,
                        },
                        {"raw": secret, "parsed": {"tile": secret}, "error": None},
                    ],
                },
            },
        ],
        "footer": None,
    }
    r = redact(t)
    assert secret not in json.dumps(r)
    assert r["header"]["seed"] is None and r["header"]["tile_order"] is None
    # public lines are kept, in order
    assert [e["type"] for e in r["entries"]] == ["event", "chat", "decision"]
    d = r["entries"][2]
    assert d["fallback"] == {"reason": "illegal"}
    assert d["legal"] == {"action_types": ["place_tile"]}
    assert d["llm"]["model"] == "m"
    assert d["llm"]["attempts"] == [
        {"ms": 5, "parsed": None, "error": HIDDEN_ERROR, "rejected": True},
        {"parsed": None, "error": None, "rejected": False},
    ]
    # the original is untouched
    assert t["entries"][3]["fallback"]["detail"] == f"tile {secret}"


def test_totals_of_an_abandoned_game_are_rebuilt_from_its_decision_lines():
    """A game that stopped without a footer (and is not running here): the
    store recomputes each seat's totals from the decision lines."""
    t = {
        "header": {"seats": [{"player_id": "p1"}, {"player_id": "p2"}]},
        "entries": [
            {"type": "event", "event": {"type": "turn_ended"}},
            {
                "type": "decision",
                "player_id": "p1",
                "source": "llm",
                "latency_s": 1.25,
                "llm": {
                    "attempts": [
                        {"raw": "{}", "error": "illegal", "input_tokens": 100,
                         "output_tokens": 10},
                        {"raw": "{}", "error": None, "input_tokens": 120,
                         "output_tokens": 12, "cache_read_tokens": 80},
                        {"raw": None, "error": "timeout"},
                    ]
                },
            },
            {"type": "decision", "player_id": "p1", "source": "fallback",
             "latency_s": 0.5},
            {"type": "decision", "player_id": "p2", "source": "human",
             "latency_s": 30.0},
            {"type": "decision", "player_id": "ghost", "source": "bot"},
        ],
        "footer": None,
    }  # fmt: skip
    totals = totals_from_entries(t)
    assert totals["p1"] == {
        "decisions": 2,
        "llm_calls": 2,
        "retries": 2,
        "fallbacks": 1,
        "input_tokens": 220,
        "output_tokens": 22,
        "cache_read_tokens": 80,
        "cache_write_tokens": 0,
        "cost_usd": None,
        "latency_s": 1.75,
        "reply_calls": 0,
    }
    # a human's thinking time is not agent latency
    assert totals["p2"]["decisions"] == 1 and totals["p2"]["latency_s"] == 0.0
    assert set(totals) == {"p1", "p2"}
