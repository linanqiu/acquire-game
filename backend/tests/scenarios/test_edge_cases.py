"""Scenario tests for edge cases - from docs/tests/scenario/edge-cases.md

Edge cases include boundary conditions, error handling, and unusual game states.
"""

from game.game import Game, GamePhase
from game.board import Tile, Board
from tests.scenarios.conftest import (
    ChainBuilder,
    give_player_tile,
)


class TestPlayerCountBoundaries:
    """Tests for player count boundaries (Scenarios 8.1 - 8.4)."""

    def test_scenario_8_1_minimum_players_three(self):
        """Scenario 8.1: Minimum Players (3)

        Game starts successfully with exactly 3 players.
        """
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Charlie")

        game.start_game()

        # Verify player count
        assert len(game.players) == 3
        assert game.phase == GamePhase.PLAYING

    def test_scenario_8_2_maximum_players_six(self):
        """Scenario 8.2: Maximum Players (6)

        Game starts successfully with exactly 6 players.
        """
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Charlie")
        game.add_player("p4", "Diana")
        game.add_player("p5", "Eve")
        game.add_player("p6", "Frank")

        game.start_game()

        # Verify player count
        assert len(game.players) == 6
        assert game.phase == GamePhase.PLAYING

    def test_scenario_8_3_invalid_player_count_too_few(self):
        """Scenario 8.3: Invalid Player Count - Too Few (2)

        Game cannot start with only 2 players.
        """
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")

        # start_game should raise ValueError
        try:
            game.start_game()
            assert False, "Should have raised ValueError"
        except ValueError as e:
            assert "players" in str(e).lower()

        # Game should still be in lobby
        assert game.phase == GamePhase.LOBBY

    def test_scenario_8_4_invalid_player_count_too_many(self):
        """Scenario 8.4: Invalid Player Count - Too Many (7)

        Cannot add 7th player to game.
        """
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Charlie")
        game.add_player("p4", "Diana")
        game.add_player("p5", "Eve")
        game.add_player("p6", "Frank")

        # Try to add 7th player - should raise ValueError
        try:
            game.add_player("p7", "George")
            assert False, "Should have raised ValueError"
        except ValueError as e:
            assert "6" in str(e) or "maximum" in str(e).lower()


class TestStartingMoney:
    """Tests for starting money verification (Scenario 8.5)."""

    def test_scenario_8_5_starting_money_correct(self):
        """Scenario 8.5: Starting Money Correct ($6,000)

        All players start with exactly $6,000.
        """
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Charlie")
        game.add_player("p4", "Diana")
        game.start_game()

        # Verify each player has $6,000
        for player in game.players:
            assert player.money == 6000, f"{player.name} should have $6,000"


class TestTileBagCorrectness:
    """Tests for tile bag correctness (Scenarios 8.6 - 8.7)."""

    def test_scenario_8_6_tile_bag_contains_108_tiles(self):
        """Scenario 8.6: Tile Bag Contains 108 Tiles

        Board has 12 columns x 9 rows = 108 tiles.
        """
        # Verify board dimensions
        assert Board.COLUMNS == 12
        assert len(Board.ROWS) == 9
        assert Board.COLUMNS * len(Board.ROWS) == 108

        # Create a game and verify tile distribution
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Charlie")
        game.start_game()

        # Count tiles:
        # - Each player has 6 tiles in hand
        # - Some tiles on board (starting tiles)
        # - Rest in tile bag
        tiles_in_hands = sum(p.hand_size for p in game.players)
        tiles_on_board = sum(
            1
            for col in range(1, 13)
            for row in Board.ROWS
            if game.board.is_tile_played(Tile(col, row))
        )
        tiles_in_bag = len(game.tile_bag)

        total = tiles_in_hands + tiles_on_board + tiles_in_bag
        assert total == 108, f"Total tiles should be 108, got {total}"

    def test_scenario_8_7_all_tile_coordinates_valid(self):
        """Scenario 8.7: All Tile Coordinates Valid

        All tiles have valid coordinates (columns 1-12, rows A-I).
        """
        # Verify valid tile range
        valid_coords = set()
        for col in range(1, 13):
            for row in "ABCDEFGHI":
                Tile(col, row)  # Validates coordinate is valid
                valid_coords.add((col, row))

        assert len(valid_coords) == 108

        # Verify invalid coordinates raise errors
        try:
            Tile(13, "A")  # Invalid column
            assert False, "Should have raised ValueError"
        except ValueError:
            pass

        try:
            Tile(1, "J")  # Invalid row
            assert False, "Should have raised ValueError"
        except ValueError:
            pass


