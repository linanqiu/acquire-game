"""Rulesets: loading, validation, default == previous behaviour, and full play
on other variants (``mini``, ``valley`` and generated rulesets).

The default numbers are compared against ``tests/data/default_frozen_pricing.json``,
captured from the engine BEFORE it was parameterised (prices, bonuses and
safety for every chain x every size 0..108, plus tie-split bonus cases).
"""

from __future__ import annotations

import asyncio
import copy
import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from agents.base import build_context
from agents.heuristic import HeuristicAgent
from agents.llm.prompt import build_system_prompt, build_user_prompt, render_board
from agents.llm.schema import build_schema, check_against_legal
from game.board import Board, Tile
from game.calculator import build_calculator_pack
from game.decisions import (
    apply_action,
    legal_actions,
    pending_decisions,
    validate_action,
)
from game.game import Game, GamePhase
from game.hotel import Hotel
from game.rules import Rules
from game.ruleset import (
    RULESETS_DIR,
    Ruleset,
    RulesetError,
    available_rulesets,
    default_ruleset,
    load_ruleset,
    ruleset_from_state,
)
from game.snapshot import from_snapshot, to_snapshot
from tests.test_decisions import run_random_game

DATA = Path(__file__).parent / "data"
BACKEND = Path(__file__).resolve().parents[1]


# =============================================================================
# Programmatic rulesets
# =============================================================================


def _base_dict() -> dict:
    return copy.deepcopy(default_ruleset().to_dict())


def tiny2_dict() -> dict:
    """2 chains on a 6x6 board, one tier, 3:1 merger trades, 3 founder shares."""
    d = _base_dict()
    d.update(
        id="tiny2",
        title="Duo",
        board={"columns": 6, "rows": 6},
        tiers=[
            {
                "id": "only",
                "label": "standard",
                "prices": [
                    {"from": 2, "price": 100},
                    {"from": 4, "price": 200},
                    {"from": 8, "price": 400},
                    {"from": 15, "price": 700},
                ],
            }
        ],
        chains=[
            {
                "id": "red",
                "name": "Red Co",
                "tier": "only",
                "color": "#D55E00",
                "abbreviation": "R",
            },
            {
                "id": "blue",
                "name": "Blue Co",
                "tier": "only",
                "color": "#0072B2",
                "abbreviation": "B",
            },
        ],
        stocks_per_chain=10,
        starting_cash=2000,
        hand_size=4,
        max_stock_purchases_per_turn=2,
        safe_chain_size=6,
        end_game_chain_size=15,
        founder_bonus_shares=3,
        merger_trade_ratio=3,
        min_players=2,
        max_players=4,
        max_pending_trades_per_player=2,
    )
    return d


def big9_dict() -> dict:
    """9 chains on a 15x12 board with 3 tiers."""
    d = _base_dict()
    names = [
        "Ash",
        "Birch",
        "Cedar",
        "Dogwood",
        "Elm",
        "Fir",
        "Ginkgo",
        "Hazel",
        "Ironwood",
    ]
    colors = [
        "#E69F00",
        "#56B4E9",
        "#009E73",
        "#F0E442",
        "#0072B2",
        "#D55E00",
        "#CC79A7",
        "#999999",
        "#000000",
    ]
    tiers = [
        "cheap",
        "cheap",
        "cheap",
        "medium",
        "medium",
        "medium",
        "expensive",
        "expensive",
        "expensive",
    ]
    d.update(
        id="big9",
        title="Forest",
        board={"columns": 15, "rows": 12},
        chains=[
            {"id": n.lower(), "name": n, "tier": t, "color": c, "abbreviation": n[:2]}
            for n, c, t in zip(names, colors, tiers)
        ],
        stocks_per_chain=30,
        starting_cash=8000,
        hand_size=7,
        safe_chain_size=13,
        end_game_chain_size=50,
    )
    return d


TINY2 = Ruleset.from_dict(tiny2_dict())
BIG9 = Ruleset.from_dict(big9_dict())
MINI = load_ruleset("mini")
VALLEY = load_ruleset("valley")
DEFAULT_NAMES = [
    "sandpiper",
    "marlowe",
    "halcyon",
    "meridian",
    "juniper",
    "obsidian",
    "aurelia",
]


# =============================================================================
# Loading / format
# =============================================================================


