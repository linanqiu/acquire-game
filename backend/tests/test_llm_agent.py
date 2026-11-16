"""LLMAgent decision loop: validate, repair, fail, notes, trading limits, log."""

import json
import time

import pytest
from agents.base import Agent
from agents.llm.agent import LLMAgent, forced_action, forced_choice
from agents.llm.decision_log import DecisionLog
from agents.llm.errors import AgentDecisionError, ProviderError
from agents.llm.providers import FakeProvider
from agents.llm.schema import ANY_KIND, build_static_schema

from tests.llm_support import bot_game, buy_ctx, make_ctx, place_ctx

pytestmark = pytest.mark.asyncio


@pytest.fixture(scope="module")
def game():
    return bot_game(seed=39, min_turns=30)


def answer(action, why="because", note=""):
    return {"why": why, "action": action, "note": note}


def first_tile(ctx):
    return ctx.legal["tiles"][0]["tile"]


async def test_agent_satisfies_seat_protocol():
    assert isinstance(LLMAgent(FakeProvider()), Agent)
    assert LLMAgent.kind == "llm"


async def test_valid_first_answer_is_one_call(game):
    ctx = place_ctx(game)
    tile = first_tile(ctx)
    prov = FakeProvider([answer({"action": "place_tile", "tile": tile}, note="plan A")])
    agent = LLMAgent(prov, agent_id="llm:x")
    action = await agent.decide(ctx)
    assert action == {"action": "place_tile", "tile": tile}
    assert len(prov.calls) == 1
    call = prov.calls[0]
    assert tile in call["user"] and "GRAND HOTELS" in call["system"]
    assert call["timeout"] == 45.0
    # schema handed to the provider is narrowed to the legal tiles
    enum = call["schema"]["properties"]["action"]["properties"]["tile"]["enum"]
    assert enum == [t["tile"] for t in ctx.legal["tiles"]]
    (rec,) = agent.recent_decisions(5)
    assert rec["repaired"] is False and rec["error"] is None
    assert rec["decision_kind"] == "place_tile" and rec["calls"] == 1
    assert rec["action"] == action and rec["why"] == "because"


async def test_illegal_then_legal_is_retried_with_the_reason(game):
    ctx = place_ctx(game)
    tile = first_tile(ctx)
    prov = FakeProvider(
        [
            answer({"action": "place_tile", "tile": "12I"}),  # not in hand
            answer({"action": "place_tile", "tile": tile}),
        ]
    )
    agent = LLMAgent(prov)
    action = await agent.decide(ctx)
    assert action["tile"] == tile
    assert len(prov.calls) == 2
    repair = prov.calls[1]["user"]
    assert "REJECTED" in repair and "12I" in repair and "not playable" in repair
    assert prov.calls[1]["user"].startswith(
        prov.calls[0]["user"]
    )  # same prompt + error
    (rec,) = agent.recent_decisions(5)
    assert rec["repaired"] is True and rec["calls"] == 2
    assert agent.totals["repairs"] == 1 and agent.totals["calls"] == 2


async def test_malformed_first_answer_is_repaired(game):
    ctx = place_ctx(game)
    prov = FakeProvider(
        [{"nonsense": True}, answer({"action": "place_tile", "tile": first_tile(ctx)})]
    )
    action = await LLMAgent(prov).decide(ctx)
    assert action["action"] == "place_tile" and len(prov.calls) == 2


async def test_always_illegal_raises_after_exactly_the_configured_retries(game):
    ctx = place_ctx(game)
    prov = FakeProvider([answer({"action": "end_turn"})])  # repeats forever
    agent = LLMAgent(prov)  # default: 1 answer + 4 retries
    with pytest.raises(AgentDecisionError, match="illegal answers: 5 tries") as ei:
        await agent.decide(ctx)
    assert ei.value.reason == "illegal" and ei.value.attempts == 5
    assert len(prov.calls) == 5
    (rec,) = agent.recent_decisions(5)
    assert rec["error"] and rec["action"] is None and rec["repaired"] is True
    assert len(rec["attempts"]) == 5 and all(a["error"] for a in rec["attempts"])
    assert agent.totals["failures"] == 1 and agent.totals["calls"] == 5
    assert agent.totals["attempts"] == 5 and agent.totals["illegal_answers"] == 5


