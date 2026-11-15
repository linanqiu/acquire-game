"""Provenance of the tier-3 snapshot fixtures.

Every fixture under ``frontend/tests/e2e/fixtures/snapshots`` must be the
product of real play: its recipe (seed + players + ordered actions) is replayed
from a fresh game through ``apply_action`` only, and the result must equal the
stored snapshot exactly. A hand-edited snapshot, or an engine change that
alters the reachable states, fails here until the fixtures are regenerated on
purpose (``cd backend && python -m fixtures_gen``).
"""

import json

import pytest

from fixtures_gen.generate import (
    DEFAULT_OUT_DIR,
    build_index,
    dump_json,
    generate_all,
)
from fixtures_gen.replay import build_expect, replay_recipe
from fixtures_gen.specs import FIXTURES_BY_NAME, Ctx, evaluate
from game.decisions import (
    BUY_STOCKS,
    CHOOSE_SURVIVOR,
    FOUND_CHAIN,
    PLACE_TILE,
    STOCK_DISPOSITION,
    TRADE_RESPONSE,
    legal_actions,
    pending_decisions,
)
from game.game import GamePhase
from game.snapshot import from_snapshot, to_snapshot

FIXTURE_FILES = sorted(
    p for p in DEFAULT_OUT_DIR.glob("*.json") if p.name != "index.json"
)
NAMES = [p.stem for p in FIXTURE_FILES]


def _load(name: str) -> dict:
    return json.loads((DEFAULT_OUT_DIR / f"{name}.json").read_text())


def _human_decision(game, human, kind):
    return next(
        (d for d in pending_decisions(game) if d.player_id == human and d.kind == kind),
        None,
    )


# Independent re-statements of what each fixture name promises, written
# against the engine API (not the generator's criteria), so a bug in a
# criterion cannot silently weaken a fixture.
def _claim_opening(g, h):
    assert not any(e["type"] == "turn_ended" for e in g.events)
    assert _human_decision(g, h, PLACE_TILE)


def _claim_found(g, h):
    d = _human_decision(g, h, FOUND_CHAIN)
    assert d and len(d.context["available_chains"]) >= 3


def _claim_buy(g, h):
    d = _human_decision(g, h, BUY_STOCKS)
    assert d and len(g.hotel.get_active_chains()) >= 3
    options = legal_actions(g, d)["options"]
    assert g.get_player(h).money >= 3 * min(o["price"] for o in options)


def _claim_tie(g, h):
    d = _human_decision(g, h, CHOOSE_SURVIVOR)
    assert d and len(d.context["tied_chains"]) >= 2
    sizes = {g.board.get_chain_size(c) for c in d.context["tied_chains"]}
    assert len(sizes) == 1


def _claim_disp_first(g, h):
    d = _human_decision(g, h, STOCK_DISPOSITION)
    assert d
    count = d.context["stock_count"]
    assert count >= 3 and count % 2 == 1
    assert legal_actions(g, d)["max_trade"] >= 2
    assert pending_decisions(g)[0].player_id == h


def _claim_disp_waiting(g, h):
    flow = pending_decisions(g)[0]
    assert flow.kind == STOCK_DISPOSITION and flow.player_id != h
    assert g.get_player(h).get_stock_count(flow.context["defunct_chain"]) > 0
    assert h in g._merger.stock_players[g._merger.stock_index + 1 :]
    assert _human_decision(g, h, STOCK_DISPOSITION) is None


def _claim_trade_limited(g, h):
    d = _human_decision(g, h, STOCK_DISPOSITION)
    assert d
    count = d.context["stock_count"]
    assert legal_actions(g, d)["max_trade"] < count - count % 2
    assert d.context["available_to_trade"] * 2 < count - count % 2 + 1


def _claim_multi_merger(g, h):
    assert _human_decision(g, h, STOCK_DISPOSITION)
    assert len(g._merger.chains) >= 3
    assert g.get_player(h).get_stock_count(g._merger.current_defunct) > 0


def _claim_safe(g, h):
    assert _human_decision(g, h, PLACE_TILE)
    assert any(g.board.get_chain_size(c) >= 11 for c in g.hotel.get_active_chains())