def test_shipped_rulesets_load_and_round_trip():
    assert {"default", "mini", "valley"} <= set(available_rulesets())
    for name in available_rulesets():
        rs = load_ruleset(name)
        assert rs.id == name
        d = rs.to_dict()
        assert json.loads(json.dumps(d)) == d
        again = Ruleset.from_dict(d)
        assert again == rs and again.fingerprint == rs.fingerprint
        # The file on disk is exactly the canonical dict.
        on_disk = json.loads((RULESETS_DIR / f"{name}.json").read_text())
        assert on_disk == d
        assert list(on_disk) == list(d)  # canonical key order
        assert Ruleset.from_public(rs.public_dict()) == rs


def test_default_matches_previous_constants():
    rs = default_ruleset()
    assert rs.title == "Grand Hotels"
    assert (rs.board.columns, rs.board.rows, rs.board.row_letters) == (
        12,
        9,
        "ABCDEFGHI",
    )
    assert [c.id for c in rs.chains] == DEFAULT_NAMES
    assert [c.name for c in rs.chains] == [n.capitalize() for n in DEFAULT_NAMES]
    assert {c.id: c.color for c in rs.chains} == {
        "sandpiper": "#B99E42",
        "marlowe": "#D9809E",
        "halcyon": "#1CB0C2",
        "meridian": "#B26D32",
        "juniper": "#749770",
        "obsidian": "#5B8CD0",
        "aurelia": "#A26FA3",
    }
    assert (
        rs.stocks_per_chain,
        rs.starting_cash,
        rs.hand_size,
        rs.max_stock_purchases_per_turn,
        rs.safe_chain_size,
        rs.end_game_chain_size,
        rs.founder_bonus_shares,
        rs.merger_trade_ratio,
        rs.min_players,
        rs.max_players,
        rs.max_pending_trades_per_player,
    ) == (25, 6000, 6, 3, 11, 41, 1, 2, 3, 6, 5)
    assert Game().ruleset is default_ruleset()


def test_default_prices_and_bonuses_equal_frozen_table():
    """Every chain x every size: price, majority, minority, safe == pre-refactor."""
    frozen = json.loads((DATA / "default_frozen_pricing.json").read_text())
    hotel = Hotel()
    assert frozen["safe_size"] == default_ruleset().safe_chain_size
    assert frozen["end_game_size"] == default_ruleset().end_game_chain_size
    assert frozen["max_chains"] == len(default_ruleset().chains)
    assert frozen["stocks_per_chain"] == default_ruleset().stocks_per_chain
    for name, info in frozen["chains"].items():
        assert default_ruleset().chain(name).tier == info["tier"]
        assert default_ruleset().chain(name).color == info["color"]
        for size, (price, maj, mino, safe) in info["by_size"].items():
            s = int(size)
            assert hotel.get_stock_price(name, s) == price, (name, s)
            assert hotel.get_majority_bonus(name, s) == maj, (name, s)
            assert hotel.get_minority_bonus(name, s) == mino, (name, s)
            assert hotel.is_chain_safe(name, s) == safe, (name, s)

    cases = {
        "solo": {"a": 3},
        "maj_tie2": {"a": 3, "b": 3},
        "maj_tie3": {"a": 3, "b": 3, "c": 3},
        "min_tie2": {"a": 5, "b": 2, "c": 2},
        "min_tie3": {"a": 5, "b": 2, "c": 2, "d": 2},
        "plain": {"a": 5, "b": 3, "c": 1},
    }

    def players(holdings):
        return [
            SimpleNamespace(player_id=k, get_stock_count=lambda c, v=v: v)
            for k, v in holdings.items()
        ]

    for key, expected in frozen["bonuses"].items():
        name, size, case = key.split("|")
        got = Rules.calculate_bonuses(players(cases[case]), name, int(size), hotel)
        assert got == expected, key


# =============================================================================
# Validation
# =============================================================================


def _mut(fn):
    d = copy.deepcopy(default_ruleset().to_dict())
    fn(d)
    return d


def _set(path, value):
    def fn(d):
        target = d
        for k in path[:-1]:
            target = target[k]
        target[path[-1]] = value

    return fn


def _del(path):
    def fn(d):
        target = d
        for k in path[:-1]:
            target = target[k]
        del target[path[-1]]

    return fn


