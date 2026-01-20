"""Scenario tests for chain expansion - from docs/tests/scenario/chain-expansion.md

Chain expansion occurs when a tile is placed adjacent to an existing chain,
causing the chain to grow. This includes simple expansion, orphan absorption,
and approaching safe status.
"""

from game.game import GamePhase
from game.board import Tile, TileState
from tests.scenarios.conftest import (
    ChainBuilder,
    give_player_tile,
)


class TestSimpleExpansion:
    """Tests for simple chain expansion (Scenarios 4.1 - 4.2)."""

    def test_scenario_4_1_basic_single_tile_expansion(self, game_with_three_players):
        """Scenario 4.1: Basic Single Tile Expansion

        Player places tile adjacent to chain, chain grows by one tile.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up American chain: 2 tiles at 6C, 7C
        builder.setup_chain("American", 2, start_col=6, row="C")

        player = game.get_current_player()

        # Initial state verification
        assert game.board.get_chain_size("American") == 2
        initial_price = game.hotel.get_stock_price("American", 2)
        assert initial_price == 300  # 2-tile Medium chain

        # Give player tile 8C (adjacent to 7C)
        tile = Tile(8, "C")
        give_player_tile(player, tile, game)

        # Place the expansion tile
        result = game.play_tile(player.player_id, tile)
        assert result["success"] is True
        assert result["result"] == "expand"

        # Verify outcomes
        assert game.board.get_chain_size("American") == 3
        new_price = game.hotel.get_stock_price("American", 3)
        assert new_price == 400  # 3-tile Medium chain

        # Tile 8C should belong to American
        cell = game.board.get_cell(8, "C")
        assert cell.chain == "American"

        # No founder bonus (expansion, not founding)
        assert player.get_stock_count("American") == 0

    def test_scenario_4_2_expansion_at_multiple_adjacency_points(
        self, game_with_three_players
    ):
        """Scenario 4.2: Expansion at Multiple Adjacency Points

        Tile adjacent to multiple chain tiles still only adds one tile.
        """
        game = game_with_three_players

        # Set up Tower chain in L-shape: 5C, 6C, 6D (3 tiles)
        # Need to place tiles individually for L-shape
        tiles_to_place = [(5, "C"), (6, "C"), (6, "D")]
        for col, row in tiles_to_place:
            tile = Tile(col, row)
            game.board.place_tile(tile)
            game.board.set_chain(tile, "Tower")
        game.hotel.activate_chain("Tower")

        player = game.get_current_player()

        # Initial state
        assert game.board.get_chain_size("Tower") == 3

        # Give player tile 5D (adjacent to both 5C and 6D)
        tile = Tile(5, "D")
        give_player_tile(player, tile, game)

        # Place the expansion tile
        result = game.play_tile(player.player_id, tile)
        assert result["success"] is True
        assert result["result"] == "expand"

        # Verify only 1 tile added despite multiple adjacencies
        assert game.board.get_chain_size("Tower") == 4

        # Tile 5D should be part of Tower
        cell = game.board.get_cell(5, "D")
        assert cell.chain == "Tower"


class TestOrphanAbsorption:
    """Tests for expansion with orphan absorption (Scenarios 4.3 - 4.5)."""

    def test_scenario_4_3_expansion_absorbs_single_orphan(
        self, game_with_three_players
    ):
        """Scenario 4.3: Expansion Absorbs Single Orphan Tile

        Tile placed adjacent to chain and orphan absorbs the orphan.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up American chain: 2 tiles at 5D, 6D
        builder.setup_chain("American", 2, start_col=5, row="D")

        # Place orphan tile at 7C
        builder.setup_lone_tiles([(7, "C")])

        player = game.get_current_player()

        # Initial state
        assert game.board.get_chain_size("American") == 2
        orphan_cell = game.board.get_cell(7, "C")
        assert orphan_cell.state != TileState.EMPTY
        assert orphan_cell.chain is None  # Orphan

        # Give player tile 7D (adjacent to 6D American and 7C orphan)
        tile = Tile(7, "D")
        give_player_tile(player, tile, game)

        # Place the expansion tile
        result = game.play_tile(player.player_id, tile)
        assert result["success"] is True
        assert result["result"] == "expand"

        # Verify outcomes
        # American should now have 4 tiles: 5D, 6D, 7D, 7C
        assert game.board.get_chain_size("American") == 4

        # Orphan 7C should now belong to American
        orphan_cell = game.board.get_cell(7, "C")
        assert orphan_cell.chain == "American"

        # 7D should also belong to American
        placed_cell = game.board.get_cell(7, "D")
        assert placed_cell.chain == "American"

    def test_scenario_4_4_expansion_absorbs_multiple_orphans(
        self, game_with_three_players
    ):
        """Scenario 4.4: Expansion Absorbs Multiple Orphan Tiles

        Expansion can absorb multiple connected orphan tiles.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up Tower chain: 2 tiles at 5D, 5E (vertical)
        tiles_to_place = [(5, "D"), (5, "E")]
        for col, row in tiles_to_place:
            tile = Tile(col, row)
            game.board.place_tile(tile)
            game.board.set_chain(tile, "Tower")
        game.hotel.activate_chain("Tower")

        # Place orphan tiles at 6C and 7D (will be absorbed through 6D)
        builder.setup_lone_tiles([(6, "C"), (7, "D")])

        player = game.get_current_player()

        # Initial state
        assert game.board.get_chain_size("Tower") == 2

        # Give player tile 6D (adjacent to 5D Tower, 6C orphan, 7D orphan)
        tile = Tile(6, "D")
        give_player_tile(player, tile, game)

        # Place the expansion tile
        result = game.play_tile(player.player_id, tile)
        assert result["success"] is True
        assert result["result"] == "expand"

        # Verify outcomes
        # Tower should now have 5 tiles: 5D, 5E, 6D, 6C, 7D
        assert game.board.get_chain_size("Tower") == 5

        # All tiles should belong to Tower
        for col, row in [(5, "D"), (5, "E"), (6, "D"), (6, "C"), (7, "D")]:
            cell = game.board.get_cell(col, row)
            assert cell.chain == "Tower", f"Tile {col}{row} should be Tower"

    def test_scenario_4_5_expansion_creates_large_size_jump(
        self, game_with_three_players
    ):
        """Scenario 4.5: Expansion Creates Large Jump in Chain Size

        Chain can grow significantly when absorbing connected orphans.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up Luxor chain: 2 tiles at 5C, 5D (vertical)
        tiles_to_place = [(5, "C"), (5, "D")]
        for col, row in tiles_to_place:
            tile = Tile(col, row)
            game.board.place_tile(tile)
            game.board.set_chain(tile, "Luxor")
        game.hotel.activate_chain("Luxor")

        # Place connected orphan tiles: 6D and 6E (adjacent to each other)
        builder.setup_lone_tiles([(6, "D"), (6, "E")])

        player = game.get_current_player()

        # Initial state
        assert game.board.get_chain_size("Luxor") == 2

        # Give player tile 5E (adjacent to 5D Luxor and 6E orphan)
        tile = Tile(5, "E")
        give_player_tile(player, tile, game)

        # Place the expansion tile
        result = game.play_tile(player.player_id, tile)
        assert result["success"] is True
        assert result["result"] == "expand"

        # Verify outcomes
        # Luxor should grow: 5C, 5D + 5E (placed) + 6E (orphan) + 6D (connected to 6E)
        assert game.board.get_chain_size("Luxor") == 5

        # Price should reflect new size
        price = game.hotel.get_stock_price("Luxor", 5)
        assert price == 500  # 5-tile Cheap tier


