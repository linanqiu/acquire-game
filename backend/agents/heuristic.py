"""Heuristic agent: the classic rule-based bot, one decision at a time.

Wraps the scoring logic in ``game/bot.py`` but only ever answers with an
action drawn from ``ctx.legal`` (``Bot._get_playable_tiles`` alone can pick a
tile that would found an 8th chain; the legal list from the engine cannot).

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
from game.board import Board, Tile, TileState
from game.bot import Bot
from game.hotel import Hotel
from game.player import Player


def _rebuild(ctx: DecisionContext) -> tuple[Board, Hotel, Player]:
    """Rebuild board, hotel and the viewer's player from public state."""
    state = ctx.state
    board = Board()
    for key, cell in (state.get("board", {}).get("cells") or {}).items():
        tile = Tile.from_string(key)
        board.place_tile(tile)
        if cell.get("state") == TileState.IN_CHAIN.value and cell.get("chain"):
            board.set_chain(tile, cell["chain"])

    hotel = Hotel()
    for name, info in (state.get("chains") or {}).items():
        if name not in Hotel.CHAINS:
            continue
        if info.get("active"):
            hotel.activate_chain(name)
        hotel._available_stocks[name] = int(info.get("available_stocks", 0))

    player = Player(ctx.player_id, "")
    for p in state.get("players", []):
        if p.get("player_id") == ctx.player_id:
            player._money = int(p.get("money", 0))
            for chain, n in (p.get("stocks") or {}).items():
                if chain in player._stocks:
                    player._stocks[chain] = int(n)
    for t in state.get("hand", []):
        player._hand.append(Tile.from_string(t))
    return board, hotel, player


def _is_winning(ctx: DecisionContext) -> bool:
    """True when the calculator says this seat would win if the game ended now."""
    for p in (ctx.calc or {}).get("players", []):
        if p.get("player_id") == ctx.player_id:
            return p.get("projected_rank") == 1
    return False


def _chain_prices(ctx: DecisionContext) -> dict[str, int]:
    prices = {}
    for name, info in ((ctx.calc or {}).get("chains") or {}).items():
        prices[name] = int(info.get("price") or 0) if info.get("active") else 0
    return prices


class HeuristicAgent:
    """Rule-based seat. Deterministic for a given seat name (seeded RNG)."""

    kind = "bot"

    def __init__(
        self,
        name: str = "Bot",
        difficulty: str = "medium",
        seed: int | str | None = None,
    ):
        self.name = name
        self.difficulty = difficulty
        self.rng = random.Random(seed if seed is not None else name)

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
        tiles = [Tile.from_string(t) for t in options]
        if self.difficulty == "easy":
            return {"action": "place_tile", "tile": str(self.rng.choice(tiles))}
        scored = sorted(
            ((bot._score_tile(t, board, hotel), i, t) for i, t in enumerate(tiles)),
            key=lambda x: (-x[0], x[1]),
        )
        if self.difficulty == "medium":
            pick = self.rng.choice(scored[:3])[2]
        else:
            pick = scored[0][2]
        return {"action": "place_tile", "tile": str(pick)}

    def _disposition(self, ctx, bot: Bot, board: Board, hotel: Hotel) -> dict:
        legal = ctx.legal
        defunct = legal.get("defunct_chain")
        survivor = legal.get("surviving_chain")
        count = int(legal.get("stock_count") or 0)
        max_trade = int(legal.get("max_trade") or 0)
        try:
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
        max_total = int(legal.get("max_total", 3))
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

    def _trade_response(self, ctx: DecisionContext) -> dict:
        """Accept only trades that are legal and strictly favourable at current prices."""
        legal = ctx.legal
        trade = legal.get("trade") or {}
        trade_id = trade.get("trade_id")
        if not legal.get("can_accept"):
            return {"action": "reject_trade", "trade_id": trade_id}
        prices = _chain_prices(ctx)
        # From this seat's point of view: it receives what the proposer offers.
        gain = int(trade.get("offering_money", 0)) + sum(
            prices.get(c, 0) * n
            for c, n in (trade.get("offering_stocks") or {}).items()
        )
        cost = int(trade.get("requesting_money", 0)) + sum(
            prices.get(c, 0) * n
            for c, n in (trade.get("requesting_stocks") or {}).items()
        )
        verb = "accept_trade" if gain > cost else "reject_trade"
        return {"action": verb, "trade_id": trade_id}