@pytest.mark.parametrize("retries", [0, 1, 2])
async def test_max_illegal_retries_is_configurable(game, retries):
    prov = FakeProvider([answer({"action": "end_turn"})])
    agent = LLMAgent(prov, max_illegal_retries=retries)
    with pytest.raises(AgentDecisionError):
        await agent.decide(place_ctx(game))
    assert len(prov.calls) == 1 + retries


async def test_several_illegal_answers_then_a_legal_one_succeeds(game):
    ctx = place_ctx(game)
    tile = first_tile(ctx)
    prov = FakeProvider(
        [
            answer({"action": "end_turn"}),
            answer({"action": "place_tile", "tile": "12I"}),
            {"nonsense": True},
            answer({"action": "place_tile", "tile": tile}),
        ]
    )
    agent = LLMAgent(prov)
    assert (await agent.decide(ctx))["tile"] == tile
    assert len(prov.calls) == 4
    (rec,) = agent.recent_decisions(5)
    assert rec["error"] is None and rec["calls"] == 4
    assert [bool(a["error"]) for a in rec["attempts"]] == [True, True, True, False]
    assert agent.totals["illegal_answers"] == 3


async def test_later_retry_prompts_list_every_earlier_rejected_answer(game):
    ctx = place_ctx(game)
    tile = first_tile(ctx)
    prov = FakeProvider(
        [
            answer({"action": "end_turn"}),
            answer({"action": "place_tile", "tile": "12I"}),
            answer({"action": "place_tile", "tile": tile}),
        ]
    )
    await LLMAgent(prov).decide(ctx)
    first, second, third = (c["user"] for c in prov.calls)
    assert "REJECTED" not in first
    assert "end_turn" in second and "12I" not in second
    assert "end_turn" in third and "12I" in third
    assert third.count("Rejected because") == 2
    assert "Legal action types: ['place_tile']" in third


async def test_engine_rejection_is_retried_with_the_engine_error(game):
    ctx = place_ctx(game)
    tiles = [t["tile"] for t in ctx.legal["tiles"]]
    prov = FakeProvider(
        [
            answer({"action": "place_tile", "tile": tiles[0]}),
            answer({"action": "place_tile", "tile": tiles[1]}),
        ]
    )
    agent = LLMAgent(prov)
    first = await agent.decide(ctx)
    second = await agent.decide(
        ctx, rejected=[{"action": first, "error": "engine says no: cursed tile"}]
    )
    assert second["tile"] == tiles[1]
    assert "engine says no: cursed tile" in prov.calls[1]["user"]
    assert tiles[0] in prov.calls[1]["user"].split("REJECTED")[1]


async def test_engine_rejections_share_the_retry_budget(game):
    ctx = place_ctx(game)
    tile = first_tile(ctx)
    prov = FakeProvider([answer({"action": "place_tile", "tile": tile})])
    agent = LLMAgent(prov, max_illegal_retries=2)
    rej = []
    for _ in range(3):  # answers 1..3 each refused by the engine
        a = await agent.decide(ctx, rejected=list(rej))
        rej.append({"action": a, "error": "no"})
    assert len(prov.calls) == 3
    with pytest.raises(AgentDecisionError) as ei:
        await agent.decide(ctx, rejected=list(rej))
    assert ei.value.reason == "illegal" and len(prov.calls) == 3  # no 4th call


async def test_retries_stop_when_the_time_budget_is_exhausted(game):
    prov = FakeProvider([answer({"action": "end_turn"})], delay=0.03)
    agent = LLMAgent(prov, decision_budget=0.08, max_illegal_retries=50)
    with pytest.raises(AgentDecisionError, match="time budget") as ei:
        await agent.decide(place_ctx(game))
    assert ei.value.reason == "timeout"
    assert 1 <= len(prov.calls) < 6


