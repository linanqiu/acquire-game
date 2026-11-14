"""Answer schema narrowing and structural validation for LLM seats."""

import json

import pytest
from agents.llm.providers import schema_first_answer
from agents.llm.schema import (
    CHAINS,
    build_schema,
    check_against_legal,
    normalize_action,
    parse_answer,
)

PLACE = {
    "action_types": ["place_tile"],
    "tiles": [
        {"tile": "5C", "outcome": "nothing", "chains": []},
        {"tile": "7D", "outcome": "expand", "chains": ["Tower"]},
    ],
}
FOUND = {"action_types": ["found_chain"], "chains": ["Luxor", "Tower"]}
SURVIVOR = {"action_types": ["merger_choice"], "chains": ["American", "Festival"]}
DISPOSE = {
    "action_types": ["merger_disposition"],
    "defunct_chain": "Luxor",
    "surviving_chain": "Tower",
    "stock_count": 5,
    "max_trade": 4,
}
BUY = {
    "action_types": ["buy_stocks", "end_turn", "declare_end_game", "propose_trade"],
    "max_total": 3,
    "money": 1500,
    "options": [
        {"chain": "Tower", "price": 400, "available": 5, "max_affordable": 2},
        {"chain": "Luxor", "price": 300, "available": 1, "max_affordable": 1},
    ],
}
TRADE = {
    "action_types": ["accept_trade", "reject_trade"],
    "trade": {"trade_id": "t1", "from_player_id": "p2"},
    "can_accept": True,
}
VIEW = {
    "self_id": "p1",
    "players": {
        "p1": {"cash": 500, "shares": {"Tower": 3}},
        "p2": {"cash": 900, "shares": {"Luxor": 2}},
    },
}


def variants(schema):
    act = schema["properties"]["action"]
    return act.get("anyOf", [act])


def types(schema):
    return [v["properties"]["action"]["enum"][0] for v in variants(schema)]


def test_envelope_shape_and_field_order():
    s = build_schema(FOUND)
    assert list(s["properties"]) == ["why", "action", "note"]
    assert s["required"] == ["why", "action", "note"]
    assert s["additionalProperties"] is False


def test_place_tile_enum_is_exactly_the_legal_tiles():
    (v,) = variants(build_schema(PLACE))
    assert v["properties"]["tile"]["enum"] == ["5C", "7D"]


def test_found_and_survivor_enums():
    (f,) = variants(build_schema(FOUND))
    assert f["properties"]["chain"]["enum"] == ["Luxor", "Tower"]
    (s,) = variants(build_schema(SURVIVOR))
    assert s["properties"]["surviving_chain"]["enum"] == ["American", "Festival"]


def test_disposition_ranges_and_even_trades():
    (v,) = variants(build_schema(DISPOSE))
    d = v["properties"]["disposition"]["properties"]
    assert v["properties"]["defunct_chain"]["enum"] == ["Luxor"]
    assert d["sell"]["enum"] == [0, 1, 2, 3, 4, 5]
    assert d["trade"]["enum"] == [0, 2, 4]


def test_buy_narrowed_per_chain_and_ordered():
    s = build_schema(BUY, other_player_ids=("p2",))
    assert types(s) == ["buy_stocks", "end_turn", "declare_end_game", "propose_trade"]
    buy = variants(s)[0]["properties"]["purchases"]["properties"]
    assert buy["Tower"]["enum"] == [0, 1, 2]
    assert buy["Luxor"]["enum"] == [0, 1]


def test_propose_trade_needs_someone_to_trade_with():
    assert "propose_trade" not in types(build_schema(BUY))
    s = build_schema(BUY, other_player_ids=("p2", "p3"))
    pt = variants(s)[-1]["properties"]
    assert pt["to_player_id"]["enum"] == ["p2", "p3"]
    assert set(pt["offering_stocks"]["properties"]) == set(CHAINS)


def test_buy_subset_of_action_types():
    s = build_schema({**BUY, "action_types": ["end_turn"]})
    assert types(s) == ["end_turn"]


def test_trade_response_narrowing_and_cannot_accept():
    assert types(build_schema(TRADE)) == ["accept_trade", "reject_trade"]
    assert types(build_schema({**TRADE, "can_accept": False})) == ["reject_trade"]


def test_no_answerable_action_raises():
    with pytest.raises(ValueError):
        build_schema({"action_types": ["place_tile"], "tiles": []})