BAD = [
    ("unknown top-level key", _set(["colour_scheme"], 1), "unknown key"),
    ("unknown theme key", _set(["theme", "font"], "x"), "theme: unknown key"),
    ("unknown chain key", _set(["chains", 0, "logo"], "x"), "chains[0]: unknown key"),
    ("missing key", _del(["hand_size"]), "missing key"),
    ("missing theme word", _del(["theme", "safe_phrase"]), "theme: missing key"),
    ("tier not defined", _set(["chains", 0, "tier"], "luxury"), "not a defined tier"),
    (
        "duplicate chain id",
        _set(["chains", 1, "id"], "sandpiper"),
        "chain ids must be unique",
    ),
    (
        "duplicate chain name",
        _set(["chains", 1, "name"], "Sandpiper"),
        "chain names must be unique",
    ),
    (
        "duplicate abbreviation",
        _set(["chains", 1, "abbreviation"], "SP"),
        "abbreviations",
    ),
    (
        "duplicate colour",
        _set(["chains", 1, "color"], "#b99e42"),
        "colors must be unique",
    ),
    ("bad colour", _set(["chains", 0, "color"], "gold"), "#RRGGBB"),
    ("not wire-safe id", _set(["chains", 0, "id"], "Lux or"), "wire-safe"),
    ("id starting with digit", _set(["chains", 0, "id"], "7up"), "wire-safe"),
    ("bad abbreviation", _set(["chains", 0, "abbreviation"], "LUXR"), "abbreviation"),
    ("one chain", _set(["chains"], [default_ruleset().to_dict()["chains"][0]]), "2 to"),
    ("too many columns", _set(["board", "columns"], 51), "board.columns"),
    ("too many rows", _set(["board", "rows"], 27), "board.rows"),
    ("price table not from 2", _del(["tiers", 0, "prices", 0]), "start at from = 2"),
    (
        "brackets not ascending",
        _set(["tiers", 0, "prices", 2, "from"], 3),
        "greater than the previous",
    ),
    (
        "bracket beyond board",
        _set(["tiers", 0, "prices", 8, "from"], 200),
        "can never be reached",
    ),
    ("zero price", _set(["tiers", 0, "prices", 0, "price"], 0), "price must be >= 1"),
    ("duplicate tier", _set(["tiers", 1, "id"], "cheap"), "tier ids must be unique"),
    ("bool as int", _set(["hand_size"], True), "must be an integer"),
    ("string as int", _set(["starting_cash"], "6000"), "must be an integer"),
    ("min > max players", _set(["min_players"], 7), "min_players must be <="),
    ("safe size > area", _set(["safe_chain_size"], 109), "safe_chain_size"),
    ("founder > stocks", _set(["founder_bonus_shares"], 26), "founder_bonus_shares"),
    ("empty title", _set(["title"], " "), "title"),
    ("not an object", lambda d: d.clear(), "missing key"),
]


@pytest.mark.parametrize("label,mutate,message", BAD, ids=[b[0] for b in BAD])
def test_invalid_rulesets_are_rejected_with_clear_errors(label, mutate, message):
    with pytest.raises(RulesetError, match=re.escape(message)):
        Ruleset.from_dict(_mut(mutate))


def test_too_few_tiles_for_hands_is_rejected():
    d = tiny2_dict()
    d["hand_size"] = 10  # 4 players x 10 > 36 tiles
    with pytest.raises(RulesetError, match="players x hand_size"):
        Ruleset.from_dict(d)


def test_from_file_errors_name_the_file(tmp_path):
    bad = tmp_path / "broken.json"
    bad.write_text("{not json")
    with pytest.raises(RulesetError, match="not valid JSON"):
        Ruleset.from_file(bad)
    wrong = tmp_path / "wrong.json"
    wrong.write_text(json.dumps(_mut(_set(["chains", 0, "tier"], "nope"))))
    with pytest.raises(RulesetError, match="wrong.json: chains"):
        Ruleset.from_file(wrong)
    with pytest.raises(RulesetError, match="Cannot read"):
        load_ruleset(str(tmp_path / "missing.json"))
    with pytest.raises(RulesetError):
        load_ruleset("no-such-ruleset")


def test_load_by_path_and_fingerprint():
    by_path = load_ruleset(str(RULESETS_DIR / "mini.json"))
    assert by_path == MINI and by_path.fingerprint == MINI.fingerprint
    assert len(MINI.fingerprint) == 12
    assert (
        len({default_ruleset().fingerprint, MINI.fingerprint, VALLEY.fingerprint}) == 3
    )
    changed = Ruleset.from_dict(_mut(_set(["starting_cash"], 6100)))
    assert changed.fingerprint != default_ruleset().fingerprint
    tampered = dict(MINI.public_dict(), fingerprint="000000000000")
    with pytest.raises(RulesetError, match="fingerprint"):
        Ruleset.from_public(tampered)


