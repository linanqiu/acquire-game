"""Tests for board.py - Board state and tile logic."""

import pytest
from game.board import Board, Tile, TileState, BoardCell


class TestTile:
    """Tests for Tile class."""

    def test_create_valid_tile(self):
        tile = Tile(1, "A")
        assert tile.column == 1
        assert tile.row == "A"

    def test_create_tile_max_coords(self):
        tile = Tile(12, "I")
        assert tile.column == 12
        assert tile.row == "I"

    def test_invalid_column_low(self):
        with pytest.raises(ValueError):
            Tile(0, "A")

    def test_invalid_column_high(self):
        with pytest.raises(ValueError):
            Tile(13, "A")

    def test_invalid_row(self):
        with pytest.raises(ValueError):
            Tile(1, "J")

    def test_tile_coords(self):
        tile = Tile(5, "C")
        assert tile.coords == (5, "C")

    def test_tile_string(self):
        tile = Tile(12, "I")
        assert str(tile) == "12I"

    def test_tile_from_string(self):
        tile = Tile.from_string("1A")
        assert tile.column == 1
        assert tile.row == "A"

    def test_tile_from_string_double_digit(self):
        tile = Tile.from_string("12I")
        assert tile.column == 12
        assert tile.row == "I"

    def test_tile_from_string_lowercase(self):
        tile = Tile.from_string("5c")
        assert tile.row == "C"

    def test_tile_equality(self):
        t1 = Tile(1, "A")
        t2 = Tile(1, "A")
        assert t1 == t2

    def test_tile_hash(self):
        t1 = Tile(1, "A")
        t2 = Tile(1, "A")
        assert hash(t1) == hash(t2)
        # Can be used in sets
        tile_set = {t1, t2}
        assert len(tile_set) == 1