async def test_each_retry_call_is_capped_to_the_time_left(game):
    prov = FakeProvider([answer({"action": "end_turn"})])
    agent = LLMAgent(prov, timeout=45.0, max_illegal_retries=1)
    with pytest.raises(AgentDecisionError):
        await agent.decide(place_ctx(game), deadline=time.monotonic() + 7.0)
    assert all(c["timeout"] <= 7.0 for c in prov.calls)


async def test_provider_error_raises_without_retry(game):
    prov = FakeProvider([ProviderError("HTTP 500")])
    agent = LLMAgent(prov)
    with pytest.raises(AgentDecisionError, match="provider error: HTTP 500"):
        await agent.decide(place_ctx(game))
    assert len(prov.calls) == 1
    assert agent.totals["failures"] == 1


async def test_generic_provider_exception_is_wrapped(game):
    agent = LLMAgent(FakeProvider([RuntimeError("boom")]))
    with pytest.raises(AgentDecisionError):
        await agent.decide(place_ctx(game))


async def test_timeout_raises(game):
    # A provider that ignores its own timeout is cut off by the agent's ceiling.
    prov = FakeProvider([answer({"action": "end_turn"})], delay=0.5)
    agent = LLMAgent(prov, timeout=0.05, timeout_grace=0.0)
    with pytest.raises(AgentDecisionError, match="timed out") as ei:
        await agent.decide(place_ctx(game))
    assert ei.value.reason == "timeout" and len(prov.calls) == 1
    assert agent.totals["failures"] == 1


async def test_provider_reported_timeout_raises(game):
    agent = LLMAgent(FakeProvider([ProviderError("slow", timeout=True)]))
    with pytest.raises(AgentDecisionError, match="slow"):
        await agent.decide(place_ctx(game))


async def test_provider_receives_configured_timeout_and_max_tokens(game):
    ctx = place_ctx(game)
    prov = FakeProvider([answer({"action": "place_tile", "tile": first_tile(ctx)})])
    await LLMAgent(prov, timeout=12.5, max_tokens=777).decide(ctx)
    assert prov.calls[0]["timeout"] == 12.5 and prov.calls[0]["max_tokens"] == 777


async def test_notes_carry_between_decisions(game):
    ctx = place_ctx(game)
    tile = first_tile(ctx)
    prov = FakeProvider(
        [
            answer({"action": "place_tile", "tile": tile}, note="first plan"),
            answer({"action": "place_tile", "tile": tile}, note="second plan"),
            answer({"action": "place_tile", "tile": tile}, note="x" * 1000),
        ]
    )
    agent = LLMAgent(prov, notes_limit=2)
    await agent.decide(ctx)
    assert "(none yet)" in prov.calls[0]["user"]
    await agent.decide(ctx)
    assert "first plan" in prov.calls[1]["user"]
    await agent.decide(ctx)
    u = prov.calls[2]["user"]
    assert "first plan" in u and "second plan" in u
    await agent.decide(ctx)  # 4th call repeats the last scripted answer
    assert "first plan" not in prov.calls[3]["user"]  # oldest note evicted (limit 2)
    assert all(len(n) <= 300 for n in agent.notes)


async def test_buy_phase_normalises_zero_purchases(game):
    ctx = buy_ctx(game)
    chain = ctx.legal["options"][0]["chain"]
    other = ctx.legal["options"][1]["chain"] if len(ctx.legal["options"]) > 1 else chain
    prov = FakeProvider(
        [
            answer(
                {
                    "action": "buy_stocks",
                    "purchases": {chain: 1, other: 0} if other != chain else {chain: 1},
                }
            )
        ]
    )
    action = await LLMAgent(prov).decide(ctx)
    assert action == {"action": "buy_stocks", "purchases": {chain: 1}}


async def test_end_turn_and_declare(game):
    ctx = buy_ctx(game)
    prov = FakeProvider([answer({"action": "end_turn"})])
    assert await LLMAgent(prov).decide(ctx) == {"action": "end_turn"}