def test_valley_has_default_numbers_and_its_own_theme():
    c, v = default_ruleset().to_dict(), VALLEY.to_dict()
    for key in ("board", "bonuses", *[k for k in c if isinstance(c[k], int)]):
        if key != "version":
            assert v[key] == c[key], key
    assert [t["prices"] for t in v["tiers"]] == [t["prices"] for t in c["tiers"]]
    assert [VALLEY.tier_rank(ch.tier) for ch in VALLEY.chains] == [0, 0, 1, 1, 1, 2, 2]
    assert VALLEY.title == "Acquihire"
    assert VALLEY.theme.chain_noun == "AI startup"
    assert [t.label for t in VALLEY.tiers] == [
        "seed-stage",
        "growth-stage",
        "frontier lab",
    ]
    assert {c.name for c in VALLEY.chains}.isdisjoint(DEFAULT_NAMES)


# =============================================================================
# Engine objects on other rulesets
# =============================================================================


def test_board_and_tiles_follow_the_ruleset():
    board = Board(MINI)
    tiles = board.all_tiles()
    assert len(tiles) == 63 and str(tiles[-1]) == "9G"
    assert len(Board().all_tiles()) == 108
    with pytest.raises(ValueError):
        Tile(10, "A", MINI.board)
    with pytest.raises(ValueError):
        Tile(1, "H", MINI.board)
    big = Board(BIG9)
    assert len(big.all_tiles()) == 180
    assert board.tile_from_string("9g") == Tile(9, "G")
    assert {str(t) for t in big.get_adjacent_tiles(big.tile(15, "L"))} == {"15K", "14L"}


def test_mini_engine_uses_its_numbers():
    game = Game(seed=4, ruleset=MINI)
    for i in range(5):
        game.add_player(f"p{i}", f"P{i}")
    with pytest.raises(ValueError, match="Maximum 5 players"):
        game.add_player("p9", "Too many")
    game.start_game()
    assert all(p.hand_size == 5 for p in game.players)
    assert all(p.money == 4000 for p in game.players)
    assert set(game.players[0].stocks) == set(MINI.chain_ids)
    assert len(game.tile_bag) == 63 - 25
    assert game.hotel.get_available_stocks("sandpiper") == 18
    pid = game.get_current_player_id()
    assert "Invalid tile format" in validate_action(
        game, pid, {"action": "place_tile", "tile": "10A"}
    )
    assert "Invalid tile format. Expected format like 1A, 5E, 9G" == validate_action(
        game, pid, {"action": "place_tile", "tile": "1H"}
    )
    assert "Invalid chain" in validate_action(
        game,
        pid,
        {"action": "found_chain", "chain": "juniper"},  # default only
    )
    state = game.get_public_state()
    assert state["ruleset"]["id"] == "mini"
    assert state["ruleset"]["fingerprint"] == MINI.fingerprint
    assert state["chains"]["aurelia"]["color"] == MINI.chain("aurelia").color
    assert ruleset_from_state(state) == MINI
    assert ruleset_from_state({}) is default_ruleset()


def test_founder_bonus_partly_in_cash_on_tiny2():
    game = Game(seed=1, ruleset=TINY2)
    for i in range(2):
        game.add_player(f"p{i}", f"P{i}")
    game.start_game()
    p = game.players[0]
    for s in ("1A", "2A"):
        game.board.place_tile(Tile.from_string(s, TINY2.board))
    game.phase = GamePhase.FOUNDING_CHAIN
    game.current_player_index = 0
    game.pending_action = {
        "type": "found_chain",
        "tile": Tile.from_string("2A", TINY2.board),
        "available_chains": ["red", "blue"],
    }
    game.hotel._available_stocks["red"] = 1  # bank can only give one share
    cash = p.money
    result = game.found_chain(p.player_id, "red")
    assert result.success
    assert p.get_stock_count("red") == 1
    assert p.money == cash + 2 * TINY2.price("red", 2)  # two shares paid as cash
    ev = game.events[-1]
    assert ev["founder_bonus_type"] == "stock" and ev["founder_bonus_cash"] == 200


# =============================================================================
# Full random play (the decisions fuzz driver) on other rulesets
# =============================================================================

FUZZ = [("mini", MINI), ("valley", VALLEY), ("tiny2", TINY2), ("big9", BIG9)]


@pytest.mark.parametrize("name,rs", FUZZ, ids=[f[0] for f in FUZZ])
def test_random_full_game_on_ruleset(name, rs):
    players = max(rs.min_players, min(4, rs.max_players))
    game, stats = run_random_game(3, players, ruleset=rs)
    assert game.ruleset is rs
    assert stats["actions"] > 10 and stats["illegal"] > 0


