"""Comprehensive tests for Acquire game rules."""

import pytest
import sys
import os

# Add the backend directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from game.board import Board, Tile
from game.hotel import Hotel
from game.player import Player
from game.rules import Rules, PlacementResult


class TestCanPlaceTile:
    """Tests for Rules.can_place_tile()"""

    def test_can_place_on_empty_cell(self):
        """Should allow placing tile on empty cell."""
        board = Board()
        hotel = Hotel()
        tile = Tile(1, 'A')

        assert Rules.can_place_tile(board, tile, hotel) is True

    def test_cannot_place_on_occupied_cell(self):
        """Should not allow placing tile on already occupied cell."""
        board = Board()
        hotel = Hotel()
        tile = Tile(1, 'A')

        board.place_tile(tile)

        assert Rules.can_place_tile(board, tile, hotel) is False

    def test_cannot_place_on_cell_in_chain(self):
        """Should not allow placing tile on cell that's part of a chain."""
        board = Board()
        hotel = Hotel()
        tile = Tile(1, 'A')

        board.place_tile(tile)
        board.set_chain(tile, "Luxor")

        assert Rules.can_place_tile(board, tile, hotel) is False

    def test_can_place_tile_adjacent_to_played_tile(self):
        """Should allow placing tile adjacent to a played tile."""
        board = Board()
        hotel = Hotel()

        board.place_tile(Tile(1, 'A'))
        tile = Tile(2, 'A')

        assert Rules.can_place_tile(board, tile, hotel) is True

    def test_cannot_merge_two_safe_chains(self):
        """Should not allow tile that merges two safe chains."""
        board = Board()
        hotel = Hotel()

        # Create two safe chains (11+ tiles each)
        # Chain 1: Luxor at column 1, rows A-I plus 2A, 3A (11 tiles)
        for row in "ABCDEFGHI":
            t = Tile(1, row)
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        for col in [2, 3]:
            t = Tile(col, 'A')
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        hotel.activate_chain("Luxor")

        # Chain 2: Tower at column 5, rows A-I plus 6A, 7A (11 tiles)
        for row in "ABCDEFGHI":
            t = Tile(5, row)
            board.place_tile(t)
            board.set_chain(t, "Tower")
        for col in [6, 7]:
            t = Tile(col, 'A')
            board.place_tile(t)
            board.set_chain(t, "Tower")
        hotel.activate_chain("Tower")

        # Try to place tile that would merge them (4A connects 3A-Luxor and 5A-Tower)
        merge_tile = Tile(4, 'A')

        assert Rules.can_place_tile(board, merge_tile, hotel) is False

    def test_can_merge_one_safe_one_unsafe_chain(self):
        """Should allow merging one safe chain with one unsafe chain."""
        board = Board()
        hotel = Hotel()

        # Create one safe chain (11 tiles)
        for row in "ABCDEFGHI":
            t = Tile(1, row)
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        for col in [2, 3]:
            t = Tile(col, 'A')
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        hotel.activate_chain("Luxor")

        # Create one unsafe chain (2 tiles)
        t1 = Tile(5, 'A')
        t2 = Tile(6, 'A')
        board.place_tile(t1)
        board.place_tile(t2)
        board.set_chain(t1, "Tower")
        board.set_chain(t2, "Tower")
        hotel.activate_chain("Tower")

        # Place tile to merge (4A connects 3A-Luxor and 5A-Tower)
        merge_tile = Tile(4, 'A')

        assert Rules.can_place_tile(board, merge_tile, hotel) is True

    def test_cannot_create_8th_chain(self):
        """Should not allow creating 8th chain when 7 exist."""
        board = Board()
        hotel = Hotel()

        # Activate all 7 chains with minimal tiles
        chains = ["Luxor", "Tower", "American", "Worldwide", "Festival", "Imperial", "Continental"]
        for i, chain_name in enumerate(chains):
            col = i + 1
            t1 = Tile(col, 'A')
            t2 = Tile(col, 'B')
            board.place_tile(t1)
            board.place_tile(t2)
            board.set_chain(t1, chain_name)
            board.set_chain(t2, chain_name)
            hotel.activate_chain(chain_name)

        # Place an isolated tile
        isolated = Tile(10, 'E')
        board.place_tile(isolated)

        # Try to place adjacent tile that would create new chain
        new_chain_tile = Tile(11, 'E')

        assert Rules.can_place_tile(board, new_chain_tile, hotel) is False

    def test_can_place_isolated_tile_with_7_chains(self):
        """Should allow placing isolated tile when 7 chains exist."""
        board = Board()
        hotel = Hotel()

        # Activate all 7 chains
        chains = ["Luxor", "Tower", "American", "Worldwide", "Festival", "Imperial", "Continental"]
        for i, chain_name in enumerate(chains):
            col = i + 1
            t1 = Tile(col, 'A')
            t2 = Tile(col, 'B')
            board.place_tile(t1)
            board.place_tile(t2)
            board.set_chain(t1, chain_name)
            board.set_chain(t2, chain_name)
            hotel.activate_chain(chain_name)

        # Place completely isolated tile (no adjacent played tiles)
        isolated_tile = Tile(12, 'I')

        assert Rules.can_place_tile(board, isolated_tile, hotel) is True

    def test_can_expand_chain_with_7_chains(self):
        """Should allow expanding existing chain when 7 chains exist."""
        board = Board()
        hotel = Hotel()

        # Activate all 7 chains
        chains = ["Luxor", "Tower", "American", "Worldwide", "Festival", "Imperial", "Continental"]
        for i, chain_name in enumerate(chains):
            col = i + 1
            t1 = Tile(col, 'A')
            t2 = Tile(col, 'B')
            board.place_tile(t1)
            board.place_tile(t2)
            board.set_chain(t1, chain_name)
            board.set_chain(t2, chain_name)
            hotel.activate_chain(chain_name)

        # Expand Luxor chain
        expand_tile = Tile(1, 'C')

        assert Rules.can_place_tile(board, expand_tile, hotel) is True


