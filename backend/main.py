"""FastAPI application for Acquire board game."""

import uuid
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, RedirectResponse

from session.manager import SessionManager
from game.board import Board, Tile
from game.hotel import Hotel
from game.player import Player
from game.rules import Rules

app = FastAPI(title="Acquire Board Game")

# Mount static files and templates
app.mount("/static", StaticFiles(directory="../frontend/static"), name="static")
templates = Jinja2Templates(directory="../frontend/templates")

# Global session manager
session_manager = SessionManager()


# HTTP Routes
@app.get("/", response_class=HTMLResponse)
async def lobby(request: Request):
    """Render lobby page."""
    return templates.TemplateResponse("lobby.html", {"request": request})


@app.post("/create")
async def create_room():
    """Create a new game room."""
    room_code = session_manager.create_room()
    return {"room_code": room_code}


@app.post("/join/{room_code}")
async def join_room(room_code: str, name: str):
    """Join an existing room."""
    room = session_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    if room.started:
        raise HTTPException(status_code=400, detail="Game already started")

    if len(room.players) >= room.max_players:
        raise HTTPException(status_code=400, detail="Room is full")

    player_id = str(uuid.uuid4())
    success = session_manager.join_room(room_code, player_id, name)

    if not success:
        raise HTTPException(status_code=400, detail="Failed to join room")

    return {"player_id": player_id, "room_code": room_code}


@app.get("/host/{room_code}", response_class=HTMLResponse)
async def host_view(request: Request, room_code: str):
    """Render host display."""
    room = session_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    return templates.TemplateResponse("host.html", {"request": request, "room_code": room_code})


@app.get("/play/{room_code}", response_class=HTMLResponse)
async def player_view(request: Request, room_code: str, player_id: str):
    """Render player view."""
    room = session_manager.get_room(room_code)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")

    if player_id not in room.players:
        raise HTTPException(status_code=404, detail="Player not found in room")

    player = room.players[player_id]
    return templates.TemplateResponse(
        "player.html",
        {
            "request": request,
            "room_code": room_code,
            "player_id": player_id,
            "player_name": player.name,
        }
    )


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
        raise HTTPException(status_code=400, detail="Cannot add bot (room full or game started)")

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
            status_code=400,
            detail=f"Need at least {room.min_players} players to start"
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
            data = await websocket.receive_json()
            await handle_player_action(room_code, player_id, data)

    except WebSocketDisconnect:
        session_manager.disconnect(room_code, player_id)


async def handle_player_action(room_code: str, player_id: str, data: dict):
    """Process player actions and broadcast updates."""
    room = session_manager.get_room(room_code)
    if room is None or not room.started:
        return

    action = data.get("action")

    if action == "place_tile":
        tile_str = data.get("tile")
        if tile_str:
            await handle_place_tile(room_code, player_id, tile_str)

    elif action == "found_chain":
        chain_name = data.get("chain")
        if chain_name:
            await handle_found_chain(room_code, player_id, chain_name)

    elif action == "merger_choice":
        surviving_chain = data.get("surviving_chain")
        if surviving_chain:
            await handle_merger_choice(room_code, player_id, surviving_chain)

    elif action == "merger_disposition":
        # Handle sell/trade/hold decisions during merger
        disposition = data.get("disposition")  # {"sell": n, "trade": n, "hold": n}
        defunct_chain = data.get("defunct_chain")
        if disposition and defunct_chain:
            await handle_merger_disposition(room_code, player_id, defunct_chain, disposition)

    elif action == "buy_stocks":
        purchases = data.get("purchases")  # {"chain_name": quantity, ...}
        if purchases:
            await handle_buy_stocks(room_code, player_id, purchases)

    elif action == "end_turn":
        await handle_end_turn(room_code, player_id)


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
    }


