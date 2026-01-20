"""FastAPI application for Acquire board game."""

import re
import time
import uuid
from collections import defaultdict
from typing import Optional, Union, Literal

from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
    HTTPException,
    Form,
)
from pydantic import BaseModel, field_validator, ValidationError

from session.manager import SessionManager
from game.board import Board, Tile
from game.hotel import Hotel
from game.player import Player
from game.rules import Rules
from game.action import TradeOffer


# =============================================================================
# Pydantic Models for WebSocket Message Validation
# =============================================================================

VALID_CHAINS = [
    "Luxor",
    "Tower",
    "American",
    "Worldwide",
    "Festival",
    "Imperial",
    "Continental",
]


class PlaceTileMessage(BaseModel):
    """Validate place_tile action messages."""

    action: Literal["place_tile"]
    tile: str

    @field_validator("tile")
    @classmethod
    def validate_tile(cls, v: str) -> str:
        """Validate tile format (e.g., '1A', '12I')."""
        if not isinstance(v, str):
            raise ValueError("Tile must be a string")
        v = v.upper().strip()
        if not re.match(r"^1?[0-9][A-I]$", v):
            raise ValueError("Invalid tile format. Expected format like 1A, 5E, 12I")
        return v


class FoundChainMessage(BaseModel):
    """Validate found_chain action messages."""

    action: Literal["found_chain"]
    chain: str

    @field_validator("chain")
    @classmethod
    def validate_chain(cls, v: str) -> str:
        """Validate chain name."""
        if v not in VALID_CHAINS:
            raise ValueError(f"Invalid chain: {v}. Must be one of {VALID_CHAINS}")
        return v


class MergerChoiceMessage(BaseModel):
    """Validate merger_choice action messages."""

    action: Literal["merger_choice"]
    surviving_chain: str

    @field_validator("surviving_chain")
    @classmethod
    def validate_chain(cls, v: str) -> str:
        """Validate chain name."""
        if v not in VALID_CHAINS:
            raise ValueError(f"Invalid chain: {v}. Must be one of {VALID_CHAINS}")
        return v


class DispositionData(BaseModel):
    """Validate disposition data within merger_disposition."""

    sell: int = 0
    trade: int = 0
    hold: int = 0

    @field_validator("sell", "trade", "hold")
    @classmethod
    def validate_non_negative(cls, v: int) -> int:
        """Ensure values are non-negative."""
        if v < 0:
            raise ValueError("Value must be non-negative")
        return v


class MergerDispositionMessage(BaseModel):
    """Validate merger_disposition action messages."""

    action: Literal["merger_disposition"]
    defunct_chain: str
    disposition: DispositionData

    @field_validator("defunct_chain")
    @classmethod
    def validate_chain(cls, v: str) -> str:
        """Validate chain name."""
        if v not in VALID_CHAINS:
            raise ValueError(f"Invalid chain: {v}. Must be one of {VALID_CHAINS}")
        return v


class BuyStocksMessage(BaseModel):
    """Validate buy_stocks action messages."""

    action: Literal["buy_stocks"]
    purchases: dict[str, int]

    @field_validator("purchases")
    @classmethod
    def validate_purchases(cls, v: dict) -> dict:
        """Validate purchases dictionary."""
        if not isinstance(v, dict):
            raise ValueError("Purchases must be a dictionary")
        total = 0
        for chain, quantity in v.items():
            if chain not in VALID_CHAINS:
                raise ValueError(f"Invalid chain: {chain}")
            if not isinstance(quantity, int) or quantity < 0:
                raise ValueError(
                    f"Invalid quantity for {chain}: must be non-negative integer"
                )
            total += quantity
        if total > 3:
            raise ValueError("Cannot buy more than 3 stocks per turn")
        return v


class EndTurnMessage(BaseModel):
    """Validate end_turn action messages."""

    action: Literal["end_turn"]


class ProposeTradeMessage(BaseModel):
    """Validate propose_trade action messages."""

    action: Literal["propose_trade"]
    to_player_id: str
    offering_stocks: dict[str, int] = {}
    offering_money: int = 0
    requesting_stocks: dict[str, int] = {}
    requesting_money: int = 0

    @field_validator("offering_stocks", "requesting_stocks")
    @classmethod
    def validate_stocks(cls, v: dict) -> dict:
        """Validate stock dictionaries."""
        for chain, quantity in v.items():
            if chain not in VALID_CHAINS:
                raise ValueError(f"Invalid chain: {chain}")
            if not isinstance(quantity, int) or quantity < 0:
                raise ValueError(
                    f"Stock quantity for {chain} must be non-negative integer"
                )
        return v

    @field_validator("offering_money", "requesting_money")
    @classmethod
    def validate_money(cls, v: int) -> int:
        """Validate money amounts."""
        if v < 0:
            raise ValueError("Money amount must be non-negative")
        return v


class AcceptTradeMessage(BaseModel):
    """Validate accept_trade action messages."""

    action: Literal["accept_trade"]
    trade_id: str


class RejectTradeMessage(BaseModel):
    """Validate reject_trade action messages."""

    action: Literal["reject_trade"]
    trade_id: str


class CancelTradeMessage(BaseModel):
    """Validate cancel_trade action messages."""

    action: Literal["cancel_trade"]
    trade_id: str


