"""Game rules and validation logic for Acquire."""

from typing import Union, List, TYPE_CHECKING
from game.board import Board, Tile, TileState
from game.hotel import Hotel, HotelChain

if TYPE_CHECKING:
    from game.action import Action
    from game.game import Game, GamePhase


class PlacementResult:
    """Result of analyzing a tile placement."""

    NOTHING = "nothing"
    EXPAND = "expand"
    FOUND = "found"
    MERGE = "merge"

    def __init__(self, result_type: str, chain: str = None, chains: list[str] = None):
        """Initialize placement result.

        Args:
            result_type: One of NOTHING, EXPAND, FOUND, MERGE
            chain: For EXPAND, the chain being expanded
            chains: For MERGE, list of chains involved
        """
        self.result_type = result_type
        self.chain = chain
        self.chains = chains or []

    def __repr__(self):
        if self.result_type == self.EXPAND:
            return f"PlacementResult({self.result_type}, chain={self.chain})"
        elif self.result_type == self.MERGE:
            return f"PlacementResult({self.result_type}, chains={self.chains})"
        return f"PlacementResult({self.result_type})"


class Rules:
    """Game rules and validation for Acquire."""

    MAX_CHAINS = 7
    SAFE_SIZE = 11
    END_GAME_SIZE = 41

    @classmethod
    def can_place_tile(cls, board: Board, tile: Tile, hotel: Hotel = None) -> bool:
        """Check if tile placement is valid.

        A tile cannot be placed if:
        - The cell is already occupied
        - It would merge two or more safe chains (11+ tiles)
        - It would create an 8th chain when all 7 exist

        Args:
            board: The game board
            tile: The tile to place
            hotel: Hotel manager (optional, for checking chain count)

        Returns:
            True if the tile can be placed, False otherwise
        """
        # Check if cell is already occupied
        cell = board.get_cell(tile.column, tile.row)
        if cell.state != TileState.EMPTY:
            return False

        # Get adjacent chains
        adjacent_chains = board.get_adjacent_chains(tile)

        # Check for safe chain merger
        if len(adjacent_chains) >= 2:
            safe_count = 0
            for chain_name in adjacent_chains:
                chain_size = board.get_chain_size(chain_name)
                if chain_size >= cls.SAFE_SIZE:
                    safe_count += 1

            # Cannot merge two or more safe chains
            if safe_count >= 2:
                return False

        # Check if this would create an 8th chain
        if hotel is not None:
            if len(adjacent_chains) == 0:
                # Check if this would found a new chain
                adjacent_played = board.get_adjacent_played_tiles(tile)
                if len(adjacent_played) > 0:
                    # This would create a new chain
                    if len(hotel.get_active_chains()) >= cls.MAX_CHAINS:
                        # All 7 chains are active, can't create new one
                        return False

        return True

    @classmethod
    def get_placement_result(cls, board: Board, tile: Tile) -> PlacementResult:
        """Determine what happens when a tile is placed.

        Args:
            board: The game board
            tile: The tile being placed

        Returns:
            PlacementResult indicating the outcome
        """
        adjacent_chains = board.get_adjacent_chains(tile)
        adjacent_played = board.get_adjacent_played_tiles(tile)

        if len(adjacent_chains) == 0:
            if len(adjacent_played) == 0:
                # No adjacent tiles at all - isolated tile
                return PlacementResult(PlacementResult.NOTHING)
            else:
                # Adjacent to played tiles but no chains - founding a chain
                return PlacementResult(PlacementResult.FOUND)

        elif len(adjacent_chains) == 1:
            # Expanding an existing chain
            chain_name = list(adjacent_chains)[0]
            return PlacementResult(PlacementResult.EXPAND, chain=chain_name)

        else:
            # Multiple chains - merger
            return PlacementResult(PlacementResult.MERGE, chains=list(adjacent_chains))

    @classmethod
    def get_merger_survivor(cls, board: Board, chains: list[str]) -> Union[str, list[str]]:
        """Determine which chain survives a merger.

        The largest chain survives. If there's a tie, returns a list
        of tied chains for the player to choose from.

        Args:
            board: The game board
            chains: List of chain names involved in the merger

        Returns:
            Single chain name if there's a clear winner, or list of
            tied chain names if player must choose
        """
        if not chains:
            return []

        # Get sizes for all chains
        chain_sizes = {}
        for chain_name in chains:
            chain_sizes[chain_name] = board.get_chain_size(chain_name)

        # Find the maximum size
        max_size = max(chain_sizes.values())

        # Find all chains with the maximum size
        largest_chains = [name for name, size in chain_sizes.items() if size == max_size]

        if len(largest_chains) == 1:
            return largest_chains[0]
        else:
            return largest_chains

    @classmethod
    def calculate_bonuses(cls, players: list, chain_name: str, chain_size: int,
                          hotel: Hotel) -> dict[str, dict[str, int]]:
        """Calculate majority and minority stockholder bonuses.

        Rules:
        - Majority holder gets majority bonus (10x stock price)
        - Minority holder gets minority bonus (5x stock price)
        - If tied for majority, split majority + minority, round up to $100
        - If tied for minority, split minority bonus, round up to $100
        - If only one stockholder, they get both bonuses

        Args:
            players: List of Player objects
            chain_name: Name of the defunct chain
            chain_size: Size of the defunct chain
            hotel: Hotel manager for bonus calculations

        Returns:
            Dict mapping player_id to dict with 'majority' and 'minority' bonus amounts
        """
        # Get stockholders and their share counts
        stockholders = []
        for player in players:
            shares = player.get_stock_count(chain_name)
            if shares > 0:
                stockholders.append((player.player_id, shares))

        if not stockholders:
            return {}

        # Sort by share count descending
        stockholders.sort(key=lambda x: x[1], reverse=True)

        # Get bonus amounts
        majority_bonus = hotel.get_majority_bonus(chain_name, chain_size)
        minority_bonus = hotel.get_minority_bonus(chain_name, chain_size)

        bonuses = {}

        if len(stockholders) == 1:
            # Single stockholder gets both bonuses
            player_id = stockholders[0][0]
            bonuses[player_id] = {
                'majority': majority_bonus,
                'minority': minority_bonus
            }
            return bonuses

        # Find majority holders (highest share count)
        max_shares = stockholders[0][1]
        majority_holders = [pid for pid, shares in stockholders if shares == max_shares]

        if len(majority_holders) > 1:
            # Tie for majority - split majority + minority among them
            total_bonus = majority_bonus + minority_bonus
            split_bonus = cls._round_up_to_hundred(total_bonus / len(majority_holders))

            for player_id in majority_holders:
                bonuses[player_id] = {
                    'majority': split_bonus,
                    'minority': 0
                }
            return bonuses

        # Single majority holder
        majority_holder = majority_holders[0]
        bonuses[majority_holder] = {
            'majority': majority_bonus,
            'minority': 0
        }

        # Find minority holders (second highest share count)
        remaining = [(pid, shares) for pid, shares in stockholders if pid != majority_holder]

        if remaining:
            second_max = remaining[0][1]
            minority_holders = [pid for pid, shares in remaining if shares == second_max]

            if len(minority_holders) > 1:
                # Tie for minority - split minority bonus
                split_bonus = cls._round_up_to_hundred(minority_bonus / len(minority_holders))
                for player_id in minority_holders:
                    bonuses[player_id] = {
                        'majority': 0,
                        'minority': split_bonus
                    }
            else:
                # Single minority holder
                bonuses[minority_holders[0]] = {
                    'majority': 0,
                    'minority': minority_bonus
                }

        return bonuses

    @classmethod
    def _round_up_to_hundred(cls, amount: float) -> int:
        """Round up to the nearest $100.

        Args:
            amount: The amount to round

        Returns:
            Amount rounded up to nearest 100
        """
        import math
        return int(math.ceil(amount / 100) * 100)

    @classmethod
    def check_end_game(cls, board: Board, hotel: Hotel) -> bool:
        """Check if the game can be ended.

        Game can end if:
        - Any chain has 41+ tiles
        - All active chains are safe (11+ tiles)
        - All 7 chains are active and no legal mergers are possible

        Args:
            board: The game board
            hotel: Hotel manager

        Returns:
            True if the game can be ended
        """
        active_chains = hotel.get_active_chains()

        if not active_chains:
            return False

        # Check if any chain >= 41 tiles
        for chain_name in active_chains:
            if board.get_chain_size(chain_name) >= cls.END_GAME_SIZE:
                return True

        # Check if all active chains are safe (11+ tiles)
        all_safe = True
        for chain_name in active_chains:
            if board.get_chain_size(chain_name) < cls.SAFE_SIZE:
                all_safe = False
                break

        if all_safe:
            return True

        # Check if all 7 chains are active and no legal mergers possible
        if len(active_chains) >= cls.MAX_CHAINS:
            # Check if all chains are safe (which means no mergers possible)
            all_safe = True
            for chain_name in active_chains:
                if board.get_chain_size(chain_name) < cls.SAFE_SIZE:
                    all_safe = False
                    break

            if all_safe:
                return True

        return False

    @classmethod
    def is_tile_permanently_unplayable(cls, board: Board, tile: Tile, hotel: Hotel) -> bool:
        """Check if a tile can never be legally played.

        A tile is permanently unplayable if it would merge two safe chains.

        Args:
            board: The game board
            tile: The tile to check
            hotel: Hotel manager

        Returns:
            True if the tile can never be played
        """
        # Check if already played
        if board.is_tile_played(tile):
            return False  # Already played, not unplayable

        # Get adjacent chains
        adjacent_chains = board.get_adjacent_chains(tile)

        if len(adjacent_chains) < 2:
            return False  # Can't merge if fewer than 2 adjacent chains

        # Count safe chains
        safe_count = 0
        for chain_name in adjacent_chains:
            chain_size = board.get_chain_size(chain_name)
            if chain_size >= cls.SAFE_SIZE:
                safe_count += 1

        # Permanently unplayable if would merge 2+ safe chains
        return safe_count >= 2

    @classmethod
    def get_playable_tiles(cls, board: Board, tiles: list[Tile], hotel: Hotel) -> list[Tile]:
        """Get list of tiles that can legally be played.

        Args:
            board: The game board
            tiles: List of tiles to check (e.g., player's hand)
            hotel: Hotel manager

        Returns:
            List of tiles that can be legally played
        """
        return [tile for tile in tiles if cls.can_place_tile(board, tile, hotel)]

    @classmethod
    def get_unplayable_tiles(cls, board: Board, tiles: list[Tile], hotel: Hotel) -> list[Tile]:
        """Get list of tiles that cannot be legally played.

        Args:
            board: The game board
            tiles: List of tiles to check (e.g., player's hand)
            hotel: Hotel manager

        Returns:
            List of tiles that cannot be legally played
        """
        return [tile for tile in tiles if not cls.can_place_tile(board, tile, hotel)]

    @classmethod
    def get_all_legal_actions(cls, game: "Game", player_id: str) -> List["Action"]:
        """Return all legal actions for the current game state.

        This method enumerates every valid action the player can take,
        which is essential for RL training with action masking.

        Args:
            game: The current game instance
            player_id: ID of the player to get actions for

        Returns:
            List of Action objects representing all legal actions
        """
        from game.action import Action
        from game.game import GamePhase

        actions = []
        player = game.get_player(player_id)

        if not player or not game.can_player_act(player_id):
            return actions

        if game.phase == GamePhase.PLAYING:
            # Player can play any playable tile from their hand
            playable = cls.get_playable_tiles(game.board, player.hand, game.hotel)
            for tile in playable:
                actions.append(Action.play_tile(str(tile)))

        elif game.phase == GamePhase.FOUNDING_CHAIN:
            # Player chooses which chain to found
            if game.pending_action and game.pending_action.get("type") == "found_chain":
                available = game.pending_action.get("available_chains", [])
                for chain in available:
                    actions.append(Action.found_chain(chain))

        elif game.phase == GamePhase.MERGING:
            if game.pending_action:
                action_type = game.pending_action.get("type")

                if action_type == "choose_survivor":
                    # Player chooses which chain survives
                    tied = game.pending_action.get("tied_chains", [])
                    for chain in tied:
                        actions.append(Action.choose_merger_survivor(chain))

                elif action_type == "stock_disposition":
                    # Player decides sell/trade/keep for defunct stocks
                    # Only if it's this player's turn to handle disposition
                    if game.pending_action.get("player_id") == player_id:
                        count = game.pending_action.get("stock_count", 0)
                        available_trade = game.pending_action.get("available_to_trade", 0)

                        # Generate all valid sell/trade/keep combinations
                        for sell in range(count + 1):
                            remaining = count - sell
                            # Trade must be even (2:1 ratio)
                            max_trade = min(remaining, available_trade * 2)
                            for trade in range(0, max_trade + 1, 2):
                                keep = remaining - trade
                                if keep >= 0:
                                    actions.append(Action.stock_disposition(sell, trade, keep))

        elif game.phase == GamePhase.BUYING_STOCKS:
            # Player can buy 0-3 stocks from active chains
            # Generate all valid purchase combinations
            active_chains = game.hotel.get_active_chains()
            affordable = []

            for chain_name in active_chains:
                if game.hotel.get_available_stocks(chain_name) > 0:
                    size = game.board.get_chain_size(chain_name)
                    price = game.hotel.get_stock_price(chain_name, size)
                    if price <= player.money:
                        affordable.append((chain_name, price))

            # Generate all combinations of 0-3 stock purchases
            actions.extend(cls._generate_stock_purchase_actions(
                affordable, player.money, game.MAX_STOCKS_PER_TURN, game.hotel, game.board
            ))

        return actions

    @classmethod
    def _generate_stock_purchase_actions(
        cls, affordable: list, money: int, max_stocks: int, hotel: Hotel, board: Board
    ) -> List["Action"]:
        """Generate all valid stock purchase action combinations.

        Args:
            affordable: List of (chain_name, price) tuples
            money: Player's available money
            max_stocks: Maximum stocks per turn
            hotel: Hotel manager
            board: Game board

        Returns:
            List of BUY_STOCKS actions
        """
        from game.action import Action

        actions = []
        # Empty purchase is always valid
        actions.append(Action.buy_stocks([]))

        if not affordable:
            return actions

        def generate_combinations(current: list, remaining_money: int, remaining_stocks: int):
            """Recursively generate valid purchase combinations."""
            if remaining_stocks <= 0:
                return

            for chain_name, price in affordable:
                # Check if we can afford this stock
                if price > remaining_money:
                    continue

                # Check if stock is still available
                current_count = current.count(chain_name)
                if current_count >= hotel.get_available_stocks(chain_name):
                    continue

                new_combo = current + [chain_name]
                actions.append(Action.buy_stocks(new_combo))

                # Recurse for additional purchases
                generate_combinations(
                    new_combo,
                    remaining_money - price,
                    remaining_stocks - 1
                )

        generate_combinations([], money, max_stocks)
        return actions

    @classmethod
    def get_action_space_size(cls) -> dict:
        """Get the size of each action space component.

        Returns:
            Dict with sizes for each action type
        """
        return {
            "play_tile": 6,  # Max 6 tiles in hand
            "found_chain": 7,  # 7 possible chains
            "choose_survivor": 7,  # 7 possible chains
            "stock_disposition": None,  # Variable (depends on stock count)
            "buy_stocks": None,  # Variable (depends on available chains/money)
        }