def _claim_dead(g, h):
    assert len(g.hotel.get_active_chains()) == 7
    d = _human_decision(g, h, PLACE_TILE)
    assert d
    playable = {t["tile"] for t in legal_actions(g, d)["tiles"]}
    hand = {str(t) for t in g.get_player(h).hand}
    assert hand - playable, "human should hold at least one unplayable tile"


def _claim_incoming(g, h):
    d = _human_decision(g, h, TRADE_RESPONSE)
    assert d and d.context["trade"]["to_player_id"] == h
    assert d.context["trade"]["from_player_id"] != h
    assert d.context["trade"]["trade_id"] == "trade-1"


def _claim_incoming_not_my_turn(g, h):
    _claim_incoming(g, h)
    assert g.get_current_player().player_id != h


def _claim_incoming_my_turn(g, h):
    _claim_incoming(g, h)
    assert g.get_current_player().player_id == h


def _claim_outgoing(g, h):
    trades = list(g.pending_trades.values())
    assert any(t.from_player_id == h for t in trades)
    assert all(t.trade_id == "trade-1" for t in trades)
    assert g.get_current_player().player_id == h


def _claim_end_available(g, h):
    d = _human_decision(g, h, PLACE_TILE)
    assert d and "declare_end_game" in legal_actions(g, d)["action_types"]


def _claim_last_turn(g, h):
    d = _human_decision(g, h, BUY_STOCKS)
    assert d and g.stocks_bought_this_turn
    assert "declare_end_game" in legal_actions(g, d)["action_types"]


def _claim_game_over(g, h):
    assert g.phase == GamePhase.GAME_OVER and not pending_decisions(g)
    ended = [e for e in g.events if e["type"] == "game_ended"][-1]
    s = ended["standings"]
    assert ended["winner"] == s[0]["player_id"]
    assert s[0]["money"] > s[1]["money"]


def _claim_game_over_tie(g, h):
    assert g.phase == GamePhase.GAME_OVER
    ended = [e for e in g.events if e["type"] == "game_ended"][-1]
    s = ended["standings"]
    assert s[0]["money"] == s[1]["money"]
    # a tie shares the rank (competition ranking) and both are winners
    assert s[0]["rank"] == s[1]["rank"] == 1
    assert ended["winners"] == [s[0]["player_id"], s[1]["player_id"]]


def _claim_low_cash(g, h):
    d = _human_decision(g, h, BUY_STOCKS)
    assert d
    legal = legal_actions(g, d)
    assert legal["options"]
    assert all(o["max_affordable"] == 0 for o in legal["options"])
    assert g.get_player(h).money < min(o["price"] for o in legal["options"])


def _claim_midgame(count):
    def claim(g, h):
        assert len(g.players) == count
        assert _human_decision(g, h, PLACE_TILE)
        assert len(g.hotel.get_active_chains()) >= 4
        assert len(g.board.get_state()["cells"]) >= 30

    return claim


CLAIMS = {
    "opening-place-tile": _claim_opening,
    "found-chain-choice": _claim_found,
    "buy-phase-multi-chain": _claim_buy,
    "merger-survivor-tie": _claim_tie,
    "disposition-human-first": _claim_disp_first,
    "disposition-waiting-on-other": _claim_disp_waiting,
    "disposition-trade-limited": _claim_trade_limited,
    "multi-chain-merger": _claim_multi_merger,
    "safe-chain-on-board": _claim_safe,
    "dead-tile-in-hand": _claim_dead,
    "trade-incoming": _claim_incoming_my_turn,
    "trade-incoming-not-my-turn": _claim_incoming_not_my_turn,
    "trade-outgoing-pending": _claim_outgoing,
    "end-game-available": _claim_end_available,
    "last-turn-before-game-over": _claim_last_turn,
    "game-over": _claim_game_over,
    "game-over-tie": _claim_game_over_tie,
    "low-cash": _claim_low_cash,
    "six-player-midgame": _claim_midgame(6),
    "three-player-midgame": _claim_midgame(3),
}


