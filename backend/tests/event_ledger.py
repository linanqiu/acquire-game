"""Rebuild cash, holdings, standings and the turn sequence from ``game.events``
ALONE (no peeking at engine state), so tests can prove the event log is a
complete record. Used by the fuzz driver in ``test_decisions.py``.

``Ledger.feed(events)`` applies events in order. After any prefix of the log,
``cash``/``stocks``/``bank`` must equal the engine's numbers.
"""

from __future__ import annotations

from game.ranking import competition_ranks


class Ledger:
    def __init__(self, ruleset):
        self.rs = ruleset
        self.cash: dict[str, int] = {}
        self.stocks: dict[str, dict[str, int]] = {}
        self.bank: dict[str, int] = {
            c: ruleset.stocks_per_chain for c in ruleset.chain_ids
        }
        self.turn_order: list[str] = []
        self.turns: list[tuple[str, str]] = []  # (ended by, next player)
        self.final: list[dict] | None = None
        self.fed = 0

    # ---------------------------------------------------------------- feed

    def feed(self, events: list[dict]) -> None:
        for e in events[self.fed :]:
            getattr(self, "_" + e["type"], self._ignore)(e)
        self.fed = len(events)

    def _ignore(self, e: dict) -> None:
        pass

    def _give(self, pid: str, chain: str, n: int) -> None:
        held = self.stocks[pid]
        held[chain] = held.get(chain, 0) + n

    def _take(self, pid: str, chain: str, n: int) -> None:
        self._give(pid, chain, -n)

    # ------------------------------------------------------------ handlers

    def _game_started(self, e: dict) -> None:
        self.turn_order = list(e["turn_order"])
        for p in e["players"]:
            self.cash[p["player_id"]] = self.rs.starting_cash
            self.stocks[p["player_id"]] = {c: 0 for c in self.rs.chain_ids}

    def _chain_founded(self, e: dict) -> None:
        pid, chain = e["player_id"], e["chain"]
        if e["founder_bonus_type"] == "stock":
            self._give(pid, chain, e["founder_bonus_value"])
            self.bank[chain] -= e["founder_bonus_value"]
            self.cash[pid] += e.get("founder_bonus_cash", 0)
        else:
            self.cash[pid] += e["founder_bonus_value"]

    def _stocks_purchased(self, e: dict) -> None:
        pid = e["player_id"]
        self.cash[pid] -= e["total_cost"]
        for chain, n in e["purchases"].items():
            self._give(pid, chain, n)
            self.bank[chain] -= n

    def _bonuses_paid(self, e: dict) -> None:
        for pid, b in e["bonuses"].items():
            self.cash[pid] += b["majority"] + b["minority"]

    def _stock_disposition(self, e: dict) -> None:
        pid = e["player_id"]
        defunct, survivor = e["defunct_chain"], e["surviving_chain"]
        self.cash[pid] += e["sale_proceeds"]
        gone = e["sell"] + e["trade"]
        self._take(pid, defunct, gone)
        self.bank[defunct] += gone
        got = e["survivor_shares_received"]
        self._give(pid, survivor, got)
        self.bank[survivor] -= got

    def _trade_accepted(self, e: dict) -> None:
        t = e["trade"]
        a, b = t["from_player_id"], t["to_player_id"]
        for chain, n in t["offering_stocks"].items():
            self._take(a, chain, n)
            self._give(b, chain, n)
        for chain, n in t["requesting_stocks"].items():
            self._take(b, chain, n)
            self._give(a, chain, n)
        self.cash[a] += t["requesting_money"] - t["offering_money"]
        self.cash[b] += t["offering_money"] - t["requesting_money"]

    def _turn_ended(self, e: dict) -> None:
        self.turns.append((e["player_id"], e["next_player_id"]))

    def _game_ended(self, e: dict) -> None:
        for pid, amount in e["final_sales"].items():
            self.cash[pid] += amount
        for held in self.stocks.values():  # everything is sold at the end
            for chain in held:
                held[chain] = 0
        order = [p for p in self.turn_order]
        scores = [self.cash[p] for p in order]
        ranks = competition_ranks(scores)
        rows = sorted(range(len(order)), key=lambda i: (-scores[i], i))
        self.final = [
            {"player_id": order[i], "money": scores[i], "rank": ranks[i]} for i in rows
        ]

    # ----------------------------------------------------------- comparing

    def check_against(self, game) -> None:
        """Every number derived from events equals the engine's."""
        for p in game.players:
            pid = p.player_id
            assert self.cash[pid] == p.money, (pid, self.cash[pid], p.money)
            for chain in self.rs.chain_ids:
                assert self.stocks[pid][chain] == p.get_stock_count(chain), (
                    pid,
                    chain,
                    self.stocks[pid][chain],
                    p.get_stock_count(chain),
                )
        if self.final is None:  # (the bank is not settled at game end)
            for chain in self.rs.chain_ids:
                assert self.bank[chain] == game.hotel.get_available_stocks(chain), chain

    def check_turn_sequence(self, game) -> None:
        """Turns follow the seating order, one ``turn_ended`` per turn, and each
        names the player who moves next."""
        order = self.turn_order
        assert order == [p.player_id for p in game.players]
        n = len(order)
        for i, (who, nxt) in enumerate(self.turns):
            assert who == order[(order.index(self.turns[0][0]) + i) % n], (i, who)
            assert nxt == order[(order.index(who) + 1) % n], (i, who, nxt)
            if i:
                assert self.turns[i - 1][1] == who, (i, self.turns[i - 1], who)