# Union type for all valid message types
WebSocketMessage = Union[
    PlaceTileMessage,
    FoundChainMessage,
    MergerChoiceMessage,
    MergerDispositionMessage,
    BuyStocksMessage,
    EndTurnMessage,
    ProposeTradeMessage,
    AcceptTradeMessage,
    RejectTradeMessage,
    CancelTradeMessage,
]


def validate_websocket_message(
    data: dict,
) -> tuple[Optional[WebSocketMessage], Optional[str]]:
    """Validate incoming WebSocket message data.

    Args:
        data: Raw message data dictionary

    Returns:
        Tuple of (validated_message, error_message)
        If validation succeeds, error_message is None
        If validation fails, validated_message is None
    """
    action = data.get("action")

    message_types = {
        "place_tile": PlaceTileMessage,
        "found_chain": FoundChainMessage,
        "merger_choice": MergerChoiceMessage,
        "merger_disposition": MergerDispositionMessage,
        "buy_stocks": BuyStocksMessage,
        "end_turn": EndTurnMessage,
        "propose_trade": ProposeTradeMessage,
        "accept_trade": AcceptTradeMessage,
        "reject_trade": RejectTradeMessage,
        "cancel_trade": CancelTradeMessage,
    }

    if action not in message_types:
        return None, f"Unknown action: {action}"

    try:
        validated = message_types[action](**data)
        return validated, None
    except ValidationError as e:
        # Extract first error message
        errors = e.errors()
        if errors:
            return None, f"Validation error: {errors[0]['msg']}"
        return None, "Validation error"


# =============================================================================
# Rate Limiting
# =============================================================================


class RateLimiter:
    """Simple rate limiter using sliding window algorithm."""

    def __init__(self, max_requests: int = 10, window_seconds: int = 1):
        """Initialize rate limiter.

        Args:
            max_requests: Maximum requests allowed in window
            window_seconds: Time window in seconds
        """
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, client_id: str) -> bool:
        """Check if a request from client_id is allowed.

        Args:
            client_id: Unique identifier for the client

        Returns:
            True if request is allowed, False if rate limited
        """
        now = time.time()
        # Clean old requests outside the window
        self.requests[client_id] = [
            t for t in self.requests[client_id] if now - t < self.window_seconds
        ]

        if len(self.requests[client_id]) >= self.max_requests:
            return False

        self.requests[client_id].append(now)
        return True

    def cleanup_client(self, client_id: str) -> None:
        """Remove tracking data for a disconnected client."""
        if client_id in self.requests:
            del self.requests[client_id]


# Global rate limiter: 10 requests per second per player
rate_limiter = RateLimiter(max_requests=10, window_seconds=1)


app = FastAPI(title="Acquire Board Game")

# Global session manager
session_manager = SessionManager()


# HTTP Routes
@app.post("/create")
async def create_room(player_name: str = Form(...)):
    """Create a new game room and add the creator as first player."""
    room_code = session_manager.create_room()

    # Add creator as first player
    player_id = str(uuid.uuid4())
    session_token = session_manager.join_room(room_code, player_id, player_name)

    if session_token is None:
        raise HTTPException(status_code=500, detail="Failed to create room")

    return {
        "room_code": room_code,
        "player_id": player_id,
        "session_token": session_token,
        "is_host": True,
    }


@app.post("/join")
async def join_room(room_code: str = Form(...), player_name: str = Form(...)):
    """Join an existing room."""
    room = session_manager.get_room(room_code.upper())
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    if room.started:
        raise HTTPException(status_code=400, detail="Game already started")

    if len(room.players) >= room.max_players:
        raise HTTPException(status_code=400, detail="Room is full")

    player_id = str(uuid.uuid4())
    session_token = session_manager.join_room(room_code.upper(), player_id, player_name)

    if session_token is None:
        # Check if it was a duplicate name
        room = session_manager.get_room(room_code.upper())
        if room and any(
            p.name.lower() == player_name.lower() for p in room.players.values()
        ):
            raise HTTPException(status_code=400, detail="Player name already taken")
        raise HTTPException(status_code=400, detail="Failed to join room")

    return {
        "room_code": room_code.upper(),
        "player_id": player_id,
        "session_token": session_token,
    }


@app.post("/room/{room_code}/add-bot")
async def add_bot(room_code: str):
    """Add a bot to the room."""
    room = session_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    if room.started:
        raise HTTPException(status_code=400, detail="Game already started")

    bot_id = session_manager.add_bot(room_code)
    if bot_id is None:
        raise HTTPException(
            status_code=400, detail="Cannot add bot (room full or game started)"
        )

    # Notify connected clients about new bot
    await broadcast_lobby_update(room_code)

    return {"bot_id": bot_id}


@app.post("/room/{room_code}/start")
async def start_game(room_code: str):
    """Start the game."""
    room = session_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    if room.started:
        raise HTTPException(status_code=400, detail="Game already started")

    if len(room.players) < room.min_players:
        raise HTTPException(
            status_code=400, detail=f"Need at least {room.min_players} players to start"
        )

    success = session_manager.start_game(room_code)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to start game")

    # Initialize game state
    await initialize_game(room_code)

    # Broadcast game start to all clients
    await broadcast_game_state(room_code)

    return {"status": "started"}


