"""Trade notifications and trade lists in game_state (humans and host).

Offers are public: every player and the host hear about each offer and its
answer; only the parties can answer or withdraw it."""

from __future__ import annotations

from tests.protocol.helpers import create_room, join_room, recv_until, start


def _state(ws):
    return recv_until(ws, lambda m: m["type"] == "game_state")


def test_trade_lists_notifications_and_stale_accept(app_client):
    client = app_client
    code, a = create_room(client, "Ann")
    b = join_room(client, code, "Ben")
    c = join_room(client, code, "Cat")
    with (
        client.websocket_connect(f"/ws/host/{code}") as host,
        client.websocket_connect(f"/ws/player/{code}/{a}") as wa,
        client.websocket_connect(f"/ws/player/{code}/{b}") as wb,
        client.websocket_connect(f"/ws/player/{code}/{c}") as wc,
    ):
        start(client, code)
        for ws in (host, wa, wb, wc):
            _state(ws)

        # Ann offers all her cash to Ben and to Cat (each valid on its own).
        for to, tid in ((b, "t-ben"), (c, "t-cat")):
            wa.send_json(
                {
                    "action": "propose_trade",
                    "to_player_id": to,
                    "offering_money": 6000,
                    "trade_id": tid,
                }
            )
            prop = recv_until(wa, lambda m: m["type"] == "trade_proposed")
            assert prop["trade"]["trade_id"] == tid
            if tid == "t-ben":
                prop_ben = prop["trade"]
            assert (
                recv_until(host, lambda m: m["type"] == "trade_proposed")["trade"][
                    "trade_id"
                ]
                == tid
            )
            # Offers are public: the other two players hear about it too,
            # whoever it is addressed to, with the full terms.
            for ws in (wb, wc):
                seen = recv_until(ws, lambda m: m["type"] == "trade_proposed")
                assert seen["trade"]["trade_id"] == tid
                assert seen["trade"]["offering_money"] == 6000
                assert (seen["from_player"], seen["to_player"]) == (a, to)

        sa = recv_until(
            wa, lambda m: m["type"] == "game_state" and len(m["outgoing_trades"]) == 2
        )
        assert [t["trade_id"] for t in sa["outgoing_trades"]] == ["t-ben", "t-cat"]
        assert sa["incoming_trades"] == []
        sb = recv_until(
            wb, lambda m: m["type"] == "game_state" and len(m["pending_trades"]) == 2
        )
        assert [t["trade_id"] for t in sb["incoming_trades"]] == ["t-ben"]
        sh = recv_until(
            host, lambda m: m["type"] == "game_state" and len(m["pending_trades"]) == 2
        )
        assert "your_hand" not in sh and "incoming_trades" not in sh

        # Cat accepts: Ann has no cash left, so Ben's offer is now stale.
        wc.send_json({"action": "accept_trade", "trade_id": "t-cat"})
        acc = recv_until(wc, lambda m: m["type"] == "trade_accepted")
        assert (acc["from_player"], acc["to_player"]) == (a, c)
        assert acc["trade"]["offering_money"] == 6000  # the terms, for the log
        recv_until(host, lambda m: m["type"] == "trade_accepted")
        # Ben is not part of this trade and still hears the answer.
        seen = recv_until(wb, lambda m: m["type"] == "trade_accepted")
        assert (seen["trade_id"], seen["from_player"], seen["to_player"]) == (
            "t-cat",
            a,
            c,
        )

        wb.send_json({"action": "accept_trade", "trade_id": "t-ben"})
        log: list = []
        err = recv_until(wb, lambda m: m["type"] in ("error", "trade_accepted"), log)
        assert err["type"] == "error" and "no longer valid" in err["message"]
        rej = recv_until(wa, lambda m: m["type"] == "trade_rejected")
        assert isinstance(rej.pop("seq"), int)
        assert rej == {
            "type": "trade_rejected",
            "trade_id": "t-ben",
            "rejected_by": b,
            "from_player": a,
            "to_player": b,
            "trade": prop_ben,
        }
        recv_until(host, lambda m: m["type"] == "trade_rejected")
        # Cat (not a party) hears the rejection too.
        seen = recv_until(wc, lambda m: m["type"] == "trade_rejected")
        assert (seen["trade_id"], seen["rejected_by"]) == ("t-ben", b)
        # Ben got the rejection notice and a fresh state before his error.
        assert [m["type"] for m in log][-3:] == [
            "trade_rejected",
            "game_state",
            "error",
        ]
        final = log[-2]
        assert final["pending_trades"] == []
        assert final["incoming_trades"] == []
        assert final["players"][a]["money"] == 0
        assert final["players"][c]["money"] == 12000


