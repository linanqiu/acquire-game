"""State encoder for converting game state to neural network input."""

from typing import TYPE_CHECKING, Tuple
import numpy as np

if TYPE_CHECKING:
    from game.acquire import AcquireGame


class StateEncoder:
    """Encodes Acquire game state into a fixed-size observation vector.

    The observation space is designed to capture all relevant game information
    while maintaining a consistent size regardless of the number of players.

    Observation breakdown (~750 features):
    - Board: 108 values (12x9 grid, encoded as 0=empty, 1=played, 2-8=chain)
    - Chains: 35 features (7 chains x 5 features each)
    - Players: 48 features (6 players x 8 features, rotated so current player is first)
    - Hand: 6 tile indices (normalized to 0-1 range)
    - Phase: 7 one-hot values
    - Meta: Additional game state info
    """

    # The 7 hotel chains in canonical order
    CHAIN_NAMES = ["Luxor", "Tower", "American", "Worldwide", "Festival", "Imperial", "Continental"]

    # Board dimensions
    BOARD_SIZE = 108  # 12 columns x 9 rows
    BOARD_COLUMNS = 12
    BOARD_ROWS = "ABCDEFGHI"

    # Game constants
    NUM_CHAINS = 7
    MAX_PLAYERS = 6
    MAX_HAND_SIZE = 6
    NUM_PHASES = 7
    MAX_CHAIN_SIZE = 41  # Maximum meaningful chain size for normalization
    MAX_MONEY = 100000  # Maximum money for normalization
    MAX_STOCKS_PER_CHAIN = 25  # Maximum stocks per chain per player

    # Game phases (for one-hot encoding)
    PHASES = [
        "WAITING_FOR_PLAYERS",
        "INITIAL_TILE_PLACEMENT",
        "PLAY_TILE",
        "FOUND_CHAIN",
        "BUY_STOCK",
        "HANDLE_DEFUNCT_STOCK",
        "GAME_OVER"
    ]

    def __init__(self):
        """Initialize the state encoder."""
        # Create chain name to index mapping
        self._chain_to_idx = {name: i for i, name in enumerate(self.CHAIN_NAMES)}

    def encode(self, game: "AcquireGame", player_id: str) -> np.ndarray:
        """Encode the full game state for a specific player's perspective.

        Args:
            game: The AcquireGame instance
            player_id: The ID of the player whose perspective to encode

        Returns:
            A numpy array of shape (observation_dim,) containing the encoded state
        """
        # Encode all components
        board = self.encode_board(game)
        chains = self.encode_chains(game)
        players = self.encode_players(game, player_id)
        hand = self.encode_hand(game, player_id)
        phase = self.encode_phase(game)
        meta = self.encode_meta(game, player_id)

        # Concatenate all components
        observation = np.concatenate([board, chains, players, hand, phase, meta])

        return observation.astype(np.float32)

    def encode_board(self, game: "AcquireGame") -> np.ndarray:
        """Encode the board state.

        The board is encoded as a flat array of 108 values:
        - 0: Empty cell
        - 1: Played tile (not in chain)
        - 2-8: Tile in chain (index corresponds to CHAIN_NAMES)

        Args:
            game: The AcquireGame instance

        Returns:
            A numpy array of shape (108,)
        """
        board = np.zeros(self.BOARD_SIZE, dtype=np.float32)

        # Get board state from game
        board_state = game.board.get_state()
        cells = board_state.get("cells", {})

        for tile_str, cell_info in cells.items():
            # Parse tile string (e.g., "1A", "12I")
            idx = self.tile_to_index_from_string(tile_str)
            if idx is None:
                continue

            state = cell_info.get("state")
            chain = cell_info.get("chain")

            if chain and chain in self._chain_to_idx:
                # Tile is in a chain: value is 2 + chain_index (range 2-8)
                board[idx] = 2 + self._chain_to_idx[chain]
            elif state == "played" or state == "in_chain":
                # Tile is played but not in a chain: value is 1
                board[idx] = 1

        # Normalize to 0-1 range (divide by 8, max possible value)
        board = board / 8.0

        return board

    def encode_chains(self, game: "AcquireGame") -> np.ndarray:
        """Encode hotel chain information.

        For each of the 7 chains, encode 5 features:
        1. Size (normalized by MAX_CHAIN_SIZE)
        2. Stock price (normalized by max price ~1200)
        3. Available stocks (normalized by 25)
        4. Is active (0 or 1)
        5. Is safe (0 or 1)

        Args:
            game: The AcquireGame instance

        Returns:
            A numpy array of shape (35,) - 7 chains x 5 features
        """
        chains = np.zeros(self.NUM_CHAINS * 5, dtype=np.float32)

        for i, chain_name in enumerate(self.CHAIN_NAMES):
            offset = i * 5

            # Get chain size from board
            size = game.board.get_chain_size(chain_name)

            # Get stock info from hotel manager
            available = game.hotel.get_available_stocks(chain_name)
            is_active = game.hotel.is_chain_active(chain_name)
            price = game.hotel.get_stock_price(chain_name, size) if is_active else 0
            is_safe = game.hotel.is_chain_safe(chain_name, size) if is_active else False

            # Encode features with normalization
            chains[offset + 0] = size / self.MAX_CHAIN_SIZE
            chains[offset + 1] = price / 1200.0  # Max price is 1200
            chains[offset + 2] = available / 25.0
            chains[offset + 3] = 1.0 if is_active else 0.0
            chains[offset + 4] = 1.0 if is_safe else 0.0

        return chains

    def encode_players(self, game: "AcquireGame", player_id: str) -> np.ndarray:
        """Encode player information, rotated so current player is first.

        For each of 6 player slots, encode 8 features:
        1. Money (normalized by MAX_MONEY)
        2-8. Stock holdings for each chain (normalized by 25)

        Players are rotated so the current player is always at index 0.
        Inactive player slots are filled with zeros.

        Args:
            game: The AcquireGame instance
            player_id: The ID of the current player

        Returns:
            A numpy array of shape (48,) - 6 players x 8 features
        """
        players = np.zeros(self.MAX_PLAYERS * 8, dtype=np.float32)

        # Get player list and find current player's index
        player_list = list(game.players.values())
        current_idx = 0
        for i, player in enumerate(player_list):
            if player.player_id == player_id:
                current_idx = i
                break

        # Rotate players so current player is first
        num_players = len(player_list)
        for slot in range(self.MAX_PLAYERS):
            if slot >= num_players:
                # Inactive slot - leave as zeros
                continue

            # Get rotated player index
            player_idx = (current_idx + slot) % num_players
            player = player_list[player_idx]

            offset = slot * 8

            # Encode money (normalized)
            players[offset + 0] = player.money / self.MAX_MONEY

            # Encode stock holdings for each chain
            for chain_idx, chain_name in enumerate(self.CHAIN_NAMES):
                stock_count = player.get_stock_count(chain_name)
                players[offset + 1 + chain_idx] = stock_count / self.MAX_STOCKS_PER_CHAIN

        return players

    def encode_hand(self, game: "AcquireGame", player_id: str) -> np.ndarray:
        """Encode the player's hand of tiles.

        Each tile is encoded as its board index (0-107), normalized to 0-1.
        Empty hand slots are filled with -1 (which becomes -1/107 after normalization).

        Args:
            game: The AcquireGame instance
            player_id: The ID of the current player

        Returns:
            A numpy array of shape (6,) - tile indices normalized
        """
        hand = np.full(self.MAX_HAND_SIZE, -1.0, dtype=np.float32)

        player = game.players.get(player_id)
        if player:
            for i, tile in enumerate(player.hand):
                if i >= self.MAX_HAND_SIZE:
                    break
                idx = self.tile_to_index(tile)
                hand[i] = idx

        # Normalize tile indices to 0-1 range (keeping -1 as indicator for empty)
        # Use (idx + 1) / 109 so that -1 -> 0, and 0-107 -> ~0.009 to ~0.99
        hand = (hand + 1) / (self.BOARD_SIZE + 1)

        return hand

    def encode_phase(self, game: "AcquireGame") -> np.ndarray:
        """Encode the current game phase as one-hot vector.

        Args:
            game: The AcquireGame instance

        Returns:
            A numpy array of shape (7,) - one-hot encoded phase
        """
        phase = np.zeros(self.NUM_PHASES, dtype=np.float32)

        # Get current phase from game
        current_phase = game.phase.value if hasattr(game.phase, 'value') else str(game.phase)

        for i, phase_name in enumerate(self.PHASES):
            if phase_name == current_phase or phase_name.lower() == current_phase.lower():
                phase[i] = 1.0
                break

        return phase

    def encode_meta(self, game: "AcquireGame", player_id: str) -> np.ndarray:
        """Encode additional game metadata.

        Meta features include:
        1-6. Current player one-hot (which player's turn)
        7. Can end game flag
        8. Turn number (normalized)
        9. Tiles remaining (normalized)
        10. Number of active players (normalized)

        Args:
            game: The AcquireGame instance
            player_id: The ID of the current player

        Returns:
            A numpy array of shape (10,)
        """
        meta = np.zeros(10, dtype=np.float32)

        # One-hot encode current player position (relative to viewing player)
        player_list = list(game.players.values())
        num_players = len(player_list)

        # Find viewing player's index
        viewing_idx = 0
        for i, p in enumerate(player_list):
            if p.player_id == player_id:
                viewing_idx = i
                break

        # Find current turn player's index
        current_player_id = game.current_player.player_id if game.current_player else None
        current_idx = 0
        for i, p in enumerate(player_list):
            if p.player_id == current_player_id:
                current_idx = i
                break

        # Relative position of current turn player
        relative_pos = (current_idx - viewing_idx) % num_players
        if relative_pos < self.MAX_PLAYERS:
            meta[relative_pos] = 1.0

        # Can end game flag
        meta[6] = 1.0 if game.can_end_game() else 0.0

        # Turn number (normalize by expected max ~200 turns)
        turn_number = getattr(game, 'turn_number', 0)
        meta[7] = min(turn_number / 200.0, 1.0)

        # Tiles remaining (normalize by 108)
        tiles_remaining = len(game.tile_bag) if hasattr(game, 'tile_bag') else 0
        meta[8] = tiles_remaining / self.BOARD_SIZE

        # Number of active players (normalize by 6)
        meta[9] = num_players / self.MAX_PLAYERS

        return meta

    def tile_to_index(self, tile) -> int:
        """Convert a Tile object to a board index (0-107).

        The board is indexed row-major: index = (column - 1) * 9 + row_index

        Args:
            tile: A Tile object with column (1-12) and row (A-I)

        Returns:
            An integer index from 0 to 107
        """
        col = tile.column  # 1-12
        row = tile.row     # A-I
        row_idx = self.BOARD_ROWS.index(row)  # 0-8
        return (col - 1) * 9 + row_idx

    def tile_to_index_from_string(self, tile_str: str) -> int:
        """Convert a tile string to a board index.

        Args:
            tile_str: A string like "1A" or "12I"

        Returns:
            An integer index from 0 to 107, or None if invalid
        """
        try:
            tile_str = tile_str.strip().upper()
            row = tile_str[-1]
            col = int(tile_str[:-1])

            if col < 1 or col > 12:
                return None
            if row not in self.BOARD_ROWS:
                return None

            row_idx = self.BOARD_ROWS.index(row)
            return (col - 1) * 9 + row_idx
        except (ValueError, IndexError):
            return None

    def index_to_tile_string(self, idx: int) -> str:
        """Convert a board index to a tile string.

        Args:
            idx: An integer index from 0 to 107

        Returns:
            A string like "1A" or "12I"
        """
        col = (idx // 9) + 1  # 1-12
        row_idx = idx % 9     # 0-8
        row = self.BOARD_ROWS[row_idx]
        return f"{col}{row}"

    def get_observation_shape(self) -> Tuple[int]:
        """Get the shape of the observation vector.

        Returns:
            A tuple containing the observation dimension
        """
        # Board: 108
        # Chains: 7 * 5 = 35
        # Players: 6 * 8 = 48
        # Hand: 6
        # Phase: 7
        # Meta: 10
        # Total: 214 (base features)
        total_dim = (
            self.BOARD_SIZE +           # 108
            self.NUM_CHAINS * 5 +       # 35
            self.MAX_PLAYERS * 8 +      # 48
            self.MAX_HAND_SIZE +        # 6
            self.NUM_PHASES +           # 7
            10                          # meta
        )
        return (total_dim,)

    def get_feature_names(self) -> list:
        """Get descriptive names for each feature in the observation.

        Returns:
            A list of feature names
        """
        names = []

        # Board features
        for col in range(1, self.BOARD_COLUMNS + 1):
            for row in self.BOARD_ROWS:
                names.append(f"board_{col}{row}")

        # Chain features
        for chain in self.CHAIN_NAMES:
            names.append(f"{chain}_size")
            names.append(f"{chain}_price")
            names.append(f"{chain}_available")
            names.append(f"{chain}_active")
            names.append(f"{chain}_safe")

        # Player features
        for p in range(self.MAX_PLAYERS):
            names.append(f"player{p}_money")
            for chain in self.CHAIN_NAMES:
                names.append(f"player{p}_{chain}_stocks")

        # Hand features
        for i in range(self.MAX_HAND_SIZE):
            names.append(f"hand_tile_{i}")

        # Phase features
        for phase in self.PHASES:
            names.append(f"phase_{phase}")

        # Meta features
        for i in range(6):
            names.append(f"current_player_is_{i}")
        names.append("can_end_game")
        names.append("turn_number")
        names.append("tiles_remaining")
        names.append("num_players")

        return names