@app.get("/room/{room_code}/state")
async def get_room_state(room_code: str):
    """Get current room state."""
    room = session_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    players = [
        {"player_id": p.player_id, "name": p.name, "is_bot": p.is_bot}
        for p in room.players.values()
    ]

    return {
        "room_code": room_code,
        "started": room.started,
        "players": players,
        "min_players": room.min_players,
        "max_players": room.max_players,
    }


# WebSocket endpoints
@app.websocket("/ws/host/{room_code}")
async def host_websocket(websocket: WebSocket, room_code: str):
    """WebSocket for host display."""
    room = session_manager.get_room(room_code)
    if room is None:
        await websocket.close(code=4004, reason="Room not found")
        return

    await websocket.accept()
    session_manager.connect_host(room_code, websocket)

    # Send current state
    await send_host_state(room_code)

    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action")

            if action == "add_bot":
                bot_id = session_manager.add_bot(room_code)
                if bot_id:
                    await broadcast_lobby_update(room_code)

            elif action == "start_game":
                room = session_manager.get_room(room_code)
                if room and not room.started and len(room.players) >= room.min_players:
                    session_manager.start_game(room_code)
                    await initialize_game(room_code)
                    await broadcast_game_state(room_code)

            elif action == "end_game":
                room = session_manager.get_room(room_code)
                if room and room.started:
                    await end_game(room_code)

    except WebSocketDisconnect:
        pass


@app.websocket("/ws/player/{room_code}/{player_id}")
async def player_websocket(websocket: WebSocket, room_code: str, player_id: str):
    """WebSocket for player device."""
    room = session_manager.get_room(room_code)
    if room is None:
        await websocket.close(code=4004, reason="Room not found")
        return

    if player_id not in room.players:
        await websocket.close(code=4004, reason="Player not found")
        return

    # Validate session token if provided (for authentication)
    # Token validation is optional for backward compatibility:
    # - If a token is provided in the query params, it must match
    # - If no token is provided, the connection is allowed (for legacy clients/tests)
    player_conn = room.players[player_id]
    token = websocket.query_params.get("token")
    if token is not None and player_conn.session_token is not None:
        # Token was provided - validate it matches
        if token != player_conn.session_token:
            await websocket.close(code=4003, reason="Invalid session token")
            return

    await websocket.accept()
    session_manager.connect_player(room_code, player_id, websocket)

    # Send current state to player
    await send_player_state(room_code, player_id)

    try:
        while True:
            data = await websocket.receive_json()

            # Apply rate limiting
            client_key = f"{room_code}:{player_id}"
            if not rate_limiter.is_allowed(client_key):
                await session_manager.send_to_player(
                    room_code,
                    player_id,
                    {
                        "type": "error",
                        "message": "Rate limit exceeded. Please slow down.",
                    },
                )
                continue

            await handle_player_action(room_code, player_id, data)

    except WebSocketDisconnect:
        session_manager.disconnect(room_code, player_id, websocket)
        # Clean up rate limiter data for this client
        rate_limiter.cleanup_client(f"{room_code}:{player_id}")


async def handle_player_action(room_code: str, player_id: str, data: dict) -> None:
    """Process player actions and broadcast updates.

    Args:
        room_code: The room code
        player_id: The player's ID
        data: The raw message data from the WebSocket
    """
    room = session_manager.get_room(room_code)
    if room is None or not room.started:
        return

    # Validate the incoming message
    validated_msg, error = validate_websocket_message(data)
    if error is not None:
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": error}
        )
        return

    action = data.get("action")

    if action == "place_tile":
        # validated_msg is PlaceTileMessage, tile is already validated and normalized
        await handle_place_tile(room_code, player_id, validated_msg.tile)

    elif action == "found_chain":
        # validated_msg is FoundChainMessage, chain is already validated
        await handle_found_chain(room_code, player_id, validated_msg.chain)

    elif action == "merger_choice":
        # validated_msg is MergerChoiceMessage
        await handle_merger_choice(room_code, player_id, validated_msg.surviving_chain)

    elif action == "merger_disposition":
        # validated_msg is MergerDispositionMessage
        disposition = {
            "sell": validated_msg.disposition.sell,
            "trade": validated_msg.disposition.trade,
            "hold": validated_msg.disposition.hold,
        }
        await handle_merger_disposition(
            room_code, player_id, validated_msg.defunct_chain, disposition
        )

    elif action == "buy_stocks":
        # validated_msg is BuyStocksMessage
        await handle_buy_stocks(room_code, player_id, validated_msg.purchases)

    elif action == "end_turn":
        await handle_end_turn(room_code, player_id)

    elif action == "propose_trade":
        # validated_msg is ProposeTradeMessage
        await handle_propose_trade(
            room_code,
            player_id,
            validated_msg.to_player_id,
            validated_msg.offering_stocks,
            validated_msg.offering_money,
            validated_msg.requesting_stocks,
            validated_msg.requesting_money,
        )

    elif action == "accept_trade":
        # validated_msg is AcceptTradeMessage
        await handle_accept_trade(room_code, player_id, validated_msg.trade_id)

    elif action == "reject_trade":
        # validated_msg is RejectTradeMessage
        await handle_reject_trade(room_code, player_id, validated_msg.trade_id)

    elif action == "cancel_trade":
        # validated_msg is CancelTradeMessage
        await handle_cancel_trade(room_code, player_id, validated_msg.trade_id)