@pytest.mark.slow
@pytest.mark.parametrize("name,rs", FUZZ, ids=[f[0] for f in FUZZ])
@pytest.mark.parametrize("seed", [5, 11, 23])
def test_random_games_on_ruleset_many_seeds(name, rs, seed):
    for players in (rs.min_players, rs.max_players):
        run_random_game(seed, players, ruleset=rs)
        run_random_game(seed, players, declare_prob=0.0, ruleset=rs)


# =============================================================================
# Snapshots
# =============================================================================


def _play_heuristic(game: Game, steps: int, seed: int = 0) -> None:
    agents: dict[str, HeuristicAgent] = {}
    for _ in range(steps):
        decisions = pending_decisions(game)
        if not decisions:
            return
        d = decisions[0]
        agent = agents.setdefault(d.player_id, HeuristicAgent(d.player_id, seed=seed))
        action = agent.choose(build_context(game, d))
        result = apply_action(game, d.player_id, action)
        assert result["success"], (action, result)


def _new_game(rs, players=3, seed=7) -> Game:
    game = Game(seed=seed, ruleset=rs)
    for i in range(players):
        game.add_player(f"p{i + 1}", f"P{i + 1}", is_bot=i == 0)
    game.start_game()
    return game


@pytest.mark.parametrize("rs", [MINI, VALLEY, TINY2], ids=["mini", "valley", "tiny2"])
def test_snapshot_round_trip_keeps_the_ruleset(rs):
    game = _new_game(rs)
    _play_heuristic(game, 60)
    snap = to_snapshot(game)
    assert snap["ruleset"] == rs.to_dict()
    assert json.loads(json.dumps(snap)) == snap
    restored = from_snapshot(json.loads(json.dumps(snap)))
    assert restored.ruleset == rs
    assert to_snapshot(restored) == snap
    # Both continue identically.
    _play_heuristic(game, 80, seed=1)
    _play_heuristic(restored, 80, seed=1)
    assert to_snapshot(restored) == to_snapshot(game)


def test_default_snapshot_has_no_ruleset_key_and_bad_ruleset_is_rejected():
    snap = to_snapshot(_new_game(None))
    assert "ruleset" not in snap
    assert from_snapshot(snap).ruleset is default_ruleset()
    mini_snap = to_snapshot(_new_game(MINI))
    mini_snap["ruleset"]["chains"][0]["tier"] = "nope"
    with pytest.raises(ValueError, match="Bad ruleset"):
        from_snapshot(mini_snap)
    # A mini snapshot cannot be read as default: its chains are unknown there.
    mini_snap = to_snapshot(_new_game(MINI))
    del mini_snap["ruleset"]
    with pytest.raises(ValueError):
        from_snapshot(mini_snap)


# =============================================================================
# Calculator and agents
# =============================================================================


@pytest.mark.parametrize("rs", [MINI, TINY2], ids=["mini", "tiny2"])
def test_calculator_projection_equals_engine_end_game(rs):
    for seed in (2, 9):
        game = _new_game(rs, seed=seed)
        _play_heuristic(game, 70 + seed)
        if game.phase == GamePhase.GAME_OVER:
            continue
        pack = build_calculator_pack(game, "p1")
        assert set(pack["chains"]) == set(rs.chain_ids)
        for chain, info in pack["chains"].items():
            assert info["price_if_founded"] == rs.price(chain, 2)
            if info["active"]:
                assert info["tiles_to_safe"] == max(
                    0, rs.safe_chain_size - info["size"]
                )
        for opt in pack["buy_options"].values():
            assert opt["max_affordable"] <= rs.max_stock_purchases_per_turn
        projected = {
            p["player_id"]: p["projected_final_score"] for p in pack["players"]
        }
        game.end_game()
        assert projected == {p.player_id: p.money for p in game.players}


@pytest.mark.parametrize(
    "rs",
    [
        MINI,
        pytest.param(VALLEY, marks=pytest.mark.slow),
        pytest.param(BIG9, marks=pytest.mark.slow),
    ],
    ids=["mini", "valley", "big9"],
)
def test_heuristic_agents_play_full_games(rs):
    for seed in (1, 2):
        game = _new_game(rs, players=max(3, rs.min_players), seed=seed)
        _play_heuristic(game, 5000, seed=seed)
        assert game.phase == GamePhase.GAME_OVER


# =============================================================================
# LLM prompt and schema
# =============================================================================


def _no_word(text: str, word: str) -> bool:
    return re.search(rf"\b{re.escape(word)}\b", text) is None


