"""FastAPI application for Acquire board game."""

import json
import os
import re
import uuid
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
from game.board import Tile
from game.game import Game, GamePhase
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


def _validate_chain_name(v: str) -> str:
    """Shared validator for chain names."""
    if v not in VALID_CHAINS:
        raise ValueError(f"Invalid chain: {v}. Must be one of {VALID_CHAINS}")
    return v


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
        return _validate_chain_name(v)


class MergerChoiceMessage(BaseModel):
    """Validate merger_choice action messages."""

    action: Literal["merger_choice"]
    surviving_chain: str

    @field_validator("surviving_chain")
    @classmethod
    def validate_chain(cls, v: str) -> str:
        """Validate chain name."""
        return _validate_chain_name(v)


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
        return _validate_chain_name(v)


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


class DeclareEndGameMessage(BaseModel):
    """Validate declare_end_game action messages."""

    action: Literal["declare_end_game"]


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
    DeclareEndGameMessage,
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
        "declare_end_game": DeclareEndGameMessage,
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
    success = session_manager.join_room(room_code, player_id, player_name)

    if not success:
        raise HTTPException(status_code=500, detail="Failed to create room")

    return {
        "room_code": room_code,
        "player_id": player_id,
        "is_host": True,
    }


@app.post("/create-spectator")
async def create_spectator_room():
    """Create a new game room for spectator mode (bots only).

    The caller does not join as a player - they can watch via the host WebSocket.
    Use /room/{room_code}/add-bot to add bots, then start the game.
    """
    room_code = session_manager.create_room()

    return {
        "room_code": room_code,
        "is_spectator": True,
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
    success = session_manager.join_room(room_code.upper(), player_id, player_name)

    if not success:
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

    await websocket.accept()
    session_manager.connect_player(room_code, player_id, websocket)

    # Send current state to player
    await send_player_state(room_code, player_id)

    try:
        while True:
            try:
                data = await websocket.receive_json()
            except json.JSONDecodeError as e:
                # Malformed JSON - send error but keep connection alive
                await session_manager.send_to_player(
                    room_code,
                    player_id,
                    {"type": "error", "message": f"Invalid JSON: {e}"},
                )
                continue

            try:
                await handle_player_action(room_code, player_id, data)
            except Exception as e:
                # Log error but keep connection alive
                print(f"Error handling player action: {e}")
                await session_manager.send_to_player(
                    room_code,
                    player_id,
                    {"type": "error", "message": f"Action failed: {e}"},
                )

    except WebSocketDisconnect:
        pass  # Normal disconnect, cleanup happens in finally
    except Exception as e:
        # Unexpected error - log it
        print(f"WebSocket error for {room_code}/{player_id}: {e}")
    finally:
        # Always cleanup, regardless of how we exit the loop
        session_manager.disconnect(room_code, player_id, websocket)


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

    elif action == "declare_end_game":
        await handle_declare_end_game(room_code, player_id)

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
    """Initialize game state for a room using Game class."""
    room = session_manager.get_room(room_code)
    if room is None:
        return

    # Create Game instance with optional seed for deterministic testing
    seed_str = os.environ.get("ACQUIRE_GAME_SEED")
    seed = int(seed_str) if seed_str else None
    game = Game(seed=seed)

    # Add all players to the game
    for player_id, connection in room.players.items():
        game.add_player(player_id, connection.name, is_bot=connection.is_bot)

    # Start the game (shuffles tiles, deals to players)
    game.start_game()

    # Store Game instance in room
    room.game = game

    # Process bot turns if the first player is a bot
    await process_bot_turns(room_code)


async def handle_place_tile(room_code: str, player_id: str, tile_str: str):
    """Handle tile placement action using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Check if it's this player's turn
    if game.get_current_player_id() != player_id:
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Not your turn"}
        )
        return

    # Check phase
    if game.phase != GamePhase.PLAYING:
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Not in playing phase"}
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

    player = game.get_player(player_id)
    if player is None:
        return

    # Check if all tiles in hand are unplayable (special rule)
    unplayable_result = game.handle_all_tiles_unplayable(player)
    if unplayable_result is not None:
        # Broadcast the all-unplayable event to all players
        await session_manager.broadcast_to_room(
            room_code,
            {
                "type": "all_tiles_unplayable",
                "player_id": player_id,
                "player_name": player.name,
                "revealed_hand": unplayable_result["revealed_hand"],
                "removed_tiles": unplayable_result["removed_tiles"],
                "new_tiles_count": len(unplayable_result["new_tiles"]),
            },
        )

        # Also notify the player of their new hand
        await session_manager.send_to_player(
            room_code,
            player_id,
            {
                "type": "tiles_replaced",
                "removed_tiles": unplayable_result["removed_tiles"],
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

    # Play the tile using Game class
    result = game.play_tile(player_id, tile)

    if not result.success:
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.error or "Unknown error"},
        )
        return

    # Handle different results
    if result.next_action == "found_chain":
        # Player needs to choose which chain to found
        await session_manager.send_to_player(
            room_code,
            player_id,
            {
                "type": "choose_chain",
                "available_chains": result.available_chains or [],
            },
        )

    elif result.next_action == "choose_merger_survivor":
        # Tie - player must choose survivor
        await session_manager.send_to_player(
            room_code,
            player_id,
            {
                "type": "choose_merger_survivor",
                "tied_chains": result.tied_chains or [],
            },
        )

    elif result.next_action == "stock_disposition":
        # Someone needs to handle stock disposition during merger
        await notify_or_handle_stock_disposition(room_code)

    await broadcast_game_state(room_code)


async def handle_found_chain(room_code: str, player_id: str, chain_name: str):
    """Handle chain founding using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Use Game.found_chain() method
    result = game.found_chain(player_id, chain_name)

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    await broadcast_game_state(room_code)


async def handle_merger_choice(room_code: str, player_id: str, surviving_chain: str):
    """Handle player choosing merger survivor in case of tie using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Use Game.choose_merger_survivor() method
    result = game.choose_merger_survivor(player_id, surviving_chain)

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    # Check if stock disposition is needed
    if result.get("next_action") == "stock_disposition":
        pending = game.pending_action
        if pending and pending.get("type") == "stock_disposition":
            await session_manager.send_to_player(
                room_code,
                pending.get("player_id"),
                {
                    "type": "stock_disposition_required",
                    "defunct_chain": pending.get("defunct_chain"),
                    "surviving_chain": pending.get("surviving_chain"),
                    "stock_count": pending.get("stock_count"),
                    "available_to_trade": pending.get("available_to_trade"),
                },
            )

    await broadcast_game_state(room_code)


async def handle_merger_disposition(
    room_code: str, player_id: str, defunct_chain: str, disposition: dict
):
    """Handle player's sell/trade/hold decision during merger using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Use Game.handle_stock_disposition() method
    # Note: "hold" in WebSocket message maps to "keep" in Game method
    result = game.handle_stock_disposition(
        player_id,
        sell=disposition.get("sell", 0),
        trade=disposition.get("trade", 0),
        keep=disposition.get("hold", 0),
    )

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    # Check if another player needs to handle stock disposition
    if result.get("next_action") == "stock_disposition":
        await notify_or_handle_stock_disposition(room_code)

    await broadcast_game_state(room_code)

    # After merger fully resolves, the bot that triggered it may need to
    # finish its turn (buy stocks, end turn) and subsequent bots may need
    # to take their turns.
    await process_bot_turns(room_code)


async def handle_buy_stocks(room_code: str, player_id: str, purchases: dict):
    """Handle stock purchase action using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Convert purchases dict to list of chain names
    # e.g., {"Luxor": 2, "Tower": 1} -> ["Luxor", "Luxor", "Tower"]
    purchase_list = []
    for chain_name, quantity in purchases.items():
        purchase_list.extend([chain_name] * quantity)

    # Use Game.buy_stocks() method
    result = game.buy_stocks(player_id, purchase_list)

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    # Move to end of turn (buy_stocks doesn't automatically advance)
    await handle_end_turn(room_code, player_id)


async def handle_end_turn(room_code: str, player_id: str):
    """Handle end of turn using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Use Game.end_turn() method
    result = game.end_turn(player_id)

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    # Check for game end condition
    if result.get("can_end_game"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "can_end_game", "message": "You may choose to end the game"},
        )

    await broadcast_game_state(room_code)

    # Process bot turns if the next player is a bot
    await process_bot_turns(room_code)