async def test_buy_over_limit_is_repaired(game):
    ctx = buy_ctx(game)
    chain = ctx.legal["options"][0]["chain"]
    prov = FakeProvider(
        [
            answer({"action": "buy_stocks", "purchases": {chain: 9}}),
            answer({"action": "end_turn"}),
        ]
    )
    assert (await LLMAgent(prov).decide(ctx))["action"] == "end_turn"
    assert len(prov.calls) == 2


# --- trading -----------------------------------------------------------------


def proposal(to="p2", **kw):
    a = {
        "action": "propose_trade",
        "to_player_id": to,
        "offering_stocks": {},
        "offering_money": 100,
        "requesting_stocks": {},
        "requesting_money": 0,
    }
    a.update(kw)
    return a


async def test_trade_response_accept_and_reject(game):
    trade = {
        "trade_id": "t1",
        "from_player_id": "p2",
        "to_player_id": "p1",
        "offering_stocks": {},
        "offering_money": 500,
        "requesting_stocks": {},
        "requesting_money": 100,
    }
    legal = {
        "action_types": ["accept_trade", "reject_trade"],
        "trade": trade,
        "can_accept": True,
    }
    ctx = make_ctx(game, "p1", "trade_response", legal)
    acc = await LLMAgent(
        FakeProvider([answer({"action": "accept_trade", "trade_id": "t1"})])
    ).decide(ctx)
    assert acc == {"action": "accept_trade", "trade_id": "t1"}
    rej = await LLMAgent(
        FakeProvider([answer({"action": "reject_trade", "trade_id": "t1"})])
    ).decide(ctx)
    assert rej["action"] == "reject_trade"
    # cannot accept -> accept is not even in the schema; an accept answer is repaired to reject
    prov = FakeProvider(
        [
            answer({"action": "accept_trade", "trade_id": "t1"}),
            answer({"action": "reject_trade", "trade_id": "t1"}),
        ]
    )
    ctx2 = make_ctx(game, "p1", "trade_response", {**legal, "can_accept": False})
    assert (await LLMAgent(prov).decide(ctx2))["action"] == "reject_trade"
    enum = [
        v["properties"]["action"]["enum"][0]
        for v in prov.calls[0]["schema"]["properties"]["action"].get(
            "anyOf", [prov.calls[0]["schema"]["properties"]["action"]]
        )
    ]
    assert enum == ["reject_trade"]


async def test_propose_trade_allowed_once_per_turn(game):
    ctx = buy_ctx(game)
    prov = FakeProvider([answer(proposal(offering_money=100))])
    agent = LLMAgent(prov, max_proposals_per_turn=1)
    first = await agent.decide(ctx)
    assert first["action"] == "propose_trade" and first["to_player_id"] == "p2"
    assert "propose_trade" in json.dumps(prov.calls[0]["schema"])
    # same turn again: propose_trade is withdrawn from legal options AND schema,
    # so repeating the proposal is rejected (repair) and then fails.
    with pytest.raises(AgentDecisionError):
        await agent.decide(ctx)
    assert "propose_trade" not in json.dumps(prov.calls[1]["schema"])
    assert '"propose_trade"' not in prov.calls[1]["user"].split("Legal options")[1]


async def test_proposal_cap_resets_next_turn(game):
    ctx = buy_ctx(game)
    prov = FakeProvider([answer(proposal())])
    agent = LLMAgent(prov, max_proposals_per_turn=1)
    await agent.decide(ctx)
    ctx.events.append(
        {"seq": 1, "type": "turn_ended", "player_id": "p1", "private_to": None}
    )
    again = await agent.decide(ctx)
    assert again["action"] == "propose_trade"


async def test_proposal_must_be_affordable(game):
    ctx = buy_ctx(game)
    prov = FakeProvider(
        [
            answer(proposal(offering_money=10**9)),
            answer({"action": "end_turn"}),
        ]
    )
    assert (await LLMAgent(prov).decide(ctx))["action"] == "end_turn"
    assert "only has" in prov.calls[1]["user"]