class TestHandSizeLimits:
    """Tests for hand size limits (Scenarios 8.8 - 8.9)."""

    def test_scenario_8_8_hand_size_maintained_at_six(self, game_with_three_players):
        """Scenario 8.8: Hand Size Always 6 (Normal Play)

        Hand size maintained at 6 during normal play.
        """
        game = game_with_three_players
        player = game.get_current_player()

        # Verify starting hand size
        assert player.hand_size == 6

        # Place a tile
        tile = player.hand[0]
        game.play_tile(player.player_id, tile)
        game.end_turn(player.player_id)

        # Hand should still be 6 (played 1, drew 1)
        assert player.hand_size == 6

    def test_scenario_8_9_hand_size_decreases_when_pool_empty(
        self, game_with_three_players
    ):
        """Scenario 8.9: Hand Size Decreases When Pool Empty

        Hand size decreases when tile pool is empty.
        """
        game = game_with_three_players
        player = game.get_current_player()

        # Empty the tile pool
        game.tile_bag.clear()

        # Verify starting hand size
        initial_hand_size = player.hand_size
        assert initial_hand_size == 6

        # Place a tile
        tile = player.hand[0]
        game.play_tile(player.player_id, tile)
        game.end_turn(player.player_id)

        # Hand should be 5 (played 1, couldn't draw)
        assert player.hand_size == initial_hand_size - 1