async def handle_declare_end_game(room_code: str, player_id: str):
    """Handle a player declaring the game over.

    This is used when end-game conditions are met and the current player
    chooses to end the game (rather than continuing to play).
    """
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Use Game.declare_end_game() method
    result = game.declare_end_game(player_id)

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    # Build final scores from standings
    standings = result.get("standings", [])
    final_scores = {}
    for entry in standings:
        final_scores[entry["player_id"]] = {
            "name": entry["name"],
            "money": entry["money"],
        }

    winner = result.get("winner", {})
    winner_id = winner.get("player_id") if winner else None

    # Broadcast final results
    await session_manager.broadcast_to_room(
        room_code,
        {
            "type": "game_over",
            "scores": final_scores,
            "winner": winner_id,
            "declared_by": player_id,
        },
    )

    await session_manager.send_to_host(
        room_code,
        {
            "type": "game_over",
            "scores": final_scores,
            "winner": winner_id,
            "declared_by": player_id,
        },
    )


# =============================================================================
# Player-to-Player Trading Handlers
# =============================================================================


async def handle_propose_trade(
    room_code: str,
    player_id: str,
    to_player_id: str,
    offering_stocks: dict,
    offering_money: int,
    requesting_stocks: dict,
    requesting_money: int,
):
    """Handle a player proposing a trade using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Create trade offer
    trade = TradeOffer(
        from_player_id=player_id,
        to_player_id=to_player_id,
        offering_stocks=offering_stocks,
        offering_money=offering_money,
        requesting_stocks=requesting_stocks,
        requesting_money=requesting_money,
    )

    # Use Game.propose_trade() method
    result = game.propose_trade(trade)

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    # Notify both players
    trade_notification = {
        "type": "trade_proposed",
        "trade": trade.to_dict(),
    }
    await session_manager.send_to_player(room_code, player_id, trade_notification)
    await session_manager.send_to_player(room_code, to_player_id, trade_notification)


async def handle_accept_trade(room_code: str, player_id: str, trade_id: str):
    """Handle a player accepting a trade using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Get trade info before accepting (for notifications)
    trade = game.pending_trades.get(trade_id)
    if trade is None:
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Trade not found"}
        )
        return

    from_player_id = trade.from_player_id
    to_player_id = trade.to_player_id

    # Use Game.accept_trade() method
    result = game.accept_trade(player_id, trade_id)

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    # Notify both players
    trade_notification = {
        "type": "trade_accepted",
        "trade_id": trade_id,
        "from_player": from_player_id,
        "to_player": to_player_id,
    }
    await session_manager.send_to_player(room_code, from_player_id, trade_notification)
    await session_manager.send_to_player(room_code, to_player_id, trade_notification)

    # Broadcast updated game state
    await broadcast_game_state(room_code)


