"""Board state and tile logic for Acquire."""

from enum import Enum
from typing import Optional
from dataclasses import dataclass, field


class TileState(Enum):
    """State of a tile on the board."""
    EMPTY = "empty"
    PLAYED = "played"  # Played but not part of a chain
    IN_CHAIN = "in_chain"


@dataclass
class Tile:
    """Represents a single tile."""
    column: int  # 1-12
    row: str     # A-I

    def __post_init__(self):
        if not (1 <= self.column <= 12):
            raise ValueError(f"Column must be 1-12, got {self.column}")
        if self.row not in "ABCDEFGHI":
            raise ValueError(f"Row must be A-I, got {self.row}")

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
    def from_string(cls, s: str) -> "Tile":
        """Parse tile from string like '1A' or '12I'."""
        s = s.strip().upper()
        row = s[-1]
        column = int(s[:-1])
        return cls(column, row)


@dataclass
class BoardCell:
    """Represents a cell on the board."""
    state: TileState = TileState.EMPTY
    chain: Optional[str] = None  # Name of hotel chain if IN_CHAIN


class Board:
    """12x9 game board for Acquire."""

    COLUMNS = 12
    ROWS = "ABCDEFGHI"

    def __init__(self):
        self._grid: dict[tuple[int, str], BoardCell] = {}
        self._initialize_grid()

    def _initialize_grid(self):
        """Create empty 12x9 grid."""
        for col in range(1, self.COLUMNS + 1):
            for row in self.ROWS:
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
        row_idx = self.ROWS.index(row)
        adjacent = []

        # Up
        if row_idx > 0:
            adjacent.append(Tile(col, self.ROWS[row_idx - 1]))
        # Down
        if row_idx < len(self.ROWS) - 1:
            adjacent.append(Tile(col, self.ROWS[row_idx + 1]))
        # Left
        if col > 1:
            adjacent.append(Tile(col - 1, row))
        # Right
        if col < self.COLUMNS:
            adjacent.append(Tile(col + 1, row))

        return adjacent

    def get_adjacent_played_tiles(self, tile: Tile) -> list[Tile]:
        """Get adjacent tiles that have been played (PLAYED or IN_CHAIN)."""
        adjacent = self.get_adjacent_tiles(tile)
        return [t for t in adjacent if self._grid[t.coords].state != TileState.EMPTY]

    def get_adjacent_chains(self, tile: Tile) -> set[str]:
        """Get unique chain names adjacent to a tile."""
        adjacent = self.get_adjacent_tiles(tile)
        chains = set()
        for t in adjacent:
            cell = self._grid[t.coords]
            if cell.chain:
                chains.add(cell.chain)
        return chains

    def get_chain_tiles(self, chain_name: str) -> list[Tile]:
        """Get all tiles belonging to a chain."""
        tiles = []
        for (col, row), cell in self._grid.items():
            if cell.chain == chain_name:
                tiles.append(Tile(col, row))
        return tiles

    def get_chain_size(self, chain_name: str) -> int:
        """Get the number of tiles in a chain."""
        return len(self.get_chain_tiles(chain_name))

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
                if adj not in visited and self._grid[adj.coords].state != TileState.EMPTY:
                    to_visit.append(adj)

        return visited

    def merge_chains(self, surviving_chain: str, defunct_chain: str):
        """Merge defunct chain into surviving chain."""
        for (col, row), cell in self._grid.items():
            if cell.chain == defunct_chain:
                cell.chain = surviving_chain

    def get_all_chains(self) -> set[str]:
        """Get all active chain names on the board."""
        chains = set()
        for cell in self._grid.values():
            if cell.chain:
                chains.add(cell.chain)
        return chains

    def is_tile_played(self, tile: Tile) -> bool:
        """Check if a tile has been played."""
        return self._grid[tile.coords].state != TileState.EMPTY

    def get_state(self) -> dict:
        """Get serializable board state."""
        cells = {}
        for (col, row), cell in self._grid.items():
            if cell.state != TileState.EMPTY:
                cells[f"{col}{row}"] = {
                    "state": cell.state.value,
                    "chain": cell.chain
                }
        return {"cells": cells}

    @classmethod
    def all_tiles(cls) -> list[Tile]:
        """Generate all 108 tiles."""
        tiles = []
        for col in range(1, cls.COLUMNS + 1):
            for row in cls.ROWS:
                tiles.append(Tile(col, row))
        return tiles