@pytest.mark.parametrize("rs", [MINI, VALLEY], ids=["mini", "valley"])
def test_system_prompt_is_generated_from_the_ruleset(rs):
    s = build_system_prompt(rs)
    assert s == build_system_prompt(rs)
    for c in rs.chains:
        assert c.id in s and c.name in s
    for name in DEFAULT_NAMES:  # mini shares five of them
        if name not in rs.chain_ids:
            assert _no_word(s, name), name
    assert "GRAND HOTELS" not in s and _no_word(s, "Buyout")
    assert default_ruleset().theme.game_description not in s
    assert rs.title.upper() in s
    b = rs.board
    assert f"{b.columns} columns (1-{b.columns}) x {b.rows} rows" in s
    assert f"{b.area} tiles" in s
    assert f"${rs.starting_cash:,}" in s
    assert f"hand of {rs.hand_size} tiles" in s
    assert f"{rs.stocks_per_chain} {rs.theme.share_noun_plural} each" in s
    assert f"0 to {rs.max_stock_purchases_per_turn} " in s
    assert f"{rs.safe_chain_size} or more tiles" in s
    assert f"{rs.end_game_chain_size}+ tiles" in s
    assert f"{rs.min_players}-{rs.max_players} players" in s
    for t in rs.tiers:
        assert t.label in s
    top = rs.tiers[-1].prices[-1][1]
    assert f"${top:,}" in s
    # The strategy playbook (LO-009) is generated too: theme words and the
    # ruleset's own numbers only; no default-theme word or number leaks.
    play = s[s.index("# Strategy playbook") :]
    for word in ("Named blunders", "Checklists", "LOCKED", "bonuses paid to all"):
        assert word in play, word
    assert f"majority bonus is {rs.bonuses.majority_multiplier}x" in play
    assert f"minority bonus {rs.bonuses.minority_multiplier}x" in play
    assert f"Use your {rs.max_stock_purchases_per_turn} purchases" in play
    assert rs.theme.chain_noun_plural in play and rs.theme.merger_noun in play
    allowed = {
        str(rs.bonuses.majority_multiplier),
        str(rs.bonuses.minority_multiplier),
        str(rs.max_stock_purchases_per_turn),
        str(rs.founder_bonus_shares),
        "1",  # "costs 1x"
    }
    assert set(re.findall(r"\d+", play)) <= allowed, re.findall(r"\d+", play)
    assert "$" not in play
    for name in DEFAULT_NAMES:
        assert _no_word(play, name), name
    for word in ("hotel", "stock", "Grand"):
        if word not in rs.theme.chain_noun + rs.theme.share_noun:
            assert word.lower() not in play.lower(), word
    if rs is MINI:
        assert "12 columns" not in s and "108 tiles" not in s and "$6,000" not in s
        assert "majority bonus = 8x price, minority = 4x price" in s
        assert "rounded UP to the next $50" in s
        assert "2 free shares" in s
    if rs is VALLEY:
        for word in ("AI startup", "equity share", "acquisition", "too big to acquire"):
            assert word in s, word
        assert "hotel" not in s.lower()
        assert "Gradientfold (id gradient)" in s


def test_default_system_prompt_keeps_its_rules_text():
    s = build_system_prompt()
    assert s == build_system_prompt(default_ruleset())
    assert (
        "GRAND HOTELS (a board game about founding and merging hotel chains), 3-6 players"
        in s
    )
    assert "12 columns (1-12) x 9 rows (A-I)" in s and "108 tiles" in s
    assert '{"action":"found_chain","chain":"marlowe"}' in s


def test_user_prompt_board_and_schema_follow_the_ruleset():
    game = _new_game(MINI, seed=3)
    _play_heuristic(game, 40)
    d = pending_decisions(game)[0]
    ctx = build_context(game, d)
    grid = [
        ln for ln in render_board(ctx.state).splitlines() if re.match(r"^  [A-Z] ", ln)
    ]
    assert len(grid) == 7 and grid[-1].startswith("  G ")
    assert "Legend: SP=sandpiper" in render_board(ctx.state)
    assert build_user_prompt(ctx)
    legal = {
        "action_types": ["propose_trade"],
    }
    schema = build_schema(
        legal, other_player_ids=["p2"], chains=MINI.chain_ids, max_shares=18
    )
    props = schema["properties"]["action"]["properties"]["offering_stocks"][
        "properties"
    ]
    assert set(props) == set(MINI.chain_ids)
    assert props["sandpiper"]["enum"][-1] == 18
    trade = {
        "action": "propose_trade",
        "to_player_id": "p2",
        "offering_stocks": {"sandpiper": 1},
        "offering_money": 0,
        "requesting_stocks": {},
        "requesting_money": 0,
    }
    assert check_against_legal(trade, legal, chains=MINI.chain_ids) is None
    assert "unknown chain" in check_against_legal(
        {**trade, "offering_stocks": {"juniper": 1}}, legal, chains=MINI.chain_ids
    )