def test_only_the_parties_can_answer_or_withdraw_a_public_offer(app_client):
    """Cat sees Ann's offer to Ben but cannot accept, reject or cancel it; the
    offer stays open, and its cancellation by Ann reaches everyone. The state
    repeats the trade messages in ``trade_log`` for pages that were away."""
    client = app_client
    code, a = create_room(client, "Ann")
    b = join_room(client, code, "Ben")
    c = join_room(client, code, "Cat")
    with (
        client.websocket_connect(f"/ws/host/{code}") as host,
        client.websocket_connect(f"/ws/player/{code}/{a}") as wa,
        client.websocket_connect(f"/ws/player/{code}/{b}") as wb,
        client.websocket_connect(f"/ws/player/{code}/{c}") as wc,
    ):
        start(client, code)
        for ws in (host, wa, wb, wc):
            _state(ws)
        wa.send_json(
            {
                "action": "propose_trade",
                "to_player_id": b,
                "offering_money": 500,
                "trade_id": "t-1",
            }
        )
        seen = recv_until(wc, lambda m: m["type"] == "trade_proposed")
        assert seen["trade"]["to_player_id"] == b
        sc = recv_until(
            wc, lambda m: m["type"] == "game_state" and len(m["pending_trades"]) == 1
        )
        # Public to Cat, but not hers to answer.
        assert sc["incoming_trades"] == [] and sc["outgoing_trades"] == []
        assert [m["type"] for m in sc["trade_log"]] == ["trade_proposed"]
        assert sc["trade_log"][0]["trade"] == seen["trade"]

        for verb, reason in (
            ("accept_trade", "Only the trade recipient can accept"),
            ("reject_trade", "Only the trade recipient can reject"),
            ("cancel_trade", "Only the trade proposer can cancel"),
        ):
            wc.send_json({"action": verb, "trade_id": "t-1"})
            err = recv_until(wc, lambda m: m["type"] == "error")
            assert reason in err["message"], err
        # The proposer cannot answer for the recipient, nor the recipient withdraw.
        wa.send_json({"action": "accept_trade", "trade_id": "t-1"})
        assert "recipient" in recv_until(wa, lambda m: m["type"] == "error")["message"]
        wb.send_json({"action": "cancel_trade", "trade_id": "t-1"})
        assert "proposer" in recv_until(wb, lambda m: m["type"] == "error")["message"]

        # Cat makes a competing offer to Ben: a normal proposal of her own.
        wc.send_json(
            {
                "action": "propose_trade",
                "to_player_id": b,
                "offering_money": 600,
                "trade_id": "t-2",
            }
        )
        rival = recv_until(wa, lambda m: m["type"] == "trade_proposed")
        assert (rival["from_player"], rival["to_player"]) == (c, b)
        assert rival["trade"]["offering_money"] == 600

        # Ann withdraws hers: everyone hears, and nothing moved.
        wa.send_json({"action": "cancel_trade", "trade_id": "t-1"})
        for ws in (wb, wc, host):
            gone = recv_until(ws, lambda m: m["type"] == "trade_canceled")
            assert (gone["trade_id"], gone["canceled_by"]) == ("t-1", a)
            assert (gone["from_player"], gone["to_player"]) == (a, b)
            assert gone["trade"]["offering_money"] == 500
        final = recv_until(
            wc,
            lambda m: (
                m["type"] == "game_state"
                and [t["trade_id"] for t in m["pending_trades"]] == ["t-2"]
            ),
        )
        assert [m["type"] for m in final["trade_log"]] == [
            "trade_proposed",
            "trade_proposed",
            "trade_canceled",
        ]
        assert {p["money"] for p in final["players"].values()} == {6000}


