"""AI player for Acquire board game."""

import random
from typing import Optional

from game.board import Board, Tile
from game.hotel import Hotel, HotelTier
from game.player import Player


class Bot:
    """AI player for Acquire."""

    def __init__(self, player: Player, difficulty: str = "medium",
                 rng: Optional[random.Random] = None):
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

    def choose_tile_to_play(self, board: Board, hotel: Hotel) -> Optional[Tile]:
        """Select which tile to play from hand.

        Strategy:
        1. Prefer tiles that found new chains
        2. Then tiles that expand chains we have stock in
        3. Then tiles that trigger profitable mergers
        4. Otherwise random valid tile

        Args:
            board: Current game board
            hotel: Hotel chain manager

        Returns:
            Tile to play, or None if no valid tiles
        """
        valid_tiles = self._get_playable_tiles(board, hotel)
        if not valid_tiles:
            return None

        if self.difficulty == "easy":
            return self.rng.choice(valid_tiles)

        # Score each tile
        scored_tiles = []
        for tile in valid_tiles:
            score = self._score_tile(tile, board, hotel)
            scored_tiles.append((score, tile))

        # Sort by score descending
        scored_tiles.sort(key=lambda x: x[0], reverse=True)

        if self.difficulty == "medium":
            # Medium: pick from top 3 with some randomness
            top_tiles = scored_tiles[:3]
            return self.rng.choice(top_tiles)[1]
        else:
            # Hard: always pick the best
            return scored_tiles[0][1]

    def _get_playable_tiles(self, board: Board, hotel: Hotel) -> list[Tile]:
        """Get tiles from hand that can be legally played.

        A tile is unplayable if it would merge two or more safe chains.
        """
        playable = []
        for tile in self.player.hand:
            if board.is_tile_played(tile):
                continue

            # Check for illegal merge (two or more safe chains)
            adjacent_chains = board.get_adjacent_chains(tile)
            if len(adjacent_chains) >= 2:
                safe_chains = [
                    c for c in adjacent_chains
                    if hotel.is_chain_safe(c, board.get_chain_size(c))
                ]
                if len(safe_chains) >= 2:
                    continue  # Illegal - would merge safe chains

            playable.append(tile)
        return playable

    def _score_tile(self, tile: Tile, board: Board, hotel: Hotel) -> float:
        """Score a tile based on strategic value."""
        score = 0.0

        adjacent_played = board.get_adjacent_played_tiles(tile)
        adjacent_chains = board.get_adjacent_chains(tile)

        # Check if this tile would found a new chain
        if len(adjacent_played) > 0 and len(adjacent_chains) == 0:
            # Would connect with lone tiles to found a chain
            inactive_chains = hotel.get_inactive_chains()
            if inactive_chains:
                score += 100  # High priority for founding

        # Check if this expands a chain we have stock in
        if len(adjacent_chains) == 1:
            chain_name = list(adjacent_chains)[0]
            stock_count = self.player.get_stock_count(chain_name)
            if stock_count > 0:
                score += 50 + stock_count * 5  # Bonus for expanding owned chains

        # Check if this triggers a merger
        if len(adjacent_chains) >= 2:
            # Find which chain would survive (largest)
            chain_sizes = [(c, board.get_chain_size(c)) for c in adjacent_chains]
            chain_sizes.sort(key=lambda x: x[1], reverse=True)

            # Check if we have stock in the surviving chain
            surviving_chain = chain_sizes[0][0]
            surviving_stock = self.player.get_stock_count(surviving_chain)

            # Check total stock in defunct chains (for bonuses)
            defunct_stock = sum(
                self.player.get_stock_count(c) for c, _ in chain_sizes[1:]
            )

            if surviving_stock > 0:
                score += 30 + surviving_stock * 3  # Good if we own the survivor
            if defunct_stock > 0:
                score += 20 + defunct_stock * 2  # Bonuses from defunct chains

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

        # Categorize by tier
        chains_by_tier = {
            HotelTier.EXPENSIVE: [],
            HotelTier.MEDIUM: [],
            HotelTier.CHEAP: [],
        }

        for chain_name in available_chains:
            chain = Hotel.get_chain(chain_name)
            chains_by_tier[chain.tier].append(chain_name)

        # Decide based on cash situation
        if self.player.money < 1500:
            # Low on cash - prefer cheap chains (lower stock prices)
            preference_order = [HotelTier.CHEAP, HotelTier.MEDIUM, HotelTier.EXPENSIVE]
        else:
            # Have money - prefer expensive chains (higher potential value)
            preference_order = [HotelTier.EXPENSIVE, HotelTier.MEDIUM, HotelTier.CHEAP]

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
        scored_chains = []
        for chain_name in tied_chains:
            stock_count = self.player.get_stock_count(chain_name)
            chain = Hotel.get_chain(chain_name)
            # Prefer chains we own stock in; tiebreak by tier value
            tier_bonus = {HotelTier.EXPENSIVE: 2, HotelTier.MEDIUM: 1, HotelTier.CHEAP: 0}
            score = stock_count * 10 + tier_bonus[chain.tier]
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
            sell = self.rng.randint(0, defunct_count)
            remaining = defunct_count - sell
            trade = (remaining // 2) * 2  # Must be even
            keep = remaining - trade
            return {"sell": sell, "trade": trade, "keep": keep}

        # Check how much stock is available to trade for
        available_surviving = hotel.get_available_stocks(surviving_chain)
        max_trade_for = min(available_surviving, defunct_count // 2)
        max_tradeable = max_trade_for * 2  # 2:1 ratio

        surviving_size = board.get_chain_size(surviving_chain)
        surviving_price = hotel.get_stock_price(surviving_chain, surviving_size)
        defunct_size = board.get_chain_size(defunct_chain)
        defunct_price = hotel.get_stock_price(defunct_chain, defunct_size)

        # Evaluate trade value
        trade_value = surviving_price  # Get 1 share of survivor
        sell_value = defunct_price * 2  # Sell 2 shares of defunct

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
            if self.player.money < 2000:
                # Need cash - sell more
                sell = defunct_count // 2
                remaining = defunct_count - sell
                trade = (min(remaining, max_tradeable) // 2) * 2
                keep = defunct_count - sell - trade
            else:
                # Have money - trade more
                trade = min(max_tradeable, (defunct_count // 2) * 2)
                remaining = defunct_count - trade
                sell = remaining // 2
                keep = remaining - sell

        # Ensure totals match
        total = sell + trade + keep
        if total != defunct_count:
            keep = defunct_count - sell - trade

        return {"sell": sell, "trade": trade, "keep": keep}

    def choose_stocks_to_buy(
        self, board: Board, hotel: Hotel, max_stocks: int = 3
    ) -> list[str]:
        """Choose which stocks to buy (up to 3 per turn).

        Returns list of chain names to buy (can repeat for multiple shares).

        Strategy: Diversify across active chains, prefer chains we already own.

        Args:
            board: Current game board
            hotel: Hotel chain manager
            max_stocks: Maximum number of stocks to buy (default 3)

        Returns:
            List of chain names to buy (length <= max_stocks)
        """
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
                    hotel.get_stock_price(c, board.get_chain_size(c))
                    for c in purchases
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

                    # Prefer cheaper stocks when low on money
                    if self.player.money < 2000:
                        score += (1200 - price) / 100

                    # Prefer higher tier chains
                    chain = Hotel.get_chain(chain_name)
                    tier_bonus = {
                        HotelTier.EXPENSIVE: 10,
                        HotelTier.MEDIUM: 5,
                        HotelTier.CHEAP: 0,
                    }
                    score += tier_bonus[chain.tier]

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