def test_disposition_schema_uses_trade_ratio():
    legal = {
        "action_types": ["merger_disposition"],
        "defunct_chain": "red",
        "surviving_chain": "blue",
        "stock_count": 7,
        "max_trade": 6,
        "trade_ratio": 3,
    }
    v = build_schema(legal)["properties"]["action"]
    assert v["properties"]["disposition"]["properties"]["trade"]["enum"] == [0, 3, 6]
    bad = {
        "action": "merger_disposition",
        "defunct_chain": "red",
        "disposition": {"sell": 5, "trade": 2, "hold": 0},
    }
    assert "multiple of 3" in check_against_legal(bad, legal)


def _play_fake_llm_game(rs, players, seed):
    """Whole game with ``llm:fake`` seats, the agent exactly as shipped (no
    monkeypatching): returns ``(game, providers, agents)``."""
    from agents.llm.agent import LLMAgent
    from agents.llm.providers import FakeProvider

    game = _new_game(rs, players=players, seed=seed)
    providers = {p.player_id: FakeProvider() for p in game.players}
    agents = {pid: LLMAgent(prov) for pid, prov in providers.items()}

    async def run():
        for _ in range(3000):
            decisions = pending_decisions(game)
            if not decisions:
                return
            d = decisions[0]
            ctx = build_context(game, d)
            action = await agents[d.player_id].decide(ctx)
            result = apply_action(game, d.player_id, action)
            assert result["success"], (action, result)

    asyncio.run(run())
    assert game.phase == GamePhase.GAME_OVER
    return game, providers, agents


def _assert_llm_saw_only(rs, providers, agents):
    calls = [c for prov in providers.values() for c in prov.calls]
    assert calls
    system = build_system_prompt(rs)
    for call in calls:
        assert call["system"] == system  # the text actually sent
        blob = json.dumps(call["schema"]) + call["user"] + call["system"]
        for c in DEFAULT_NAMES:
            if c not in rs.chain_ids:
                assert _no_word(blob, c), c
        assert all(c.name in call["system"] for c in rs.chains)
    # the structured records (transcripts) carry the same prompts
    from agents.llm.prompt import system_prompt_id

    for agent in agents.values():
        rec = agent.last_decision_record()
        assert rec["system_prompt"] == system
        assert rec["system_prompt_id"] == system_prompt_id(system, rs)
        for name in DEFAULT_NAMES:
            if name not in rs.chain_ids:
                assert _no_word(rec["system_prompt"] + rec["user_prompt"], name)


def _chain_enums(schema) -> set[str]:
    """Every string enum under a ``chain``-ish key of an answer schema."""
    found: set[str] = set()

    def walk(node, key=None):
        if isinstance(node, dict):
            enum = node.get("enum")
            if isinstance(enum, list) and key in ("chain", "surviving_chain"):
                found.update(enum)
            for k, v in node.items():
                walk(v, k)
        elif isinstance(node, list):
            for v in node:
                walk(v, key)

    walk(schema)
    return found


def test_unpatched_fake_llm_seats_on_mini_use_the_games_ruleset():
    """The shipped agent builds its system prompt and schema from the game's
    ruleset: mini's chain names, none of default's, mini's share cap."""
    game, providers, agents = _play_fake_llm_game(MINI, players=2, seed=6)
    _assert_llm_saw_only(MINI, providers, agents)
    seen = set()
    for prov in providers.values():
        for call in prov.calls:
            seen |= _chain_enums(call["schema"])
    assert seen and seen <= set(MINI.chain_ids)


@pytest.mark.slow
def test_unpatched_fake_llm_seats_on_valley_use_the_games_ruleset():
    game, providers, agents = _play_fake_llm_game(VALLEY, players=3, seed=5)
    _assert_llm_saw_only(VALLEY, providers, agents)
    seen = set()
    for prov in providers.values():
        for call in prov.calls:
            seen |= _chain_enums(call["schema"])
    assert seen and seen <= set(VALLEY.chain_ids)