# --- observability -----------------------------------------------------------


async def test_decision_log_ring_buffer_and_totals(game):
    ctx = place_ctx(game)
    tile = first_tile(ctx)
    prov = FakeProvider([answer({"action": "place_tile", "tile": tile}, why="w")])
    log = DecisionLog("llm:t", "fake", capacity=3)
    agent = LLMAgent(prov, log=log, agent_id="llm:t")
    for _ in range(5):
        await agent.decide(ctx)
    recs = agent.recent_decisions(10)
    assert len(recs) == 3  # ring buffer
    r = recs[-1]
    assert r["agent_id"] == "llm:t" and r["model"] == "fake"
    assert r["system_chars"] > 1000 and r["user_chars"] > 1000
    assert r["input_tokens"] > 0 and r["output_tokens"] > 0 and r["latency_s"] >= 0
    assert agent.totals["decisions"] == 5 and agent.totals["calls"] == 5
    assert agent.totals["input_tokens"] > 0
    agent.note_fallback("driver rejected")
    assert agent.recent_decisions(1)[0]["fallback"] is True


async def test_decision_log_writes_logger_and_jsonl(
    game, tmp_path, monkeypatch, caplog
):
    monkeypatch.setenv("GAME_LLM_LOG_DIR", str(tmp_path))
    ctx = place_ctx(game)
    tile = first_tile(ctx)
    agent = LLMAgent(
        FakeProvider([answer({"action": "place_tile", "tile": tile}, why="reason")])
    )
    with caplog.at_level("INFO", logger="llm"):
        await agent.decide(ctx)
    assert any(
        "kind=place_tile" in r.message and "reason" in r.message for r in caplog.records
    )
    lines = (tmp_path / "decisions.jsonl").read_text().strip().splitlines()
    rec = json.loads(lines[0])
    assert rec["action"]["tile"] == tile
    assert "GRAND HOTELS" in rec["system"] and tile in rec["user"] and rec["responses"]


async def test_failure_is_also_logged_to_jsonl(game, tmp_path, monkeypatch):
    monkeypatch.setenv("GAME_LLM_LOG_DIR", str(tmp_path))
    agent = LLMAgent(FakeProvider([ProviderError("nope")]))
    with pytest.raises(AgentDecisionError):
        await agent.decide(place_ctx(game))
    rec = json.loads((tmp_path / "decisions.jsonl").read_text().splitlines()[0])
    assert "nope" in rec["error"]


async def test_fake_provider_default_plays_first_legal_action(game):
    # no script: answers from the schema (this is what llm:fake does)
    agent = LLMAgent(FakeProvider())
    ctx = place_ctx(game)
    assert (await agent.decide(ctx))["tile"] == first_tile(ctx)
    buy = await agent.decide(buy_ctx(game))
    assert buy == {"action": "buy_stocks", "purchases": {}}


def after_purchase_ctx(game, *, can_declare=False):
    """The buy decision as the engine asks it again once the purchase is made."""
    types = [
        "end_turn",
        *(["declare_end_game"] if can_declare else []),
        "propose_trade",
    ]
    legal = {"action_types": types, "max_total": 0, "options": [], "money": 0}
    return make_ctx(game, "p1", "buy_stocks", legal)


async def test_after_its_purchase_the_seat_ends_the_turn_without_a_model_call(game):
    prov = FakeProvider([])
    agent = LLMAgent(prov, agent_id="llm:x")
    assert await agent.decide(after_purchase_ctx(game)) == {"action": "end_turn"}
    assert prov.calls == []
    # another context gets no record ...
    assert agent.last_decision_record(after_purchase_ctx(game)) is None


async def test_a_forced_move_is_recorded_as_forced_with_no_attempts(game):
    prov = FakeProvider([])
    agent = LLMAgent(prov, agent_id="llm:x")
    ctx = after_purchase_ctx(game)
    await agent.decide(ctx)
    rec = agent.last_decision_record(ctx)
    assert rec["outcome"] == "forced" and rec["attempts"] == []
    assert rec["why"].startswith("No model call:")
    assert rec["system_prompt_id"].startswith("sp-") and rec["user_prompt"] == ""
    assert agent.forced_decisions == 1 and agent.totals["calls"] == 0


