"""Deterministic policies that pick one legal action per decision.

A policy is a plain description ``Policy(tile, found, survivor, disp, buy)``;
``choose`` turns a decision plus ``legal_actions`` output into a wire action.
Everything random draws from the ``random.Random`` passed in, which the
search seeds from (seed, player count, policy pair), so a search is exactly
repeatable. Policies only ever return actions derived from ``legal_actions``.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from game.decisions import (
    BUY_STOCKS,
    CHOOSE_SURVIVOR,
    FOUND_CHAIN,
    PLACE_TILE,
    STOCK_DISPOSITION,
    TRADE_RESPONSE,
    Decision,
)
from game.game import Game


@dataclass(frozen=True)
class Policy:
    tile: str = "first"  # first | random | mix | merge | grow | found | nothing
    found: str = "first"  # first | random | last
    survivor: str = "first"  # first | random
    disp: str = "random"  # sell | hold | trade | random | split
    buy: str = "cheap"  # none | cheap | pricey | random | spread | focus

    @property
    def id(self) -> str:
        return f"{self.tile}/{self.found}/{self.survivor}/{self.disp}/{self.buy}"


# Outcome priority for tile modes (lower is preferred).
_TILE_PRIORITY = {
    "merge": {"merge": 0, "found": 1, "expand": 2, "nothing": 3},
    "found": {"found": 0, "nothing": 1, "expand": 2, "merge": 3},
    "nothing": {"nothing": 0, "found": 1, "expand": 2, "merge": 3},
}


def _choose_tile(policy: Policy, game: Game, legal: dict, rng: random.Random) -> dict:
    tiles = legal["tiles"]
    mode = policy.tile
    if mode == "first":
        pick = tiles[0]
    elif mode == "random":
        pick = rng.choice(tiles)
    elif mode == "mix":
        weights = {"merge": 4, "found": 3, "expand": 2, "nothing": 1}
        pick = rng.choices(tiles, weights=[weights[t["outcome"]] for t in tiles])[0]
    elif mode == "grow":
        # Expand the biggest chain; avoid mergers; found only as a last resort.
        def key(t):
            if t["outcome"] == "expand":
                return (0, -game.board.get_chain_size(t["chains"][0]))
            return ({"nothing": 1, "found": 2, "merge": 3}[t["outcome"]], 0)

        pick = min(tiles, key=key)
    else:
        prio = _TILE_PRIORITY[mode]
        pick = min(tiles, key=lambda t: prio[t["outcome"]])
    return {"action": "place_tile", "tile": pick["tile"]}


def _choose_disposition(policy: Policy, legal: dict, rng: random.Random) -> dict:
    count = legal["stock_count"]
    max_trade = legal["max_trade"]
    mode = policy.disp
    if mode == "sell":
        sell, trade = count, 0
    elif mode == "hold":
        sell, trade = 0, 0
    elif mode == "trade":
        sell, trade = 0, max_trade
    elif mode == "split":
        trade = max_trade // 2 // 2 * 2
        sell = (count - trade) // 2
    else:
        trade = rng.choice(range(0, max_trade + 1, 2)) if max_trade else 0
        sell = rng.randint(0, count - trade)
    hold = count - sell - trade
    return {
        "action": "merger_disposition",
        "defunct_chain": legal["defunct_chain"],
        "disposition": {"sell": sell, "trade": trade, "hold": hold},
    }


def _choose_buy(policy: Policy, game: Game, legal: dict, rng: random.Random) -> dict:
    options = [dict(o) for o in legal["options"]]
    money = legal["money"]
    purchases: dict[str, int] = {}
    mode = policy.buy
    if mode == "none":
        return {"action": "buy_stocks", "purchases": {}}
    for _ in range(legal["max_total"]):
        cands = [
            o
            for o in options
            if o["available"] - purchases.get(o["chain"], 0) > 0 and o["price"] <= money
        ]
        if not cands:
            break
        if mode == "cheap":
            pick = min(cands, key=lambda o: (o["price"], o["chain"]))
        elif mode == "pricey":
            pick = max(cands, key=lambda o: (o["price"], o["chain"]))
        elif mode == "focus":
            # Drain whichever chain already has the least stock left.
            pick = min(
                cands,
                key=lambda o: (
                    o["available"] - purchases.get(o["chain"], 0),
                    o["chain"],
                ),
            )
        elif mode == "spread":
            pick = min(
                cands,
                key=lambda o: (purchases.get(o["chain"], 0), o["price"], o["chain"]),
            )
        else:
            pick = rng.choice(cands)
        purchases[pick["chain"]] = purchases.get(pick["chain"], 0) + 1
        money -= pick["price"]
    return {"action": "buy_stocks", "purchases": dict(sorted(purchases.items()))}


def choose(
    policy: Policy,
    game: Game,
    decision: Decision,
    legal: dict,
    rng: random.Random,
) -> dict:
    """The action ``policy`` takes for ``decision`` (never declares end game)."""
    kind = decision.kind
    if kind == PLACE_TILE:
        return _choose_tile(policy, game, legal, rng)
    if kind == FOUND_CHAIN:
        chains = legal["chains"]
        pick = {
            "first": chains[0],
            "last": chains[-1],
            "random": rng.choice(chains),
        }[policy.found]
        return {"action": "found_chain", "chain": pick}
    if kind == CHOOSE_SURVIVOR:
        chains = legal["chains"]
        pick = chains[0] if policy.survivor == "first" else rng.choice(chains)
        return {"action": "merger_choice", "surviving_chain": pick}
    if kind == STOCK_DISPOSITION:
        return _choose_disposition(policy, legal, rng)
    if kind == BUY_STOCKS:
        if "buy_stocks" in legal["action_types"]:
            return _choose_buy(policy, game, legal, rng)
        return {"action": "end_turn"}
    if kind == TRADE_RESPONSE:  # never the flow decision; kept for completeness
        return {
            "action": "reject_trade",
            "trade_id": decision.context["trade"]["trade_id"],
        }
    raise ValueError(f"unknown decision kind {kind}")


# A small curated pool; the search pairs them (human seat policy, others).
POLICIES: list[Policy] = [
    Policy("mix", "random", "random", "random", "random"),
    Policy("merge", "first", "first", "trade", "cheap"),
    Policy("grow", "first", "first", "hold", "spread"),
    Policy("found", "random", "first", "sell", "pricey"),
    Policy("mix", "last", "random", "split", "focus"),
    Policy("random", "random", "random", "random", "pricey"),
    Policy("nothing", "first", "first", "sell", "pricey"),
    Policy("merge", "random", "random", "hold", "focus"),
    Policy("grow", "last", "first", "trade", "cheap"),
]