def test_prompt_version_and_ids_incorporate_the_ruleset_fingerprint():
    from agents.llm.prompt import prompt_version, system_prompt_id

    versions = {prompt_version(rs) for rs in (default_ruleset(), MINI, VALLEY)}
    assert len(versions) == 3
    assert prompt_version() == prompt_version(default_ruleset())
    # same text, different ruleset: never the same id
    assert system_prompt_id("x", MINI) != system_prompt_id("x", VALLEY)
    # same words, different numbers: a different fingerprint changes the version
    d = MINI.to_dict()
    d["starting_cash"] += 100
    other = Ruleset.from_dict(d)
    assert other.id == MINI.id and other.fingerprint != MINI.fingerprint
    assert prompt_version(other) != prompt_version(MINI)


def test_user_prompt_money_uses_the_theme_currency_symbol():
    """Every amount in the user prompt (not just the system prompt) carries the
    ruleset's currency symbol."""
    from agents.llm.prompt import money

    d = MINI.to_dict()
    d["id"] = "euro"
    d["theme"]["currency_symbol"] = "\u20ac"
    euro = Ruleset.from_dict(d)
    game = _new_game(euro, players=2, seed=6)
    decision = pending_decisions(game)[0]
    ctx = build_context(game, decision)
    user = build_user_prompt(ctx)
    assert "\u20ac" in user and "$" not in user
    assert money(1500) == "$1,500"  # the module default is unchanged outside a prompt
    assert f"\u20ac{euro.starting_cash:,}" in user
    assert f"\u20ac{euro.starting_cash:,}" in build_system_prompt(euro)


def test_legal_disposition_carries_trade_ratio_only_when_not_two():
    seen = set()
    for seed in range(1, 12):
        game, _ = run_random_game(seed, 3, ruleset=TINY2)
        for e in game.events:
            if e["type"] == "stock_disposition":
                assert e["trade"] % 3 == 0
                seen.add(e["trade"])
        if seen - {0}:
            break
    assert seen - {0}, "no 3:1 trade happened"
    game = _new_game(None)
    for d in pending_decisions(game):
        assert "trade_ratio" not in legal_actions(game, d)


# =============================================================================
# No hard-coded default values in the engine
# =============================================================================

ENGINE_FILES = [
    "game/board.py",
    "game/hotel.py",
    "game/player.py",
    "game/rules.py",
    "game/game.py",
    "game/decisions.py",
    "game/snapshot.py",
    "game/calculator.py",
    "game/bot.py",
    "agents/heuristic.py",
    "agents/llm/prompt.py",
    "agents/llm/schema.py",
    "protocol.py",
    "broadcast.py",
    "fixtures_gen/replay.py",
]
FORBIDDEN = [
    *(rf"\b{n}\b" for n in DEFAULT_NAMES),
    r"ABCDEFGHI",
    r"\[A-I\]",
    r"1\[0-2\]",
    r"range\(1, 1[23]\)",
    r"12\s*x\s*9",
    r"\b108\b",
    r"\b6,?000\b",
    r"Grand Hotels",
]
# Lines allowed to mention a forbidden pattern (documented aliases only).
ALLOW = {
    "fixtures_gen/replay.py": [],
}


def test_engine_has_no_hard_coded_default_values():
    offenders = []
    for rel in ENGINE_FILES:
        text = (BACKEND / rel).read_text()
        for i, line in enumerate(text.splitlines(), 1):
            for pat in FORBIDDEN:
                if re.search(pat, line) and line.strip() not in ALLOW.get(rel, []):
                    offenders.append(f"{rel}:{i}: {line.strip()}")
    assert offenders == [], "\n".join(offenders)


def test_numeric_rule_constants_are_not_redefined():
    """Old constant names may only be default aliases (``= default_ruleset()...``)."""
    pat = re.compile(
        r"^\s*(MAX_PLAYERS|MIN_PLAYERS|STARTING_TILES|MAX_STOCKS_PER_TURN|"
        r"MAX_PENDING_TRADES_PER_PLAYER|STARTING_MONEY|MAX_HAND_SIZE|"
        r"MAX_STOCKS_PER_CHAIN|TOTAL_STOCKS_PER_CHAIN|SAFE_SIZE|END_GAME_SIZE|"
        r"MAX_CHAINS|COLUMNS|ROWS|MAX_STOCKS|MAX_BUY_PER_TURN)\b[^=]*=\s*(.*)$"
    )
    for rel in ENGINE_FILES:
        for i, line in enumerate((BACKEND / rel).read_text().splitlines(), 1):
            m = pat.match(line)
            if m:
                assert "default_ruleset()" in m.group(2), f"{rel}:{i}: {line.strip()}"