def nothing_to_buy_ctx(game, pid="p1", *, shares=None, propose=True):
    """The buy step when no share is affordable (or none is for sale)."""
    ctx = buy_ctx(game, pid)
    legal = {
        "action_types": [
            "buy_stocks",
            "end_turn",
            *(["propose_trade"] if propose else []),
        ],
        "max_total": 3,
        "options": [{**o, "max_affordable": 0} for o in ctx.legal.get("options", [])],
        "money": 0,
    }
    ctx = make_ctx(game, pid, "buy_stocks", legal)
    if shares is not None:
        for p in ctx.calc["players"]:
            if p["player_id"] == pid:
                p["shares"] = dict(shares)
    return ctx


async def test_nothing_to_buy_ends_the_turn_without_a_model_call(game):
    prov = FakeProvider([])
    agent = LLMAgent(prov, agent_id="llm:x")
    # no shares to offer anyone: nothing to decide at all
    ctx = nothing_to_buy_ctx(game, shares={})
    assert await agent.decide(ctx) == {"action": "end_turn"}
    assert prov.calls == []
    assert (
        agent.last_decision_record(ctx)["why"]
        == "No model call: no share can be bought."
    )
    # holding shares but no trade on offer: still nothing to decide
    ctx = nothing_to_buy_ctx(game, shares={"sandpiper": 4}, propose=False)
    assert await agent.decide(ctx) == {"action": "end_turn"}
    assert prov.calls == []


async def test_a_broke_seat_with_shares_is_still_asked_because_it_can_trade(game):
    prov = FakeProvider([answer({"action": "end_turn"})])
    agent = LLMAgent(prov, agent_id="llm:x")
    ctx = nothing_to_buy_ctx(game, shares={"sandpiper": 4})
    assert await agent.decide(ctx) == {"action": "end_turn"}
    assert len(prov.calls) == 1


async def test_one_playable_tile_or_one_chain_left_needs_no_model_call(game):
    prov = FakeProvider([])
    agent = LLMAgent(prov, agent_id="llm:x")
    ctx = place_ctx(game)
    only = ctx.legal["tiles"][0]
    one = make_ctx(
        game, "p1", "place_tile", {"action_types": ["place_tile"], "tiles": [only]}
    )
    assert await agent.decide(one) == {"action": "place_tile", "tile": only["tile"]}
    found = make_ctx(
        game,
        "p1",
        "found_chain",
        {"action_types": ["found_chain"], "chains": ["marlowe"]},
    )
    assert await agent.decide(found) == {"action": "found_chain", "chain": "marlowe"}
    assert prov.calls == [] and agent.forced_decisions == 2


async def test_a_seat_that_may_declare_the_end_is_always_asked(game):
    ctx = place_ctx(game)
    only = ctx.legal["tiles"][0]
    legal = {"action_types": ["place_tile", "declare_end_game"], "tiles": [only]}
    prov = FakeProvider([answer({"action": "declare_end_game"})])
    agent = LLMAgent(prov, agent_id="llm:x")
    act = await agent.decide(make_ctx(game, "p1", "place_tile", legal))
    assert act == {"action": "declare_end_game"} and len(prov.calls) == 1


async def test_forced_choice_table():
    assert (
        forced_choice("place_tile", {"action_types": ["place_tile"], "tiles": []})
        is None
    )
    two = {"action_types": ["place_tile"], "tiles": ["1A", "2B"]}
    assert forced_choice("place_tile", two) is None
    assert (
        forced_choice(
            "found_chain", {"action_types": ["found_chain"], "chains": ["a", "b"]}
        )
        is None
    )
    assert (
        forced_choice("stock_disposition", {"action_types": ["merger_disposition"]})
        is None
    )
    assert (
        forced_choice(
            "trade_response", {"action_types": ["accept_trade", "reject_trade"]}
        )
        is None
    )
    buy = {
        "action_types": ["buy_stocks", "end_turn", "propose_trade"],
        "options": [{"chain": "a", "max_affordable": 1}],
    }
    assert forced_choice("buy_stocks", buy) is None
    assert forced_action("buy_stocks", {**buy, "options": []}, holds_shares=False) == {
        "action": "end_turn"
    }
    assert (
        forced_action("buy_stocks", {**buy, "options": []}, holds_shares=True) is None
    )