class TestGetPlacementResult:
    """Tests for Rules.get_placement_result()"""

    def test_nothing_isolated_tile(self):
        """Isolated tile returns 'nothing'."""
        board = Board()
        tile = Tile(5, 'E')

        result = Rules.get_placement_result(board, tile)

        assert result.result_type == PlacementResult.NOTHING
        assert result.chain is None
        assert result.chains == []

    def test_found_new_chain(self):
        """Tile adjacent to played tile (no chain) returns 'found'."""
        board = Board()
        board.place_tile(Tile(5, 'E'))

        tile = Tile(5, 'F')
        result = Rules.get_placement_result(board, tile)

        assert result.result_type == PlacementResult.FOUND

    def test_found_multiple_adjacent_played_tiles(self):
        """Tile adjacent to multiple played tiles (no chains) returns 'found'."""
        board = Board()
        board.place_tile(Tile(5, 'D'))
        board.place_tile(Tile(4, 'E'))

        tile = Tile(5, 'E')
        result = Rules.get_placement_result(board, tile)

        assert result.result_type == PlacementResult.FOUND

    def test_expand_existing_chain(self):
        """Tile adjacent to single chain returns 'expand'."""
        board = Board()
        t1 = Tile(5, 'E')
        t2 = Tile(5, 'F')
        board.place_tile(t1)
        board.place_tile(t2)
        board.set_chain(t1, "Luxor")
        board.set_chain(t2, "Luxor")

        tile = Tile(5, 'G')
        result = Rules.get_placement_result(board, tile)

        assert result.result_type == PlacementResult.EXPAND
        assert result.chain == "Luxor"

    def test_expand_with_adjacent_played_tile(self):
        """Tile adjacent to chain and played tile expands the chain."""
        board = Board()
        # Create chain
        t1 = Tile(5, 'E')
        t2 = Tile(5, 'F')
        board.place_tile(t1)
        board.place_tile(t2)
        board.set_chain(t1, "Luxor")
        board.set_chain(t2, "Luxor")

        # Place isolated tile
        board.place_tile(Tile(5, 'H'))

        # Tile between chain and played tile
        tile = Tile(5, 'G')
        result = Rules.get_placement_result(board, tile)

        assert result.result_type == PlacementResult.EXPAND
        assert result.chain == "Luxor"

    def test_merge_two_chains(self):
        """Tile adjacent to two chains returns 'merge'."""
        board = Board()

        # Chain 1
        t1 = Tile(3, 'E')
        t2 = Tile(4, 'E')
        board.place_tile(t1)
        board.place_tile(t2)
        board.set_chain(t1, "Luxor")
        board.set_chain(t2, "Luxor")

        # Chain 2
        t3 = Tile(6, 'E')
        t4 = Tile(7, 'E')
        board.place_tile(t3)
        board.place_tile(t4)
        board.set_chain(t3, "Tower")
        board.set_chain(t4, "Tower")

        # Merge tile
        tile = Tile(5, 'E')
        result = Rules.get_placement_result(board, tile)

        assert result.result_type == PlacementResult.MERGE
        assert set(result.chains) == {"Luxor", "Tower"}

    def test_merge_three_chains(self):
        """Tile adjacent to three chains returns 'merge' with all three."""
        board = Board()

        # Chain 1 (left)
        t1 = Tile(4, 'E')
        board.place_tile(t1)
        board.set_chain(t1, "Luxor")

        # Chain 2 (right)
        t2 = Tile(6, 'E')
        board.place_tile(t2)
        board.set_chain(t2, "Tower")

        # Chain 3 (above)
        t3 = Tile(5, 'D')
        board.place_tile(t3)
        board.set_chain(t3, "American")

        # Merge tile (5E)
        tile = Tile(5, 'E')
        result = Rules.get_placement_result(board, tile)

        assert result.result_type == PlacementResult.MERGE
        assert set(result.chains) == {"Luxor", "Tower", "American"}