async def initialize_game(room_code: str):
    """Initialize game state for a room."""
    room = session_manager.get_room(room_code)
    if room is None:
        return

    # Create game objects
    board = Board()
    hotel = Hotel()

    # Create tile pool and shuffle
    import random

    tile_pool = Board.all_tiles()
    random.shuffle(tile_pool)

    # Create Player objects
    players = {}
    for player_id, connection in room.players.items():
        players[player_id] = Player(player_id, connection.name)

    # Deal initial tiles (6 per player)
    for player in players.values():
        for _ in range(6):
            if tile_pool:
                player.add_tile(tile_pool.pop())

    # Determine turn order (random)
    turn_order = list(players.keys())
    random.shuffle(turn_order)

    # Store game state in room
    room.game = {
        "board": board,
        "hotel": hotel,
        "players": players,
        "tile_pool": tile_pool,
        "turn_order": turn_order,
        "current_turn_index": 0,
        "phase": "place_tile",  # place_tile, found_chain, merger, buy_stocks
        "pending_action": None,  # For tracking multi-step actions
        "pending_trades": {},  # trade_id -> TradeOffer for player-to-player trading
    }

    # Process bot turns if the first player is a bot
    await process_bot_turns(room_code)


async def handle_place_tile(room_code: str, player_id: str, tile_str: str):
    """Handle tile placement action."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Verify it's this player's turn
    current_player_id = game["turn_order"][game["current_turn_index"]]
    if player_id != current_player_id:
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Not your turn"}
        )
        return

    # Parse tile
    try:
        tile = Tile.from_string(tile_str)
    except (ValueError, IndexError):
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Invalid tile"}
        )
        return

    player = game["players"][player_id]
    board = game["board"]
    hotel = game["hotel"]
    tile_pool = game["tile_pool"]

    # Check if all tiles in hand are unplayable (special rule)
    # If so, reveal hand, remove unplayable tiles from game, and draw new ones
    if Rules.are_all_tiles_unplayable(board, player.hand, hotel):
        # Reveal hand to all players
        revealed_hand = [str(t) for t in player.hand]
        removed_tiles = []

        # Remove all tiles from hand (they're removed from game, not back to pool)
        tiles_to_remove = list(player.hand)
        for t in tiles_to_remove:
            player.remove_tile(t)
            removed_tiles.append(str(t))

        # Draw new tiles up to hand limit
        new_tiles = []
        while player.hand_size < 6 and tile_pool:
            new_tile = tile_pool.pop()
            player.add_tile(new_tile)
            new_tiles.append(str(new_tile))

        # Broadcast the all-unplayable event to all players
        await session_manager.broadcast_to_room(
            room_code,
            {
                "type": "all_tiles_unplayable",
                "player_id": player_id,
                "player_name": player.name,
                "revealed_hand": revealed_hand,
                "removed_tiles": removed_tiles,
                "new_tiles_count": len(new_tiles),
            },
        )

        # Also notify the player of their new hand
        await session_manager.send_to_player(
            room_code,
            player_id,
            {
                "type": "tiles_replaced",
                "removed_tiles": removed_tiles,
                "new_hand": [str(t) for t in player.hand],
            },
        )

        # Broadcast updated state and return - player needs to try again with new tiles
        await broadcast_game_state(room_code)

        # Return error so client knows to retry with new hand
        await session_manager.send_to_player(
            room_code,
            player_id,
            {
                "type": "error",
                "message": "Your tiles were replaced. Please select a new tile to play.",
            },
        )
        return

    # Verify player has this tile
    if not player.has_tile(tile):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": "You don't have this tile"},
        )
        return

    # Check if tile can be placed
    if not Rules.can_place_tile(board, tile, hotel):
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Cannot place this tile"}
        )
        return

    # Place the tile
    player.remove_tile(tile)
    board.place_tile(tile)

    # Determine what happens
    result = Rules.get_placement_result(board, tile)

    if result.result_type == "nothing":
        # Just placed, move to buy phase
        game["phase"] = "buy_stocks"

    elif result.result_type == "expand":
        # Expand existing chain
        connected = board.get_connected_tiles(tile)
        for t in connected:
            board.set_chain(t, result.chain)
        game["phase"] = "buy_stocks"

    elif result.result_type == "found":
        # Need player to choose which chain to found
        game["phase"] = "found_chain"
        game["pending_action"] = {
            "tile": tile,
            "connected_tiles": board.get_connected_tiles(tile),
        }
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "choose_chain", "available_chains": hotel.get_inactive_chains()},
        )

    elif result.result_type == "merge":
        # Handle merger
        survivor = Rules.get_merger_survivor(board, result.chains)

        if isinstance(survivor, list):
            # Tie - player must choose
            game["phase"] = "merger"
            game["pending_action"] = {
                "type": "choose_survivor",
                "chains": result.chains,
                "tied_chains": survivor,
                "tile": tile,
            }
            await session_manager.send_to_player(
                room_code,
                player_id,
                {"type": "choose_merger_survivor", "tied_chains": survivor},
            )
        else:
            # Clear winner - process merger
            game["pending_action"] = {
                "type": "process_merger",
                "surviving_chain": survivor,
                "defunct_chains": [c for c in result.chains if c != survivor],
                "tile": tile,
            }
            await process_merger(room_code)

    await broadcast_game_state(room_code)


async def handle_found_chain(room_code: str, player_id: str, chain_name: str):
    """Handle chain founding."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game
    hotel = game["hotel"]
    board = game["board"]
    player = game["players"][player_id]

    # Verify phase
    if game["phase"] != "found_chain":
        return

    # Verify chain is available
    if chain_name not in hotel.get_inactive_chains():
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Chain not available"}
        )
        return

    # Found the chain
    hotel.activate_chain(chain_name)
    connected_tiles = game["pending_action"]["connected_tiles"]
    for t in connected_tiles:
        board.set_chain(t, chain_name)

    # Give founder a free stock if available, otherwise cash equivalent
    chain_size = board.get_chain_size(chain_name)
    stock_price = hotel.get_stock_price(chain_name, chain_size)

    if hotel.get_available_stocks(chain_name) > 0:
        hotel.buy_stock(chain_name)
        player.add_stocks(chain_name, 1)
    else:
        # No stock available - give cash equivalent
        player.add_money(stock_price)

    game["pending_action"] = None
    game["phase"] = "buy_stocks"

    await broadcast_game_state(room_code)