class TestBoard:
    """Tests for Board class."""

    def test_board_creation(self):
        board = Board()
        # Should have 12*9 = 108 cells
        assert len(board._grid) == 108

    def test_all_cells_empty_initially(self):
        board = Board()
        for cell in board._grid.values():
            assert cell.state == TileState.EMPTY
            assert cell.chain is None

    def test_place_tile_on_empty(self):
        board = Board()
        tile = Tile(1, "A")
        result = board.place_tile(tile)
        assert result is True
        assert board.get_cell(1, "A").state == TileState.PLAYED

    def test_place_tile_on_occupied(self):
        board = Board()
        tile = Tile(1, "A")
        board.place_tile(tile)
        result = board.place_tile(tile)
        assert result is False

    def test_set_chain(self):
        board = Board()
        tile = Tile(1, "A")
        board.place_tile(tile)
        board.set_chain(tile, "Luxor")
        cell = board.get_cell(1, "A")
        assert cell.state == TileState.IN_CHAIN
        assert cell.chain == "Luxor"

    def test_get_adjacent_tiles_center(self):
        board = Board()
        tile = Tile(5, "E")
        adjacent = board.get_adjacent_tiles(tile)
        assert len(adjacent) == 4
        coords = {t.coords for t in adjacent}
        assert (5, "D") in coords  # Up
        assert (5, "F") in coords  # Down
        assert (4, "E") in coords  # Left
        assert (6, "E") in coords  # Right

    def test_get_adjacent_tiles_corner(self):
        board = Board()
        tile = Tile(1, "A")
        adjacent = board.get_adjacent_tiles(tile)
        assert len(adjacent) == 2
        coords = {t.coords for t in adjacent}
        assert (1, "B") in coords  # Down
        assert (2, "A") in coords  # Right

    def test_get_adjacent_tiles_edge(self):
        board = Board()
        tile = Tile(12, "E")
        adjacent = board.get_adjacent_tiles(tile)
        assert len(adjacent) == 3

    def test_get_adjacent_played_tiles(self):
        board = Board()
        board.place_tile(Tile(1, "A"))
        board.place_tile(Tile(2, "A"))
        adjacent = board.get_adjacent_played_tiles(Tile(1, "A"))
        assert len(adjacent) == 1
        assert adjacent[0].coords == (2, "A")

    def test_get_adjacent_chains(self):
        board = Board()
        tile1 = Tile(1, "A")
        tile2 = Tile(2, "A")
        board.place_tile(tile1)
        board.place_tile(tile2)
        board.set_chain(tile1, "Luxor")
        board.set_chain(tile2, "Luxor")

        # Tile adjacent to the chain
        tile3 = Tile(3, "A")
        chains = board.get_adjacent_chains(tile3)
        assert chains == {"Luxor"}

    def test_get_adjacent_chains_multiple(self):
        board = Board()
        # Create two separate chains
        tile1 = Tile(1, "A")
        tile2 = Tile(3, "A")
        board.place_tile(tile1)
        board.place_tile(tile2)
        board.set_chain(tile1, "Luxor")
        board.set_chain(tile2, "Tower")

        # Tile between them
        chains = board.get_adjacent_chains(Tile(2, "A"))
        assert chains == {"Luxor", "Tower"}

    def test_get_chain_tiles(self):
        board = Board()
        tiles = [Tile(1, "A"), Tile(2, "A"), Tile(3, "A")]
        for t in tiles:
            board.place_tile(t)
            board.set_chain(t, "Luxor")

        chain_tiles = board.get_chain_tiles("Luxor")
        assert len(chain_tiles) == 3

    def test_get_chain_size(self):
        board = Board()
        for i in range(1, 6):
            tile = Tile(i, "A")
            board.place_tile(tile)
            board.set_chain(tile, "Tower")

        assert board.get_chain_size("Tower") == 5

    def test_get_connected_tiles(self):
        board = Board()
        # Create L-shaped group
        board.place_tile(Tile(1, "A"))
        board.place_tile(Tile(2, "A"))
        board.place_tile(Tile(2, "B"))

        connected = board.get_connected_tiles(Tile(1, "A"))
        assert len(connected) == 3

    def test_get_connected_tiles_separate_groups(self):
        board = Board()
        # Two separate tiles
        board.place_tile(Tile(1, "A"))
        board.place_tile(Tile(5, "E"))

        connected = board.get_connected_tiles(Tile(1, "A"))
        assert len(connected) == 1

    def test_merge_chains(self):
        board = Board()
        # Create two chains
        t1, t2 = Tile(1, "A"), Tile(2, "A")
        t3, t4 = Tile(4, "A"), Tile(5, "A")

        for t in [t1, t2]:
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        for t in [t3, t4]:
            board.place_tile(t)
            board.set_chain(t, "Tower")

        board.merge_chains("Luxor", "Tower")

        assert board.get_chain_size("Luxor") == 4
        assert board.get_chain_size("Tower") == 0

    def test_get_all_chains(self):
        board = Board()
        t1 = Tile(1, "A")
        t2 = Tile(5, "E")
        board.place_tile(t1)
        board.place_tile(t2)
        board.set_chain(t1, "Luxor")
        board.set_chain(t2, "Tower")

        chains = board.get_all_chains()
        assert chains == {"Luxor", "Tower"}

    def test_is_tile_played(self):
        board = Board()
        tile = Tile(1, "A")
        assert board.is_tile_played(tile) is False
        board.place_tile(tile)
        assert board.is_tile_played(tile) is True

    def test_get_state(self):
        board = Board()
        tile = Tile(1, "A")
        board.place_tile(tile)
        board.set_chain(tile, "Luxor")

        state = board.get_state()
        assert "1A" in state["cells"]
        assert state["cells"]["1A"]["chain"] == "Luxor"

    def test_all_tiles(self):
        tiles = Board.all_tiles()
        assert len(tiles) == 108


class TestBoardCell:
    """Tests for BoardCell class."""

    def test_default_state(self):
        cell = BoardCell()
        assert cell.state == TileState.EMPTY
        assert cell.chain is None

    def test_with_chain(self):
        cell = BoardCell(state=TileState.IN_CHAIN, chain="Luxor")
        assert cell.state == TileState.IN_CHAIN
        assert cell.chain == "Luxor"