def test_fixtures_exist_and_every_spec_has_a_file():
    assert NAMES, f"no fixtures in {DEFAULT_OUT_DIR}; run: python -m fixtures_gen"
    assert set(NAMES) == set(FIXTURES_BY_NAME), (
        "fixture files and specs differ; regenerate with python -m fixtures_gen"
    )
    assert set(CLAIMS) == set(FIXTURES_BY_NAME), "every fixture needs an explicit claim"


@pytest.mark.parametrize("name", NAMES)
def test_replay_reproduces_stored_snapshot(name):
    """Recipe -> fresh game -> apply_action only -> exactly the stored snapshot."""
    doc = _load(name)
    game = replay_recipe(doc["recipe"])  # raises if any action is rejected
    assert to_snapshot(game) == doc["snapshot"]


@pytest.mark.parametrize("name", NAMES)
def test_restored_snapshot_matches_expect_block(name):
    doc = _load(name)
    game = from_snapshot(doc["snapshot"])
    assert to_snapshot(game) == doc["snapshot"]
    assert build_expect(game, doc["human_seat"]) == doc["expect"]
    decisions = pending_decisions(game)
    assert [d.to_dict() for d in decisions] == [
        {k: e[k] for k in ("player_id", "kind", "context")}
        for e in doc["expect"]["decisions"]
    ]
    for decision, entry in zip(decisions, doc["expect"]["decisions"], strict=True):
        assert legal_actions(game, decision) == entry["legal"]


@pytest.mark.parametrize("name", NAMES)
def test_target_state_really_holds(name):
    doc = _load(name)
    game = replay_recipe(doc["recipe"])
    CLAIMS[name](game, doc["human_seat"])
    # The generator's own criteria must agree with what was recorded.
    ev = evaluate(
        FIXTURES_BY_NAME[name],
        Ctx(game, len(doc["recipe"]["actions"]), doc["human_seat"]),
    )
    assert ev is not None, "required criteria no longer hold"
    assert {"met": ev[0], "missed": ev[1]} == doc["criteria"]


@pytest.mark.parametrize("name", NAMES)
def test_recipe_shape(name):
    doc = _load(name)
    recipe = doc["recipe"]
    ids = [p["player_id"] for p in recipe["players"]]
    assert ids == [f"p{i + 1}" for i in range(len(ids))]
    assert doc["human_seat"] in ids
    assert doc["name"] == name
    assert isinstance(recipe["seed"], int)
    assert recipe["tile_order"] is None
    for step in recipe["actions"]:
        assert step["player_id"] in ids
        if step["action"]["action"] == "propose_trade":
            assert isinstance(step["action"].get("trade_id"), str)
    assert doc["snapshot"]["version"] == 1


@pytest.mark.parametrize("name", NAMES)
def test_file_is_canonical_json(name):
    """Byte-for-byte canonical form: hand edits / reformatting are detected."""
    path = DEFAULT_OUT_DIR / f"{name}.json"
    assert path.read_text() == dump_json(json.loads(path.read_text()))


def test_index_matches_files():
    index = json.loads((DEFAULT_OUT_DIR / "index.json").read_text())
    docs = {name: _load(name) for name in NAMES}
    assert index == build_index(docs)
    assert [e["name"] for e in index["fixtures"]] == sorted(NAMES)
    for entry in index["fixtures"]:
        assert (DEFAULT_OUT_DIR / entry["file"]).exists()
    text = (DEFAULT_OUT_DIR / "index.json").read_text()
    assert text == dump_json(json.loads(text))


@pytest.mark.slow
def test_regenerating_in_memory_equals_files_on_disk():
    """Engine changes that alter these states force a deliberate regeneration."""
    docs, unreachable = generate_all()
    assert unreachable == []
    assert set(docs) == set(NAMES)
    for name, doc in docs.items():
        assert dump_json(doc) == (DEFAULT_OUT_DIR / f"{name}.json").read_text(), (
            f"{name} differs from disk; run: cd backend && python -m fixtures_gen"
        )
    assert dump_json(build_index(docs)) == (DEFAULT_OUT_DIR / "index.json").read_text()
