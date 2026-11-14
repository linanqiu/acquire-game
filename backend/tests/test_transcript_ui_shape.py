"""The frontend's sample transcript (``frontend/tests/unit/fixtures/
transcript-full.json``, generated against the contract) as a SHAPE reference:
every key the UI's sample has per line type must be emitted by the real
writer. Extra keys from the writer are fine (additive)."""

from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from pathlib import Path

import pytest

from agents.llm.agent import LLMAgent
from agents.llm.providers import FakeProvider
from bench.runner import run_game
from transcripts import read_transcript

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "frontend/tests/unit/fixtures/transcript-full.json"
)
ILLEGAL = {"why": "x", "action": {"action": "found_chain", "chain": "Nope"}, "note": ""}


def shape(t: dict) -> dict[str, set]:
    ks: dict[str, set] = defaultdict(set)
    ks["top"] |= set(t)
    ks["header"] |= set(t["header"])
    ks["header.seat"] |= set(t["header"]["seats"][0])
    if t.get("footer"):
        ks["footer"] |= set(t["footer"])
        for st in t["footer"]["standings"]:
            ks["footer.standing"] |= set(st)
        for tot in t["footer"]["totals"].values():
            ks["footer.totals"] |= set(tot)
    for e in t["entries"]:
        ty = e.get("type")
        if ty == "decision":
            ks["decision"] |= set(e)
            if e.get("llm"):
                ks["llm"] |= set(e["llm"]) - {"system_prompt", "outcome", "error"}
                for a in e["llm"]["attempts"]:
                    ks["attempt"] |= set(a)
            if e.get("fallback"):
                ks["fallback"] |= set(e["fallback"])
        elif ty == "state":
            ks["state"] |= set(e)
            ks["state.public"] |= set(e["public"]) - {"merger_state"}
        else:
            ev = e["event"] if ty == "event" and "event" in e else e
            ks["event"] |= {"seq", "type", "player_id", "private_to"} & set(ev)
    return ks


@pytest.mark.skipif(not FIXTURE.exists(), reason="frontend fixture not present")
def test_writer_emits_every_key_the_ui_sample_has(tmp_path, monkeypatch):
    from config import get_settings

    monkeypatch.setattr(get_settings(), "llm_decision_timeout", 5.0)
    first = {"n": 0}

    def answer(system, user, schema):
        first["n"] += 1
        return ILLEGAL if first["n"] == 1 else None

    seats = [
        ("llm:a", lambda: LLMAgent(FakeProvider(answer), agent_id="llm:a")),
        (
            "llm:b",
            lambda: LLMAgent(
                FakeProvider([ILLEGAL]), agent_id="llm:b", max_illegal_retries=0
            ),
        ),
        "bot",
    ]
    calls = {"n": 0}

    def stop():
        calls["n"] += 1
        return calls["n"] > 40

    rec = asyncio.run(run_game(seats, 2, transcript_dir=tmp_path, stop=stop))
    mine = shape(read_transcript(rec.transcript) | {"redacted": False})
    # a finished game for the footer standings (the game above was stopped)
    monkeypatch.setattr("game.calculator.build_calculator_pack", lambda game, pid: {})
    done = asyncio.run(run_game(["bot"] * 3, 2, transcript_dir=tmp_path))
    full = shape(read_transcript(done.transcript) | {"redacted": False})
    mine["footer.standing"] = full["footer.standing"]
    ui = shape(json.loads(FIXTURE.read_text()))
    # the UI fixture has a footer; ours (stopped game) too, reason abandoned
    missing = {k: sorted(ui[k] - mine[k]) for k in ui if ui[k] - mine[k]}
    assert missing == {}, f"keys in the UI sample the writer does not emit: {missing}"
