"""Heuristic agent: the rule-based bot, one decision at a time.

Wraps the scoring logic in ``game/bot.py`` but only ever answers with an
action drawn from ``ctx.legal``.

It sees only what the seat contract allows: the public state plus its own
hand (``ctx.state``), the legal options and the calculator pack. The engine
objects ``Bot`` needs (board, hotel, player) are rebuilt from that public
state, so the agent can never read hidden information.

This agent is also the server's fallback whenever another agent errors, times
out or answers illegally (see ``seats.py``).
"""

from __future__ import annotations

import random

from agents.base import DecisionContext
from agents.bot_rules import choose_buys_position, choose_disposition_position
from agents.bot_versions import get_policy
from game.board import Board, TileState
from game.bot import Bot
from game.hotel import Hotel
from game.player import Player
from game.ruleset import default_ruleset, ruleset_from_state
from game.tile_value import table_from_parts


def _rebuild(ctx: DecisionContext) -> tuple[Board, Hotel, Player]:
    """Rebuild board, hotel and the viewer's player from public state."""
    state = ctx.state
    rs = ruleset_from_state(state)
    board = Board(rs)
    for key, cell in (state.get("board", {}).get("cells") or {}).items():
        tile = board.tile_from_string(key)
        board.place_tile(tile)
        if cell.get("state") == TileState.IN_CHAIN.value and cell.get("chain"):
            board.set_chain(tile, cell["chain"])

    hotel = Hotel(rs)
    for name, info in (state.get("chains") or {}).items():
        if not rs.has_chain(name):
            continue
        if info.get("active"):
            hotel.activate_chain(name)
        hotel._available_stocks[name] = int(info.get("available_stocks", 0))

    player = Player(ctx.player_id, "", rs)
    for p in state.get("players", []):
        if p.get("player_id") == ctx.player_id:
            player._money = int(p.get("money", 0))
            for chain, n in (p.get("stocks") or {}).items():
                if chain in player._stocks:
                    player._stocks[chain] = int(n)
    for t in state.get("hand", []):
        player._hand.append(board.tile_from_string(t))
    return board, hotel, player


def _table_players(ctx: DecisionContext, me: Player) -> list[Player]:
    """Every seat's public cash and shares, in seat order (``me`` for the
    viewer), for the tile valuation."""
    rs = ruleset_from_state(ctx.state)
    out = []
    for p in ctx.state.get("players", []):
        pid = p.get("player_id")
        if pid == ctx.player_id:
            out.append(me)
            continue
        other = Player(pid, p.get("name", ""), rs)
        other._money = int(p.get("money", 0))
        for chain, n in (p.get("stocks") or {}).items():
            if chain in other._stocks:
                other._stocks[chain] = int(n)
        out.append(other)
    return out if any(p is me for p in out) else [me, *out]


# "medium" varies its tile only among tiles worth within this much (money) of
# the best one, and never plays a negative tile while a non-negative one exists.
MEDIUM_TILE_MARGIN = 100


def pick_tile(scored: list[tuple], agent: HeuristicAgent):
    """``scored``: ``(score, index, tile)`` best first. "hard" takes the best;
    "medium" a random one of the near-best (see ``MEDIUM_TILE_MARGIN``); when
    every tile is harmful both take the least harmful."""
    best = scored[0][0]
    if agent.difficulty != "medium" or best < 0:
        return scored[0][2]
    near = [s for s in scored if s[0] >= best - MEDIUM_TILE_MARGIN and s[0] >= 0]
    return agent.rng.choice(near)[2]


def _is_winning(ctx: DecisionContext) -> bool:
    """True when the calculator says this seat would win if the game ended now."""
    for p in (ctx.calc or {}).get("players", []):
        if p.get("player_id") == ctx.player_id:
            return p.get("projected_rank") == 1
    return False