class TestSafeStatusExpansion:
    """Tests for expansion toward and after safe status (Scenarios 4.6 - 4.8)."""

    def test_scenario_4_6_expansion_to_safe_size(self, game_with_three_players):
        """Scenario 4.6: Expansion to Safe Size (11 Tiles)

        Chain becomes safe when it reaches 11 tiles.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up Continental chain with 10 tiles
        builder.setup_chain("Continental", 10, start_col=1, row="A")

        player = game.get_current_player()

        # Initial state - not safe yet
        assert game.board.get_chain_size("Continental") == 10
        assert not game.hotel.is_chain_safe("Continental", 10)

        # Give player tile 11A (adjacent to 10A)
        tile = Tile(11, "A")
        give_player_tile(player, tile, game)

        # Place the expansion tile
        result = game.play_tile(player.player_id, tile)
        assert result["success"] is True
        assert result["result"] == "expand"

        # Verify outcomes
        assert game.board.get_chain_size("Continental") == 11
        assert game.hotel.is_chain_safe("Continental", 11)

        # Price should be $900 for 11-20 tile Expensive tier
        price = game.hotel.get_stock_price("Continental", 11)
        assert price == 900

    def test_scenario_4_7_safe_chain_remains_safe(self, game_with_three_players):
        """Scenario 4.7: Safe Chain Remains Safe

        Chain that is already safe stays safe when expanded.
        """
        game = game_with_three_players

        # Set up American chain with 15 tiles (already safe)
        # Need to use multiple rows since max column is 12
        # Row A: 1-12 (12 tiles), Row B: 1-3 (3 tiles) = 15 tiles
        for col in range(1, 13):
            tile = Tile(col, "A")
            game.board.place_tile(tile)
            game.board.set_chain(tile, "American")
        for col in range(1, 4):
            tile = Tile(col, "B")
            game.board.place_tile(tile)
            game.board.set_chain(tile, "American")
        game.hotel.activate_chain("American")

        player = game.get_current_player()

        # Initial state - already safe
        assert game.board.get_chain_size("American") == 15
        assert game.hotel.is_chain_safe("American", 15)

        # Give player tile 4B (adjacent to 3B)
        tile = Tile(4, "B")
        give_player_tile(player, tile, game)

        # Place the expansion tile
        result = game.play_tile(player.player_id, tile)
        assert result["success"] is True
        assert result["result"] == "expand"

        # Verify outcomes
        assert game.board.get_chain_size("American") == 16
        assert game.hotel.is_chain_safe("American", 16)

        # Price should be $800 for 11-20 tile Medium tier (same bracket)
        price = game.hotel.get_stock_price("American", 16)
        assert price == 800

    def test_scenario_4_8_expansion_price_bracket_change(self, game_with_three_players):
        """Scenario 4.8: Expansion Price Bracket Change

        Chain price updates when crossing bracket threshold.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up Tower chain with 5 tiles (at bracket boundary)
        builder.setup_chain("Tower", 5, start_col=1, row="A")

        player = game.get_current_player()

        # Initial state - 5-tile price
        assert game.board.get_chain_size("Tower") == 5
        price_at_5 = game.hotel.get_stock_price("Tower", 5)
        assert price_at_5 == 500  # 5-tile Cheap tier

        # Give player tile 6A (adjacent to 5A)
        tile = Tile(6, "A")
        give_player_tile(player, tile, game)

        # Place the expansion tile
        result = game.play_tile(player.player_id, tile)
        assert result["success"] is True
        assert result["result"] == "expand"

        # Verify outcomes
        assert game.board.get_chain_size("Tower") == 6

        # Price should change from $500 to $600 (crossed into 6-10 bracket)
        price_at_6 = game.hotel.get_stock_price("Tower", 6)
        assert price_at_6 == 600