class TestGetMergerSurvivor:
    """Tests for Rules.get_merger_survivor()"""

    def test_larger_chain_survives(self):
        """Larger chain should survive merger."""
        board = Board()

        # Luxor: 5 tiles
        for i in range(5):
            t = Tile(1, "ABCDE"[i])
            board.place_tile(t)
            board.set_chain(t, "Luxor")

        # Tower: 3 tiles
        for i in range(3):
            t = Tile(3, "ABC"[i])
            board.place_tile(t)
            board.set_chain(t, "Tower")

        result = Rules.get_merger_survivor(board, ["Luxor", "Tower"])

        assert result == "Luxor"

    def test_tie_returns_list(self):
        """Tied chains should return list for player choice."""
        board = Board()

        # Luxor: 3 tiles
        for i in range(3):
            t = Tile(1, "ABC"[i])
            board.place_tile(t)
            board.set_chain(t, "Luxor")

        # Tower: 3 tiles
        for i in range(3):
            t = Tile(3, "ABC"[i])
            board.place_tile(t)
            board.set_chain(t, "Tower")

        result = Rules.get_merger_survivor(board, ["Luxor", "Tower"])

        assert isinstance(result, list)
        assert set(result) == {"Luxor", "Tower"}

    def test_three_way_tie(self):
        """Three-way tie returns all three."""
        board = Board()

        chains = ["Luxor", "Tower", "American"]
        for idx, chain in enumerate(chains):
            for i in range(2):
                t = Tile(idx * 2 + 1, "AB"[i])
                board.place_tile(t)
                board.set_chain(t, chain)

        result = Rules.get_merger_survivor(board, chains)

        assert isinstance(result, list)
        assert set(result) == {"Luxor", "Tower", "American"}

    def test_three_chains_one_largest(self):
        """With three chains, largest survives."""
        board = Board()

        # Luxor: 5 tiles
        for i in range(5):
            t = Tile(1, "ABCDE"[i])
            board.place_tile(t)
            board.set_chain(t, "Luxor")

        # Tower: 3 tiles
        for i in range(3):
            t = Tile(3, "ABC"[i])
            board.place_tile(t)
            board.set_chain(t, "Tower")

        # American: 2 tiles
        for i in range(2):
            t = Tile(5, "AB"[i])
            board.place_tile(t)
            board.set_chain(t, "American")

        result = Rules.get_merger_survivor(board, ["Luxor", "Tower", "American"])

        assert result == "Luxor"

    def test_empty_list_returns_empty(self):
        """Empty chain list returns empty list."""
        board = Board()
        result = Rules.get_merger_survivor(board, [])
        assert result == []