async def handle_merger_choice(room_code: str, player_id: str, surviving_chain: str):
    """Handle player choosing merger survivor in case of tie."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game
    pending = game.get("pending_action")

    if not pending or pending.get("type") != "choose_survivor":
        return

    if surviving_chain not in pending["tied_chains"]:
        return

    # Set up merger processing
    game["pending_action"] = {
        "type": "process_merger",
        "surviving_chain": surviving_chain,
        "defunct_chains": [c for c in pending["chains"] if c != surviving_chain],
        "tile": pending["tile"],
    }

    await process_merger(room_code)


async def process_merger(room_code: str):
    """Process a merger after survivor is determined."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game
    pending = game["pending_action"]
    board = game["board"]
    hotel = game["hotel"]
    players = game["players"]

    surviving_chain = pending["surviving_chain"]
    defunct_chains = pending["defunct_chains"]
    tile = pending["tile"]

    # Process each defunct chain (largest first)
    defunct_chains_sorted = sorted(
        defunct_chains, key=lambda c: board.get_chain_size(c), reverse=True
    )

    for defunct_chain in defunct_chains_sorted:
        chain_size = board.get_chain_size(defunct_chain)

        # Calculate and pay bonuses
        bonuses = Rules.calculate_bonuses(
            list(players.values()), defunct_chain, chain_size, hotel
        )

        for pid, bonus_info in bonuses.items():
            total_bonus = bonus_info["majority"] + bonus_info["minority"]
            players[pid].add_money(total_bonus)

        # Merge the chains on the board
        board.merge_chains(surviving_chain, defunct_chain)
        hotel.deactivate_chain(defunct_chain)

    # Include the placed tile in the surviving chain
    connected = board.get_connected_tiles(tile)
    for t in connected:
        board.set_chain(t, surviving_chain)

    game["pending_action"] = None
    game["phase"] = "buy_stocks"

    await broadcast_game_state(room_code)


async def handle_merger_disposition(
    room_code: str, player_id: str, defunct_chain: str, disposition: dict
):
    """Handle player's sell/trade/hold decision during merger."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game
    player = game["players"][player_id]
    board = game["board"]
    hotel = game["hotel"]

    # Get surviving chain from pending action
    pending = game.get("pending_action")
    if not pending:
        return

    surviving_chain = pending.get("surviving_chain")
    if not surviving_chain:
        return

    chain_size = board.get_chain_size(defunct_chain)
    stock_price = hotel.get_stock_price(defunct_chain, chain_size)

    sell_count = disposition.get("sell", 0)
    trade_count = disposition.get("trade", 0)

    # Sell stocks
    if sell_count > 0:
        player.sell_stock(defunct_chain, sell_count, stock_price)
        hotel.return_stock(defunct_chain, sell_count)

    # Trade stocks (2:1)
    if trade_count > 0:
        player.trade_stock(defunct_chain, surviving_chain, trade_count)

    await broadcast_game_state(room_code)


async def handle_buy_stocks(room_code: str, player_id: str, purchases: dict):
    """Handle stock purchase action."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game
    player = game["players"][player_id]
    board = game["board"]
    hotel = game["hotel"]

    # Verify phase
    if game["phase"] != "buy_stocks":
        return

    # Verify it's this player's turn
    current_player_id = game["turn_order"][game["current_turn_index"]]
    if player_id != current_player_id:
        return

    # Maximum 3 stocks per turn
    total_stocks = sum(purchases.values())
    if total_stocks > 3:
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": "Cannot buy more than 3 stocks per turn"},
        )
        return

    # Process each purchase
    for chain_name, quantity in purchases.items():
        if quantity <= 0:
            continue

        if not hotel.is_chain_active(chain_name):
            continue

        if hotel.get_available_stocks(chain_name) < quantity:
            continue

        chain_size = board.get_chain_size(chain_name)
        price = hotel.get_stock_price(chain_name, chain_size)

        if player.buy_stock(chain_name, quantity, price):
            hotel.buy_stock(chain_name, quantity)

    # Move to end of turn
    await handle_end_turn(room_code, player_id)


