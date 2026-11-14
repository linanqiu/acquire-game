"""Trade notifications and trade lists in game_state (humans and host)."""

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
            assert (
                recv_until(host, lambda m: m["type"] == "trade_proposed")["trade"][
                    "trade_id"
                ]
                == tid
            )

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
        recv_until(host, lambda m: m["type"] == "trade_accepted")

        wb.send_json({"action": "accept_trade", "trade_id": "t-ben"})
        log: list = []
        err = recv_until(wb, lambda m: m["type"] in ("error", "trade_accepted"), log)
        assert err["type"] == "error" and "no longer valid" in err["message"]
        rej = recv_until(wa, lambda m: m["type"] == "trade_rejected")
        assert rej == {"type": "trade_rejected", "trade_id": "t-ben", "rejected_by": b}
        recv_until(host, lambda m: m["type"] == "trade_rejected")
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