def test_schema_has_no_unsupported_keywords():
    blob = json.dumps(build_schema(BUY, other_player_ids=("p2",)))
    for kw in ("minimum", "maximum", "minLength", "maxLength", "multipleOf"):
        assert kw not in blob


@pytest.mark.parametrize(
    "legal",
    [PLACE, FOUND, SURVIVOR, DISPOSE, BUY, TRADE],
    ids=lambda x: x["action_types"][0],
)
def test_first_legal_answer_from_schema_passes_validator(legal):
    schema = build_schema(legal, other_player_ids=("p2",))
    ans = schema_first_answer(schema)
    action, _, _ = parse_answer(ans)
    assert check_against_legal(action, legal, view=VIEW) is None


# --- check_against_legal: accepts every legal shape --------------------------


@pytest.mark.parametrize(
    "legal,action",
    [
        (PLACE, {"action": "place_tile", "tile": "7D"}),
        (FOUND, {"action": "found_chain", "chain": "Tower"}),
        (SURVIVOR, {"action": "merger_choice", "surviving_chain": "Festival"}),
        (
            DISPOSE,
            {
                "action": "merger_disposition",
                "defunct_chain": "Luxor",
                "disposition": {"sell": 1, "trade": 4, "hold": 0},
            },
        ),
        (BUY, {"action": "buy_stocks", "purchases": {}}),
        (BUY, {"action": "buy_stocks", "purchases": {"Tower": 2, "Luxor": 1}}),
        (BUY, {"action": "end_turn"}),
        (BUY, {"action": "declare_end_game"}),
        (
            BUY,
            {
                "action": "propose_trade",
                "to_player_id": "p2",
                "offering_stocks": {"Tower": 1},
                "offering_money": 0,
                "requesting_stocks": {"Luxor": 2},
                "requesting_money": 100,
            },
        ),
        (TRADE, {"action": "accept_trade", "trade_id": "t1"}),
        (TRADE, {"action": "reject_trade", "trade_id": "t1"}),
    ],
)
def test_accepts_legal_shapes(legal, action):
    assert check_against_legal(action, legal, view=VIEW) is None


# --- ...and rejects each class of illegal answer ------------------------------


def disp(sell, trade, hold, chain="Luxor"):
    return {
        "action": "merger_disposition",
        "defunct_chain": chain,
        "disposition": {"sell": sell, "trade": trade, "hold": hold},
    }


def prop(**kw):
    base = {
        "action": "propose_trade",
        "to_player_id": "p2",
        "offering_stocks": {"Tower": 1},
        "offering_money": 0,
        "requesting_stocks": {},
        "requesting_money": 0,
    }
    base.update(kw)
    return base