async def handle_reject_trade(room_code: str, player_id: str, trade_id: str):
    """Handle a player rejecting a trade using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Get trade info before rejecting (for notifications)
    trade = game.pending_trades.get(trade_id)
    if trade is None:
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Trade not found"}
        )
        return

    from_player_id = trade.from_player_id
    to_player_id = trade.to_player_id

    # Use Game.reject_trade() method
    result = game.reject_trade(player_id, trade_id)

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    # Notify both players
    trade_notification = {
        "type": "trade_rejected",
        "trade_id": trade_id,
        "rejected_by": player_id,
    }
    await session_manager.send_to_player(room_code, from_player_id, trade_notification)
    await session_manager.send_to_player(room_code, to_player_id, trade_notification)


async def handle_cancel_trade(room_code: str, player_id: str, trade_id: str):
    """Handle a player canceling a trade using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Get trade info before canceling (for notifications)
    trade = game.pending_trades.get(trade_id)
    if trade is None:
        await session_manager.send_to_player(
            room_code, player_id, {"type": "error", "message": "Trade not found"}
        )
        return

    from_player_id = trade.from_player_id
    to_player_id = trade.to_player_id

    # Use Game.cancel_trade() method
    result = game.cancel_trade(player_id, trade_id)

    if not result.get("success"):
        await session_manager.send_to_player(
            room_code,
            player_id,
            {"type": "error", "message": result.get("error", "Unknown error")},
        )
        return

    # Notify both players
    trade_notification = {
        "type": "trade_canceled",
        "trade_id": trade_id,
        "canceled_by": player_id,
    }
    await session_manager.send_to_player(room_code, from_player_id, trade_notification)
    await session_manager.send_to_player(room_code, to_player_id, trade_notification)