class TestCalculateBonuses:
    """Tests for Rules.calculate_bonuses()"""

    def test_single_stockholder_gets_both_bonuses(self):
        """Single stockholder gets both majority and minority bonuses."""
        hotel = Hotel()
        player1 = Player("p1", "Alice")
        player1._stocks["Luxor"] = 5

        bonuses = Rules.calculate_bonuses([player1], "Luxor", 5, hotel)

        # Size 5, cheap tier: price = 500, majority = 5000, minority = 2500
        assert bonuses["p1"]["majority"] == 5000
        assert bonuses["p1"]["minority"] == 2500

    def test_clear_majority_minority(self):
        """Clear majority and minority holders get respective bonuses."""
        hotel = Hotel()
        player1 = Player("p1", "Alice")
        player2 = Player("p2", "Bob")
        player1._stocks["Luxor"] = 8
        player2._stocks["Luxor"] = 3

        bonuses = Rules.calculate_bonuses([player1, player2], "Luxor", 5, hotel)

        assert bonuses["p1"]["majority"] == 5000
        assert bonuses["p1"]["minority"] == 0
        assert bonuses["p2"]["majority"] == 0
        assert bonuses["p2"]["minority"] == 2500

    def test_tied_majority_split_both_bonuses(self):
        """Tied majority holders split majority + minority bonus."""
        hotel = Hotel()
        player1 = Player("p1", "Alice")
        player2 = Player("p2", "Bob")
        player1._stocks["Luxor"] = 5
        player2._stocks["Luxor"] = 5

        bonuses = Rules.calculate_bonuses([player1, player2], "Luxor", 5, hotel)

        # Total bonus = 5000 + 2500 = 7500, split = 3750, rounded up = 3800
        assert bonuses["p1"]["majority"] == 3800
        assert bonuses["p1"]["minority"] == 0
        assert bonuses["p2"]["majority"] == 3800
        assert bonuses["p2"]["minority"] == 0

    def test_three_way_majority_tie(self):
        """Three-way majority tie splits all bonuses three ways."""
        hotel = Hotel()
        player1 = Player("p1", "Alice")
        player2 = Player("p2", "Bob")
        player3 = Player("p3", "Carol")
        player1._stocks["Luxor"] = 5
        player2._stocks["Luxor"] = 5
        player3._stocks["Luxor"] = 5

        bonuses = Rules.calculate_bonuses([player1, player2, player3], "Luxor", 5, hotel)

        # Total = 7500 / 3 = 2500 (exact)
        assert bonuses["p1"]["majority"] == 2500
        assert bonuses["p2"]["majority"] == 2500
        assert bonuses["p3"]["majority"] == 2500

    def test_tied_minority_split(self):
        """Tied minority holders split minority bonus."""
        hotel = Hotel()
        player1 = Player("p1", "Alice")
        player2 = Player("p2", "Bob")
        player3 = Player("p3", "Carol")
        player1._stocks["Luxor"] = 8
        player2._stocks["Luxor"] = 3
        player3._stocks["Luxor"] = 3

        bonuses = Rules.calculate_bonuses([player1, player2, player3], "Luxor", 5, hotel)

        # Majority: 5000 to p1
        # Minority: 2500 / 2 = 1250, rounded up = 1300
        assert bonuses["p1"]["majority"] == 5000
        assert bonuses["p2"]["minority"] == 1300
        assert bonuses["p3"]["minority"] == 1300

    def test_no_stockholders_returns_empty(self):
        """No stockholders returns empty dict."""
        hotel = Hotel()
        player1 = Player("p1", "Alice")
        # player1 has no Luxor stock

        bonuses = Rules.calculate_bonuses([player1], "Luxor", 5, hotel)

        assert bonuses == {}

    def test_bonus_rounding(self):
        """Verify bonuses are rounded up to nearest $100."""
        hotel = Hotel()
        player1 = Player("p1", "Alice")
        player2 = Player("p2", "Bob")
        player3 = Player("p3", "Carol")
        player4 = Player("p4", "Dave")
        player1._stocks["Luxor"] = 5
        player2._stocks["Luxor"] = 5
        player3._stocks["Luxor"] = 5
        player4._stocks["Luxor"] = 5

        bonuses = Rules.calculate_bonuses(
            [player1, player2, player3, player4], "Luxor", 5, hotel
        )

        # Total = 7500 / 4 = 1875, rounded up = 1900
        for pid in ["p1", "p2", "p3", "p4"]:
            assert bonuses[pid]["majority"] == 1900

    def test_expensive_chain_bonuses(self):
        """Test bonus calculation for expensive chain."""
        hotel = Hotel()
        player1 = Player("p1", "Alice")
        player2 = Player("p2", "Bob")
        player1._stocks["Imperial"] = 10
        player2._stocks["Imperial"] = 5

        bonuses = Rules.calculate_bonuses([player1, player2], "Imperial", 10, hotel)

        # Size 10 (6-10 bracket), expensive tier: price = 800, majority = 8000, minority = 4000
        assert bonuses["p1"]["majority"] == 8000
        assert bonuses["p2"]["minority"] == 4000