@pytest.mark.parametrize(
    "legal,action,fragment",
    [
        (PLACE, {"action": "end_turn"}, "not allowed"),
        (PLACE, {"action": "place_tile", "tile": "1A"}, "not playable"),
        (PLACE, {"action": "place_tile"}, "not playable"),
        (PLACE, "place 5C", "JSON object"),
        (FOUND, {"action": "found_chain", "chain": "Imperial"}, "cannot be founded"),
        (
            SURVIVOR,
            {"action": "merger_choice", "surviving_chain": "Tower"},
            "tied chains",
        ),
        (DISPOSE, disp(2, 2, 2), "must equal 5"),
        (DISPOSE, disp(2, 3, 0), "even"),
        (DISPOSE, disp(0, 6, -1), "non-negative"),
        (DISPOSE, disp(1, 4, 0, chain="Tower"), "defunct_chain"),
        (DISPOSE, {**disp(1, 4, 0), "disposition": "sell all"}, "object"),
        ({**DISPOSE, "max_trade": 2}, disp(1, 4, 0), "exceeds"),
        (
            BUY,
            {"action": "buy_stocks", "purchases": {"Tower": 4}},
            "available|at most|buy at most",
        ),
        (BUY, {"action": "buy_stocks", "purchases": {"Tower": 3}}, "at most 2"),
        (BUY, {"action": "buy_stocks", "purchases": {"Luxor": 2}}, "only 1"),
        (BUY, {"action": "buy_stocks", "purchases": {"Imperial": 1}}, "not buyable"),
        (
            BUY,
            {"action": "buy_stocks", "purchases": {"Tower": 2, "Luxor": 2}},
            "only 1|at most",
        ),
        (
            {**BUY, "money": 700},
            {"action": "buy_stocks", "purchases": {"Tower": 2}},
            "only have",
        ),
        (BUY, {"action": "buy_stocks", "purchases": [["Tower", 1]]}, "object"),
        (BUY, {"action": "buy_stocks", "purchases": {"Tower": 1.5}}, "integer"),
        (
            {
                **BUY,
                "options": BUY["options"]
                + [
                    {
                        "chain": "American",
                        "price": 100,
                        "available": 9,
                        "max_affordable": 3,
                    }
                ],
            },
            {"action": "buy_stocks", "purchases": {"Tower": 2, "American": 2}},
            "at most 3",
        ),
        (
            {**BUY, "action_types": ["end_turn"]},
            {"action": "buy_stocks", "purchases": {}},
            "not allowed",
        ),
        (TRADE, {"action": "accept_trade", "trade_id": "other"}, "trade_id"),
        (
            {**TRADE, "can_accept": False},
            {"action": "accept_trade", "trade_id": "t1"},
            "not allowed|cannot accept",
        ),
        (BUY, prop(to_player_id=""), "to_player_id"),
        (BUY, prop(offering_stocks={"Bogus": 1}), "unknown chain"),
        (BUY, prop(offering_money=-5), "non-negative"),
        (BUY, prop(offering_stocks={}), "at least one"),
        (BUY, prop(to_player_id="p1"), "yourself"),
        (BUY, prop(to_player_id="p9"), "unknown player"),
        (BUY, prop(offering_stocks={"Tower": 9}), "holds only 3"),
        (BUY, prop(offering_money=9999), "only has"),
        (BUY, prop(requesting_stocks={"Luxor": 5}), "holds only 2"),
    ],
)
def test_rejects_illegal_answers(legal, action, fragment):
    err = check_against_legal(action, legal, view=VIEW)
    assert err is not None
    import re

    assert re.search(fragment, err), err


# --- parse / normalise --------------------------------------------------------


def test_normalize_drops_zero_entries_and_extra_keys():
    a = normalize_action(
        {"action": "buy_stocks", "purchases": {"Tower": 2, "Luxor": 0}, "junk": 1}
    )
    assert a == {"action": "buy_stocks", "purchases": {"Tower": 2}}
    p = normalize_action(
        {
            "action": "propose_trade",
            "to_player_id": "p2",
            "offering_stocks": {"Tower": 1, "Luxor": 0},
            "offering_money": 0,
            "requesting_stocks": {"Luxor": 0},
            "requesting_money": 200,
        }
    )
    assert p["offering_stocks"] == {"Tower": 1}
    assert p["requesting_stocks"] == {}


def test_parse_answer_envelope_note_truncated():
    action, note, why = parse_answer(
        {"why": " ok ", "action": {"action": "end_turn"}, "note": "x" * 500}
    )
    assert action == {"action": "end_turn"}
    assert why == "ok"
    assert len(note) == 300


def test_parse_answer_tolerates_bare_action_and_json_string():
    assert parse_answer({"action": "place_tile", "tile": "5C", "why": "w"})[0] == {
        "action": "place_tile",
        "tile": "5C",
    }
    assert parse_answer({"action": '{"action":"end_turn"}'})[0] == {
        "action": "end_turn"
    }
    assert parse_answer({"nothing": 1})[0] is None
    assert parse_answer({"action": 5})[0] is None


# ---------------------------------------------------------------------------
# Boundaries of the pre-check: what is exactly allowed must pass, one more must
# not (the LLM gets the message and a retry instead of an engine refusal).
# ---------------------------------------------------------------------------

B_BUY = {
    "action_types": ["buy_stocks", "end_turn"],
    "max_total": 3,
    "money": 900,
    "options": [{"chain": "Tower", "price": 300, "available": 3, "max_affordable": 3}],
}
B_DISPOSE = {
    "action_types": ["merger_disposition"],
    "defunct_chain": "Tower",
    "surviving_chain": "Luxor",
    "stock_count": 4,
    "max_trade": 2,
}
B_VIEW = {
    "self_id": "p1",
    "players": {
        "p1": {"cash": 500, "shares": {"Luxor": 2}},
        "p2": {"cash": 100, "shares": {"Tower": 1}},
    },
}
B_PROPOSE = {"action_types": ["propose_trade"]}