async def handle_end_turn(room_code: str, player_id: str):
    """Handle end of turn - draw tile and advance to next player."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game
    player = game["players"][player_id]
    tile_pool = game["tile_pool"]

    # Draw a tile if pool is not empty
    if tile_pool:
        new_tile = tile_pool.pop()
        player.add_tile(new_tile)

    # Replace unplayable tiles
    board = game["board"]
    hotel = game["hotel"]
    unplayable = Rules.get_unplayable_tiles(board, player.hand, hotel)

    for bad_tile in unplayable:
        if Rules.is_tile_permanently_unplayable(board, bad_tile, hotel):
            player.remove_tile(bad_tile)
            if tile_pool:
                player.add_tile(tile_pool.pop())

    # Check for game end
    if Rules.check_end_game(board, hotel):
        # A player can choose to end the game
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "can_end_game", "message": "You may choose to end the game"},
        )

    # Advance to next player
    game["current_turn_index"] = (game["current_turn_index"] + 1) % len(
        game["turn_order"]
    )
    game["phase"] = "place_tile"

    await broadcast_game_state(room_code)

    # Process bot turns if the next player is a bot
    await process_bot_turns(room_code)


# =============================================================================
# Player-to-Player Trading Handlers
# =============================================================================

MAX_PENDING_TRADES_PER_PLAYER = 5


async def handle_propose_trade(
    room_code: str,
    player_id: str,
    to_player_id: str,
    offering_stocks: dict,
    offering_money: int,
    requesting_stocks: dict,
    requesting_money: int,
):
    """Handle a player proposing a trade to another player."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game
    players = game["players"]
    pending_trades = game.get("pending_trades", {})

    # Validate players exist
    if player_id not in players:
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Player not found"}
        )
        return

    if to_player_id not in players:
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": "Target player not found"},
        )
        return

    if player_id == to_player_id:
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": "Cannot trade with yourself"},
        )
        return

    # Check pending trade limit
    player_pending_count = sum(
        1 for t in pending_trades.values() if t.from_player_id == player_id
    )
    if player_pending_count >= MAX_PENDING_TRADES_PER_PLAYER:
        await session_manager.send_to_player(
            room_code,
            player_id,
            {
                "type": "error",
                "message": f"Maximum {MAX_PENDING_TRADES_PER_PLAYER} pending trades allowed",
            },
        )
        return

    # Create trade offer
    trade = TradeOffer(
        from_player_id=player_id,
        to_player_id=to_player_id,
        offering_stocks=offering_stocks,
        offering_money=offering_money,
        requesting_stocks=requesting_stocks,
        requesting_money=requesting_money,
    )

    # Validate the trade
    from_player = players[player_id]
    to_player = players[to_player_id]

    # Check that at least one thing is being exchanged
    has_offering = offering_money > 0 or any(
        qty > 0 for qty in offering_stocks.values()
    )
    has_requesting = requesting_money > 0 or any(
        qty > 0 for qty in requesting_stocks.values()
    )

    if not has_offering and not has_requesting:
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": "Trade must include at least one item"},
        )
        return

    # Check offering player has the resources
    if not from_player.can_afford_trade(offering_stocks, offering_money):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": "You don't have the offered resources"},
        )
        return

    # Check receiving player has the requested resources
    if not to_player.can_afford_trade(requesting_stocks, requesting_money):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {
                "type": "error",
                "message": "Target player doesn't have the requested resources",
            },
        )
        return

    # Add to pending trades
    pending_trades[trade.trade_id] = trade
    game["pending_trades"] = pending_trades

    # Notify both players
    trade_notification = {
        "type": "trade_proposed",
        "trade": trade.to_dict(),
    }
    await session_manager.send_to_player(room_code, player_id, trade_notification)
    await session_manager.send_to_player(room_code, to_player_id, trade_notification)


async def handle_accept_trade(room_code: str, player_id: str, trade_id: str):
    """Handle a player accepting a trade offer."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game
    players = game["players"]
    pending_trades = game.get("pending_trades", {})

    if trade_id not in pending_trades:
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Trade not found"}
        )
        return

    trade = pending_trades[trade_id]

    # Only the recipient can accept
    if trade.to_player_id != player_id:
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": "Only the trade recipient can accept"},
        )
        return

    from_player = players[trade.from_player_id]
    to_player = players[trade.to_player_id]

    # Re-validate the trade (resources may have changed)
    if not from_player.can_afford_trade(trade.offering_stocks, trade.offering_money):
        del pending_trades[trade_id]
        await session_manager.send_to_player(
            room_code,
            player_id,
            {
                "type": "error",
                "message": "Trade is no longer valid - proposer lacks resources",
            },
        )
        return

    if not to_player.can_afford_trade(trade.requesting_stocks, trade.requesting_money):
        del pending_trades[trade_id]
        await session_manager.send_to_player(
            room_code,
            player_id,
            {
                "type": "error",
                "message": "Trade is no longer valid - you lack requested resources",
            },
        )
        return

    # Execute the trade
    from_player.execute_trade_give(trade.offering_stocks, trade.offering_money)
    to_player.execute_trade_give(trade.requesting_stocks, trade.requesting_money)
    to_player.execute_trade_receive(trade.offering_stocks, trade.offering_money)
    from_player.execute_trade_receive(trade.requesting_stocks, trade.requesting_money)

    # Remove the trade
    del pending_trades[trade_id]

    # Notify both players
    trade_notification = {
        "type": "trade_accepted",
        "trade_id": trade_id,
        "from_player": trade.from_player_id,
        "to_player": trade.to_player_id,
    }
    await session_manager.send_to_player(
        room_code, trade.from_player_id, trade_notification
    )
    await session_manager.send_to_player(
        room_code, trade.to_player_id, trade_notification
    )

    # Broadcast updated game state
    await broadcast_game_state(room_code)


async def handle_reject_trade(room_code: str, player_id: str, trade_id: str):
    """Handle a player rejecting a trade offer."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game
    pending_trades = game.get("pending_trades", {})

    if trade_id not in pending_trades:
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Trade not found"}
        )
        return

    trade = pending_trades[trade_id]

    # Only the recipient can reject
    if trade.to_player_id != player_id:
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": "Only the trade recipient can reject"},
        )
        return

    # Remove the trade
    del pending_trades[trade_id]

    # Notify both players
    trade_notification = {
        "type": "trade_rejected",
        "trade_id": trade_id,
        "rejected_by": player_id,
    }
    await session_manager.send_to_player(
        room_code, trade.from_player_id, trade_notification
    )
    await session_manager.send_to_player(
        room_code, trade.to_player_id, trade_notification
    )