class TestCheckEndGame:
    """Tests for Rules.check_end_game()"""

    def test_no_chains_cannot_end(self):
        """Game cannot end if no chains exist."""
        board = Board()
        hotel = Hotel()

        assert Rules.check_end_game(board, hotel) is False

    def test_chain_41_plus_can_end(self):
        """Game can end if any chain has 41+ tiles."""
        board = Board()
        hotel = Hotel()

        # Create chain with 41 tiles (4 columns + 5 more)
        for col in range(1, 5):
            for row in "ABCDEFGHI":
                t = Tile(col, row)
                board.place_tile(t)
                board.set_chain(t, "Luxor")
        # 4 * 9 = 36, need 5 more
        for row in "ABCDE":
            t = Tile(5, row)
            board.place_tile(t)
            board.set_chain(t, "Luxor")

        hotel.activate_chain("Luxor")

        assert board.get_chain_size("Luxor") == 41
        assert Rules.check_end_game(board, hotel) is True

    def test_all_chains_safe_can_end(self):
        """Game can end if all active chains are safe (11+)."""
        board = Board()
        hotel = Hotel()

        # Create two safe chains
        chains = ["Luxor", "Tower"]
        for idx, chain in enumerate(chains):
            col_start = idx * 2 + 1
            for row in "ABCDEFGHI":
                t = Tile(col_start, row)
                board.place_tile(t)
                board.set_chain(t, chain)
            # Add 2 more tiles
            for i in range(2):
                t = Tile(col_start + 1, "AB"[i])
                board.place_tile(t)
                board.set_chain(t, chain)
            hotel.activate_chain(chain)

        assert board.get_chain_size("Luxor") >= 11
        assert board.get_chain_size("Tower") >= 11
        assert Rules.check_end_game(board, hotel) is True

    def test_one_unsafe_chain_cannot_end(self):
        """Game cannot end if one chain is unsafe and no chain >= 41."""
        board = Board()
        hotel = Hotel()

        # Safe chain
        for row in "ABCDEFGHI":
            t = Tile(1, row)
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        for i in range(2):
            t = Tile(2, "AB"[i])
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        hotel.activate_chain("Luxor")

        # Unsafe chain (only 3 tiles)
        for i in range(3):
            t = Tile(5, "ABC"[i])
            board.place_tile(t)
            board.set_chain(t, "Tower")
        hotel.activate_chain("Tower")

        assert board.get_chain_size("Luxor") >= 11
        assert board.get_chain_size("Tower") < 11
        assert Rules.check_end_game(board, hotel) is False

    def test_single_safe_chain_can_end(self):
        """Game can end with single safe chain."""
        board = Board()
        hotel = Hotel()

        # Create one safe chain
        for row in "ABCDEFGHI":
            t = Tile(1, row)
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        for i in range(2):
            t = Tile(2, "AB"[i])
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        hotel.activate_chain("Luxor")

        assert Rules.check_end_game(board, hotel) is True