async def end_game(room_code: str):
    """End the game and calculate final scores using Game class."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Use Game.end_game() method
    result = game.end_game()

    if not result.get("success"):
        return

    # Build final scores from standings
    standings = result.get("standings", [])
    final_scores = {}
    for entry in standings:
        final_scores[entry["player_id"]] = {
            "name": entry["name"],
            "money": entry["money"],
        }

    winner = result.get("winner", {})
    winner_id = winner.get("player_id") if winner else None

    # Broadcast final results
    await session_manager.broadcast_to_room(
        room_code, {"type": "game_over", "scores": final_scores, "winner": winner_id}
    )

    await session_manager.send_to_host(
        room_code, {"type": "game_over", "scores": final_scores, "winner": winner_id}
    )


async def notify_or_handle_stock_disposition(room_code: str):
    """Handle stock disposition for the pending player (bot or human).

    If the player is a bot, automatically generates and submits their disposition.
    If the player is human, sends them the disposition_required message.
    Continues processing until we reach a human or no more dispositions needed.
    """
    import asyncio

    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Safety counter to prevent infinite loops
    max_iterations = 50
    iterations = 0

    while iterations < max_iterations:
        iterations += 1

        # Check if there's a pending stock disposition
        pending = game.pending_action
        if not pending or pending.get("type") != "stock_disposition":
            break

        disposition_player_id = pending.get("player_id")
        if not disposition_player_id:
            break

        defunct_chain = pending.get("defunct_chain")

        # Check if this player is a bot
        player_conn = room.players.get(disposition_player_id)
        if player_conn is None or not player_conn.is_bot:
            # Human player needs to dispose - send message and wait
            await session_manager.send_to_player(
                room_code,
                disposition_player_id,
                {
                    "type": "stock_disposition_required",
                    "defunct_chain": defunct_chain,
                    "surviving_chain": pending.get("surviving_chain"),
                    "stock_count": pending.get("stock_count"),
                    "available_to_trade": pending.get("available_to_trade"),
                },
            )
            break

        # Bot needs to dispose - generate decision and execute directly
        bot = game.bots.get(disposition_player_id)
        if bot is None:
            break

        surviving_chain = pending.get("surviving_chain")
        stock_count = pending.get("stock_count")

        # Get bot's disposition decision
        decision = bot.choose_stock_disposition(
            defunct_chain, surviving_chain, stock_count, game.board, game.hotel
        )

        # Execute the disposition using Game method directly
        result = game.handle_stock_disposition(
            disposition_player_id,
            sell=decision.get("sell", 0),
            trade=decision.get("trade", 0),
            keep=decision.get("keep", 0),
        )

        # Broadcast state after bot's disposition
        await broadcast_game_state(room_code)

        # Small delay to prevent overwhelming clients
        await asyncio.sleep(0.1)

        # If disposition failed, break
        if not result.get("success"):
            break

        # Loop continues to check if another player needs to dispose


async def process_bot_turns(room_code: str):
    """Process bot turns automatically using Game.execute_bot_turn().

    This function handles bot players by using the Game class's bot execution.
    After bots finish and it's a human player's turn, checks if the human
    has all-unplayable tiles and replaces them automatically.
    """
    import asyncio

    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Safety counter to prevent infinite loops
    max_iterations = 100
    iterations = 0

    while iterations < max_iterations:
        iterations += 1

        # Check if game is over
        if game.phase == GamePhase.GAME_OVER:
            break

        current_player_id = game.get_current_player_id()
        if current_player_id is None:
            break

        player_conn = room.players.get(current_player_id)

        # Check if current player is a bot
        if player_conn is None or not player_conn.is_bot:
            # Human player's turn - stop and wait for their input
            break

        # This is a bot's turn - use Game.execute_bot_turn()
        prev_player = current_player_id
        prev_phase = game.phase
        game.execute_bot_turn(current_player_id)

        # Detect stuck bot: if player and phase didn't change, the bot
        # couldn't complete its turn (e.g., play_tile rejected its tile).
        # Force-advance to prevent infinite loop.
        if game.phase == prev_phase and game.get_current_player_id() == prev_player:
            if game.phase == GamePhase.PLAYING:
                # Bot couldn't play any tile — skip to buy and end turn
                game.phase = GamePhase.BUYING_STOCKS
                game.buy_stocks(current_player_id, {})
                game.end_turn(current_player_id)

        # Broadcast the state after bot's turn
        await broadcast_game_state(room_code)

        # If bot triggered a merger that requires a human to dispose stock,
        # handle it and break out. Without this, execute_bot_turn breaks out
        # of its merger loop (human can't dispose inside bot execution),
        # and process_bot_turns loops endlessly calling execute_bot_turn.
        if game.phase == GamePhase.MERGING and game.pending_action:
            pending_type = game.pending_action.get("type")
            if pending_type == "stock_disposition":
                disposition_player_id = game.pending_action.get("player_id")
                disp_conn = room.players.get(disposition_player_id, None)
                if disp_conn is None or not disp_conn.is_bot:
                    # Human needs to dispose — notify them and stop
                    await notify_or_handle_stock_disposition(room_code)
                    await broadcast_game_state(room_code)
                    return  # Wait for human input

        # Small delay to prevent overwhelming clients
        await asyncio.sleep(0.1)

    # After bots finish, if it's a human player's turn, check for
    # all-unplayable tiles. The frontend won't let them click unplayable
    # tiles, so we must handle replacement server-side proactively.
    await check_and_replace_unplayable_tiles(room_code)


async def check_and_replace_unplayable_tiles(room_code: str):
    """If the current human player has all unplayable tiles, replace them.

    This prevents a deadlock where the frontend shows no clickable tiles
    and the backend waits for a play_tile message that can never come.
    Loops in case replacement tiles are also all unplayable.
    """
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game
    max_replacements = 10  # Safety limit

    for _ in range(max_replacements):
        if game.phase != GamePhase.PLAYING:
            break

        current_player_id = game.get_current_player_id()
        if current_player_id is None:
            break

        # Only handle for human players
        player_conn = room.players.get(current_player_id)
        if player_conn is None or player_conn.is_bot:
            break

        player = game.get_player(current_player_id)
        if player is None:
            break

        result = game.handle_all_tiles_unplayable(player)
        if result is None:
            # Player has at least one playable tile - no action needed
            break

        # Broadcast the replacement event
        await session_manager.broadcast_to_room(
            room_code,
            {
                "type": "all_tiles_unplayable",
                "player_id": current_player_id,
                "player_name": player.name,
                "revealed_hand": result["revealed_hand"],
                "removed_tiles": result["removed_tiles"],
                "new_tiles_count": len(result["new_tiles"]),
            },
        )

        # Notify the player of their new hand
        await session_manager.send_to_player(
            room_code,
            current_player_id,
            {
                "type": "tiles_replaced",
                "removed_tiles": result["removed_tiles"],
                "new_hand": [str(t) for t in player.hand],
            },
        )

        # Broadcast updated state so frontend gets new tile_playability
        await broadcast_game_state(room_code)


async def broadcast_game_state(room_code: str):
    """Send updated state to all clients using Game.get_public_state()."""
    room = session_manager.get_room(room_code)
    if room is None:
        return

    game = room.game

    if game is None:
        return

    # Get public state from Game class
    game_state = game.get_public_state()

    # Build chain info in the format expected by WebSocket clients
    chains_info = []
    for chain_name, chain_data in game_state["chains"].items():
        chains_info.append(
            {
                "name": chain_name,
                "size": chain_data["size"],
                "price": chain_data["stock_price"],
                "stocks_available": chain_data["available_stocks"],
            }
        )

    hotel_state = {
        "chains": chains_info,
        "available_stocks": {
            name: data["available_stocks"]
            for name, data in game_state["chains"].items()
        },
        "active_chains": [
            name for name, data in game_state["chains"].items() if data["active"]
        ],
    }

    # Build turn order from players list
    turn_order = [p["player_id"] for p in game_state["players"]]

    public_state = {
        "type": "game_state",
        "board": game_state["board"],
        "hotel": hotel_state,
        "turn_order": turn_order,
        "current_player": game_state["current_player"],
        "phase": game_state["phase"],
        "players": {
            p["player_id"]: {
                "name": p["name"],
                "money": p["money"],
                "stocks": p["stocks"],
                "hand_size": p["tile_count"],
            }
            for p in game_state["players"]
        },
        "tiles_remaining": game_state["tiles_remaining"],
    }

    # Send to host
    await session_manager.send_to_host(room_code, public_state)

    # Send to each player with their private hand info
    for player_info in game_state["players"]:
        player_id = player_info["player_id"]
        player_state = game.get_player_state(player_id)
        ws_state = {
            **public_state,
            "your_hand": player_state.get("hand", []),
            "tile_playability": player_state.get("tile_playability", {}),
        }
        await session_manager.send_to_player(room_code, player_id, ws_state)


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
