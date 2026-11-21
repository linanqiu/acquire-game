"""Tier 2: the trade-preview route (BL-021), over HTTP against the real app.

The preview is read-only and public: it proposes nothing and tells nobody.
For a draft addressed to a rules-based seat it says what that seat will
answer; the test then sends the same offers over the WebSocket and the seat
answers as the preview said.
"""

from __future__ import annotations

from tests.protocol.helpers import add_seat, create_room, join_room, recv_until, start


def _preview(client, code: str, player_id: str, body: dict):
    return client.post(f"/room/{code}/trade-preview/{player_id}", json=body)


def _answer(ws, trade_id: str) -> str:
    done = recv_until(
        ws,
        lambda m: (
            m["type"] in ("trade_accepted", "trade_rejected")
            and m["trade_id"] == trade_id
        ),
    )
    return done["type"]


def test_preview_is_refused_outside_a_game_and_for_strangers(app_client):
    client = app_client
    code, ann = create_room(client, "Ann")
    ben = join_room(client, code, "Ben")
    draft = {"to_player_id": ben, "offering_money": 100}
    assert _preview(client, "ZZZZ", ann, draft).status_code == 404
    assert _preview(client, code, ann, draft).status_code == 400  # lobby
    join_room(client, code, "Cat")
    start(client, code)
    assert _preview(client, code, "nobody", draft).status_code == 404
    assert _preview(client, code, ann, {}).status_code == 422
    # An offer that is no longer open (answered a moment ago) is not an error.
    gone = _preview(client, code, ann, {"trade_id": "none"})
    assert gone.status_code == 200
    assert gone.json() == {"valid": False, "error": "Trade not found"}
    ok = _preview(client, code, ann, draft)
    assert ok.status_code == 200 and ok.json()["valid"] is True


def test_preview_says_what_the_bot_answers_and_proposes_nothing(app_client):
    client = app_client
    code, ann = create_room(client, "Ann")
    cat = join_room(client, code, "Cat")
    bot = add_seat(client, code, "bot")["player_id"]
    with (
        client.websocket_connect(f"/ws/player/{code}/{ann}") as wa,
        client.websocket_connect(f"/ws/player/{code}/{cat}") as wc,
    ):
        start(client, code)
        first = recv_until(wa, lambda m: m["type"] == "game_state")
        assert first["players"][bot]["kind"] == "bot"

        # Ann asks the bot for $500 and offers $100: a loss for the bot.
        bad = {"to_player_id": bot, "offering_money": 100, "requesting_money": 500}
        shown = _preview(client, code, ann, bad).json()
        assert shown["valid"] is True
        assert (shown["from_player_id"], shown["to_player_id"]) == (ann, bot)
        assert shown["list"] == {"offering": 100, "requesting": 500}
        assert shown["positions"] == []
        assert shown["bot"]["player_id"] == bot
        assert shown["bot"]["acceptable"] is False
        needed = shown["bot"]["cash_needed"]
        assert needed == 500  # nothing asked any more, and the $100 on top

        # The same draft with the cash the preview names: it will be taken.
        good = {"to_player_id": bot, "offering_money": 100}
        assert _preview(client, code, ann, good).json()["bot"] == {
            "player_id": bot,
            "acceptable": True,
            "cash_needed": 0,
        }

        # A draft for a human seat is never judged; position effects only.
        to_cat = {"to_player_id": cat, "offering_money": 100}
        assert _preview(client, code, ann, to_cat).json()["bot"] is None

        # Refusals are apply_action's own words.
        broke = {"to_player_id": bot, "offering_money": 999_999}
        refused = _preview(client, code, ann, broke).json()
        assert refused == {
            "valid": False,
            "error": refused["error"],
            "from_player_id": ann,
            "to_player_id": bot,
        }
        wa.send_json({"action": "propose_trade", **broke})
        err = recv_until(wa, lambda m: m["type"] == "error")
        assert err["message"] == refused["error"]
        malformed = _preview(client, code, ann, {"to_player_id": 7}).json()
        assert malformed["valid"] is False and malformed["error"]

        # Nothing was proposed by any of that.
        state = client.get(f"/test/room/{code}/snapshot").json()
        assert state["pending_trades"] == []

        # The seat answers as the preview said, to the offer sent for real.
        wa.send_json({"action": "propose_trade", **bad, "trade_id": "t-bad"})
        assert _answer(wa, "t-bad") == "trade_rejected"
        wa.send_json({"action": "propose_trade", **good, "trade_id": "t-good"})
        assert _answer(wa, "t-good") == "trade_accepted"

        # An open offer: anyone at the table may ask what it does (it is
        # public), by its id; no verdict is given for it.
        wa.send_json(
            {
                "action": "propose_trade",
                "to_player_id": cat,
                "offering_money": 300,
                "trade_id": "t-open",
            }
        )
        recv_until(
            wc, lambda m: m["type"] == "trade_proposed" and m["trade_id"] == "t-open"
        )
        for asker in (ann, cat, bot):
            seen = _preview(client, code, asker, {"trade_id": "t-open"}).json()
            assert seen["valid"] is True and seen["bot"] is None
            assert seen["list"] == {"offering": 300, "requesting": 0}
            assert (seen["from_player_id"], seen["to_player_id"]) == (ann, cat)
