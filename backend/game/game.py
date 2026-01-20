"""Main game orchestration for Acquire board game."""

from enum import Enum
from typing import Optional, Dict, List, TYPE_CHECKING
import random

from game.board import Board, Tile, TileState

if TYPE_CHECKING:
    from game.action import Action
from game.action import TradeOffer
from game.events import EventType, GameEvent, create_event
from game.hotel import Hotel
from game.player import Player
from game.rules import Rules, PlacementResult
from game.bot import Bot
from game.responses import (
    PlayTileResult,
    FoundChainResult,
    ChooseMergerSurvivorResult,
    StockDispositionResult,
    BuyStocksResult,
    StockPurchase,
    EndTurnResult,
    EndGameResult,
    PlayerStanding,
    ProposeTradeResult,
    AcceptTradeResult,
    RejectTradeResult,
    CancelTradeResult,
    DeclareEndGameResult,
)


class GamePhase(Enum):
    """Game phases that control what actions are valid."""

    LOBBY = "lobby"
    PLAYING = "playing"
    TILE_PLAYED = "tile_played"
    FOUNDING_CHAIN = "founding_chain"
    MERGING = "merging"
    BUYING_STOCKS = "buying_stocks"
    GAME_OVER = "game_over"


class Game:
    """Main game class that orchestrates the full Acquire game."""

    MIN_PLAYERS = 3
    MAX_PLAYERS = 6
    STARTING_TILES = 6
    MAX_STOCKS_PER_TURN = 3
    MAX_PENDING_TRADES_PER_PLAYER = 5  # Limit to prevent spam
    MAX_EVENTS = 50  # Maximum number of events to keep in the log

    def __init__(self, seed: Optional[int] = None):
        """Initialize a new game in lobby state.

        Args:
            seed: Optional random seed for reproducible games
        """
        self.seed = seed
        self.rng = random.Random(seed)
        self.board = Board()
        self.hotel = Hotel()
        self.players: list[Player] = []
        self.bots: dict[str, Bot] = {}  # player_id -> Bot
        self.tile_bag: list[Tile] = []
        self.current_player_index: int = 0
        self.phase: GamePhase = GamePhase.LOBBY
        self.pending_action: Optional[dict] = None  # Track what action is needed

        # Merger state tracking
        self._merger_chains: list[str] = []  # Chains involved in current merger
        self._merger_survivor: Optional[str] = None  # Surviving chain
        self._merger_defunct_queue: list[str] = []  # Defunct chains to process
        self._merger_current_defunct: Optional[str] = None  # Currently processing
        self._merger_stock_players: list[
            str
        ] = []  # Players to handle stock disposition
        self._merger_stock_index: int = 0  # Current player handling disposition

        # Player-to-player trading state
        self.pending_trades: Dict[str, TradeOffer] = {}  # trade_id -> TradeOffer

        # Event logging for activity feed
        self._events: List[GameEvent] = []

    # Convenience properties for backward compatibility with WebSocket handlers

    @property
    def turn_order(self) -> list[str]:
        """Get list of player IDs in turn order."""
        return [p.player_id for p in self.players]

    @property
    def current_turn_index(self) -> int:
        """Get current turn index (alias for current_player_index)."""
        return self.current_player_index

    @current_turn_index.setter
    def current_turn_index(self, value: int) -> None:
        """Set current turn index."""
        self.current_player_index = value

    @property
    def tile_pool(self) -> list[Tile]:
        """Get tile pool (alias for tile_bag)."""
        return self.tile_bag

    @property
    def turn_phase(self) -> str:
        """Get the current turn phase as a string for WebSocket compatibility."""
        # Map GamePhase to turn phase strings used by WebSocket handlers
        phase_map = {
            GamePhase.LOBBY: "lobby",
            GamePhase.PLAYING: "place_tile",
            GamePhase.FOUNDING_CHAIN: "found_chain",
            GamePhase.MERGING: "merger",
            GamePhase.BUYING_STOCKS: "buy_stocks",
            GamePhase.GAME_OVER: "game_over",
        }
        # Check pending_action for stock_disposition
        if self.phase == GamePhase.MERGING and self.pending_action:
            if self.pending_action.get("type") == "stock_disposition":
                return "stock_disposition"
        return phase_map.get(self.phase, "unknown")

    @turn_phase.setter
    def turn_phase(self, value: str) -> None:
        """Set turn phase from string (for test compatibility)."""
        phase_map = {
            "place_tile": GamePhase.PLAYING,
            "found_chain": GamePhase.FOUNDING_CHAIN,
            "merger": GamePhase.MERGING,
            "buy_stocks": GamePhase.BUYING_STOCKS,
            "game_over": GamePhase.GAME_OVER,
        }
        if value in phase_map:
            self.phase = phase_map[value]

    def add_player(
        self,
        player_id: str,
        name: str,
        is_bot: bool = False,
        bot_difficulty: str = "medium",
    ) -> Player:
        """Add a player to the game.

        Args:
            player_id: Unique identifier for the player
            name: Display name for the player
            is_bot: Whether this player is controlled by AI
            bot_difficulty: AI difficulty level ("easy", "medium", "hard")

        Returns:
            The created Player instance

        Raises:
            ValueError: If game is not in lobby or max players reached
        """
        if self.phase != GamePhase.LOBBY:
            raise ValueError("Cannot add players after game has started")
        if len(self.players) >= self.MAX_PLAYERS:
            raise ValueError(f"Maximum {self.MAX_PLAYERS} players allowed")
        if any(p.player_id == player_id for p in self.players):
            raise ValueError(f"Player with id {player_id} already exists")

        player = Player(player_id, name)
        self.players.append(player)

        if is_bot:
            self.bots[player_id] = Bot(player, bot_difficulty, rng=self.rng)

        return player

    def remove_player(self, player_id: str) -> bool:
        """Remove a player from the game.

        Args:
            player_id: ID of player to remove

        Returns:
            True if player was removed, False if not found

        Raises:
            ValueError: If game is not in lobby
        """
        if self.phase != GamePhase.LOBBY:
            raise ValueError("Cannot remove players after game has started")

        for i, player in enumerate(self.players):
            if player.player_id == player_id:
                self.players.pop(i)
                self.bots.pop(player_id, None)
                return True
        return False

    def start_game(self):
        """Start the game by shuffling tiles and dealing to players.

        Raises:
            ValueError: If not enough players or not in lobby
        """
        if self.phase != GamePhase.LOBBY:
            raise ValueError("Game has already started")
        if len(self.players) < self.MIN_PLAYERS:
            raise ValueError(f"Need at least {self.MIN_PLAYERS} players to start")

        # Create and shuffle tile bag (use instance RNG for reproducibility)
        self.tile_bag = Board.all_tiles()
        self.rng.shuffle(self.tile_bag)

        # Deal starting tiles to each player
        for player in self.players:
            for _ in range(self.STARTING_TILES):
                self.draw_tile(player)

        # Set initial game state
        self.current_player_index = 0
        self.phase = GamePhase.PLAYING

        # Emit game started event
        player_names = [p.name for p in self.players]
        self._emit_event(
            EventType.GAME_STARTED,
            None,
            f"Game started with {len(self.players)} players",
            {"players": player_names},
        )

    def get_current_player(self) -> Player:
        """Get the player whose turn it is.

        Returns:
            Current Player instance
        """
        return self.players[self.current_player_index]

    def get_current_player_id(self) -> Optional[str]:
        """Get the ID of the player whose turn it is.

        This is a convenience method for AI training to easily identify
        which player should act next.

        Returns:
            Player ID string, or None if no players exist
        """
        if not self.players:
            return None
        return self.players[self.current_player_index].player_id

    def get_player(self, player_id: str) -> Optional[Player]:
        """Get a player by ID.

        Args:
            player_id: ID of player to find

        Returns:
            Player instance or None if not found
        """
        for player in self.players:
            if player.player_id == player_id:
                return player
        return None

    def next_turn(self):
        """Advance to the next player's turn."""
        self.current_player_index = (self.current_player_index + 1) % len(self.players)
        self.phase = GamePhase.PLAYING
        self.pending_action = None

    def _emit_event(
        self,
        event_type: EventType,
        player_id: str | None,
        message: str,
        details: dict | None = None,
    ) -> None:
        """Emit a game event to the activity log.

        Args:
            event_type: The type of event
            player_id: ID of the player who triggered the event (if applicable)
            message: Human-readable description of the event
            details: Machine-readable data about the event
        """
        event = create_event(event_type, player_id, message, details)
        self._events.append(event)

        # Trim to max events
        if len(self._events) > self.MAX_EVENTS:
            self._events = self._events[-self.MAX_EVENTS :]

    def get_events(self, limit: int = 20) -> List[GameEvent]:
        """Get recent events from the activity log.

        Args:
            limit: Maximum number of events to return

        Returns:
            List of recent GameEvent objects
        """
        return self._events[-limit:]

    def handle_all_tiles_unplayable(self, player: Player) -> Optional[dict]:
        """Handle the case where a player has no playable tiles at turn start.

        According to Acquire rules, if all tiles in a player's hand are unplayable
        at the start of their turn, they must:
        1. Reveal their hand to all players
        2. Set aside all unplayable tiles (removed from game, not back to tile bag)
        3. Draw new tiles to refill their hand

        Args:
            player: The player to check

        Returns:
            Dict with information about what happened, or None if hand was playable.
            If returns a dict, it contains:
            - revealed_hand: List of tile strings that were revealed
            - removed_tiles: List of tile strings that were removed from game
            - new_tiles: List of tile strings drawn as replacements
        """
        # Check if all tiles are unplayable
        if not Rules.are_all_tiles_unplayable(self.board, player.hand, self.hotel):
            return None

        # Record the revealed hand
        revealed_hand = [str(t) for t in player.hand]
        removed_tiles = []

        # Remove all unplayable tiles from the game (not back to tile bag)
        tiles_to_remove = list(player.hand)  # Copy since we're modifying
        for tile in tiles_to_remove:
            player.remove_tile(tile)
            removed_tiles.append(str(tile))
            # Note: tiles are removed from game, NOT returned to tile_bag

        # Draw new tiles up to hand limit
        new_tiles = []
        while player.hand_size < Player.MAX_HAND_SIZE and self.tile_bag:
            tile = self.draw_tile(player)
            if tile:
                new_tiles.append(str(tile))
            else:
                break

        return {
            "revealed_hand": revealed_hand,
            "removed_tiles": removed_tiles,
            "new_tiles": new_tiles,
        }

    def draw_tile(self, player: Player) -> Optional[Tile]:
        """Draw a tile from the bag for a player.

        Args:
            player: Player to give the tile to

        Returns:
            The drawn Tile or None if bag is empty or hand is full
        """
        if not self.tile_bag:
            return None
        if player.hand_size >= Player.MAX_HAND_SIZE:
            return None

        tile = self.tile_bag.pop()
        player.add_tile(tile)
        return tile

    def can_player_act(self, player_id: str) -> bool:
        """Check if a player can take an action in the current phase.

        Args:
            player_id: ID of player to check

        Returns:
            True if player can act
        """
        current = self.get_current_player()

        # In most phases, only current player can act
        if self.phase in (
            GamePhase.PLAYING,
            GamePhase.TILE_PLAYED,
            GamePhase.FOUNDING_CHAIN,
            GamePhase.BUYING_STOCKS,
        ):
            return player_id == current.player_id

        # During merging, specific player may need to handle disposition
        if self.phase == GamePhase.MERGING:
            if (
                self.pending_action
                and self.pending_action.get("type") == "stock_disposition"
            ):
                return player_id == self.pending_action.get("player_id")
            # Otherwise, current player chooses survivor
            return player_id == current.player_id

        return False

    def play_tile(self, player_id: str, tile: Tile) -> PlayTileResult:
        """Play a tile from a player's hand.

        Args:
            player_id: ID of player making the move
            tile: Tile to play

        Returns:
            PlayTileResult with result and next action needed
        """
        # Validate state
        if self.phase != GamePhase.PLAYING:
            return PlayTileResult(success=False, error="Not in playing phase")

        player = self.get_player(player_id)
        if not player:
            return PlayTileResult(success=False, error="Player not found")

        if player.player_id != self.get_current_player().player_id:
            return PlayTileResult(success=False, error="Not your turn")

        if not player.has_tile(tile):
            return PlayTileResult(success=False, error="Tile not in hand")

        if not Rules.can_place_tile(self.board, tile, self.hotel):
            return PlayTileResult(success=False, error="Tile cannot be placed")

        # Place the tile
        self.board.place_tile(tile)
        player.remove_tile(tile)

        # Determine what happens
        result = Rules.get_placement_result(self.board, tile)

        if result.result_type == PlacementResult.NOTHING:
            # Just placed, move to buying stocks
            self.phase = GamePhase.BUYING_STOCKS
            self._emit_event(
                EventType.TILE_PLACED,
                player_id,
                f"{player.name} placed {tile}",
                {"tile": str(tile)},
            )
            return PlayTileResult(
                success=True,
                tile=str(tile),
                result_type="nothing",
                next_action="buy_stocks",
            )

        elif result.result_type == PlacementResult.EXPAND:
            # Expand the chain
            chain_name = result.chain
            self._expand_chain(tile, chain_name)
            self.phase = GamePhase.BUYING_STOCKS
            chain_size = self.board.get_chain_size(chain_name)
            self._emit_event(
                EventType.TILE_PLACED,
                player_id,
                f"{player.name} placed {tile}",
                {"tile": str(tile)},
            )
            self._emit_event(
                EventType.CHAIN_EXPANDED,
                player_id,
                f"{chain_name} grows to {chain_size} tiles",
                {"chain": chain_name, "size": chain_size},
            )
            return PlayTileResult(
                success=True,
                tile=str(tile),
                result_type="expand",
                chain=chain_name,
                next_action="buy_stocks",
            )

        elif result.result_type == PlacementResult.FOUND:
            # Player needs to choose which chain to found
            available = self.hotel.get_inactive_chains()
            self.phase = GamePhase.FOUNDING_CHAIN
            self.pending_action = {
                "type": "found_chain",
                "tile": tile,
                "available_chains": available,
            }
            self._emit_event(
                EventType.TILE_PLACED,
                player_id,
                f"{player.name} placed {tile}",
                {"tile": str(tile)},
            )
            return PlayTileResult(
                success=True,
                tile=str(tile),
                result_type="found",
                available_chains=available,
                next_action="found_chain",
            )

        elif result.result_type == PlacementResult.MERGE:
            # Merger! Determine survivor
            chains = result.chains
            self._merger_chains = chains

            self._emit_event(
                EventType.TILE_PLACED,
                player_id,
                f"{player.name} placed {tile}",
                {"tile": str(tile)},
            )

            survivor = Rules.get_merger_survivor(self.board, chains)

            if isinstance(survivor, str):
                # Clear winner
                self._merger_survivor = survivor
                defunct = [c for c in chains if c != survivor]
                self._start_merger_process(tile, survivor, defunct)
                return PlayTileResult(
                    success=True,
                    tile=str(tile),
                    result_type="merge",
                    survivor=survivor,
                    defunct=defunct,
                    next_action=self.pending_action.get("type")
                    if self.pending_action
                    else "buy_stocks",
                )
            else:
                # Tie - player must choose
                self.phase = GamePhase.MERGING
                self.pending_action = {
                    "type": "choose_survivor",
                    "tile": tile,
                    "tied_chains": survivor,
                }
                return PlayTileResult(
                    success=True,
                    tile=str(tile),
                    result_type="merge_tie",
                    tied_chains=survivor,
                    next_action="choose_merger_survivor",
                )

        return PlayTileResult(success=False, error="Unknown placement result")

    def _expand_chain(self, tile: Tile, chain_name: str):
        """Expand a chain to include the placed tile and any connected tiles."""
        # Set the played tile to the chain
        self.board.set_chain(tile, chain_name)

        # Also add any adjacent played tiles that aren't in a chain
        connected = self.board.get_connected_tiles(tile)
        for t in connected:
            cell = self.board.get_cell(t.column, t.row)
            if cell.state == TileState.PLAYED and cell.chain is None:
                self.board.set_chain(t, chain_name)

    def found_chain(self, player_id: str, chain_name: str) -> FoundChainResult:
        """Found a new hotel chain.

        Args:
            player_id: ID of player founding the chain
            chain_name: Name of chain to found

        Returns:
            FoundChainResult with result
        """
        if self.phase != GamePhase.FOUNDING_CHAIN:
            return FoundChainResult(success=False, error="Not in founding chain phase")

        player = self.get_player(player_id)
        if not player or player.player_id != self.get_current_player().player_id:
            return FoundChainResult(success=False, error="Not your turn")

        if not self.pending_action or self.pending_action.get("type") != "found_chain":
            return FoundChainResult(success=False, error="No pending chain founding")

        available = self.pending_action.get("available_chains", [])
        if chain_name not in available:
            return FoundChainResult(
                success=False, error=f"Chain {chain_name} not available"
            )

        tile = self.pending_action.get("tile")

        # Found the chain
        self.hotel.activate_chain(chain_name)

        # Assign all connected tiles to the chain
        connected = self.board.get_connected_tiles(tile)
        for t in connected:
            self.board.set_chain(t, chain_name)

        # Give founder a free stock if available, otherwise cash equivalent
        chain_size = self.board.get_chain_size(chain_name)
        stock_price = self.hotel.get_stock_price(chain_name, chain_size)
        founder_bonus_type = None
        founder_bonus_value = 0

        if self.hotel.get_available_stocks(chain_name) > 0:
            self.hotel.buy_stock(chain_name)
            player.add_stocks(chain_name, 1)
            founder_bonus_type = "stock"
            founder_bonus_value = 1
        else:
            # No stock available - give cash equivalent
            player.add_money(stock_price)
            founder_bonus_type = "cash"
            founder_bonus_value = stock_price

        self.phase = GamePhase.BUYING_STOCKS
        self.pending_action = None

        self._emit_event(
            EventType.CHAIN_FOUNDED,
            player_id,
            f"{chain_name} founded with {chain_size} tiles",
            {"chain": chain_name, "size": chain_size, "founder": player.name},
        )

        return FoundChainResult(
            success=True,
            chain=chain_name,
            founder_bonus=True,
            founder_bonus_type=founder_bonus_type,
            founder_bonus_value=founder_bonus_value,
            next_action="buy_stocks",
        )

    def _start_merger_process(
        self, tile: Tile, survivor: str, defunct_chains: list[str]
    ):
        """Start processing a merger."""
        self.phase = GamePhase.MERGING
        self._merger_survivor = survivor
        self._merger_defunct_queue = sorted(
            defunct_chains, key=lambda c: self.board.get_chain_size(c), reverse=True
        )

        defunct_str = ", ".join(defunct_chains)
        self._emit_event(
            EventType.MERGER_STARTED,
            self.get_current_player().player_id,
            f"{defunct_str} merging into {survivor}",
            {"survivor": survivor, "defunct": defunct_chains},
        )

        self._process_next_defunct_chain(tile)

    def _process_next_defunct_chain(self, tile: Tile = None):
        """Process the next defunct chain in the queue."""
        if not self._merger_defunct_queue:
            # All defunct chains processed, finalize merger
            self._finalize_merger(tile)
            return

        defunct = self._merger_defunct_queue.pop(0)
        self._merger_current_defunct = defunct

        # Pay bonuses
        chain_size = self.board.get_chain_size(defunct)
        bonuses = Rules.calculate_bonuses(self.players, defunct, chain_size, self.hotel)

        bonus_details = []
        for player_id, bonus in bonuses.items():
            player = self.get_player(player_id)
            if player:
                total = bonus.get("majority", 0) + bonus.get("minority", 0)
                player.add_money(total)
                if total > 0:
                    bonus_details.append(
                        {"player": player.name, "amount": total, "type": bonus}
                    )

        if bonus_details:
            self._emit_event(
                EventType.BONUSES_PAID,
                None,
                f"Bonuses paid for {defunct}",
                {"chain": defunct, "bonuses": bonus_details},
            )

        # Find players who need to handle stock disposition
        stockholders = []
        current_idx = self.current_player_index
        for i in range(len(self.players)):
            idx = (current_idx + i) % len(self.players)
            p = self.players[idx]
            if p.get_stock_count(defunct) > 0:
                stockholders.append(p.player_id)

        if stockholders:
            self._merger_stock_players = stockholders
            self._merger_stock_index = 0
            self._prompt_next_stock_disposition()
        else:
            # No stockholders, continue to next defunct chain
            self._process_next_defunct_chain(tile)

    def _prompt_next_stock_disposition(self):
        """Prompt the next player for stock disposition."""
        if self._merger_stock_index >= len(self._merger_stock_players):
            # All players handled, process next defunct chain
            self._process_next_defunct_chain()
            return

        player_id = self._merger_stock_players[self._merger_stock_index]
        player = self.get_player(player_id)
        defunct = self._merger_current_defunct
        count = player.get_stock_count(defunct)

        self.pending_action = {
            "type": "stock_disposition",
            "player_id": player_id,
            "defunct_chain": defunct,
            "surviving_chain": self._merger_survivor,
            "stock_count": count,
            "available_to_trade": self.hotel.get_available_stocks(
                self._merger_survivor
            ),
        }

    def choose_merger_survivor(
        self, player_id: str, chain_name: str
    ) -> ChooseMergerSurvivorResult:
        """Choose which chain survives a tied merger.

        Args:
            player_id: ID of player making the choice
            chain_name: Name of chain that should survive

        Returns:
            ChooseMergerSurvivorResult with result
        """
        if self.phase != GamePhase.MERGING:
            return ChooseMergerSurvivorResult(
                success=False, error="Not in merging phase"
            )

        if (
            not self.pending_action
            or self.pending_action.get("type") != "choose_survivor"
        ):
            return ChooseMergerSurvivorResult(
                success=False, error="No pending survivor choice"
            )

        player = self.get_player(player_id)
        if not player or player.player_id != self.get_current_player().player_id:
            return ChooseMergerSurvivorResult(success=False, error="Not your turn")

        tied_chains = self.pending_action.get("tied_chains", [])
        if chain_name not in tied_chains:
            return ChooseMergerSurvivorResult(
                success=False, error=f"Chain {chain_name} not in tied chains"
            )

        tile = self.pending_action.get("tile")
        defunct = [c for c in self._merger_chains if c != chain_name]

        self._merger_survivor = chain_name
        self.pending_action = None

        self._start_merger_process(tile, chain_name, defunct)

        return ChooseMergerSurvivorResult(
            success=True,
            survivor=chain_name,
            defunct=defunct,
            next_action=self.pending_action.get("type")
            if self.pending_action
            else "buy_stocks",
        )

    def handle_stock_disposition(
        self, player_id: str, sell: int, trade: int, keep: int
    ) -> StockDispositionResult:
        """Handle a player's decision on defunct stock.

        Args:
            player_id: ID of player making the decision
            sell: Number of shares to sell
            trade: Number of shares to trade (must be even)
            keep: Number of shares to keep

        Returns:
            StockDispositionResult with result
        """
        if self.phase != GamePhase.MERGING:
            return StockDispositionResult(success=False, error="Not in merging phase")

        if (
            not self.pending_action
            or self.pending_action.get("type") != "stock_disposition"
        ):
            return StockDispositionResult(
                success=False, error="No pending stock disposition"
            )

        if player_id != self.pending_action.get("player_id"):
            return StockDispositionResult(
                success=False, error="Not your turn to handle stocks"
            )

        player = self.get_player(player_id)
        defunct = self.pending_action.get("defunct_chain")
        survivor = self.pending_action.get("surviving_chain")
        total_stock = self.pending_action.get("stock_count")

        # Validate
        if sell + trade + keep != total_stock:
            return StockDispositionResult(
                success=False, error="Stock counts don't add up"
            )

        if trade % 2 != 0:
            return StockDispositionResult(
                success=False, error="Trade count must be even"
            )

        trade_for = trade // 2
        available = self.hotel.get_available_stocks(survivor)
        if trade_for > available:
            return StockDispositionResult(
                success=False, error="Not enough survivor stock available to trade"
            )

        # Execute sell
        if sell > 0:
            defunct_size = self.board.get_chain_size(defunct)
            sell_price = self.hotel.get_stock_price(defunct, defunct_size)
            player.sell_stock(defunct, sell, sell_price)
            self.hotel.return_stock(defunct, sell)

        # Execute trade
        if trade > 0:
            player.remove_stocks(defunct, trade)
            player.add_stocks(survivor, trade_for)
            self.hotel.return_stock(defunct, trade)
            self.hotel.buy_stock(survivor, trade_for)

        # Keep is automatic (just don't do anything with them)

        # Emit stock disposition event
        parts = []
        if sell > 0:
            parts.append(f"sold {sell}")
        if trade > 0:
            parts.append(f"traded {trade}")
        if keep > 0:
            parts.append(f"kept {keep}")
        disposition_str = ", ".join(parts) if parts else "disposed"

        self._emit_event(
            EventType.STOCK_DISPOSED,
            player_id,
            f"{player.name} {disposition_str} {defunct}",
            {"chain": defunct, "sold": sell, "traded": trade, "kept": keep},
        )

        # Move to next player or next defunct chain
        self._merger_stock_index += 1
        self._prompt_next_stock_disposition()

        return StockDispositionResult(
            success=True,
            sold=sell,
            traded=trade,
            kept=keep,
            next_action=self.pending_action.get("type")
            if self.pending_action
            else "buy_stocks",
        )

    def _finalize_merger(self, tile: Tile = None):
        """Finalize the merger by merging all defunct chains into survivor."""
        survivor = self._merger_survivor
        defunct_chains = [c for c in self._merger_chains if c != survivor]

        # Merge all defunct chains into survivor on the board
        for defunct in self._merger_chains:
            if defunct != survivor:
                self.board.merge_chains(survivor, defunct)
                self.hotel.deactivate_chain(defunct)

        # If we have a tile, also absorb any connected lone tiles
        if tile:
            connected = self.board.get_connected_tiles(tile)
            for t in connected:
                cell = self.board.get_cell(t.column, t.row)
                if cell.chain is None:
                    self.board.set_chain(t, survivor)

        # Emit merger completed event
        survivor_size = self.board.get_chain_size(survivor)
        self._emit_event(
            EventType.MERGER_COMPLETED,
            None,
            f"Merger complete, {survivor} now has {survivor_size} tiles",
            {"survivor": survivor, "defunct": defunct_chains, "size": survivor_size},
        )

        # Reset merger state
        self._merger_chains = []
        self._merger_survivor = None
        self._merger_defunct_queue = []
        self._merger_current_defunct = None
        self._merger_stock_players = []
        self._merger_stock_index = 0

        self.phase = GamePhase.BUYING_STOCKS
        self.pending_action = None

    def buy_stocks(self, player_id: str, purchases: list[str]) -> BuyStocksResult:
        """Buy stocks for the current player.

        Args:
            player_id: ID of player buying
            purchases: List of chain names to buy (can repeat, max 3)

        Returns:
            BuyStocksResult with result
        """
        if self.phase != GamePhase.BUYING_STOCKS:
            return BuyStocksResult(success=False, error="Not in buying stocks phase")

        player = self.get_player(player_id)
        if not player or player.player_id != self.get_current_player().player_id:
            return BuyStocksResult(success=False, error="Not your turn")

        if len(purchases) > self.MAX_STOCKS_PER_TURN:
            return BuyStocksResult(
                success=False,
                error=f"Can only buy up to {self.MAX_STOCKS_PER_TURN} stocks",
            )

        # Validate all purchases first
        total_cost = 0
        chain_counts = {}
        for chain_name in purchases:
            if not self.hotel.is_chain_active(chain_name):
                return BuyStocksResult(
                    success=False, error=f"Chain {chain_name} is not active"
                )

            chain_counts[chain_name] = chain_counts.get(chain_name, 0) + 1
            size = self.board.get_chain_size(chain_name)
            price = self.hotel.get_stock_price(chain_name, size)
            total_cost += price

        if total_cost > player.money:
            return BuyStocksResult(success=False, error="Not enough money")

        for chain_name, count in chain_counts.items():
            if self.hotel.get_available_stocks(chain_name) < count:
                return BuyStocksResult(
                    success=False, error=f"Not enough {chain_name} stock available"
                )

        # Execute purchases
        bought = []
        for chain_name in purchases:
            size = self.board.get_chain_size(chain_name)
            price = self.hotel.get_stock_price(chain_name, size)
            self.hotel.buy_stock(chain_name)
            player.buy_stock(chain_name, 1, price)
            bought.append(StockPurchase(chain=chain_name, price=price))

        # Emit stock purchase event if any purchases were made
        if bought:
            purchase_str = ", ".join(f"1 {p.chain} for ${p.price}" for p in bought)
            self._emit_event(
                EventType.STOCK_PURCHASED,
                player_id,
                f"{player.name} bought {purchase_str}",
                {"purchases": [p.to_dict() for p in bought], "total_cost": total_cost},
            )

        return BuyStocksResult(
            success=True,
            purchased=bought,
            total_cost=total_cost,
            next_action="end_turn",
        )

    def end_turn(self, player_id: str) -> EndTurnResult:
        """End the current player's turn.

        Args:
            player_id: ID of player ending turn

        Returns:
            EndTurnResult with result
        """
        if self.phase != GamePhase.BUYING_STOCKS:
            return EndTurnResult(
                success=False, error="Cannot end turn in current phase"
            )

        player = self.get_player(player_id)
        if not player or player.player_id != self.get_current_player().player_id:
            return EndTurnResult(success=False, error="Not your turn")

        # Draw a tile if possible
        drawn_tile = self.draw_tile(player)

        # Replace any permanently unplayable tiles
        replaced = []
        while True:
            unplayable = [
                t
                for t in player.hand
                if Rules.is_tile_permanently_unplayable(self.board, t, self.hotel)
            ]
            if not unplayable or not self.tile_bag:
                break
            for tile in unplayable:
                player.remove_tile(tile)
                replaced.append(str(tile))
                self.draw_tile(player)

        # Check for end game condition
        can_end = Rules.check_end_game(self.board, self.hotel)

        # Emit turn ended event
        self._emit_event(
            EventType.TURN_ENDED,
            player_id,
            f"{player.name} ended their turn",
            {"drew_tile": str(drawn_tile) if drawn_tile else None},
        )

        # Move to next player
        self.next_turn()

        return EndTurnResult(
            success=True,
            drew_tile=str(drawn_tile) if drawn_tile else None,
            replaced_tiles=replaced,
            can_end_game=can_end,
            next_player=self.get_current_player().player_id,
        )

    def end_game(self) -> EndGameResult:
        """End the game and calculate final scores.

        Returns:
            EndGameResult with final results
        """
        if self.phase == GamePhase.GAME_OVER:
            return EndGameResult(success=False, error="Game already over")

        if self.phase == GamePhase.LOBBY:
            return EndGameResult(success=False, error="Game hasn't started")

        # Pay final bonuses for all active chains
        for chain_name in self.hotel.get_active_chains():
            chain_size = self.board.get_chain_size(chain_name)
            bonuses = Rules.calculate_bonuses(
                self.players, chain_name, chain_size, self.hotel
            )
            for player_id, bonus in bonuses.items():
                player = self.get_player(player_id)
                if player:
                    total = bonus.get("majority", 0) + bonus.get("minority", 0)
                    player.add_money(total)

        # Sell all stocks at current prices
        for player in self.players:
            for chain_name in Hotel.get_all_chain_names():
                count = player.get_stock_count(chain_name)
                if count > 0:
                    if self.hotel.is_chain_active(chain_name):
                        size = self.board.get_chain_size(chain_name)
                        price = self.hotel.get_stock_price(chain_name, size)
                    else:
                        price = 0
                    player.set_stocks(chain_name, 0)
                    player.add_money(count * price)

        # Calculate final standings
        standings_data = []
        for player in self.players:
            standings_data.append(
                {
                    "player_id": player.player_id,
                    "name": player.name,
                    "money": player.money,
                    "is_bot": player.player_id in self.bots,
                }
            )

        standings_data.sort(key=lambda x: x["money"], reverse=True)

        # Assign ranks and convert to typed standings
        standings = []
        for i, entry in enumerate(standings_data):
            standings.append(
                PlayerStanding(
                    player_id=entry["player_id"],
                    name=entry["name"],
                    money=entry["money"],
                    rank=i + 1,
                    is_bot=entry["is_bot"],
                )
            )

        self.phase = GamePhase.GAME_OVER

        # Emit game ended event
        winner = standings[0] if standings else None
        if winner:
            self._emit_event(
                EventType.GAME_ENDED,
                winner.player_id,
                f"Game over! {winner.name} wins with ${winner.money}",
                {
                    "winner": winner.to_dict(),
                    "standings": [s.to_dict() for s in standings],
                },
            )

        return EndGameResult(
            success=True,
            standings=standings,
            winner=winner,
        )

    def can_declare_end_game(self) -> bool:
        """Check if the current player can declare the game over.

        Per Acquire rules, a player MAY declare the game over when:
        1. Any single chain has 41 or more tiles, OR
        2. All active chains on the board are "safe" (11+ tiles each)

        Note: This is an OPTIONAL declaration - the player can choose to continue.

        Returns:
            True if end-game conditions are met and declaration is allowed
        """
        # Can only declare during certain phases
        if self.phase not in (GamePhase.PLAYING, GamePhase.BUYING_STOCKS):
            return False

        # Use the existing Rules.check_end_game method
        return Rules.check_end_game(self.board, self.hotel)

    def declare_end_game(self, player_id: str) -> DeclareEndGameResult:
        """Player declares the game is over.

        This allows a player to explicitly end the game when end-game
        conditions are met. Per the rules, this is optional - players
        may choose to continue playing even when conditions are met.

        Args:
            player_id: ID of the player declaring the end

        Returns:
            DeclareEndGameResult with final standings
        """
        # Validate game state
        if self.phase == GamePhase.GAME_OVER:
            return DeclareEndGameResult(success=False, error="Game is already over")

        if self.phase == GamePhase.LOBBY:
            return DeclareEndGameResult(success=False, error="Game has not started")

        # Check if it's this player's turn (only current player can declare)
        current_player = self.get_current_player()
        if player_id != current_player.player_id:
            return DeclareEndGameResult(
                success=False, error="Only the current player can declare end game"
            )

        # Check if end-game conditions are met
        if not self.can_declare_end_game():
            return DeclareEndGameResult(
                success=False, error="End game conditions are not met"
            )

        # End the game (this handles bonuses, stock sales, and standings)
        end_result = self.end_game()

        if not end_result.success:
            return DeclareEndGameResult(success=False, error=end_result.error)

        # Emit end game declared event
        player = self.get_player(player_id)
        self._emit_event(
            EventType.END_GAME_DECLARED,
            player_id,
            f"{player.name} declared the game over",
            {"declared_by": player.name},
        )

        return DeclareEndGameResult(
            success=True,
            declared_by=player_id,
            standings=end_result.standings,
            winner=end_result.winner,
        )

    # =========================================================================
    # Player-to-Player Trading Methods
    # =========================================================================

    def _count_pending_trades_for_player(self, player_id: str) -> int:
        """Count the number of pending trades initiated by a player.

        Args:
            player_id: ID of the player to count trades for

        Returns:
            Number of pending trades where this player is the proposer
        """
        count = 0
        for trade in self.pending_trades.values():
            if trade.from_player_id == player_id:
                count += 1
        return count

    def propose_trade(self, trade: TradeOffer) -> ProposeTradeResult:
        """Propose a trade to another player.

        Players can propose trades at any time during the game (not just their turn).
        The trade will be validated and added to pending trades if valid.

        Args:
            trade: The TradeOffer containing the trade details

        Returns:
            ProposeTradeResult with result
        """
        # Check game is in progress
        if self.phase == GamePhase.LOBBY:
            return ProposeTradeResult(success=False, error="Game has not started yet")

        if self.phase == GamePhase.GAME_OVER:
            return ProposeTradeResult(success=False, error="Game is already over")

        # Check pending trade limit for the proposer
        current_count = self._count_pending_trades_for_player(trade.from_player_id)
        if current_count >= self.MAX_PENDING_TRADES_PER_PLAYER:
            return ProposeTradeResult(
                success=False,
                error=f"Maximum of {self.MAX_PENDING_TRADES_PER_PLAYER} pending trades per player",
            )

        # Validate the trade
        is_valid, error_msg = Rules.validate_trade(self, trade)
        if not is_valid:
            return ProposeTradeResult(success=False, error=error_msg)

        # Add to pending trades
        self.pending_trades[trade.trade_id] = trade

        # Emit trade proposed event
        from_player = self.get_player(trade.from_player_id)
        to_player = self.get_player(trade.to_player_id)
        self._emit_event(
            EventType.TRADE_PROPOSED,
            trade.from_player_id,
            f"{from_player.name} proposed a trade to {to_player.name}",
            {
                "trade_id": trade.trade_id,
                "from_player": from_player.name,
                "to_player": to_player.name,
                "offering": trade.offering_stocks,
                "offering_money": trade.offering_money,
                "requesting": trade.requesting_stocks,
                "requesting_money": trade.requesting_money,
            },
        )

        return ProposeTradeResult(
            success=True,
            trade_id=trade.trade_id,
            from_player=trade.from_player_id,
            to_player=trade.to_player_id,
        )

    def accept_trade(self, player_id: str, trade_id: str) -> AcceptTradeResult:
        """Accept a pending trade offer.

        Only the recipient of the trade can accept it. The trade will be
        re-validated before execution to ensure both players still have
        the required resources.

        Args:
            player_id: ID of the player accepting the trade
            trade_id: Unique ID of the trade to accept

        Returns:
            AcceptTradeResult with result
        """
        # Check that the trade exists
        if trade_id not in self.pending_trades:
            return AcceptTradeResult(success=False, error="Trade not found")

        trade = self.pending_trades[trade_id]

        # Check that the accepting player is the recipient
        if trade.to_player_id != player_id:
            return AcceptTradeResult(
                success=False, error="Only the trade recipient can accept"
            )

        # Re-validate the trade (resources may have changed)
        is_valid, error_msg = Rules.validate_trade(self, trade)
        if not is_valid:
            # Trade is no longer valid, remove it
            del self.pending_trades[trade_id]
            return AcceptTradeResult(
                success=False, error=f"Trade is no longer valid: {error_msg}"
            )

        # Get the players
        from_player = self.get_player(trade.from_player_id)
        to_player = self.get_player(trade.to_player_id)

        # Execute the trade atomically
        # First, remove resources from both players
        from_player.execute_trade_give(trade.offering_stocks, trade.offering_money)
        to_player.execute_trade_give(trade.requesting_stocks, trade.requesting_money)

        # Then, add resources to both players
        to_player.execute_trade_receive(trade.offering_stocks, trade.offering_money)
        from_player.execute_trade_receive(
            trade.requesting_stocks, trade.requesting_money
        )

        # Remove the trade from pending
        del self.pending_trades[trade_id]

        # Emit trade accepted event
        self._emit_event(
            EventType.TRADE_ACCEPTED,
            player_id,
            f"Trade accepted: {from_player.name} and {to_player.name}",
            {
                "trade_id": trade_id,
                "from_player": from_player.name,
                "to_player": to_player.name,
                "offered_stocks": trade.offering_stocks,
                "offered_money": trade.offering_money,
                "requested_stocks": trade.requesting_stocks,
                "requested_money": trade.requesting_money,
            },
        )

        return AcceptTradeResult(
            success=True,
            trade_id=trade_id,
            from_player=trade.from_player_id,
            to_player=trade.to_player_id,
            offered_stocks=dict(trade.offering_stocks),
            offered_money=trade.offering_money,
            requested_stocks=dict(trade.requesting_stocks),
            requested_money=trade.requesting_money,
        )

    def reject_trade(self, player_id: str, trade_id: str) -> RejectTradeResult:
        """Reject a pending trade offer.

        Only the recipient of the trade can reject it.

        Args:
            player_id: ID of the player rejecting the trade
            trade_id: Unique ID of the trade to reject

        Returns:
            RejectTradeResult with result
        """
        # Check that the trade exists
        if trade_id not in self.pending_trades:
            return RejectTradeResult(success=False, error="Trade not found")

        trade = self.pending_trades[trade_id]

        # Check that the rejecting player is the recipient
        if trade.to_player_id != player_id:
            return RejectTradeResult(
                success=False, error="Only the trade recipient can reject"
            )

        # Get player names for event
        rejecting_player = self.get_player(player_id)
        proposing_player = self.get_player(trade.from_player_id)

        # Remove the trade
        del self.pending_trades[trade_id]

        # Emit trade rejected event
        self._emit_event(
            EventType.TRADE_REJECTED,
            player_id,
            f"{rejecting_player.name} rejected trade from {proposing_player.name}",
            {"trade_id": trade_id, "rejected_by": rejecting_player.name},
        )

        return RejectTradeResult(success=True, trade_id=trade_id, rejected_by=player_id)

    def cancel_trade(self, player_id: str, trade_id: str) -> CancelTradeResult:
        """Cancel a pending trade offer.

        Only the proposer of the trade can cancel it.

        Args:
            player_id: ID of the player canceling the trade
            trade_id: Unique ID of the trade to cancel

        Returns:
            CancelTradeResult with result
        """
        # Check that the trade exists
        if trade_id not in self.pending_trades:
            return CancelTradeResult(success=False, error="Trade not found")

        trade = self.pending_trades[trade_id]

        # Check that the canceling player is the proposer
        if trade.from_player_id != player_id:
            return CancelTradeResult(
                success=False, error="Only the trade proposer can cancel"
            )

        # Get player name for event
        canceling_player = self.get_player(player_id)

        # Remove the trade
        del self.pending_trades[trade_id]

        # Emit trade canceled event
        self._emit_event(
            EventType.TRADE_CANCELED,
            player_id,
            f"{canceling_player.name} canceled their trade offer",
            {"trade_id": trade_id, "canceled_by": canceling_player.name},
        )

        return CancelTradeResult(success=True, trade_id=trade_id, canceled_by=player_id)

    def get_pending_trades_for_player(self, player_id: str) -> List[TradeOffer]:
        """Get all pending trades involving a player.

        Returns trades where the player is either the proposer or recipient.

        Args:
            player_id: ID of the player to get trades for

        Returns:
            List of TradeOffer objects involving this player
        """
        trades = []
        for trade in self.pending_trades.values():
            if trade.from_player_id == player_id or trade.to_player_id == player_id:
                trades.append(trade)
        return trades

    def get_incoming_trades_for_player(self, player_id: str) -> List[TradeOffer]:
        """Get pending trades where the player is the recipient.

        Args:
            player_id: ID of the player to get incoming trades for

        Returns:
            List of TradeOffer objects where this player is the recipient
        """
        return [
            trade
            for trade in self.pending_trades.values()
            if trade.to_player_id == player_id
        ]

    def get_outgoing_trades_for_player(self, player_id: str) -> List[TradeOffer]:
        """Get pending trades where the player is the proposer.

        Args:
            player_id: ID of the player to get outgoing trades for

        Returns:
            List of TradeOffer objects where this player is the proposer
        """
        return [
            trade
            for trade in self.pending_trades.values()
            if trade.from_player_id == player_id
        ]

    def execute_bot_turn(self, player_id: str) -> list[dict]:
        """Execute a full turn for a bot player.

        Args:
            player_id: ID of the bot player

        Returns:
            List of all actions taken
        """
        if player_id not in self.bots:
            return [{"success": False, "error": "Player is not a bot"}]

        bot = self.bots[player_id]
        actions = []

        # Play tile phase
        if self.phase == GamePhase.PLAYING:
            tile = bot.choose_tile_to_play(self.board, self.hotel)
            if tile:
                result = self.play_tile(player_id, tile)
                actions.append({"action": "play_tile", **result})
            else:
                # No playable tiles, skip to buy stocks
                self.phase = GamePhase.BUYING_STOCKS
                actions.append({"action": "skip_tile", "reason": "no playable tiles"})

        # Founding chain phase
        if self.phase == GamePhase.FOUNDING_CHAIN:
            available = self.pending_action.get("available_chains", [])
            chain = bot.choose_chain_to_found(available, self.board)
            result = self.found_chain(player_id, chain)
            actions.append({"action": "found_chain", **result})

        # Merging phase - handle survivor choice if needed
        while self.phase == GamePhase.MERGING:
            if self.pending_action:
                action_type = self.pending_action.get("type")

                if action_type == "choose_survivor":
                    tied = self.pending_action.get("tied_chains", [])
                    choice = bot.choose_merger_survivor(tied, self.board, self.hotel)
                    result = self.choose_merger_survivor(player_id, choice)
                    actions.append({"action": "choose_survivor", **result})

                elif action_type == "stock_disposition":
                    # This might be for another player
                    disposition_player_id = self.pending_action.get("player_id")
                    if disposition_player_id in self.bots:
                        disp_bot = self.bots[disposition_player_id]
                        defunct = self.pending_action.get("defunct_chain")
                        survivor = self.pending_action.get("surviving_chain")
                        count = self.pending_action.get("stock_count")

                        decision = disp_bot.choose_stock_disposition(
                            defunct, survivor, count, self.board, self.hotel
                        )
                        result = self.handle_stock_disposition(
                            disposition_player_id,
                            decision["sell"],
                            decision["trade"],
                            decision["keep"],
                        )
                        actions.append(
                            {
                                "action": "stock_disposition",
                                "player": disposition_player_id,
                                **result,
                            }
                        )
                    else:
                        # Human player needs to decide
                        break
                else:
                    break
            else:
                break

        # Buying stocks phase
        if self.phase == GamePhase.BUYING_STOCKS:
            purchases = bot.choose_stocks_to_buy(self.board, self.hotel)
            result = self.buy_stocks(player_id, purchases)
            actions.append({"action": "buy_stocks", **result})

            # End turn
            result = self.end_turn(player_id)
            actions.append({"action": "end_turn", **result})

        return actions

    def _get_merger_state(self) -> dict | None:
        """Get current merger state for broadcasting.

        Returns merger disposition queue information during STOCK_DISPOSITION phase,
        or None if not in an active merger with stock disposition.
        """
        # Only return merger state during active stock disposition
        if self.phase != GamePhase.MERGING:
            return None

        if (
            not self.pending_action
            or self.pending_action.get("type") != "stock_disposition"
        ):
            return None

        survivor = self._merger_survivor
        current_defunct = self._merger_current_defunct

        if not survivor or not current_defunct:
            return None

        # Build queue with status
        queue = []
        for i, player_id in enumerate(self._merger_stock_players):
            player = self.get_player(player_id)
            if not player:
                continue

            if i < self._merger_stock_index:
                status = "completed"
            elif i == self._merger_stock_index:
                status = "current"
            else:
                status = "waiting"

            queue.append(
                {
                    "player_id": player_id,
                    "name": player.name,
                    "status": status,
                }
            )

        return {
            "survivor": survivor,
            "defunct": current_defunct,
            "disposition_queue": queue,
        }

    def get_public_state(self) -> dict:
        """Get public game state visible to everyone.

        Returns:
            Dict with public state
        """
        # Calculate chain sizes and prices
        chain_info = {}
        for chain_name in Hotel.get_all_chain_names():
            size = self.board.get_chain_size(chain_name)
            active = self.hotel.is_chain_active(chain_name)
            price = self.hotel.get_stock_price(chain_name, size) if active else 0
            safe = self.hotel.is_chain_safe(chain_name, size) if active else False

            chain_info[chain_name] = {
                "active": active,
                "size": size,
                "stock_price": price,
                "available_stocks": self.hotel.get_available_stocks(chain_name),
                "safe": safe,
                "color": Hotel.CHAINS[chain_name].color,
            }

        # Player public info
        player_info = []
        for player in self.players:
            player_info.append(
                {
                    "player_id": player.player_id,
                    "name": player.name,
                    "money": player.money,
                    "tile_count": player.hand_size,
                    "stocks": player.stocks,
                    "is_bot": player.player_id in self.bots,
                }
            )

        # Get merger state if applicable
        merger_state = self._get_merger_state()

        state = {
            "phase": self.phase.value,
            "current_player": self.get_current_player().player_id
            if self.players
            else None,
            "board": self.board.get_state(),
            "chains": chain_info,
            "players": player_info,
            "tiles_remaining": len(self.tile_bag),
            "pending_action": self.pending_action,
            "can_end_game": Rules.check_end_game(self.board, self.hotel)
            if self.phase != GamePhase.LOBBY
            else False,
            "pending_trades": [
                trade.to_dict() for trade in self.pending_trades.values()
            ],
            "recent_events": [e.to_dict() for e in self._events[-20:]],
        }

        if merger_state:
            state["merger_state"] = merger_state

        return state

    def get_player_state(self, player_id: str) -> dict:
        """Get private state for a specific player.

        Args:
            player_id: ID of player to get state for

        Returns:
            Dict with player's private state
        """
        player = self.get_player(player_id)
        if not player:
            return {"error": "Player not found"}

        public = self.get_public_state()

        # Add private info
        playable_tiles = Rules.get_playable_tiles(self.board, player.hand, self.hotel)

        # Get player-specific trade information
        incoming_trades = [
            t.to_dict() for t in self.get_incoming_trades_for_player(player_id)
        ]
        outgoing_trades = [
            t.to_dict() for t in self.get_outgoing_trades_for_player(player_id)
        ]

        # Check if this player can declare end game
        # Only the current player can declare, and only if conditions are met
        end_game_available = (
            player_id == self.get_current_player().player_id
            and self.can_declare_end_game()
        )

        return {
            **public,
            "hand": [str(t) for t in player.hand],
            "playable_tiles": [str(t) for t in playable_tiles],
            "can_act": self.can_player_act(player_id),
            "incoming_trades": incoming_trades,
            "outgoing_trades": outgoing_trades,
            "end_game_available": end_game_available,
        }

    def apply_action(self, player_id: str, action: "Action") -> dict:
        """Apply a single action and return result.

        This unified interface simplifies RL training by providing a single
        method to apply any action type.

        Args:
            player_id: ID of player taking the action
            action: Action object representing the action to take

        Returns:
            Dict with result of the action
        """
        from game.action import ActionType

        if action.action_type == ActionType.PLAY_TILE:
            tile = Tile.from_string(action.tile)
            return self.play_tile(player_id, tile)

        elif action.action_type == ActionType.FOUND_CHAIN:
            return self.found_chain(player_id, action.chain)

        elif action.action_type == ActionType.CHOOSE_MERGER_SURVIVOR:
            return self.choose_merger_survivor(player_id, action.chain)

        elif action.action_type == ActionType.STOCK_DISPOSITION:
            disp = action.disposition
            return self.handle_stock_disposition(
                player_id, disp["sell"], disp["trade"], disp["keep"]
            )

        elif action.action_type == ActionType.BUY_STOCKS:
            return self.buy_stocks(player_id, action.stocks or [])

        elif action.action_type == ActionType.END_TURN:
            return self.end_turn(player_id)

        elif action.action_type == ActionType.END_GAME:
            return self.end_game()

        elif action.action_type == ActionType.PROPOSE_TRADE:
            if action.trade is None:
                return {"success": False, "error": "Trade offer is required"}
            # Ensure the proposing player matches the action player
            if action.trade.from_player_id != player_id:
                return {
                    "success": False,
                    "error": "Trade proposer must match action player",
                }
            return self.propose_trade(action.trade)

        elif action.action_type == ActionType.ACCEPT_TRADE:
            if action.trade_id is None:
                return {"success": False, "error": "Trade ID is required"}
            return self.accept_trade(player_id, action.trade_id)

        elif action.action_type == ActionType.REJECT_TRADE:
            if action.trade_id is None:
                return {"success": False, "error": "Trade ID is required"}
            return self.reject_trade(player_id, action.trade_id)

        elif action.action_type == ActionType.CANCEL_TRADE:
            if action.trade_id is None:
                return {"success": False, "error": "Trade ID is required"}
            return self.cancel_trade(player_id, action.trade_id)

        return {"success": False, "error": f"Unknown action type: {action.action_type}"}

    def clone(self) -> "Game":
        """Create a deep copy of the game state for simulation.

        This is essential for MCTS and other lookahead algorithms.

        Returns:
            A new Game instance with identical state
        """
        new_game = Game(seed=self.seed)

        # Copy board state
        new_game.board = Board()
        for (col, row), cell in self.board._grid.items():
            new_game.board._grid[(col, row)].state = cell.state
            new_game.board._grid[(col, row)].chain = cell.chain

        # Copy hotel state
        new_game.hotel._available_stocks = dict(self.hotel._available_stocks)
        new_game.hotel._active_chains = set(self.hotel._active_chains)

        # Copy players
        new_game.players = []
        for player in self.players:
            new_player = Player.from_state(player.get_state())
            new_game.players.append(new_player)

        # Copy bots (reference the new players)
        new_game.bots = {}
        for player_id, bot in self.bots.items():
            new_player = new_game.get_player(player_id)
            new_game.bots[player_id] = Bot(new_player, bot.difficulty, rng=new_game.rng)

        # Copy game state
        new_game.tile_bag = list(self.tile_bag)
        new_game.current_player_index = self.current_player_index
        new_game.phase = self.phase
        new_game.pending_action = (
            dict(self.pending_action) if self.pending_action else None
        )

        # Copy merger state
        new_game._merger_chains = list(self._merger_chains)
        new_game._merger_survivor = self._merger_survivor
        new_game._merger_defunct_queue = list(self._merger_defunct_queue)
        new_game._merger_current_defunct = self._merger_current_defunct
        new_game._merger_stock_players = list(self._merger_stock_players)
        new_game._merger_stock_index = self._merger_stock_index

        # Copy pending trades (deep copy each trade)
        new_game.pending_trades = {}
        for trade_id, trade in self.pending_trades.items():
            new_game.pending_trades[trade_id] = TradeOffer(
                from_player_id=trade.from_player_id,
                to_player_id=trade.to_player_id,
                offering_stocks=dict(trade.offering_stocks),
                offering_money=trade.offering_money,
                requesting_stocks=dict(trade.requesting_stocks),
                requesting_money=trade.requesting_money,
                trade_id=trade.trade_id,
            )

        # Copy events
        new_game._events = list(self._events)

        return new_game

    def get_full_state(self) -> dict:
        """Get complete serializable game state for cloning/saving.

        Returns:
            Dict containing all game state
        """
        return {
            "seed": self.seed,
            "board": self.board.get_state(),
            "hotel": self.hotel.get_state(),
            "players": [p.get_state() for p in self.players],
            "bots": {
                pid: {"difficulty": bot.difficulty} for pid, bot in self.bots.items()
            },
            "tile_bag": [str(t) for t in self.tile_bag],
            "current_player_index": self.current_player_index,
            "phase": self.phase.value,
            "pending_action": self.pending_action,
            "merger_chains": self._merger_chains,
            "merger_survivor": self._merger_survivor,
            "merger_defunct_queue": self._merger_defunct_queue,
            "merger_current_defunct": self._merger_current_defunct,
            "merger_stock_players": self._merger_stock_players,
            "merger_stock_index": self._merger_stock_index,
            "pending_trades": {
                trade_id: trade.to_dict()
                for trade_id, trade in self.pending_trades.items()
            },
            "events": [e.to_dict() for e in self._events],
        }

    @classmethod
    def from_state(cls, state: dict) -> "Game":
        """Create a game from serialized state.

        Args:
            state: Dict containing game state from get_full_state()

        Returns:
            Game instance
        """
        game = cls(seed=state.get("seed"))

        # Load board
        board_state = state["board"]
        for tile_str, cell_data in board_state.get("cells", {}).items():
            tile = Tile.from_string(tile_str)
            game.board._grid[tile.coords].state = TileState(cell_data["state"])
            game.board._grid[tile.coords].chain = cell_data.get("chain")

        # Load hotel
        game.hotel.load_state(state["hotel"])

        # Load players
        game.players = [Player.from_state(p) for p in state["players"]]

        # Load bots
        game.bots = {}
        for player_id, bot_data in state.get("bots", {}).items():
            player = game.get_player(player_id)
            if player:
                game.bots[player_id] = Bot(player, bot_data["difficulty"], rng=game.rng)

        # Load game state
        game.tile_bag = [Tile.from_string(t) for t in state["tile_bag"]]
        game.current_player_index = state["current_player_index"]
        game.phase = GamePhase(state["phase"])
        game.pending_action = state.get("pending_action")

        # Load merger state
        game._merger_chains = state.get("merger_chains", [])
        game._merger_survivor = state.get("merger_survivor")
        game._merger_defunct_queue = state.get("merger_defunct_queue", [])
        game._merger_current_defunct = state.get("merger_current_defunct")
        game._merger_stock_players = state.get("merger_stock_players", [])
        game._merger_stock_index = state.get("merger_stock_index", 0)

        # Load pending trades
        game.pending_trades = {}
        for trade_id, trade_data in state.get("pending_trades", {}).items():
            game.pending_trades[trade_id] = TradeOffer.from_dict(trade_data)

        # Load events
        game._events = [GameEvent.from_dict(e) for e in state.get("events", [])]

        return game
