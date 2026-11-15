"""Board state and tile logic for Buyout."""

from enum import Enum
from typing import Optional
from dataclasses import InitVar, dataclass

from game.ruleset import BoardSpec, Ruleset, default_ruleset, resolve


class hybridmethod:
    """Method callable on the class (default ruleset) or an instance (its own)."""

    def __init__(self, func):
        self.func = func
        self.__doc__ = func.__doc__

    def __get__(self, obj, cls):
        target = obj if obj is not None else cls

        def bound(*args, **kwargs):
            return self.func(target, *args, **kwargs)

        bound.__doc__ = self.func.__doc__
        return bound


class TileState(Enum):
    """State of a tile on the board."""

    EMPTY = "empty"
    PLAYED = "played"  # Played but not part of a chain
    IN_CHAIN = "in_chain"


@dataclass
class Tile:
    """Represents a single tile."""

    column: int  # 1..board columns
    row: str  # one row letter of the board
    # Board the tile must fit on (default: the default ruleset's board).
    bounds: InitVar[Optional[BoardSpec]] = None

    def __post_init__(self, bounds: Optional[BoardSpec] = None):
        spec = bounds if bounds is not None else default_ruleset().board
        if not (1 <= self.column <= spec.columns):
            raise ValueError(f"Column must be 1-{spec.columns}, got {self.column}")
        letters = spec.row_letters
        if self.row not in letters:
            raise ValueError(f"Row must be A-{letters[-1]}, got {self.row}")

    @property
    def coords(self) -> tuple[int, str]:
        return (self.column, self.row)

    def __hash__(self):
        return hash(self.coords)

    def __eq__(self, other):
        if isinstance(other, Tile):
            return self.coords == other.coords
        return False

    def __str__(self):
        return f"{self.column}{self.row}"

    def __repr__(self):
        return f"Tile({self.column}, '{self.row}')"

    @classmethod
    def from_string(cls, s: str, bounds: Optional[BoardSpec] = None) -> "Tile":
        """Parse tile from string like '1A' (bounds: the board, default: the default ruleset)."""
        s = s.strip().upper()
        row = s[-1]
        column = int(s[:-1])
        return cls(column, row, bounds)


@dataclass
class BoardCell:
    """Represents a cell on the board."""

    state: TileState = TileState.EMPTY
    chain: Optional[str] = None  # Name of hotel chain if IN_CHAIN


class Board:
    """The game board; its size comes from the ruleset.

    ``Board.COLUMNS`` / ``Board.ROWS`` are aliases of the default ruleset's
    board kept for older callers; an instance uses ``columns`` / ``row_letters``.
    """

    ruleset: Ruleset = default_ruleset()
    COLUMNS = default_ruleset().board.columns
    ROWS = default_ruleset().board.row_letters

    def __init__(self, ruleset: Optional[Ruleset] = None):
        self.ruleset = resolve(ruleset)
        self._grid: dict[tuple[int, str], BoardCell] = {}
        self._initialize_grid()

    @property
    def spec(self) -> BoardSpec:
        return self.ruleset.board

    @property
    def columns(self) -> int:
        return self.ruleset.board.columns

    @property
    def row_letters(self) -> str:
        return self.ruleset.board.row_letters

    def tile(self, column: int, row: str) -> Tile:
        """A Tile validated against this board."""
        return Tile(column, row, self.ruleset.board)

    def tile_from_string(self, s: str) -> Tile:
        return Tile.from_string(s, self.ruleset.board)

    def _initialize_grid(self):
        """Create the empty grid."""
        for col in range(1, self.columns + 1):
            for row in self.row_letters:
                self._grid[(col, row)] = BoardCell()

    def get_cell(self, column: int, row: str) -> BoardCell:
        """Get the cell at given coordinates."""
        return self._grid[(column, row)]

    def place_tile(self, tile: Tile) -> bool:
        """Place a tile on the board. Returns True if successful."""
        cell = self._grid[tile.coords]
        if cell.state != TileState.EMPTY:
            return False
        cell.state = TileState.PLAYED
        return True

    def set_chain(self, tile: Tile, chain_name: str):
        """Assign a tile to a hotel chain."""
        cell = self._grid[tile.coords]
        cell.state = TileState.IN_CHAIN
        cell.chain = chain_name

    def get_adjacent_tiles(self, tile: Tile) -> list[Tile]:
        """Get all adjacent tiles (up, down, left, right)."""
        col, row = tile.coords
        rows = self.row_letters
        row_idx = rows.index(row)
        adjacent = []

        # Up
        if row_idx > 0:
            adjacent.append(self.tile(col, rows[row_idx - 1]))
        # Down
        if row_idx < len(rows) - 1:
            adjacent.append(self.tile(col, rows[row_idx + 1]))
        # Left
        if col > 1:
            adjacent.append(self.tile(col - 1, row))
        # Right
        if col < self.columns:
            adjacent.append(self.tile(col + 1, row))

        return adjacent

    def get_adjacent_played_tiles(self, tile: Tile) -> list[Tile]:
        """Get adjacent tiles that have been played (PLAYED or IN_CHAIN)."""
        adjacent = self.get_adjacent_tiles(tile)
        return [t for t in adjacent if self._grid[t.coords].state != TileState.EMPTY]

    def get_adjacent_chains(self, tile: Tile) -> list[str]:
        """Get unique chain names adjacent to a tile (sorted for determinism)."""
        adjacent = self.get_adjacent_tiles(tile)
        chains = set()
        for t in adjacent:
            cell = self._grid[t.coords]
            if cell.chain:
                chains.add(cell.chain)
        return sorted(chains)

    def get_chain_size(self, chain_name: str) -> int:
        """Get the number of tiles in a chain."""
        return sum(1 for cell in self._grid.values() if cell.chain == chain_name)

    def get_connected_tiles(self, start_tile: Tile) -> set[Tile]:
        """Get all tiles connected to start_tile (flood fill of played tiles)."""
        if self._grid[start_tile.coords].state == TileState.EMPTY:
            return set()

        visited = set()
        to_visit = [start_tile]

        while to_visit:
            current = to_visit.pop()
            if current in visited:
                continue
            visited.add(current)

            for adj in self.get_adjacent_tiles(current):
                if (
                    adj not in visited
                    and self._grid[adj.coords].state != TileState.EMPTY
                ):
                    to_visit.append(adj)

        return visited

    def merge_chains(self, surviving_chain: str, defunct_chain: str):
        """Merge defunct chain into surviving chain."""
        for (col, row), cell in self._grid.items():
            if cell.chain == defunct_chain:
                cell.chain = surviving_chain

    def is_tile_played(self, tile: Tile) -> bool:
        """Check if a tile has been played."""
        return self._grid[tile.coords].state != TileState.EMPTY

    def get_state(self) -> dict:
        """Get serializable board state."""
        cells = {}
        for (col, row), cell in self._grid.items():
            if cell.state != TileState.EMPTY:
                cells[f"{col}{row}"] = {"state": cell.state.value, "chain": cell.chain}
        return {"cells": cells}

    @hybridmethod
    def all_tiles(target) -> list[Tile]:
        """Every tile of the board (``Board.all_tiles()``: the default board)."""
        spec = target.ruleset.board
        return [
            Tile(col, row, spec)
            for col in range(1, spec.columns + 1)
            for row in spec.row_letters
        ]