class TestIsTilePermanentlyUnplayable:
    """Tests for Rules.is_tile_permanently_unplayable()"""

    def test_empty_tile_not_unplayable(self):
        """Isolated tile is not permanently unplayable."""
        board = Board()
        hotel = Hotel()
        tile = Tile(5, 'E')

        assert Rules.is_tile_permanently_unplayable(board, tile, hotel) is False

    def test_tile_between_two_safe_chains_is_unplayable(self):
        """Tile that would merge two safe chains is permanently unplayable."""
        board = Board()
        hotel = Hotel()

        # Create two safe chains
        for row in "ABCDEFGHI":
            t = Tile(1, row)
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        for col in [2, 3]:
            t = Tile(col, 'A')
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        hotel.activate_chain("Luxor")

        for row in "ABCDEFGHI":
            t = Tile(5, row)
            board.place_tile(t)
            board.set_chain(t, "Tower")
        for col in [6, 7]:
            t = Tile(col, 'A')
            board.place_tile(t)
            board.set_chain(t, "Tower")
        hotel.activate_chain("Tower")

        # Tile between safe chains
        tile = Tile(4, 'A')

        assert Rules.is_tile_permanently_unplayable(board, tile, hotel) is True

    def test_tile_between_safe_and_unsafe_not_unplayable(self):
        """Tile between safe and unsafe chain is not permanently unplayable."""
        board = Board()
        hotel = Hotel()

        # Safe chain
        for row in "ABCDEFGHI":
            t = Tile(1, row)
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        for col in [2, 3]:
            t = Tile(col, 'A')
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        hotel.activate_chain("Luxor")

        # Unsafe chain (3 tiles)
        for col in [5, 6, 7]:
            t = Tile(col, 'A')
            board.place_tile(t)
            board.set_chain(t, "Tower")
        hotel.activate_chain("Tower")

        # Tile between them
        tile = Tile(4, 'A')

        assert Rules.is_tile_permanently_unplayable(board, tile, hotel) is False

    def test_already_played_tile_not_unplayable(self):
        """Already played tile is not 'unplayable'."""
        board = Board()
        hotel = Hotel()
        tile = Tile(5, 'E')
        board.place_tile(tile)

        assert Rules.is_tile_permanently_unplayable(board, tile, hotel) is False

    def test_tile_adjacent_to_single_chain(self):
        """Tile adjacent to single chain is not unplayable."""
        board = Board()
        hotel = Hotel()

        # Safe chain
        for row in "ABCDEFGHI":
            t = Tile(1, row)
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        for col in [2, 3]:
            t = Tile(col, 'A')
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        hotel.activate_chain("Luxor")

        # Adjacent tile
        tile = Tile(4, 'A')

        assert Rules.is_tile_permanently_unplayable(board, tile, hotel) is False