async def handle_cancel_trade(room_code: str, player_id: str, trade_id: str):
    """Handle a player canceling their own trade offer."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game
    pending_trades = game.get("pending_trades", {})

    if trade_id not in pending_trades:
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Trade not found"}
        )
        return

    trade = pending_trades[trade_id]

    # Only the proposer can cancel
    if trade.from_player_id != player_id:
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": "Only the trade proposer can cancel"},
        )
        return

    # Remove the trade
    del pending_trades[trade_id]

    # Notify both players
    trade_notification = {
        "type": "trade_canceled",
        "trade_id": trade_id,
        "canceled_by": player_id,
    }
    await session_manager.send_to_player(
        room_code, trade.from_player_id, trade_notification
    )
    await session_manager.send_to_player(
        room_code, trade.to_player_id, trade_notification
    )


async def end_game(room_code: str):
    """End the game and calculate final scores."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game
    board = game["board"]
    hotel = game["hotel"]
    players = game["players"]

    # Pay final bonuses for all active chains
    for chain_name in hotel.get_active_chains():
        chain_size = board.get_chain_size(chain_name)
        bonuses = Rules.calculate_bonuses(
            list(players.values()), chain_name, chain_size, hotel
        )

        for pid, bonus_info in bonuses.items():
            total_bonus = bonus_info["majority"] + bonus_info["minority"]
            players[pid].add_money(total_bonus)

        # Sell all stocks at current price
        stock_price = hotel.get_stock_price(chain_name, chain_size)
        for player in players.values():
            stock_count = player.get_stock_count(chain_name)
            if stock_count > 0:
                player.sell_stock(chain_name, stock_count, stock_price)

    # Calculate final scores
    final_scores = {}
    for player in players.values():
        final_scores[player.player_id] = {"name": player.name, "money": player.money}

    # Determine winner
    winner_id = max(final_scores.keys(), key=lambda pid: final_scores[pid]["money"])

    # Broadcast final results
    await session_manager.broadcast_to_room(
        room_code, {"type": "game_over", "scores": final_scores, "winner": winner_id}
    )

    await session_manager.send_to_host(
        room_code, {"type": "game_over", "scores": final_scores, "winner": winner_id}
    )