def _b_propose(**kw):
    return {"action": "propose_trade", "to_player_id": "p2", **kw}


@pytest.mark.parametrize(
    "legal, action, error",
    [
        # spending exactly all your money on exactly what is available
        (B_BUY, {"action": "buy_stocks", "purchases": {"Tower": 3}}, None),
        (
            {**B_BUY, "money": 899},
            {"action": "buy_stocks", "purchases": {"Tower": 3}},
            "cost $900",
        ),
        (
            {**B_BUY, "options": [{**B_BUY["options"][0], "available": 2}]},
            {"action": "buy_stocks", "purchases": {"Tower": 3}},
            "only 2 Tower",
        ),
        (
            {**B_BUY, "options": [{**B_BUY["options"][0], "max_affordable": 2}]},
            {"action": "buy_stocks", "purchases": {"Tower": 3}},
            "at most 2 Tower",
        ),
        (B_BUY, {"action": "buy_stocks", "purchases": {"Tower": -1}}, "non-negative"),
        (B_BUY, {"action": "buy_stocks", "purchases": {"Luxor": 0}}, None),
        # dispositions: missing keys are 0, trade up to max_trade
        (B_DISPOSE, {"action": "merger_disposition", "defunct_chain": "Tower",
                   "disposition": {"sell": 2, "trade": 2}}, None),
        (B_DISPOSE, {"action": "merger_disposition", "defunct_chain": "Tower",
                   "disposition": {"hold": 4}}, None),
        (B_DISPOSE, {"action": "merger_disposition", "defunct_chain": "Tower",
                   "disposition": {"trade": 4}}, "exceeds the maximum allowed 2"),
        (B_DISPOSE, {"action": "merger_disposition", "defunct_chain": "Tower",
                   "disposition": {"sell": 3, "hold": 1, "keep": 0}}, "unknown keys"),
        (B_DISPOSE, {"action": "merger_disposition", "defunct_chain": "Tower",
                   "disposition": {"sell": -1, "hold": 5}}, "non-negative"),
        # proposals: offering exactly what you hold is fine, one more is not
        (B_PROPOSE, _b_propose(offering_stocks={"Luxor": 2}, offering_money=500), None),
        (B_PROPOSE, _b_propose(requesting_stocks={"Tower": 1}, requesting_money=100), None),
        (B_PROPOSE, _b_propose(offering_money=501), "$500, trade needs $501"),
        (B_PROPOSE, _b_propose(offering_stocks={"Luxor": 3}), "only 2 Luxor shares, trade needs 3"),
        (B_PROPOSE, _b_propose(requesting_money=101), "p2 only has $100"),
        (B_PROPOSE, _b_propose(requesting_stocks={"Tower": 2}), "p2 holds only 1 Tower"),
        (B_PROPOSE, _b_propose(offering_stocks={"Luxor": 0}), "at least one share"),
        (B_PROPOSE, _b_propose(offering_stocks={"Luxor": -1}), "non-negative"),
        (B_PROPOSE, _b_propose(offering_money=-1), "non-negative"),
        (B_PROPOSE, {**_b_propose(offering_money=1), "to_player_id": "p9"},
         "unknown player 'p9'; players: ['p2']"),
    ],
)  # fmt: skip
def test_pre_check_boundaries(legal, action, error):
    result = check_against_legal(action, legal, view=B_VIEW)
    if error is None:
        assert result is None, result
    else:
        assert result is not None and error in result, result


def test_trade_ratio_from_legal_defaults_to_two():
    dispose = {**B_DISPOSE, "stock_count": 3, "max_trade": 3}
    action = {
        "action": "merger_disposition",
        "defunct_chain": "Tower",
        "disposition": {"trade": 3},
    }
    assert "even" in check_against_legal(action, dispose)
    assert check_against_legal(action, {**dispose, "trade_ratio": 3}) is None
    assert "even" in check_against_legal(action, {**dispose, "trade_ratio": 0})


def test_chains_for_proposals_come_from_the_view():
    view = {"self_id": "p1", "players": {"p1": {"shares": {"red": 1}}, "p2": {}}}
    ok = _b_propose(offering_stocks={"red": 1})
    assert check_against_legal(ok, B_PROPOSE, view=view) is None
    bad = _b_propose(offering_stocks={"Luxor": 1})
    assert check_against_legal(bad, B_PROPOSE, view=view) is not None
