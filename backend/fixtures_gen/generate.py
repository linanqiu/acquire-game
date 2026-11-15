"""Build fixture documents from search hits and write them to disk."""

from __future__ import annotations

import json
from pathlib import Path

from fixtures_gen.replay import (
    ReplayError,
    build_expect,
    make_players,
    replay_recipe,
    turn_count,
)
from fixtures_gen.search import Hit, search
from fixtures_gen.specs import FIXTURES_BY_NAME, Ctx, Fixture, evaluate
from game.snapshot import to_snapshot

FORMAT_VERSION = 1
SEED_BUDGET = 60

DEFAULT_OUT_DIR = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "tests"
    / "e2e"
    / "fixtures"
    / "snapshots"
)


def build_document(fixture: Fixture, hit: Hit) -> dict:
    """Replay the hit's recipe from scratch and describe the resulting state.

    Raises if replay fails or the replayed state does not satisfy the
    fixture's required criteria (the search and the replay must agree).
    """
    recipe = {
        "seed": hit.seed,
        "tile_order": None,
        "players": make_players(hit.players),
        "actions": hit.actions,
    }
    game = replay_recipe(recipe)
    ev = evaluate(fixture, Ctx(game, len(hit.actions), fixture.human_seat))
    if ev is None:
        raise ReplayError(
            f"{fixture.name}: replayed state fails required criteria (seed={hit.seed})"
        )
    met, missed = ev
    return {
        "format_version": FORMAT_VERSION,
        "name": fixture.name,
        "description": fixture.description,
        "human_seat": fixture.human_seat,
        "recipe": recipe,
        "criteria": {"met": met, "missed": missed},
        "turns_completed": turn_count(game),
        "expect": build_expect(game, fixture.human_seat),
        "snapshot": to_snapshot(game),
    }


def index_entry(doc: dict) -> dict:
    expect = doc["expect"]
    flow = expect["flow_decision"]
    human = expect["human_decisions"]
    return {
        "name": doc["name"],
        "file": f"{doc['name']}.json",
        "description": doc["description"],
        "human_seat": doc["human_seat"],
        "players": len(doc["recipe"]["players"]),
        "phase": expect["phase"],
        "decision_kind": flow["kind"] if flow else None,
        "decision_player": flow["player_id"] if flow else None,
        "human_decision_kinds": [d["kind"] for d in human],
        "actions": len(doc["recipe"]["actions"]),
        "turns_completed": doc["turns_completed"],
        "criteria_missed": doc["criteria"]["missed"],
    }


def build_index(docs: dict[str, dict]) -> dict:
    return {
        "format_version": FORMAT_VERSION,
        "fixtures": [index_entry(docs[name]) for name in sorted(docs)],
    }


def generate_all(
    seed_budget: int = SEED_BUDGET, verbose: bool = False
) -> tuple[dict[str, dict], list[str]]:
    """Search and build every fixture. Returns (docs by name, unreachable names)."""
    result = search(seed_budget, verbose=verbose)
    docs: dict[str, dict] = {}
    unreachable: list[str] = []
    for name, fixture in FIXTURES_BY_NAME.items():
        hit = result.hits.get(name)
        if hit is None:
            unreachable.append(name)
            continue
        docs[name] = build_document(fixture, hit)
    return docs, unreachable


def dump_json(data: dict) -> str:
    """Canonical serialisation: sorted keys, fixed indent, trailing newline."""
    return json.dumps(data, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def write_all(docs: dict[str, dict], out_dir: Path = DEFAULT_OUT_DIR) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    wanted = {f"{name}.json" for name in docs} | {"index.json"}
    for old in out_dir.glob("*.json"):
        if old.name not in wanted:
            old.unlink()
    for name, doc in docs.items():
        (out_dir / f"{name}.json").write_text(dump_json(doc))
    (out_dir / "index.json").write_text(dump_json(build_index(docs)))