class TestGetPlayableTiles:
    """Tests for Rules.get_playable_tiles()"""

    def test_all_tiles_playable_empty_board(self):
        """All tiles are playable on empty board."""
        board = Board()
        hotel = Hotel()
        tiles = [Tile(1, 'A'), Tile(5, 'E'), Tile(12, 'I')]

        playable = Rules.get_playable_tiles(board, tiles, hotel)

        assert len(playable) == 3

    def test_filter_out_unplayable_tiles(self):
        """Should filter out tiles that cannot be played."""
        board = Board()
        hotel = Hotel()

        # Create two safe chains
        for row in "ABCDEFGHI":
            t = Tile(1, row)
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        for col in [2, 3]:
            t = Tile(col, 'A')
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        hotel.activate_chain("Luxor")

        for row in "ABCDEFGHI":
            t = Tile(5, row)
            board.place_tile(t)
            board.set_chain(t, "Tower")
        for col in [6, 7]:
            t = Tile(col, 'A')
            board.place_tile(t)
            board.set_chain(t, "Tower")
        hotel.activate_chain("Tower")

        # Tiles: one unplayable (4A), one playable (10E)
        tiles = [Tile(4, 'A'), Tile(10, 'E')]

        playable = Rules.get_playable_tiles(board, tiles, hotel)

        assert len(playable) == 1
        assert playable[0].coords == (10, 'E')


class TestGetUnplayableTiles:
    """Tests for Rules.get_unplayable_tiles()"""

    def test_no_unplayable_tiles_empty_board(self):
        """No tiles are unplayable on empty board."""
        board = Board()
        hotel = Hotel()
        tiles = [Tile(1, 'A'), Tile(5, 'E'), Tile(12, 'I')]

        unplayable = Rules.get_unplayable_tiles(board, tiles, hotel)

        assert len(unplayable) == 0

    def test_find_unplayable_tiles(self):
        """Should find tiles that cannot be played."""
        board = Board()
        hotel = Hotel()

        # Create two safe chains
        for row in "ABCDEFGHI":
            t = Tile(1, row)
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        for col in [2, 3]:
            t = Tile(col, 'A')
            board.place_tile(t)
            board.set_chain(t, "Luxor")
        hotel.activate_chain("Luxor")

        for row in "ABCDEFGHI":
            t = Tile(5, row)
            board.place_tile(t)
            board.set_chain(t, "Tower")
        for col in [6, 7]:
            t = Tile(col, 'A')
            board.place_tile(t)
            board.set_chain(t, "Tower")
        hotel.activate_chain("Tower")

        # Tiles: one unplayable (4A), one playable (10E)
        tiles = [Tile(4, 'A'), Tile(10, 'E')]

        unplayable = Rules.get_unplayable_tiles(board, tiles, hotel)

        assert len(unplayable) == 1
        assert unplayable[0].coords == (4, 'A')


class TestPlacementResult:
    """Tests for PlacementResult class."""

    def test_repr_nothing(self):
        """Test repr for NOTHING result."""
        result = PlacementResult(PlacementResult.NOTHING)
        assert "nothing" in repr(result)

    def test_repr_expand(self):
        """Test repr for EXPAND result."""
        result = PlacementResult(PlacementResult.EXPAND, chain="Luxor")
        assert "expand" in repr(result)
        assert "Luxor" in repr(result)

    def test_repr_merge(self):
        """Test repr for MERGE result."""
        result = PlacementResult(PlacementResult.MERGE, chains=["Luxor", "Tower"])
        assert "merge" in repr(result)
        assert "Luxor" in repr(result)


class TestRoundUpToHundred:
    """Tests for the internal _round_up_to_hundred method."""

    def test_exact_hundred(self):
        """Exact hundreds stay the same."""
        assert Rules._round_up_to_hundred(100) == 100
        assert Rules._round_up_to_hundred(500) == 500
        assert Rules._round_up_to_hundred(1000) == 1000

    def test_round_up(self):
        """Non-exact values round up."""
        assert Rules._round_up_to_hundred(101) == 200
        assert Rules._round_up_to_hundred(150) == 200
        assert Rules._round_up_to_hundred(199) == 200
        assert Rules._round_up_to_hundred(1875) == 1900
        assert Rules._round_up_to_hundred(3750) == 3800

    def test_zero(self):
        """Zero stays zero."""
        assert Rules._round_up_to_hundred(0) == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