def test_bot_refuses_face_value_for_its_majority_and_takes_a_fair_price(app_client):
    """A human plays real turns against two rules-based seats until one of
    them holds a chain's majority alone, then asks for those shares: at list
    price the bot rejects, at a price that covers the bonuses it accepts
    (docs/ai/bot-trading.md). Everything over the real protocol."""
    from tests.protocol.helpers import HumanClient, add_seat, configure

    client = app_client
    code, me = create_room(client, "Ann")
    bots = {add_seat(client, code, "bot")["player_id"] for _ in range(2)}
    configure(client, code, 5)

    def target(state):
        """(bot, chain, shares, list value, bonuses) the human can pay for."""
        for chain, info in (state.get("chain_holders") or {}).items():
            for h in info["holders"]:
                if h["player_id"] in bots and h["role"] == "majority" and not h["tied"]:
                    cost = h["shares"] * info["price"]
                    both = info["majority_bonus"] + info["minority_bonus"]
                    if cost + 2 * both <= state["players"][me]["money"]:
                        return h["player_id"], chain, h["shares"], cost, both
        return None

    with client.websocket_connect(f"/ws/player/{code}/{me}") as ws:
        human = HumanClient(ws, me)
        start(client, code)
        state = human.play(
            stop=lambda s: (
                human.my_turn(s)
                and s["awaiting"]["decision"] == "place_tile"
                and target(s) is not None
            )
        )
        assert state["phase"] != "game_over", "no bot ever held a sole majority"
        bot, chain, shares, cost, both = target(state)
        cash = state["players"][me]["money"]

        # 1. List price for the whole majority position: refused.
        ws.send_json(
            {
                "action": "propose_trade",
                "to_player_id": bot,
                "offering_money": cost,
                "requesting_stocks": {chain: shares},
                "trade_id": "face",
            }
        )
        log: list = []
        answer = recv_until(
            ws,
            lambda m: m["type"] in ("trade_rejected", "trade_accepted", "error"),
            log,
        )
        assert answer["type"] == "trade_rejected", answer
        assert (answer["trade_id"], answer["rejected_by"]) == ("face", bot)
        after = recv_until(
            ws, lambda m: m["type"] == "game_state" and m["pending_trades"] == [], log
        )
        assert after["players"][me]["money"] == cash
        assert after["players"][bot]["stocks"][chain] == shares

        # 2. List price plus twice the bonuses at stake: accepted.
        ws.send_json(
            {
                "action": "propose_trade",
                "to_player_id": bot,
                "offering_money": cost + 2 * both,
                "requesting_stocks": {chain: shares},
                "trade_id": "fair",
            }
        )
        answer = recv_until(
            ws,
            lambda m: m["type"] in ("trade_rejected", "trade_accepted", "error"),
            log,
        )
        assert answer["type"] == "trade_accepted", answer
        assert (answer["trade_id"], answer["to_player"]) == ("fair", bot)
        after = recv_until(
            ws,
            lambda m: (
                m["type"] == "game_state"
                and m["players"][me]["stocks"].get(chain, 0) >= shares
            ),
            log,
        )
        assert after["players"][me]["money"] == cash - cost - 2 * both
        assert after["players"][bot]["stocks"].get(chain, 0) == 0
        assert human.errors == [] and not [m for m in log if m["type"] == "error"]