async def handle_place_tile(room_code: str, player_id: str, tile_str: str):
    """Handle tile placement action."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return

    game = room.game

    # Verify it's this player's turn
    current_player_id = game["turn_order"][game["current_turn_index"]]
    if player_id != current_player_id:
        await session_manager.send_to_player(room_code, player_id, {
            "type": "error",
            "message": "Not your turn"
        })
        return

    # Parse tile
    try:
        tile = Tile.from_string(tile_str)
    except (ValueError, IndexError):
        await session_manager.send_to_player(room_code, player_id, {
            "type": "error",
            "message": "Invalid tile"
        })
        return

    player = game["players"][player_id]
    board = game["board"]
    hotel = game["hotel"]

    # Verify player has this tile
    if not player.has_tile(tile):
        await session_manager.send_to_player(room_code, player_id, {
            "type": "error",
            "message": "You don't have this tile"
        })
        return

    # Check if tile can be placed
    if not Rules.can_place_tile(board, tile, hotel):
        await session_manager.send_to_player(room_code, player_id, {
            "type": "error",
            "message": "Cannot place this tile"
        })
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
        game["pending_action"] = {"tile": tile, "connected_tiles": board.get_connected_tiles(tile)}
        await session_manager.send_to_player(room_code, player_id, {
            "type": "choose_chain",
            "available_chains": hotel.get_inactive_chains()
        })

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
                "tile": tile
            }
            await session_manager.send_to_player(room_code, player_id, {
                "type": "choose_merger_survivor",
                "tied_chains": survivor
            })
        else:
            # Clear winner - process merger
            game["pending_action"] = {
                "type": "process_merger",
                "surviving_chain": survivor,
                "defunct_chains": [c for c in result.chains if c != survivor],
                "tile": tile
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
        await session_manager.send_to_player(room_code, player_id, {
            "type": "error",
            "message": "Chain not available"
        })
        return

    # Found the chain
    hotel.activate_chain(chain_name)
    connected_tiles = game["pending_action"]["connected_tiles"]
    for t in connected_tiles:
        board.set_chain(t, chain_name)

    # Give founder a free stock if available
    if hotel.get_available_stocks(chain_name) > 0:
        hotel.buy_stock(chain_name)
        player._stocks[chain_name] += 1

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
        "tile": pending["tile"]
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
        defunct_chains,
        key=lambda c: board.get_chain_size(c),
        reverse=True
    )

    for defunct_chain in defunct_chains_sorted:
        chain_size = board.get_chain_size(defunct_chain)

        # Calculate and pay bonuses
        bonuses = Rules.calculate_bonuses(
            list(players.values()),
            defunct_chain,
            chain_size,
            hotel
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
    room_code: str,
    player_id: str,
    defunct_chain: str,
    disposition: dict
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
        await session_manager.send_to_player(room_code, player_id, {
            "type": "error",
            "message": "Cannot buy more than 3 stocks per turn"
        })
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
        await session_manager.send_to_player(room_code, player_id, {
            "type": "can_end_game",
            "message": "You may choose to end the game"
        })

    # Advance to next player
    game["current_turn_index"] = (game["current_turn_index"] + 1) % len(game["turn_order"])
    game["phase"] = "place_tile"

    await broadcast_game_state(room_code)


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
            list(players.values()),
            chain_name,
            chain_size,
            hotel
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
        final_scores[player.player_id] = {
            "name": player.name,
            "money": player.money
        }

    # Determine winner
    winner_id = max(final_scores.keys(), key=lambda pid: final_scores[pid]["money"])

    # Broadcast final results
    await session_manager.broadcast_to_room(room_code, {
        "type": "game_over",
        "scores": final_scores,
        "winner": winner_id
    })

    await session_manager.send_to_host(room_code, {
        "type": "game_over",
        "scores": final_scores,
        "winner": winner_id
    })


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

    public_state = {
        "type": "game_state",
        "board": board.get_state(),
        "hotel": hotel.get_state(),
        "turn_order": game["turn_order"],
        "current_player": current_player_id,
        "phase": game["phase"],
        "players": {
            pid: {
                "name": p.name,
                "money": p.money,
                "stocks": p.stocks,
                "hand_size": p.hand_size
            }
            for pid, p in players.items()
        },
        "tiles_remaining": len(game["tile_pool"])
    }

    # Send to host
    await session_manager.send_to_host(room_code, public_state)

    # Send to each player with their private hand info
    for player_id, player in players.items():
        player_state = {
            **public_state,
            "your_hand": [str(tile) for tile in player.hand]
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
        "can_start": len(players) >= room.min_players
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