class _Recorder(FakeProvider):
    """A scripted provider that is treated like a real one (static schema)."""

    narrow_schema = False


class _Advisory(_Recorder):
    schema_is_advisory = True


async def test_real_providers_get_the_same_schema_for_every_decision_of_a_kind(game):
    prov = _Recorder(lambda s, u, schema: answer({"action": "end_turn"}))
    agent = LLMAgent(prov, agent_id="llm:x")
    ctx = buy_ctx(game)
    await agent.decide(ctx)
    poorer = buy_ctx(game)
    poorer.legal["options"] = poorer.legal["options"][:1]
    poorer.legal["money"] = 100
    await agent.decide(poorer)
    a, b = (c["schema"] for c in prov.calls)
    assert a == b  # nothing of the moment in it: the request prefix is stable
    assert a == build_static_schema("buy_stocks")
    # the fake (it answers by walking the schema) still gets the narrowed one
    fake = FakeProvider()
    await LLMAgent(fake).decide(poorer)
    assert fake.calls[0]["schema"] != a


async def test_an_answer_the_static_schema_allows_but_the_rules_do_not_is_sent_back(
    game,
):
    ctx = place_ctx(game)
    legal_tiles = {t["tile"] for t in ctx.legal["tiles"]}
    bad = next(
        f"{c}{r}"
        for c in range(1, 13)
        for r in "ABCDEFGHI"
        if f"{c}{r}" not in legal_tiles
    )
    good = first_tile(ctx)
    prov = _Recorder(
        [
            answer({"action": "place_tile", "tile": bad}),
            answer({"action": "end_turn"}),
            answer({"action": "place_tile", "tile": good}),
        ]
    )
    agent = LLMAgent(prov, agent_id="llm:x")
    assert await agent.decide(ctx) == {"action": "place_tile", "tile": good}
    assert len(prov.calls) == 3
    assert "is not playable" in prov.calls[1]["user"]
    assert "is not allowed here" in prov.calls[2]["user"]


async def test_a_provider_that_only_describes_the_schema_gets_one_for_all_kinds(game):
    prov = _Advisory(
        [answer({"action": "end_turn"}), answer({"action": "place_tile", "tile": "x"})]
    )
    agent = LLMAgent(prov, agent_id="llm:x", max_illegal_retries=0)
    await agent.decide(buy_ctx(game))
    with pytest.raises(AgentDecisionError):
        await agent.decide(place_ctx(game))
    a, b = (c["schema"] for c in prov.calls)
    assert a == b == build_static_schema(ANY_KIND)


async def test_only_the_last_three_notes_are_shown_and_repeats_are_not_stored(game):
    notes = iter(
        ["plan one", "plan two", "plan two", "plan three", "", "plan four", ""]
    )
    prov = FakeProvider(
        lambda s, u, schema: answer({"action": "end_turn"}, note=next(notes))
    )
    agent = LLMAgent(prov, agent_id="llm:x")
    for _ in range(7):
        await agent.decide(buy_ctx(game))
    assert list(agent.notes) == ["plan two", "plan three", "plan four"]
    assert "plan one" not in prov.calls[-1]["user"]


async def test_model_is_still_asked_when_it_can_buy_or_declare_the_end(game):
    for ctx, act in (
        (buy_ctx(game), {"action": "end_turn"}),
        (after_purchase_ctx(game, can_declare=True), {"action": "declare_end_game"}),
    ):
        prov = FakeProvider([answer(act)])
        assert await LLMAgent(prov, agent_id="llm:x").decide(ctx) == act
        assert len(prov.calls) == 1
