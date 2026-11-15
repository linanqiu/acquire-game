"""Game rules and validation logic for Buyout."""

from enum import Enum
from typing import Union, Tuple, TYPE_CHECKING
from game.board import Board, Tile, TileState
from game.hotel import Hotel
from game.action import TradeOffer

if TYPE_CHECKING:
    from game.game import Game


class UnplayableReason(Enum):
    """Reasons why a tile cannot be played."""

    PLAYABLE = "playable"
    MERGE_SAFE_CHAINS = "would_merge_safe_chains"
    EIGHTH_CHAIN = "would_create_eighth_chain"


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
    """Game rules and validation for Buyout.

    Every threshold (safe size, end-game size, number of chains, bonus
    rounding, trade ratio) is read from ``board.ruleset`` / ``hotel.ruleset``.
    """

    @classmethod
    def _count_safe_chains(cls, board: Board, chains: list[str]) -> int:
        """Count how many chains in the list are safe (ruleset safe size).

        Args:
            board: The game board
            chains: List of chain names to check

        Returns:
            Number of safe chains
        """
        safe = board.ruleset.safe_chain_size
        return sum(1 for c in chains if board.get_chain_size(c) >= safe)

    @classmethod
    def _are_all_chains_safe(cls, board: Board, chains: list[str]) -> bool:
        """Check if all chains in the list are safe.

        Args:
            board: The game board
            chains: List of chain names to check

        Returns:
            True if all chains are safe
        """
        safe = board.ruleset.safe_chain_size
        return all(board.get_chain_size(c) >= safe for c in chains)

    @classmethod
    def can_place_tile(cls, board: Board, tile: Tile, hotel: Hotel = None) -> bool:
        """Check if tile placement is valid.

        A tile cannot be placed if:
        - The cell is already occupied
        - It would merge two or more safe chains
        - It would found a new chain while every chain is already active

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
            # Cannot merge two or more safe chains
            if cls._count_safe_chains(board, adjacent_chains) >= 2:
                return False

        # Check if this would create an 8th chain
        if hotel is not None:
            if len(adjacent_chains) == 0:
                # Check if this would found a new chain
                adjacent_played = board.get_adjacent_played_tiles(tile)
                if len(adjacent_played) > 0:
                    # This would create a new chain
                    if len(hotel.get_active_chains()) >= len(board.ruleset.chains):
                        # Every chain is active, can't create a new one
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
            chain_name = adjacent_chains[0]
            return PlacementResult(PlacementResult.EXPAND, chain=chain_name)

        else:
            # Multiple chains - merger
            return PlacementResult(PlacementResult.MERGE, chains=adjacent_chains)

    @classmethod
    def get_merger_survivor(
        cls, board: Board, chains: list[str]
    ) -> Union[str, list[str]]:
        """Determine which chain survives a merger.

        Rules for survivor determination (in priority order):
        1. If exactly one chain is safe, it survives regardless of size
        2. Otherwise, the largest chain survives
        3. If there's a tie for largest, returns a list of tied chains for player choice

        Note: Merging two safe chains is illegal and should be prevented at tile
        placement time (can_place_tile). This method assumes valid mergers only.

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

        # Check for safe chains - a safe chain always survives
        safe_size = board.ruleset.safe_chain_size
        safe_chains = [name for name, size in chain_sizes.items() if size >= safe_size]

        # If exactly one chain is safe, it survives regardless of size
        if len(safe_chains) == 1:
            return safe_chains[0]

        # Note: len(safe_chains) >= 2 should not happen (illegal merger)
        # But if it does, fall through to size comparison

        # Find the maximum size
        max_size = max(chain_sizes.values())

        # Find all chains with the maximum size
        largest_chains = [
            name for name, size in chain_sizes.items() if size == max_size
        ]

        if len(largest_chains) == 1:
            return largest_chains[0]
        else:
            return largest_chains

    @classmethod
    def calculate_bonuses(
        cls, players: list, chain_name: str, chain_size: int, hotel: Hotel
    ) -> dict[str, dict[str, int]]:
        """Calculate majority and minority stockholder bonuses.

        Rules:
        - Majority holder gets majority bonus (multiplier x stock price)
        - Minority holder gets minority bonus (multiplier x stock price)
        - If tied for majority, split majority + minority, rounded up to the
          ruleset's step ($100 in default)
        - If tied for minority, split minority bonus, rounded up likewise
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
                "majority": majority_bonus,
                "minority": minority_bonus,
            }
            return bonuses

        # Find majority holders (highest share count)
        max_shares = stockholders[0][1]
        majority_holders = [pid for pid, shares in stockholders if shares == max_shares]

        if len(majority_holders) > 1:
            # Tie for majority - split majority + minority among them
            total_bonus = majority_bonus + minority_bonus
            split_bonus = hotel.ruleset.round_split(total_bonus / len(majority_holders))

            for player_id in majority_holders:
                bonuses[player_id] = {"majority": split_bonus, "minority": 0}
            return bonuses

        # Single majority holder
        majority_holder = majority_holders[0]
        bonuses[majority_holder] = {"majority": majority_bonus, "minority": 0}

        # Find minority holders (second highest share count)
        remaining = [
            (pid, shares) for pid, shares in stockholders if pid != majority_holder
        ]

        if remaining:
            second_max = remaining[0][1]
            minority_holders = [
                pid for pid, shares in remaining if shares == second_max
            ]

            if len(minority_holders) > 1:
                # Tie for minority - split minority bonus
                split_bonus = hotel.ruleset.round_split(
                    minority_bonus / len(minority_holders)
                )
                for player_id in minority_holders:
                    bonuses[player_id] = {"majority": 0, "minority": split_bonus}
            else:
                # Single minority holder
                bonuses[minority_holders[0]] = {
                    "majority": 0,
                    "minority": minority_bonus,
                }

        return bonuses

    @classmethod
    def check_end_game(cls, board: Board, hotel: Hotel) -> bool:
        """Check if the game can be ended.

        Game can end if:
        - Any chain has reached the ruleset's end-game size
        - All active chains are safe

        Args:
            board: The game board
            hotel: Hotel manager

        Returns:
            True if the game can be ended
        """
        active_chains = hotel.get_active_chains()

        if not active_chains:
            return False

        # Check if any chain reached the end-game size
        end_size = board.ruleset.end_game_chain_size
        for chain_name in active_chains:
            if board.get_chain_size(chain_name) >= end_size:
                return True

        # Check if all active chains are safe
        # Note: If all chains are safe, mergers are impossible, so game can end
        return cls._are_all_chains_safe(board, active_chains)

    @classmethod
    def is_tile_permanently_unplayable(
        cls, board: Board, tile: Tile, hotel: Hotel
    ) -> bool:
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

        # Permanently unplayable if would merge 2+ safe chains
        return cls._count_safe_chains(board, adjacent_chains) >= 2

    @classmethod
    def get_playable_tiles(
        cls, board: Board, tiles: list[Tile], hotel: Hotel
    ) -> list[Tile]:
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
    def are_all_tiles_unplayable(
        cls, board: Board, tiles: list[Tile], hotel: Hotel
    ) -> bool:
        """Check if all tiles in a hand are unplayable.

        According to Buyout rules, if a player has no playable tiles at the
        start of their turn, they must reveal their hand, remove all unplayable
        tiles from the game, and draw new tiles.

        Args:
            board: The game board
            tiles: List of tiles to check (player's hand)
            hotel: Hotel manager

        Returns:
            True if all tiles are unplayable, False otherwise
        """
        if not tiles:
            return False  # Empty hand is not "all unplayable"

        for tile in tiles:
            if cls.can_place_tile(board, tile, hotel):
                return False
        return True

    @classmethod
    def get_tile_playability(cls, board: Board, tile: Tile, hotel: Hotel) -> dict:
        """Determine if a tile is playable and why not if it isn't.

        Args:
            board: The game board
            tile: The tile to check
            hotel: Hotel manager

        Returns:
            Dict with:
                - playable: bool - whether the tile can be played
                - reason: str | None - why it can't be played (if not playable)
                - permanent: bool | None - whether the unplayability is permanent
                - would_trigger_merger: bool - whether playing this tile would trigger a merger
        """
        # Check if cell is already occupied
        cell = board.get_cell(tile.column, tile.row)
        if cell.state != TileState.EMPTY:
            # Already played, technically playable (just not by placing again)
            return {
                "playable": True,
                "reason": None,
                "permanent": None,
                "would_trigger_merger": False,
            }

        # Get adjacent chains
        adjacent_chains = board.get_adjacent_chains(tile)

        # Determine if this tile would trigger a merger (2+ adjacent chains)
        would_trigger_merger = len(adjacent_chains) >= 2

        # Check for safe chain merger (would merge 2+ safe chains)
        if would_trigger_merger:
            if cls._count_safe_chains(board, adjacent_chains) >= 2:
                return {
                    "playable": False,
                    "reason": UnplayableReason.MERGE_SAFE_CHAINS.value,
                    "permanent": False,  # Could become playable if a chain is merged
                    "would_trigger_merger": True,
                }

        # Check if this would found one chain too many
        if len(adjacent_chains) == 0:
            adjacent_played = board.get_adjacent_played_tiles(tile)
            if len(adjacent_played) > 0:
                # This would create a new chain
                active_chains = hotel.get_active_chains()
                if len(active_chains) >= len(board.ruleset.chains):
                    return {
                        "playable": False,
                        "reason": UnplayableReason.EIGHTH_CHAIN.value,
                        "permanent": True,  # Unplayable while every chain exists
                        "would_trigger_merger": False,
                    }

        return {
            "playable": True,
            "reason": None,
            "permanent": None,
            "would_trigger_merger": would_trigger_merger,
        }

    @classmethod
    def get_tiles_playability(
        cls, board: Board, tiles: list[Tile], hotel: Hotel
    ) -> dict[str, dict]:
        """Get playability status for multiple tiles.

        Args:
            board: The game board
            tiles: List of tiles to check (e.g., player's hand)
            hotel: Hotel manager

        Returns:
            Dict mapping tile string (e.g., "5C") to playability info
        """
        return {
            str(tile): cls.get_tile_playability(board, tile, hotel) for tile in tiles
        }

    @classmethod
    def validate_trade(cls, game: "Game", trade: TradeOffer) -> Tuple[bool, str]:
        """Validate a trade offer between two players.

        Checks that:
        - Both players exist in the game
        - The offering player has the stocks and money they're offering
        - The receiving player has the stocks and money being requested
        - The trade is not empty (at least one thing being exchanged)
        - Players are not trading with themselves
        - Stock quantities are non-negative
        - Money amounts are non-negative

        Args:
            game: The current game instance
            trade: The TradeOffer to validate

        Returns:
            Tuple of (is_valid, error_message). If valid, error_message is empty string.
        """
        # Check that players are not trading with themselves
        if trade.from_player_id == trade.to_player_id:
            return False, "Cannot trade with yourself"

        # Check that both players exist
        from_player = game.get_player(trade.from_player_id)
        if from_player is None:
            return False, f"Offering player '{trade.from_player_id}' not found"

        to_player = game.get_player(trade.to_player_id)
        if to_player is None:
            return False, f"Receiving player '{trade.to_player_id}' not found"

        # Validate non-negative amounts
        if trade.offering_money < 0:
            return False, "Offering money cannot be negative"
        if trade.requesting_money < 0:
            return False, "Requesting money cannot be negative"

        for chain_name, quantity in trade.offering_stocks.items():
            if quantity < 0:
                return (
                    False,
                    f"Offering stock quantity for {chain_name} cannot be negative",
                )

        for chain_name, quantity in trade.requesting_stocks.items():
            if quantity < 0:
                return (
                    False,
                    f"Requesting stock quantity for {chain_name} cannot be negative",
                )

        # Check that the trade is not empty
        has_offering = trade.offering_money > 0 or any(
            qty > 0 for qty in trade.offering_stocks.values()
        )
        has_requesting = trade.requesting_money > 0 or any(
            qty > 0 for qty in trade.requesting_stocks.values()
        )

        if not has_offering and not has_requesting:
            return False, "Trade must include at least one item to exchange"

        # Stock of chains in an in-progress merger is frozen: bonuses were paid
        # on current holdings and pending dispositions rely on the stock counts.
        merger = getattr(game, "_merger", None)
        if merger is not None and merger.chains:
            for chain_name in merger.chains:
                if (
                    trade.offering_stocks.get(chain_name, 0) > 0
                    or trade.requesting_stocks.get(chain_name, 0) > 0
                ):
                    return (
                        False,
                        f"Cannot trade {chain_name} stock during its merger",
                    )

        # Check that offering player has the resources they're offering
        if not from_player.can_afford_trade(
            trade.offering_stocks, trade.offering_money
        ):
            return False, "Offering player does not have the required stocks or money"

        # Check that receiving player has the resources being requested
        if not to_player.can_afford_trade(
            trade.requesting_stocks, trade.requesting_money
        ):
            return False, "Receiving player does not have the requested stocks or money"

        # Check that receiving stocks won't exceed max for the receiver
        max_held = game.ruleset.stocks_per_chain
        for chain_name, quantity in trade.offering_stocks.items():
            if quantity > 0:
                current = to_player.get_stock_count(chain_name)
                if current + quantity > max_held:
                    return (
                        False,
                        f"Trade would exceed max stocks for {chain_name} for receiving player",
                    )

        # Check that receiving stocks won't exceed max for the offerer
        for chain_name, quantity in trade.requesting_stocks.items():
            if quantity > 0:
                current = from_player.get_stock_count(chain_name)
                if current + quantity > max_held:
                    return (
                        False,
                        f"Trade would exceed max stocks for {chain_name} for offering player",
                    )

        return True, ""