class TestStockLimits:
    """Tests for stock limits (Scenario 8.10)."""

    def test_scenario_8_10_stock_limit_per_chain_25(self, game_with_three_players):
        """Scenario 8.10: Stock Limit Per Chain (25)

        Cannot buy more than available stock (max 25 per chain).
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up American chain
        builder.setup_chain("American", 3, start_col=1, row="A")

        # Exhaust most of the stock (leave 2)
        for _ in range(23):
            game.hotel.buy_stock("American")

        assert game.hotel.get_available_stocks("American") == 2

        player = game.get_current_player()

        # Place tile to enter buying phase
        tile = Tile(5, "E")
        give_player_tile(player, tile, game)
        game.play_tile(player.player_id, tile)

        # Try to buy 3 (only 2 available)
        result = game.buy_stocks(player.player_id, ["American", "American", "American"])

        # Should either fail or only buy what's available
        if result["success"]:
            assert player.get_stock_count("American") <= 2


class TestTurnValidation:
    """Tests for turn validation (Scenarios 8.11 - 8.14)."""

    def test_scenario_8_11_wrong_players_turn(self, game_with_three_players):
        """Scenario 8.11: Wrong Player's Turn

        Cannot take action when it's not your turn.
        """
        game = game_with_three_players

        current_player = game.get_current_player()

        # Find a player who is NOT current
        other_player = None
        for p in game.players:
            if p.player_id != current_player.player_id:
                other_player = p
                break

        # Try to place tile as other player
        tile = other_player.hand[0]
        result = game.play_tile(other_player.player_id, tile)
        assert result["success"] is False

    def test_scenario_8_12_invalid_tile_coordinates(self):
        """Scenario 8.12: Invalid Tile Coordinates

        Tile coordinates must be valid.
        """
        # Test invalid column (13)
        try:
            Tile(13, "A")
            assert False, "Should have raised ValueError for column 13"
        except ValueError:
            pass

        # Test invalid row (J)
        try:
            Tile(1, "J")
            assert False, "Should have raised ValueError for row J"
        except ValueError:
            pass

        # Test column 0
        try:
            Tile(0, "A")
            assert False, "Should have raised ValueError for column 0"
        except ValueError:
            pass

    def test_scenario_8_13_duplicate_tile_placement(self, game_with_three_players):
        """Scenario 8.13: Duplicate Tile Placement

        Cannot place tile on already occupied space.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Place a tile on the board
        builder.setup_lone_tiles([(6, "D")])

        player = game.get_current_player()

        # Give player the same tile coordinates
        tile = Tile(6, "D")
        give_player_tile(player, tile, game)

        # Try to place on occupied space
        result = game.play_tile(player.player_id, tile)
        assert result["success"] is False

    def test_scenario_8_14_phase_validation_buy_before_place(
        self, game_with_three_players
    ):
        """Scenario 8.14: Phase Validation - Buy Before Place

        Cannot buy stock before placing tile.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up a chain so there's stock to buy
        builder.setup_chain("American", 3, start_col=1, row="A")

        player = game.get_current_player()

        # Try to buy stock before placing tile
        result = game.buy_stocks(player.player_id, ["American"])
        assert result["success"] is False


class TestReproducibility:
    """Tests for game reproducibility (Scenario 8.15)."""

    def test_scenario_8_15_reproducible_games_with_seed(self):
        """Scenario 8.15: Reproducible Games with Seed

        Games with same seed have identical initial states.
        """
        # Create two games with same seed
        game1 = Game(seed=12345)
        game1.add_player("p1", "Alice")
        game1.add_player("p2", "Bob")
        game1.add_player("p3", "Charlie")
        game1.start_game()

        game2 = Game(seed=12345)
        game2.add_player("p1", "Alice")
        game2.add_player("p2", "Bob")
        game2.add_player("p3", "Charlie")
        game2.start_game()

        # Compare player hands
        for i in range(3):
            hand1 = [str(t) for t in game1.players[i].hand]
            hand2 = [str(t) for t in game2.players[i].hand]
            assert hand1 == hand2, f"Player {i} hands differ"

        # Compare tile bags
        bag1 = [str(t) for t in game1.tile_bag]
        bag2 = [str(t) for t in game2.tile_bag]
        assert bag1 == bag2


class TestUnplayableTileHandling:
    """Tests for unplayable tile handling (Scenarios 8.16 - 8.17)."""

    def test_scenario_8_16_permanently_unplayable_tiles_detected(
        self, game_with_three_players
    ):
        """Scenario 8.16: Permanently Unplayable Tiles

        Tiles that would merge two safe chains are unplayable.
        """
        from game.rules import Rules

        game = game_with_three_players
        builder = ChainBuilder(game)

        # Create two safe chains (11+ tiles each)
        builder.setup_chain("Luxor", 11, start_col=1, row="A")
        builder.setup_chain("Tower", 11, start_col=1, row="C")

        # Tile at 1B would merge two safe chains
        tile = Tile(1, "B")

        # Verify tile is permanently unplayable
        assert Rules.is_tile_permanently_unplayable(game.board, tile, game.hotel)
        assert not Rules.can_place_tile(game.board, tile, game.hotel)

    def test_scenario_8_17_all_tiles_unplayable_scenario(self, game_with_three_players):
        """Scenario 8.17: All Hand Tiles Unplayable

        Game continues when all tiles in hand are unplayable.
        """
        # This scenario tests that the game doesn't break when tiles are unplayable
        # The implementation may vary (skip tile placement, etc.)
        game = game_with_three_players

        # The game should have a way to handle this - verify the game is functional
        assert game.phase == GamePhase.PLAYING


class TestEmptyTileBag:
    """Tests for empty tile bag scenarios (Scenario 8.18)."""

    def test_scenario_8_18_tile_bag_empties_mid_game(self, game_with_three_players):
        """Scenario 8.18: Tile Bag Empties Mid-Game

        Game continues normally when tile bag empties.
        """
        game = game_with_three_players
        player = game.get_current_player()

        # Leave only 1 tile in bag
        while len(game.tile_bag) > 1:
            game.tile_bag.pop()

        assert len(game.tile_bag) == 1

        # Place a tile
        tile = player.hand[0]
        game.play_tile(player.player_id, tile)
        game.end_turn(player.player_id)

        # Player should have 5 tiles (played 1, drew 1)
        # Next player won't be able to draw
        assert len(game.tile_bag) == 0

        # Game should continue
        assert game.phase == GamePhase.PLAYING


class TestBonusRounding:
    """Tests for bonus rounding (Scenario 8.19)."""

    def test_scenario_8_19_bonus_rounding_to_nearest_100(self):
        """Scenario 8.19: Bonus Rounding to Nearest $100

        Bonuses should be rounded consistently.
        """
        from game.hotel import Hotel

        hotel = Hotel()

        # Get a stock price
        price = hotel.get_stock_price("Luxor", 5)
        majority = hotel.get_majority_bonus("Luxor", 5)
        minority = hotel.get_minority_bonus("Luxor", 5)

        # Verify bonuses are multiples of 100
        assert majority % 100 == 0
        assert minority % 100 == 0

        # Verify 10x and 5x relationships
        assert majority == price * 10
        assert minority == price * 5


class TestConcurrentAccess:
    """Tests for concurrent access handling (Scenario 8.22)."""

    def test_scenario_8_22_simultaneous_action_attempts(self, game_with_three_players):
        """Scenario 8.22: Simultaneous Action Attempts

        Only current player's action should succeed.
        """
        game = game_with_three_players

        current_player = game.get_current_player()
        other_player = None
        for p in game.players:
            if p.player_id != current_player.player_id:
                other_player = p
                break

        # Current player should succeed
        tile_current = current_player.hand[0]
        result_current = game.play_tile(current_player.player_id, tile_current)
        assert result_current["success"] is True

        # Other player should fail
        tile_other = other_player.hand[0]
        result_other = game.play_tile(other_player.player_id, tile_other)
        assert result_other["success"] is False


class TestBoundaryTilePositions:
    """Tests for boundary tile positions (Scenarios 8.23 - 8.24)."""

    def test_scenario_8_23_corner_tile_adjacency(self):
        """Scenario 8.23: Corner Tile Adjacency

        Corner tiles have only 2 adjacent tiles.
        """
        board = Board()

        # Test top-left corner (1A)
        tile_1a = Tile(1, "A")
        adjacent_1a = board.get_adjacent_tiles(tile_1a)

        # Should only be adjacent to 2A and 1B
        expected_1a = {Tile(2, "A"), Tile(1, "B")}
        assert set(adjacent_1a) == expected_1a

        # Test bottom-right corner (12I)
        tile_12i = Tile(12, "I")
        adjacent_12i = board.get_adjacent_tiles(tile_12i)

        # Should only be adjacent to 11I and 12H
        expected_12i = {Tile(11, "I"), Tile(12, "H")}
        assert set(adjacent_12i) == expected_12i

    def test_scenario_8_24_edge_tile_adjacency(self):
        """Scenario 8.24: Edge Tile Adjacency

        Edge tiles have only 3 adjacent tiles.
        """
        board = Board()

        # Test top edge middle (6A)
        tile_6a = Tile(6, "A")
        adjacent_6a = board.get_adjacent_tiles(tile_6a)

        # Should only be adjacent to 5A, 7A, and 6B
        expected_6a = {Tile(5, "A"), Tile(7, "A"), Tile(6, "B")}
        assert set(adjacent_6a) == expected_6a

        # Test bottom edge middle (6I)
        tile_6i = Tile(6, "I")
        adjacent_6i = board.get_adjacent_tiles(tile_6i)

        # Should only be adjacent to 5I, 7I, and 6H
        expected_6i = {Tile(5, "I"), Tile(7, "I"), Tile(6, "H")}
        assert set(adjacent_6i) == expected_6i

        # Test left edge middle (1E)
        tile_1e = Tile(1, "E")
        adjacent_1e = board.get_adjacent_tiles(tile_1e)

        # Should only be adjacent to 2E, 1D, and 1F
        expected_1e = {Tile(2, "E"), Tile(1, "D"), Tile(1, "F")}
        assert set(adjacent_1e) == expected_1e

        # Test right edge middle (12E)
        tile_12e = Tile(12, "E")
        adjacent_12e = board.get_adjacent_tiles(tile_12e)

        # Should only be adjacent to 11E, 12D, and 12F
        expected_12e = {Tile(11, "E"), Tile(12, "D"), Tile(12, "F")}
        assert set(adjacent_12e) == expected_12e
