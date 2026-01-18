"""Session manager for Acquire board game multiplayer rooms."""

import random
import string
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from fastapi import WebSocket


@dataclass
class PlayerConnection:
    """Tracks a connected player."""

    player_id: str
    name: str
    websockets: list[WebSocket] = field(default_factory=list)
    is_bot: bool = False
    is_host: bool = False
    session_token: Optional[str] = None  # For authentication


@dataclass
class GameRoom:
    """A game room/session."""

    room_code: str
    host_websocket: Optional[WebSocket] = None
    players: dict[str, PlayerConnection] = field(default_factory=dict)
    game: Optional[Any] = None  # Will be Game instance
    started: bool = False
    max_players: int = 6
    min_players: int = 2


class SessionManager:
    """Manages game rooms and connections."""

    def __init__(self):
        self._rooms: dict[str, GameRoom] = {}

    def generate_room_code(self) -> str:
        """Generate unique 4-letter room code."""
        while True:
            code = "".join(random.choices(string.ascii_uppercase, k=4))
            if code not in self._rooms:
                return code

    def create_room(self) -> str:
        """Create new room, return room code."""
        code = self.generate_room_code()
        self._rooms[code] = GameRoom(room_code=code)
        return code

    def get_room(self, room_code: str) -> Optional[GameRoom]:
        """Get room by code."""
        return self._rooms.get(room_code)

    def join_room(self, room_code: str, player_id: str, name: str) -> Optional[str]:
        """Add player to room.

        Args:
            room_code: The room code to join
            player_id: Unique identifier for the player
            name: Display name for the player

        Returns:
            Session token if successful, None if failed
        """
        room = self.get_room(room_code)
        if room is None:
            return None
        if room.started:
            return None
        if len(room.players) >= room.max_players:
            return None
        if player_id in room.players:
            return None

        # Generate a session token for authentication
        session_token = str(uuid.uuid4())

        is_host = len(room.players) == 0
        room.players[player_id] = PlayerConnection(
            player_id=player_id,
            name=name,
            is_host=is_host,
            session_token=session_token,
        )
        return session_token

    def leave_room(self, room_code: str, player_id: str):
        """Remove player from room."""
        room = self.get_room(room_code)
        if room is None:
            return
        if player_id not in room.players:
            return

        was_host = room.players[player_id].is_host
        del room.players[player_id]

        # If host left and there are remaining players, assign new host
        if was_host and room.players:
            next_player = next(iter(room.players.values()))
            next_player.is_host = True

        # Delete room if empty
        if not room.players:
            self.delete_room(room_code)

    def add_bot(self, room_code: str) -> Optional[str]:
        """Add a bot player, return bot's player_id."""
        room = self.get_room(room_code)
        if room is None:
            return None
        if room.started:
            return None
        if len(room.players) >= room.max_players:
            return None

        bot_id = f"bot_{uuid.uuid4().hex[:8]}"
        bot_number = sum(1 for p in room.players.values() if p.is_bot) + 1
        bot_name = f"Bot {bot_number}"

        room.players[bot_id] = PlayerConnection(
            player_id=bot_id,
            name=bot_name,
            is_bot=True,
        )
        return bot_id

    def connect_player(self, room_code: str, player_id: str, websocket: WebSocket):
        """Associate websocket with player (supports multiple connections)."""
        room = self.get_room(room_code)
        if room is None:
            return
        if player_id not in room.players:
            return
        room.players[player_id].websockets.append(websocket)

    def connect_host(self, room_code: str, websocket: WebSocket):
        """Connect host display."""
        room = self.get_room(room_code)
        if room is None:
            return
        room.host_websocket = websocket

    def disconnect(self, room_code: str, player_id: str, websocket: WebSocket):
        """Handle disconnect for a specific websocket."""
        room = self.get_room(room_code)
        if room is None:
            return
        if player_id not in room.players:
            return
        player = room.players[player_id]
        if websocket in player.websockets:
            player.websockets.remove(websocket)

    async def broadcast_to_room(self, room_code: str, message: dict):
        """Send message to all connected players in room."""
        room = self.get_room(room_code)
        if room is None:
            return

        for player in room.players.values():
            if player.is_bot:
                continue
            dead_websockets = []
            for ws in player.websockets:
                try:
                    await ws.send_json(message)
                except Exception:
                    dead_websockets.append(ws)
            for ws in dead_websockets:
                player.websockets.remove(ws)

    async def send_to_player(self, room_code: str, player_id: str, message: dict):
        """Send private message to specific player (all their connections)."""
        room = self.get_room(room_code)
        if room is None:
            return
        if player_id not in room.players:
            return

        player = room.players[player_id]
        dead_websockets = []
        for ws in player.websockets:
            try:
                await ws.send_json(message)
            except Exception:
                dead_websockets.append(ws)
        for ws in dead_websockets:
            player.websockets.remove(ws)

    async def send_to_host(self, room_code: str, message: dict):
        """Send message to host display."""
        room = self.get_room(room_code)
        if room is None:
            return
        if room.host_websocket is not None:
            try:
                await room.host_websocket.send_json(message)
            except Exception:
                # Handle disconnected websocket
                room.host_websocket = None

    def start_game(self, room_code: str) -> bool:
        """Initialize and start the game. Returns True if successful."""
        room = self.get_room(room_code)
        if room is None:
            return False
        if room.started:
            return False
        if len(room.players) < room.min_players:
            return False

        room.started = True
        # Game initialization will be added when Game class is implemented
        return True

    def delete_room(self, room_code: str):
        """Delete a room."""
        if room_code in self._rooms:
            del self._rooms[room_code]

    def validate_session_token(self, room_code: str, player_id: str, token: str) -> bool:
        """Validate a session token for a player.

        Args:
            room_code: The room code
            player_id: The player's ID
            token: The session token to validate

        Returns:
            True if token is valid, False otherwise
        """
        room = self.get_room(room_code)
        if room is None:
            return False
        if player_id not in room.players:
            return False

        player = room.players[player_id]
        return player.session_token == token

    def get_session_token(self, room_code: str, player_id: str) -> Optional[str]:
        """Get the session token for a player.

        Args:
            room_code: The room code
            player_id: The player's ID

        Returns:
            The session token if found, None otherwise
        """
        room = self.get_room(room_code)
        if room is None:
            return None
        if player_id not in room.players:
            return None

        return room.players[player_id].session_token