class TestExpansionWithoutMerger:
    """Tests for expansion without triggering merger (Scenarios 4.9 - 4.10)."""

    def test_scenario_4_9_expansion_near_another_chain_no_contact(
        self, game_with_three_players
    ):
        """Scenario 4.9: Expansion Near Another Chain (No Contact)

        Expansion that doesn't touch another chain doesn't merge.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up American chain: 2 tiles at 4D, 5D
        builder.setup_chain("American", 2, start_col=4, row="D")

        # Set up Tower chain: 2 tiles at 7D, 8D (gap between them)
        builder.setup_chain("Tower", 2, start_col=7, row="D")

        player = game.get_current_player()

        # Initial state
        assert game.board.get_chain_size("American") == 2
        assert game.board.get_chain_size("Tower") == 2

        # Give player tile 5E (adjacent only to American at 5D)
        tile = Tile(5, "E")
        give_player_tile(player, tile, game)

        # Place the expansion tile
        result = game.play_tile(player.player_id, tile)
        assert result["success"] is True
        assert result["result"] == "expand"

        # Verify outcomes
        assert game.board.get_chain_size("American") == 3
        assert game.board.get_chain_size("Tower") == 2  # Unchanged

        # No merger triggered
        assert game.phase != GamePhase.MERGING

        # Both chains remain separate
        cell_american = game.board.get_cell(5, "E")
        assert cell_american.chain == "American"

    def test_scenario_4_10_expansion_with_orphan_near_other_chain(
        self, game_with_three_players
    ):
        """Scenario 4.10: Expansion with Orphan Near Other Chain

        Orphan between chains stays orphan if not connected to expansion.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up Festival chain: 2 tiles at 3D, 4D
        builder.setup_chain("Festival", 2, start_col=3, row="D")

        # Set up Worldwide chain: 2 tiles at 8D, 9D
        builder.setup_chain("Worldwide", 2, start_col=8, row="D")

        # Place orphan tile at 6D (between chains but not adjacent to either)
        # Festival ends at 4D, Worldwide starts at 8D, so 6D has gap on both sides
        builder.setup_lone_tiles([(6, "D")])

        player = game.get_current_player()

        # Initial state
        assert game.board.get_chain_size("Festival") == 2
        assert game.board.get_chain_size("Worldwide") == 2
        orphan_cell = game.board.get_cell(6, "D")
        assert orphan_cell.state != TileState.EMPTY
        assert orphan_cell.chain is None

        # Give player tile 4E (adjacent to 4D Festival, not adjacent to orphan 6D)
        tile = Tile(4, "E")
        give_player_tile(player, tile, game)

        # Place the expansion tile
        result = game.play_tile(player.player_id, tile)
        assert result["success"] is True
        assert result["result"] == "expand"

        # Verify outcomes
        assert game.board.get_chain_size("Festival") == 3
        assert game.board.get_chain_size("Worldwide") == 2  # Unchanged

        # Orphan 6D still orphan (not connected to expansion)
        orphan_cell = game.board.get_cell(6, "D")
        assert orphan_cell.chain is None

        # No unexpected absorption or merger
        assert game.phase != GamePhase.MERGING
