"""Main game orchestration for Buyout (turn flow, tiles, founding, buying, end).

Mergers live in ``game/merger.py`` and player trades in ``game/trading.py``
(mixed into ``Game``); phases in ``game/phase.py``.
"""

from typing import Optional, Dict
import random

from game.board import Board, Tile, TileState
from game.merger import MergerMixin, MergerState
from game.phase import PHASE_NAMES, GamePhase
from game.trading import TradingMixin
from game.action import TradeOffer
from game.hotel import Hotel
from game.player import Player
from game.rules import Rules, PlacementResult
from game.ranking import competition_ranks
from game.ruleset import Ruleset, resolve
from game.bot import Bot
from game.responses import (
    PlayTileResult,
    FoundChainResult,
    BuyStocksResult,
    StockPurchase,
    EndTurnResult,
    EndGameResult,
    PlayerStanding,
    DeclareEndGameResult,
)


class Game(MergerMixin, TradingMixin):
    """Main game class that orchestrates the full Buyout game.

    All parameters come from ``self.ruleset`` (default: the default ruleset).
    """

    def __init__(
        self,
        seed: Optional[int] = None,
        tile_order: Optional[list[str]] = None,
        ruleset: Optional[Ruleset] = None,
    ):
        """Initialize a new game in lobby state.

        Args:
            seed: Optional random seed for reproducible games
            tile_order: Optional explicit tile order (list of tile strings like "1A", "2B")
            ruleset: Game parameters (board, chains, prices, limits); default: the default ruleset
        """
        self.ruleset = resolve(ruleset)
        self.seed = seed
        self._tile_order = tile_order
        self.rng = random.Random(seed)
        self.board = Board(self.ruleset)
        self.hotel = Hotel(self.ruleset)
        self.players: list[Player] = []
        self.bots: dict[str, Bot] = {}  # player_id -> Bot
        self.tile_bag: list[Tile] = []
        self.current_player_index: int = 0
        self.phase: GamePhase = GamePhase.LOBBY
        self.pending_action: Optional[dict] = None  # Track what action is needed

        # Merger state tracking (consolidated into single object)
        self._merger = MergerState()

        # Player-to-player trading state
        self.pending_trades: Dict[str, TradeOffer] = {}  # trade_id -> TradeOffer

        # Append-only event log (see docs/architecture/seat-contract.md).
        # Each entry: {"seq": int, "type": str, "player_id": str | None,
        #              "private_to": str | None, ...payload}
        self.events: list[dict] = []

        # True once the current player has bought stocks this turn.
        self.stocks_bought_this_turn: bool = False

    def _emit(
        self,
        event_type: str,
        player_id: str | None = None,
        private_to: str | None = None,
        **payload,
    ) -> dict:
        """Append an event to the event log.

        Payload values must be JSON-serialisable (tiles as "5C" strings).

        Args:
            event_type: Event type name (see seat-contract.md)
            player_id: Player who acted / is concerned, if any
            private_to: If set, only this player may see the event
            **payload: Event-specific data

        Returns:
            The appended event dict
        """
        event = {
            "seq": len(self.events),
            "type": event_type,
            "player_id": player_id,
            "private_to": private_to,
            **payload,
        }
        self.events.append(event)
        return event

    def _chain_sizes(self, chains: list[str]) -> dict[str, int]:
        """Get current board sizes for a list of chains."""
        return {c: self.board.get_chain_size(c) for c in chains}

    @property
    def turn_order(self) -> list[str]:
        """Get list of player IDs in turn order."""
        return [p.player_id for p in self.players]

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
        max_players = self.ruleset.max_players
        if len(self.players) >= max_players:
            raise ValueError(f"Maximum {max_players} players allowed")
        if any(p.player_id == player_id for p in self.players):
            raise ValueError(f"Player with id {player_id} already exists")

        player = Player(player_id, name, self.ruleset)
        self.players.append(player)

        if is_bot:
            self.bots[player_id] = Bot(player, bot_difficulty, rng=self.rng)

        return player

    def start_game(self):
        """Start the game by shuffling tiles and dealing to players.

        Raises:
            ValueError: If not enough players or not in lobby
        """
        if self.phase != GamePhase.LOBBY:
            raise ValueError("Game has already started")
        min_players = self.ruleset.min_players
        if len(self.players) < min_players:
            raise ValueError(f"Need at least {min_players} players to start")

        # Create tile bag: use explicit order if provided, otherwise shuffle
        if self._tile_order:
            self.tile_bag = [self.board.tile_from_string(s) for s in self._tile_order]
        else:
            self.tile_bag = self.board.all_tiles()
            self.rng.shuffle(self.tile_bag)

        self._emit(
            "game_started",
            turn_order=self.turn_order,
            players=[{"player_id": p.player_id, "name": p.name} for p in self.players],
        )

        # Deal starting tiles to each player
        for player in self.players:
            dealt = []
            for _ in range(self.ruleset.hand_size):
                tile = self.draw_tile(player)
                if tile:
                    dealt.append(str(tile))
            self._emit(
                "tiles_dealt",
                player_id=player.player_id,
                private_to=player.player_id,
                tiles=dealt,
            )

        # Set initial game state
        self.current_player_index = 0
        self.phase = GamePhase.PLAYING
        self.stocks_bought_this_turn = False
        self.resolve_unplayable_turn()

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
        self.stocks_bought_this_turn = False

    def _has_playable_tile(self, player: Player) -> bool:
        """Check whether a player holds at least one legally playable tile."""
        return any(Rules.can_place_tile(self.board, t, self.hotel) for t in player.hand)

    def resolve_unplayable_turn(self) -> dict | None:
        """Give the current player a way forward if they cannot place a tile.

        Called automatically at the start of every turn (``start_game`` and
        ``end_turn``), and safe to call at any time (it is idempotent and a
        no-op unless the game is in PLAYING phase and the current player holds
        no playable tile). Drivers only need to call it themselves after
        mutating game state outside the engine (tests, snapshot surgery).

        Steps, in order:
        1. If every tile in hand is unplayable, apply the replacement rule
           (``handle_all_tiles_unplayable``).
        2. If the player now has a playable tile, nothing else happens.
        3. If the bag is empty and no player at all holds a playable tile, the
           board can never change again, so the game ends.
        4. Otherwise the tile placement step is skipped: phase moves to
           BUYING_STOCKS and a ``tile_placement_skipped`` event is emitted.

        Returns:
            None if nothing had to be done, otherwise a dict with keys
            ``replaced`` (the handle_all_tiles_unplayable result or None),
            ``skipped`` (bool) and ``game_over`` (bool).
        """
        if self.phase != GamePhase.PLAYING or not self.players:
            return None

        player = self.get_current_player()
        if self._has_playable_tile(player):
            return None

        replaced = self.handle_all_tiles_unplayable(player)
        if self._has_playable_tile(player):
            return {"replaced": replaced, "skipped": False, "game_over": False}

        if not self.tile_bag and not any(
            self._has_playable_tile(p) for p in self.players
        ):
            self.end_game(reason="no_playable_tiles")
            return {"replaced": replaced, "skipped": False, "game_over": True}

        self.phase = GamePhase.BUYING_STOCKS
        self._emit(
            "tile_placement_skipped",
            player_id=player.player_id,
            reason="no_playable_tiles",
        )
        return {"replaced": replaced, "skipped": True, "game_over": False}

    def handle_all_tiles_unplayable(self, player: Player) -> Optional[dict]:
        """Handle the case where a player has no playable tiles at turn start.

        According to Buyout rules, if all tiles in a player's hand are unplayable
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
        while player.hand_size < self.ruleset.hand_size and self.tile_bag:
            tile = self.draw_tile(player)
            if tile:
                new_tiles.append(str(tile))
            else:
                break

        self._emit(
            "tiles_replaced",
            player_id=player.player_id,
            reason="all_unplayable",
            revealed_hand=revealed_hand,
            removed_tiles=removed_tiles,
            new_tile_count=len(new_tiles),
        )
        for tile_str in new_tiles:
            self._emit(
                "tile_drawn",
                player_id=player.player_id,
                private_to=player.player_id,
                tile=tile_str,
                reason="replacement",
            )

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
        if player.hand_size >= self.ruleset.hand_size:
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
            self._emit("tile_placed", player_id, tile=str(tile), outcome="nothing")
            self.phase = GamePhase.BUYING_STOCKS
            return PlayTileResult(
                success=True,
                tile=str(tile),
                result_type="nothing",
                next_action="buy_stocks",
            )

        elif result.result_type == PlacementResult.EXPAND:
            # Expand the chain
            chain_name = result.chain
            self._emit(
                "tile_placed",
                player_id,
                tile=str(tile),
                outcome="expand",
                chains=[chain_name],
            )
            self._expand_chain(tile, chain_name)
            self._emit(
                "chain_expanded",
                player_id,
                chain=chain_name,
                tile=str(tile),
                size=self.board.get_chain_size(chain_name),
            )
            self.phase = GamePhase.BUYING_STOCKS
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
            self._emit(
                "tile_placed",
                player_id,
                tile=str(tile),
                outcome="found",
                available_chains=list(available),
            )
            self.phase = GamePhase.FOUNDING_CHAIN
            self.pending_action = {
                "type": "found_chain",
                "tile": tile,
                "available_chains": available,
            }
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
            self._merger.chains = chains

            survivor = Rules.get_merger_survivor(self.board, chains)
            self._emit(
                "tile_placed",
                player_id,
                tile=str(tile),
                outcome="merge" if isinstance(survivor, str) else "merge_tie",
                chains=list(chains),
                sizes=self._chain_sizes(chains),
                tied_chains=None if isinstance(survivor, str) else list(survivor),
            )

            if isinstance(survivor, str):
                # Clear winner
                self._merger.survivor = survivor
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

        # Give the founder free stock (ruleset founder_bonus_shares, 1 in
        # default); any share the bank cannot supply is paid as its price.
        chain_size = self.board.get_chain_size(chain_name)
        stock_price = self.hotel.get_stock_price(chain_name, chain_size)
        wanted = self.ruleset.founder_bonus_shares
        shares = min(wanted, self.hotel.get_available_stocks(chain_name))
        cash = (wanted - shares) * stock_price

        if shares > 0:
            self.hotel.buy_stock(chain_name, shares)
            player.add_stocks(chain_name, shares)
            founder_bonus_type = "stock"
            founder_bonus_value = shares
        else:
            # No stock available - give cash equivalent
            founder_bonus_type = "cash"
            founder_bonus_value = cash
        if cash:
            player.add_money(cash)

        extra = {"founder_bonus_cash": cash} if shares > 0 and cash else {}
        self._emit(
            "chain_founded",
            player_id,
            chain=chain_name,
            tile=str(tile),
            size=chain_size,
            founder_bonus_type=founder_bonus_type,
            founder_bonus_value=founder_bonus_value,
            **extra,
        )

        self.phase = GamePhase.BUYING_STOCKS
        self.pending_action = None

        return FoundChainResult(
            success=True,
            chain=chain_name,
            founder_bonus=True,
            founder_bonus_type=founder_bonus_type,
            founder_bonus_value=founder_bonus_value,
            next_action="buy_stocks",
        )

    def buy_stocks(self, player_id: str, purchases: list[str]) -> BuyStocksResult:
        """Buy stocks for the current player.

        Args:
            player_id: ID of player buying
            purchases: List of chain names to buy (can repeat, up to the
                ruleset's per-turn limit)

        Returns:
            BuyStocksResult with result
        """
        if self.phase != GamePhase.BUYING_STOCKS:
            return BuyStocksResult(success=False, error="Not in buying stocks phase")

        player = self.get_player(player_id)
        if not player or player.player_id != self.get_current_player().player_id:
            return BuyStocksResult(success=False, error="Not your turn")

        if self.stocks_bought_this_turn:
            return BuyStocksResult(
                success=False, error="Stocks already bought this turn"
            )

        max_buy = self.ruleset.max_stock_purchases_per_turn
        if len(purchases) > max_buy:
            return BuyStocksResult(
                success=False,
                error=f"Can only buy up to {max_buy} stocks",
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

        self.stocks_bought_this_turn = True
        self._emit(
            "stocks_purchased",
            player_id,
            purchases=dict(chain_counts),
            prices={b.chain: b.price for b in bought},
            total_cost=total_cost,
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
        if drawn_tile:
            self._emit(
                "tile_drawn",
                player_id,
                private_to=player_id,
                tile=str(drawn_tile),
                reason="end_turn",
            )

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
            removed_now = []
            drawn_now = []
            for tile in unplayable:
                player.remove_tile(tile)
                replaced.append(str(tile))
                removed_now.append(str(tile))
                new_tile = self.draw_tile(player)
                if new_tile:
                    drawn_now.append(str(new_tile))
            self._emit(
                "tiles_replaced",
                player_id,
                reason="permanently_unplayable",
                revealed_hand=list(removed_now),
                removed_tiles=removed_now,
                new_tile_count=len(drawn_now),
            )
            for tile_str in drawn_now:
                self._emit(
                    "tile_drawn",
                    player_id,
                    private_to=player_id,
                    tile=tile_str,
                    reason="replacement",
                )

        # Check for end game condition
        can_end = Rules.check_end_game(self.board, self.hotel)

        # Move to next player
        self.next_turn()
        self._emit(
            "turn_ended",
            player_id,
            next_player_id=self.get_current_player().player_id,
        )

        # Give the next player a way forward if they cannot place a tile
        self.resolve_unplayable_turn()

        return EndTurnResult(
            success=True,
            drew_tile=str(drawn_tile) if drawn_tile else None,
            replaced_tiles=replaced,
            can_end_game=can_end,
            next_player=self.get_current_player().player_id,
        )

    def end_game(self, reason: str = "ended") -> EndGameResult:
        """End the game and calculate final scores.

        Args:
            reason: Why the game ended, recorded on the ``game_ended`` event
                ("declared", "no_playable_tiles", or "ended" for direct calls)

        Returns:
            EndGameResult with final results
        """
        if self.phase == GamePhase.GAME_OVER:
            return EndGameResult(success=False, error="Game already over")

        if self.phase == GamePhase.LOBBY:
            return EndGameResult(success=False, error="Game hasn't started")

        # Pay final bonuses for all active chains
        for chain_name in self.hotel.get_active_chains():
            self._pay_bonuses(chain_name, final=True)

        # Sell all stocks at current prices
        final_sales: dict[str, int] = {}
        for player in self.players:
            for chain_name in self.hotel.get_all_chain_names():
                count = player.get_stock_count(chain_name)
                if count > 0:
                    if self.hotel.is_chain_active(chain_name):
                        size = self.board.get_chain_size(chain_name)
                        price = self.hotel.get_stock_price(chain_name, size)
                    else:
                        price = 0
                    player.set_stocks(chain_name, 0)
                    player.add_money(count * price)
                    final_sales[player.player_id] = (
                        final_sales.get(player.player_id, 0) + count * price
                    )

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

        # Stable sort: players tied on money keep seating order in the list
        # but share a rank (competition ranking: 1, 1, 3) and all win.
        standings_data.sort(key=lambda x: x["money"], reverse=True)
        ranks = competition_ranks([e["money"] for e in standings_data])
        standings = [
            PlayerStanding(
                player_id=entry["player_id"],
                name=entry["name"],
                money=entry["money"],
                rank=ranks[i],
                is_bot=entry["is_bot"],
            )
            for i, entry in enumerate(standings_data)
        ]
        winners = [s for s in standings if s.rank == 1]

        self.phase = GamePhase.GAME_OVER
        self.pending_action = None

        winner = standings[0] if standings else None
        self._emit(
            "game_ended",
            reason=reason,
            final_sales=final_sales,
            standings=[s.to_dict() for s in standings],
            winner=winner.player_id if winner else None,
            winners=[w.player_id for w in winners],
        )
        return EndGameResult(
            success=True,
            standings=standings,
            winner=winner,
            winners=winners,
        )

    def can_declare_end_game(self) -> bool:
        """Check if the current player can declare the game over.

        Per Buyout rules, a player MAY declare the game over when:
        1. Any single chain has reached the ruleset's end-game size, OR
        2. All active chains on the board are "safe"

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

        self._emit("end_game_declared", player_id)

        # End the game (this handles bonuses, stock sales, and standings)
        end_result = self.end_game(reason="declared")

        if not end_result.success:
            return DeclareEndGameResult(success=False, error=end_result.error)

        return DeclareEndGameResult(
            success=True,
            declared_by=player_id,
            standings=end_result.standings,
            winner=end_result.winner,
            winners=end_result.winners,
        )

    def get_public_state(self) -> dict:
        """Get public game state visible to everyone.

        Returns:
            Dict with public state
        """
        # Calculate chain sizes and prices
        chain_info = {}
        for chain_name in self.hotel.get_all_chain_names():
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
                "color": self.ruleset.chain(chain_name).color,
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
            "phase": PHASE_NAMES.get(self.phase, self.phase.value),
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
            # Everything a client needs to render this variant (see
            # docs/architecture/seat-contract.md "Ruleset").
            "ruleset": self.ruleset.public_dict(),
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

        # Get playability details for each tile in hand
        tile_playability = Rules.get_tiles_playability(
            self.board, player.hand, self.hotel
        )

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
            "tile_playability": tile_playability,
            "can_act": self.can_player_act(player_id),
            "incoming_trades": incoming_trades,
            "outgoing_trades": outgoing_trades,
            "end_game_available": end_game_available,
        }