async def process_bot_turns(room_code: str):
    """Process bot turns automatically until a connected human player's turn or game ends.

    This function handles:
    1. Bot players - automatically plays their turns
    2. Disconnected human players - automatically ends their turns (AFK handling)
    """
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game
    board = game["board"]
    hotel = game["hotel"]
    players = game["players"]

    # Safety counter to prevent infinite loops
    max_iterations = 100
    iterations = 0

    while iterations < max_iterations:
        iterations += 1

        current_player_id = game["turn_order"][game["current_turn_index"]]
        player_conn = room.players.get(current_player_id)

        # Check if current player is a bot
        if player_conn is None or not player_conn.is_bot:
            # Human player's turn - stop and wait for their input
            break

        # This is a bot's turn - process it
        player = players[current_player_id]
        phase = game["phase"]

        if phase == "place_tile":
            # Bot chooses and places a tile
            playable_tiles = [
                t for t in player.hand if Rules.can_place_tile(board, t, hotel)
            ]

            if playable_tiles:
                # Simple strategy: pick a random playable tile
                import random

                tile = random.choice(playable_tiles)
                player.remove_tile(tile)
                board.place_tile(tile)

                # Determine what happens
                result = Rules.get_placement_result(board, tile)

                if result.result_type == "nothing":
                    game["phase"] = "buy_stocks"

                elif result.result_type == "expand":
                    connected = board.get_connected_tiles(tile)
                    for t in connected:
                        board.set_chain(t, result.chain)
                    game["phase"] = "buy_stocks"

                elif result.result_type == "found":
                    # Bot picks first available chain
                    available_chains = hotel.get_inactive_chains()
                    if available_chains:
                        chain_name = available_chains[0]
                        hotel.activate_chain(chain_name)
                        connected_tiles = board.get_connected_tiles(tile)
                        for t in connected_tiles:
                            board.set_chain(t, chain_name)
                        # Give founder a free stock
                        if hotel.get_available_stocks(chain_name) > 0:
                            hotel.buy_stock(chain_name)
                            player.add_stocks(chain_name, 1)
                    game["phase"] = "buy_stocks"

                elif result.result_type == "merge":
                    # Handle merger - pick survivor (largest chain)
                    survivor = Rules.get_merger_survivor(board, result.chains)

                    if isinstance(survivor, list):
                        # Tie - pick first one
                        survivor = survivor[0]

                    defunct_chains = [c for c in result.chains if c != survivor]

                    # Pay bonuses and process merger
                    for defunct_chain in defunct_chains:
                        chain_size = board.get_chain_size(defunct_chain)
                        bonuses = Rules.calculate_bonuses(
                            list(players.values()), defunct_chain, chain_size, hotel
                        )
                        for pid, bonus_info in bonuses.items():
                            total_bonus = (
                                bonus_info["majority"] + bonus_info["minority"]
                            )
                            players[pid].add_money(total_bonus)

                        # Merge on board
                        board.merge_chains(survivor, defunct_chain)
                        hotel.deactivate_chain(defunct_chain)

                    # Include placed tile in surviving chain
                    connected = board.get_connected_tiles(tile)
                    for t in connected:
                        board.set_chain(t, survivor)

                    game["phase"] = "buy_stocks"

                # Broadcast the tile placement
                await broadcast_game_state(room_code)
            else:
                # No playable tiles - skip to buy phase
                game["phase"] = "buy_stocks"

        if phase == "buy_stocks" or game["phase"] == "buy_stocks":
            # Bot buys stocks (simple: buy nothing for now, just end turn)
            # More sophisticated bots can be added later

            # Draw a tile
            tile_pool = game["tile_pool"]
            if tile_pool:
                new_tile = tile_pool.pop()
                player.add_tile(new_tile)

            # Replace unplayable tiles
            unplayable = Rules.get_unplayable_tiles(board, player.hand, hotel)
            for bad_tile in unplayable:
                if Rules.is_tile_permanently_unplayable(board, bad_tile, hotel):
                    player.remove_tile(bad_tile)
                    if tile_pool:
                        player.add_tile(tile_pool.pop())

            # Advance to next player
            game["current_turn_index"] = (game["current_turn_index"] + 1) % len(
                game["turn_order"]
            )
            game["phase"] = "place_tile"

            # Broadcast the end of turn
            await broadcast_game_state(room_code)

            # Small delay to prevent overwhelming clients
            import asyncio

            await asyncio.sleep(0.1)


async def broadcast_game_state(room_code: str):
    """Send updated state to all clients."""
    room = session_manager.get_room(room_code)
    if room is None:
        return

    game = room.game

    if game is None:
        return

    board = game["board"]
    hotel = game["hotel"]
    players = game["players"]

    # Build public game state
    current_player_id = game["turn_order"][game["current_turn_index"]]

    # Build chain info with sizes and prices
    hotel_state = hotel.get_state()
    chains_info = []
    for chain_name in hotel.get_all_chain_names():
        size = board.get_chain_size(chain_name)
        price = hotel.get_stock_price(chain_name, size)
        chains_info.append(
            {
                "name": chain_name,
                "size": size,
                "price": price,
                "stocks_available": hotel_state["available_stocks"].get(chain_name, 25),
            }
        )
    hotel_state["chains"] = chains_info

    public_state = {
        "type": "game_state",
        "board": board.get_state(),
        "hotel": hotel_state,
        "turn_order": game["turn_order"],
        "current_player": current_player_id,
        "phase": game["phase"],
        "players": {
            pid: {
                "name": p.name,
                "money": p.money,
                "stocks": p.stocks,
                "hand_size": p.hand_size,
            }
            for pid, p in players.items()
        },
        "tiles_remaining": len(game["tile_pool"]),
    }

    # Send to host
    await session_manager.send_to_host(room_code, public_state)

    # Send to each player with their private hand info
    for player_id, player in players.items():
        player_state = {
            **public_state,
            "your_hand": [str(tile) for tile in player.hand],
        }
        await session_manager.send_to_player(room_code, player_id, player_state)


async def broadcast_lobby_update(room_code: str):
    """Broadcast lobby state to all connected clients."""
    room = session_manager.get_room(room_code)
    if room is None:
        return

    players = [
        {"player_id": p.player_id, "name": p.name, "is_bot": p.is_bot}
        for p in room.players.values()
    ]

    message = {
        "type": "lobby_update",
        "players": players,
        "can_start": len(players) >= room.min_players,
    }

    await session_manager.send_to_host(room_code, message)
    await session_manager.broadcast_to_room(room_code, message)


async def send_host_state(room_code: str):
    """Send current state to host."""
    room = session_manager.get_room(room_code)
    if room is None:
        return

    if room.started and room.game:
        await broadcast_game_state(room_code)
    else:
        await broadcast_lobby_update(room_code)


async def send_player_state(room_code: str, player_id: str):
    """Send current state to a specific player."""
    room = session_manager.get_room(room_code)
    if room is None:
        return

    if room.started and room.game:
        await broadcast_game_state(room_code)
    else:
        await broadcast_lobby_update(room_code)
