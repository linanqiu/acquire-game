"""Session manager for Acquire board game multiplayer rooms."""

import random
import string
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional, TYPE_CHECKING

from fastapi import WebSocket

if TYPE_CHECKING:
    from game.game import Game

# Seat kinds (see docs/architecture/seat-contract.md)
HUMAN = "human"
SEAT_KINDS = ("human", "bot", "llm", "scripted")


@dataclass
class PlayerConnection:
    """Tracks a connected player."""

    player_id: str
    name: str
    websockets: list[WebSocket] = field(default_factory=list)
    is_bot: bool = False  # True for every non-human seat (compatibility)
    is_host: bool = False
    kind: str = HUMAN  # human | bot | llm | scripted
    agent_id: Optional[str] = None  # catalog id for AI seats
    agent_label: Optional[str] = None  # catalog label for AI seats
    agent: Any = None  # agents.base.Agent instance driving this seat (None = human)

    @property
    def is_agent(self) -> bool:
        """True when the seat is driven by an Agent (not a human)."""
        return self.kind != HUMAN


@dataclass
class GameRoom:
    """A game room/session."""

    room_code: str
    host_websocket: Optional[WebSocket] = None
    players: dict[str, PlayerConnection] = field(default_factory=dict)
    game: Optional["Game"] = None  # Game instance, not dict
    started: bool = False
    max_players: int = 6
    min_players: int = 2
    seed: Optional[int] = None
    tile_order: Optional[list[str]] = None
    # Per-room driver state (lock, driver task, fallback counters); created
    # lazily by seats.get_runtime().
    runtime: Any = None
    # Id of the current game (transcripts, ``/games/{game_id}``) and its
    # transcripts.TranscriptWriter (None when transcripts are disabled).
    game_id: Optional[str] = None
    transcript: Any = None


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

    def join_room(self, room_code: str, player_id: str, name: str) -> bool:
        """Add player to room.

        Args:
            room_code: The room code to join
            player_id: Unique identifier for the player
            name: Display name for the player

        Returns:
            True if successful, False if failed
        """
        room = self.get_room(room_code)
        if room is None:
            return False
        if room.started:
            return False
        if len(room.players) >= room.max_players:
            return False
        if player_id in room.players:
            return False

        # Check for duplicate name (case-insensitive)
        for existing_player in room.players.values():
            if existing_player.name.lower() == name.lower():
                return False

        is_host = len(room.players) == 0
        room.players[player_id] = PlayerConnection(
            player_id=player_id,
            name=name,
            is_host=is_host,
        )
        return True

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
        """Add a heuristic bot seat, return its player_id (None if not allowed)."""
        from agents.registry import create

        room = self.get_room(room_code)
        if room is None or room.started or len(room.players) >= room.max_players:
            return None
        name = self.next_seat_name(room_code, "Bot", numbered=True)
        return self.add_seat(
            room_code,
            kind="bot",
            name=name,
            agent_id="bot",
            agent_label=None,
            agent=create("bot", name=name),
        )

    def next_seat_name(self, room_code: str, base: str, numbered: bool) -> str:
        """Pick a free seat name: "Bot 1" style when ``numbered``, else ``base``
        followed by " 2", " 3"... only when ``base`` is already taken."""
        room = self.get_room(room_code)
        taken = {p.name.lower() for p in room.players.values()} if room else set()
        n = 1
        while True:
            if numbered or n > 1:
                name = f"{base} {n}"
            else:
                name = base
            if name.lower() not in taken:
                return name
            n += 1

    def add_seat(
        self,
        room_code: str,
        *,
        kind: str,
        name: str,
        agent_id: str,
        agent_label: Optional[str],
        agent: Any,
    ) -> Optional[str]:
        """Add an AI seat driven by ``agent``; return its player_id.

        Returns None if the room is missing, started, full, or the name is taken.
        """
        room = self.get_room(room_code)
        if room is None or room.started or len(room.players) >= room.max_players:
            return None
        if any(p.name.lower() == name.lower() for p in room.players.values()):
            return None
        prefix = "bot" if kind == "bot" else kind
        seat_id = f"{prefix}_{uuid.uuid4().hex[:8]}"
        room.players[seat_id] = PlayerConnection(
            player_id=seat_id,
            name=name,
            is_bot=True,
            kind=kind,
            agent_id=agent_id,
            agent_label=agent_label,
            agent=agent,
        )
        return seat_id

    def remove_seat(self, room_code: str, player_id: str) -> bool:
        """Remove an AI seat from a room in the lobby. Humans cannot be removed."""
        room = self.get_room(room_code)
        if room is None or room.started:
            return False
        seat = room.players.get(player_id)
        if seat is None or not seat.is_agent:
            return False
        del room.players[player_id]
        return True

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

    async def _send_to_websockets(
        self, player: PlayerConnection, message: dict
    ) -> None:
        """Send message to all websockets for a player, removing dead connections.

        Args:
            player: The player connection to send to
            message: The message dict to send
        """
        dead_websockets = []
        for ws in player.websockets:
            try:
                await ws.send_json(message)
            except Exception:
                dead_websockets.append(ws)
        for ws in dead_websockets:
            try:
                player.websockets.remove(ws)
            except ValueError:
                pass  # Already removed by concurrent operation

    async def broadcast_to_room(self, room_code: str, message: dict):
        """Send message to all connected players in room."""
        room = self.get_room(room_code)
        if room is None:
            return

        for player in room.players.values():
            if player.is_bot or player.is_agent:
                continue
            await self._send_to_websockets(player, message)

    async def send_to_player(self, room_code: str, player_id: str, message: dict):
        """Send private message to specific player (all their connections)."""
        room = self.get_room(room_code)
        if room is None:
            return
        if player_id not in room.players:
            return

        await self._send_to_websockets(room.players[player_id], message)

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
