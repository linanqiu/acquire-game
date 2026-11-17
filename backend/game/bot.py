"""Scoring rules of the heuristic bot (driven by ``agents/heuristic.py``)."""

import random
from typing import Optional

from game.board import Board, Tile
from game.hotel import Hotel
from game.player import Player
from game.tile_value import table_from_parts, tile_valuation


class Bot:
    """Heuristic scoring for one seat. ``HeuristicAgent`` restricts every
    choice to the engine's legal options; ``Game.bots`` marks bot seats."""

    def __init__(
        self,
        player: Player,
        difficulty: str = "medium",
        rng: Optional[random.Random] = None,
    ):
        """Initialize the bot.

        Args:
            player: The Player instance this bot controls
            difficulty: AI difficulty level ("easy", "medium", "hard")
            rng: Optional random number generator for reproducibility
        """
        self.player = player
        self.difficulty = difficulty
        self.rng = rng if rng is not None else random.Random()
        if difficulty not in ("easy", "medium", "hard"):
            raise ValueError(f"Invalid difficulty: {difficulty}")

    def _score_tile(
        self,
        tile: Tile,
        board: Board,
        hotel: Hotel,
        players: Optional[list[Player]] = None,
    ) -> float:
        """Score a tile in money: what placing it gains this seat minus what it
        hands rivals (``game.tile_value.tile_valuation``, docs/ai/bot-tiles.md).

        ``players`` is the whole table in seat order (this bot's player
        included); without it only this seat's own holdings are known."""
        table = table_from_parts(
            board, hotel, players if players else [self.player], board.ruleset
        )
        return float(tile_valuation(table, tile, self.player.player_id)["score"])

    def _score_tile_v1(self, tile: Tile, board: Board, hotel: Hotel) -> float:
        """Bot v1's tile points (agents/bot_versions.py), kept unchanged so
        that version stays playable. Ignores who collects merger bonuses."""
        score = 0.0
        adjacent_played = board.get_adjacent_played_tiles(tile)
        adjacent_chains = board.get_adjacent_chains(tile)
        if len(adjacent_played) > 0 and len(adjacent_chains) == 0:
            if hotel.get_inactive_chains():
                score += 100  # founding
        if len(adjacent_chains) == 1:
            stock_count = self.player.get_stock_count(adjacent_chains[0])
            if stock_count > 0:
                score += 50 + stock_count * 5  # expanding an owned chain
        if len(adjacent_chains) >= 2:
            chain_sizes = [(c, board.get_chain_size(c)) for c in adjacent_chains]
            chain_sizes.sort(key=lambda x: x[1], reverse=True)
            surviving_stock = self.player.get_stock_count(chain_sizes[0][0])
            defunct_stock = sum(
                self.player.get_stock_count(c) for c, _ in chain_sizes[1:]
            )
            if surviving_stock > 0:
                score += 30 + surviving_stock * 3
            if defunct_stock > 0:
                score += 20 + defunct_stock * 2
        return score

    def choose_chain_to_found(self, available_chains: list[str], board: Board) -> str:
        """Choose which chain to found.

        Strategy: Prefer expensive chains early, cheap chains when low on cash.

        Args:
            available_chains: List of chain names that can be founded
            board: Current game board

        Returns:
            Name of chain to found
        """
        if not available_chains:
            raise ValueError("No chains available to found")

        if self.difficulty == "easy":
            return self.rng.choice(available_chains)

        # Categorize by tier (ruleset order: cheapest tier first)
        rs = board.ruleset
        chains_by_tier: dict[str, list[str]] = {t.id: [] for t in rs.tiers}

        for chain_name in available_chains:
            chains_by_tier[rs.chain(chain_name).tier].append(chain_name)

        # Decide based on cash situation (a quarter of the starting cash:
        # $1,500 in default)
        cheapest_first = [t.id for t in rs.tiers]
        if self.player.money < rs.starting_cash // 4:
            # Low on cash - prefer cheap chains (lower stock prices)
            preference_order = cheapest_first
        else:
            # Have money - prefer expensive chains (higher potential value)
            preference_order = cheapest_first[::-1]

        for tier in preference_order:
            if chains_by_tier[tier]:
                if self.difficulty == "hard":
                    return chains_by_tier[tier][0]
                else:
                    return self.rng.choice(chains_by_tier[tier])

        # Fallback (shouldn't reach here)
        return available_chains[0]

    def choose_merger_survivor(
        self, tied_chains: list[str], board: Board, hotel: Hotel
    ) -> str:
        """Choose which chain survives when there's a tie.

        Strategy: Prefer chain we have most stock in.

        Args:
            tied_chains: List of chain names tied for largest
            board: Current game board
            hotel: Hotel chain manager

        Returns:
            Name of chain that should survive
        """
        if not tied_chains:
            raise ValueError("No chains to choose from")

        if len(tied_chains) == 1:
            return tied_chains[0]

        if self.difficulty == "easy":
            return self.rng.choice(tied_chains)

        # Score by stock ownership
        rs = board.ruleset
        scored_chains = []
        for chain_name in tied_chains:
            stock_count = self.player.get_stock_count(chain_name)
            # Prefer chains we own stock in; tiebreak by tier rank (0 = cheapest)
            tier_bonus = rs.tier_rank(rs.chain(chain_name).tier)
            score = stock_count * 10 + tier_bonus
            scored_chains.append((score, chain_name))

        scored_chains.sort(key=lambda x: x[0], reverse=True)

        if self.difficulty == "medium":
            # Some randomness among top choices
            top = [c for s, c in scored_chains if s >= scored_chains[0][0] - 5]
            return self.rng.choice(top) if top else scored_chains[0][1]

        return scored_chains[0][1]

    def choose_stock_disposition(
        self,
        defunct_chain: str,
        surviving_chain: str,
        defunct_count: int,
        board: Board,
        hotel: Hotel,
    ) -> dict:
        """Decide sell/trade/keep for defunct stock.

        Returns {"sell": n, "trade": n, "keep": n}

        Strategy: Trade if surviving chain is good, sell if need cash.

        Args:
            defunct_chain: Name of the defunct chain
            surviving_chain: Name of the surviving chain
            defunct_count: Number of defunct stocks player holds
            board: Current game board
            hotel: Hotel chain manager

        Returns:
            Dict with "sell", "trade", and "keep" counts
        """
        if defunct_count == 0:
            return {"sell": 0, "trade": 0, "keep": 0}

        if self.difficulty == "easy":
            # Easy: random split
            ratio = board.ruleset.merger_trade_ratio
            sell = self.rng.randint(0, defunct_count)
            remaining = defunct_count - sell
            trade = (remaining // ratio) * ratio  # A multiple of the ratio
            keep = remaining - trade
            return {"sell": sell, "trade": trade, "keep": keep}

        # Check how much stock is available to trade for
        ratio = board.ruleset.merger_trade_ratio
        available_surviving = hotel.get_available_stocks(surviving_chain)
        max_trade_for = min(available_surviving, defunct_count // ratio)
        max_tradeable = max_trade_for * ratio

        surviving_size = board.get_chain_size(surviving_chain)
        surviving_price = hotel.get_stock_price(surviving_chain, surviving_size)
        defunct_size = board.get_chain_size(defunct_chain)
        defunct_price = hotel.get_stock_price(defunct_chain, defunct_size)

        # Evaluate trade value
        trade_value = surviving_price  # Get 1 share of survivor
        sell_value = defunct_price * ratio  # Sell `ratio` defunct shares

        trade = 0
        sell = 0
        keep = 0

        if self.difficulty == "hard":
            # Hard: optimize based on value comparison
            if trade_value > sell_value and max_tradeable > 0:
                # Trading is more valuable
                trade = max_tradeable
            else:
                # Selling is more valuable
                sell = defunct_count
        else:
            # Medium: balance between options
            if self.player.money < board.ruleset.starting_cash // 3:
                # Need cash - sell more
                sell = defunct_count // 2
                remaining = defunct_count - sell
                trade = (min(remaining, max_tradeable) // ratio) * ratio
                keep = defunct_count - sell - trade
            else:
                # Have money - trade more
                trade = min(max_tradeable, (defunct_count // ratio) * ratio)
                remaining = defunct_count - trade
                sell = remaining // 2
                keep = remaining - sell

        # Ensure totals match
        total = sell + trade + keep
        if total != defunct_count:
            keep = defunct_count - sell - trade

        return {"sell": sell, "trade": trade, "keep": keep}

    def choose_stocks_to_buy(
        self, board: Board, hotel: Hotel, max_stocks: int | None = None
    ) -> list[str]:
        """Choose which stocks to buy (up to the ruleset's per-turn limit).

        Returns list of chain names to buy (can repeat for multiple shares).

        Strategy: Diversify across active chains, prefer chains we already own.

        Args:
            board: Current game board
            hotel: Hotel chain manager
            max_stocks: Maximum number of stocks to buy (default: the ruleset's
                per-turn limit)

        Returns:
            List of chain names to buy (length <= max_stocks)
        """
        rs = board.ruleset
        if max_stocks is None:
            max_stocks = rs.max_stock_purchases_per_turn
        active_chains = hotel.get_active_chains()
        if not active_chains:
            return []

        purchases = []

        for _ in range(max_stocks):
            # Find affordable chains with available stock
            affordable = []
            for chain_name in active_chains:
                if hotel.get_available_stocks(chain_name) <= 0:
                    continue

                size = board.get_chain_size(chain_name)
                price = hotel.get_stock_price(chain_name, size)

                if price <= self.player.money - sum(
                    hotel.get_stock_price(c, board.get_chain_size(c)) for c in purchases
                ):
                    affordable.append((chain_name, price, size))

            if not affordable:
                break

            if self.difficulty == "easy":
                choice = self.rng.choice(affordable)[0]
            else:
                # Score chains
                scored = []
                for chain_name, price, size in affordable:
                    score = 0.0
                    owned = self.player.get_stock_count(chain_name)
                    already_buying = purchases.count(chain_name)

                    # Prefer chains we own (building toward majority)
                    if owned > 0:
                        score += 20 + owned * 3

                    # Prefer chains we're not already buying this turn (diversify)
                    if already_buying == 0:
                        score += 15

                    # Prefer larger chains (more stable)
                    score += size * 2

                    # Prefer cheaper stocks when low on money (a third of
                    # the starting cash; prices relative to the top price)
                    if self.player.money < rs.starting_cash // 3:
                        score += (rs.max_price - price) / 100

                    # Prefer higher tier chains (5 points per tier rank)
                    score += 5 * rs.tier_rank(rs.chain(chain_name).tier)

                    scored.append((score, chain_name))

                scored.sort(key=lambda x: x[0], reverse=True)

                if self.difficulty == "medium":
                    # Pick from top choices with some randomness
                    top = scored[: min(3, len(scored))]
                    choice = self.rng.choice(top)[1]
                else:
                    choice = scored[0][1]

            purchases.append(choice)

        return purchases