class HeuristicAgent:
    """Rule-based seat. Deterministic for a given seat name (seeded RNG)."""

    kind = "bot"

    def __init__(
        self,
        name: str = "Bot",
        difficulty: str = "medium",
        seed: int | str | None = None,
        version: str | None = None,
    ):
        self.name = name
        self.difficulty = difficulty
        self.rng = random.Random(seed if seed is not None else name)
        # The bot generation (agents/bot_versions.py); default: the best one.
        self.policy = get_policy(version)
        self.version = self.policy.version

    async def decide(self, ctx: DecisionContext) -> dict:
        return self.choose(ctx)

    # Synchronous core (also used directly by the driver as the fallback).
    def choose(self, ctx: DecisionContext) -> dict:
        kind = ctx.decision.kind
        legal = ctx.legal
        types = legal.get("action_types", [])

        if kind == "trade_response":
            return self._trade_response(ctx)

        if "declare_end_game" in types and _is_winning(ctx):
            return {"action": "declare_end_game"}

        board, hotel, player = _rebuild(ctx)
        bot = Bot(player, self.difficulty, rng=self.rng)

        if kind == "place_tile":
            return self._place_tile(ctx, bot, board, hotel)
        if kind == "found_chain":
            chains = list(legal.get("chains", []))
            choice = bot.choose_chain_to_found(chains, board) if chains else None
            if choice not in chains:
                choice = chains[0] if chains else None
            return {"action": "found_chain", "chain": choice}
        if kind == "choose_survivor":
            chains = list(legal.get("chains", []))
            choice = (
                bot.choose_merger_survivor(chains, board, hotel) if chains else None
            )
            if choice not in chains:
                choice = chains[0] if chains else None
            return {"action": "merger_choice", "surviving_chain": choice}
        if kind == "stock_disposition":
            return self._disposition(ctx, bot, board, hotel)
        if kind == "buy_stocks":
            return self._buy(ctx, bot, board, hotel)
        return {"action": types[0]} if types else {"action": "end_turn"}

    def _place_tile(self, ctx, bot: Bot, board: Board, hotel: Hotel) -> dict:
        options = [o["tile"] for o in ctx.legal.get("tiles", [])]
        if not options:
            # Unreachable: the engine always leaves a playable tile or skips
            # placement. Declaring (if legal) is the only other legal move.
            if "declare_end_game" in ctx.legal.get("action_types", []):
                return {"action": "declare_end_game"}
            return {"action": "place_tile", "tile": None}
        tiles = [board.tile_from_string(t) for t in options]
        if self.difficulty == "easy":
            return {"action": "place_tile", "tile": str(self.rng.choice(tiles))}
        if self.policy.tile == "legacy":
            scored = sorted(
                (
                    (bot._score_tile_v1(t, board, hotel), i, t)
                    for i, t in enumerate(tiles)
                ),
                key=lambda x: (-x[0], x[1]),
            )
            if self.difficulty == "medium":
                return {
                    "action": "place_tile",
                    "tile": str(self.rng.choice(scored[:3])[2]),
                }
            return {"action": "place_tile", "tile": str(scored[0][2])}
        players = _table_players(ctx, bot.player)
        scored = sorted(
            (
                (bot._score_tile(t, board, hotel, players), i, t)
                for i, t in enumerate(tiles)
            ),
            key=lambda x: (-x[0], x[1]),
        )
        return {"action": "place_tile", "tile": str(pick_tile(scored, self))}

    def _disposition(self, ctx, bot: Bot, board: Board, hotel: Hotel) -> dict:
        legal = ctx.legal
        defunct = legal.get("defunct_chain")
        survivor = legal.get("surviving_chain")
        count = int(legal.get("stock_count") or 0)
        max_trade = int(legal.get("max_trade") or 0)
        info = (ctx.calc or {}).get("disposition") or {}
        try:
            if (
                self.policy.disposition == "position"
                and self.difficulty != "easy"
                and info.get("defunct") == defunct
            ):
                table = table_from_parts(
                    board, hotel, _table_players(ctx, bot.player), board.ruleset
                )
                d = choose_disposition_position(
                    table, ctx.player_id, info, board.ruleset.merger_trade_ratio
                )
            else:
                d = bot.choose_stock_disposition(defunct, survivor, count, board, hotel)
            sell, trade = int(d.get("sell", 0)), int(d.get("trade", 0))
        except Exception:  # noqa: BLE001 - fall back to a safe answer
            sell, trade = count, 0
        trade = max(0, min(trade, max_trade))
        trade -= trade % 2
        sell = max(0, min(sell, count - trade))
        hold = count - sell - trade
        return {
            "action": "merger_disposition",
            "defunct_chain": defunct,
            "disposition": {"sell": sell, "trade": trade, "hold": hold},
        }

    def _buy(self, ctx, bot: Bot, board: Board, hotel: Hotel) -> dict:
        legal = ctx.legal
        if "buy_stocks" not in legal.get("action_types", []):
            return {"action": "end_turn"}
        options = {o["chain"]: o for o in legal.get("options", [])}
        money = int(legal.get("money", 0))
        max_total = int(
            legal.get("max_total", default_ruleset().max_stock_purchases_per_turn)
        )
        if self.policy.buy != "legacy" and self.difficulty != "easy":
            counts = self._buy_position(
                ctx, bot, board, hotel, options, money, max_total
            )
            if counts is not None:
                return {"action": "buy_stocks", "purchases": counts}
        wanted = bot.choose_stocks_to_buy(board, hotel, max_total)
        counts: dict[str, int] = {}
        spent = 0
        for chain in wanted:
            opt = options.get(chain)
            if opt is None or sum(counts.values()) >= max_total:
                continue
            if counts.get(chain, 0) + 1 > opt["available"]:
                continue
            if spent + opt["price"] > money:
                continue
            counts[chain] = counts.get(chain, 0) + 1
            spent += opt["price"]
        return {"action": "buy_stocks", "purchases": counts}

    def _buy_position(self, ctx, bot, board, hotel, options, money, max_total):
        """Buy rule "position" (v3+, agents/bot_rules.py): the affordable
        purchase that gains most in bonus positions; ``None`` when nothing
        gains at least ``buy_min_gain`` (the legacy rule then buys)."""
        p = self.policy
        table = table_from_parts(
            board, hotel, _table_players(ctx, bot.player), board.ruleset
        )
        counts, value = choose_buys_position(
            table,
            ctx.player_id,
            options,
            money - int(p.w("cash_reserve", 0)),
            max_total,
            cash_cost=p.w("cash_cost", 0.0),
            defend=p.w("defend", 0.0),
        )
        if not counts or value < p.w("buy_min_gain", 1.0):
            # v3+: fall back to v1's buying, or buy nothing ("fallback": "none")
            return {} if p.weights.get("fallback") == "none" else None
        return counts

    def _trade_response(self, ctx: DecisionContext) -> dict:
        """Accept only a legal trade that improves this seat's position.

        The judgement is ``game.trade_value.trade_valuation`` (in the
        calculator pack as ``trades``): cash, shares and bonus positions for
        both sides, a discount for what the proposer gains and a margin. See
        docs/ai/bot-trading.md. No valuation (or an invalid trade) -> reject.
        """
        legal = ctx.legal
        trade = legal.get("trade") or {}
        trade_id = trade.get("trade_id")
        value = ((ctx.calc or {}).get("trades") or {}).get(trade_id) or {}
        accept = bool(legal.get("can_accept") and value.get("acceptable"))
        return {
            "action": "accept_trade" if accept else "reject_trade",
            "trade_id": trade_id,
        }
