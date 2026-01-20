"""Scenario tests for chain founding - from docs/tests/scenario/chain-founding.md

Chain founding covers creating new chains, founder's bonus, chain selection,
and re-founding defunct chains.
"""

from game.game import GamePhase
from game.board import Tile
from game.rules import Rules
from tests.scenarios.conftest import (
    ChainBuilder,
    give_player_tile,
)


class TestChainFounding:
    """Tests for founding new hotel chains."""

    def test_founder_receives_free_stock(self, game_with_two_players):
        """Founder should receive one free stock when founding a chain."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Place a lone tile
        builder.setup_lone_tiles([(5, "C")])

        player = game.get_current_player()
        initial_luxor_stock = player.get_stock_count("Luxor")

        # Give player a tile adjacent to the lone tile
        tile = Tile(5, "D")
        give_player_tile(player, tile, game)

        # Play the tile to trigger founding
        game.play_tile(player.player_id, tile)
        assert game.phase == GamePhase.FOUNDING_CHAIN

        # Found Luxor
        result = game.found_chain(player.player_id, "Luxor")

        assert result["success"] is True
        assert result["founder_bonus"] is True
        assert player.get_stock_count("Luxor") == initial_luxor_stock + 1

    def test_all_connected_tiles_join_chain(self, game_with_two_players):
        """All tiles connected to the founding tile should join the chain."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Place multiple lone tiles in a connected group
        builder.setup_lone_tiles([(5, "C"), (5, "D"), (6, "D")])

        player = game.get_current_player()

        # Give player a tile that connects to the group
        tile = Tile(6, "C")
        give_player_tile(player, tile, game)

        # Play the tile to trigger founding
        game.play_tile(player.player_id, tile)
        assert game.phase == GamePhase.FOUNDING_CHAIN

        # Found Tower
        game.found_chain(player.player_id, "Tower")

        # All tiles should now be part of Tower
        for col, row in [(5, "C"), (5, "D"), (6, "C"), (6, "D")]:
            assert game.board.get_cell(col, row).chain == "Tower"

    def test_no_stock_if_none_available(self, game_with_two_players):
        """Founder gets no stock if chain has no available stocks."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Exhaust all Luxor stocks
        game.hotel._available_stocks["Luxor"] = 0

        # Place a lone tile
        builder.setup_lone_tiles([(5, "C")])

        player = game.get_current_player()
        initial_stock = player.get_stock_count("Luxor")

        # Give player a tile adjacent to the lone tile
        tile = Tile(5, "D")
        give_player_tile(player, tile, game)

        # Play the tile to trigger founding
        game.play_tile(player.player_id, tile)

        # Found Luxor
        result = game.found_chain(player.player_id, "Luxor")

        assert result["success"] is True
        assert player.get_stock_count("Luxor") == initial_stock  # No change

    def test_available_chains_offered(self, game_with_two_players):
        """Only inactive chains should be offered for founding."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Activate some chains first
        builder.setup_chain("Luxor", 2, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=1, row="C")

        # Place lone tiles for founding
        builder.setup_lone_tiles([(10, "H")])

        player = game.get_current_player()
        tile = Tile(10, "I")
        give_player_tile(player, tile, game)

        # Play the tile to trigger founding
        result = game.play_tile(player.player_id, tile)

        assert result["success"] is True
        assert result["result"] == "found"

        # Luxor and Tower should NOT be in available chains
        assert "Luxor" not in result["available_chains"]
        assert "Tower" not in result["available_chains"]

        # Other chains should be available
        assert "American" in result["available_chains"]
        assert "Worldwide" in result["available_chains"]


class TestFoundChainValidation:
    """Tests for chain founding validation."""

    def test_cannot_found_active_chain(self, game_with_two_players):
        """Cannot found a chain that is already active."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Activate Luxor
        builder.setup_chain("Luxor", 2, start_col=1, row="A")

        # Set up for founding
        builder.setup_lone_tiles([(10, "H")])

        player = game.get_current_player()
        tile = Tile(10, "I")
        give_player_tile(player, tile, game)

        game.play_tile(player.player_id, tile)

        # Try to found already active Luxor
        result = game.found_chain(player.player_id, "Luxor")

        assert result["success"] is False
        assert "not available" in result["error"].lower()

    def test_cannot_found_when_not_in_founding_phase(self, game_with_two_players):
        """Cannot found a chain when not in founding phase."""
        game = game_with_two_players

        result = game.found_chain("p1", "Luxor")

        assert result["success"] is False
        assert "not in founding" in result["error"].lower()

    def test_cannot_found_wrong_players_turn(self, game_with_two_players):
        """Cannot found a chain when it's not your turn."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up for founding
        builder.setup_lone_tiles([(10, "H")])

        current_player = game.get_current_player()
        other_player_id = "p2" if current_player.player_id == "p1" else "p1"

        tile = Tile(10, "I")
        give_player_tile(current_player, tile, game)

        game.play_tile(current_player.player_id, tile)
        assert game.phase == GamePhase.FOUNDING_CHAIN

        # Try to found as wrong player
        result = game.found_chain(other_player_id, "Luxor")

        assert result["success"] is False
        assert "not your turn" in result["error"].lower()


class TestChainTiers:
    """Tests for chain tier effects (Scenario 3.3)."""

    def test_scenario_3_3_chain_tier_affects_pricing(self, game_with_three_players):
        """Scenario 3.3: Chain Tier Affects Pricing

        Different tiers have different starting prices for same size chain.
        """
        from game.hotel import Hotel

        hotel = Hotel()

        # 2-tile chains - same size, different prices by tier
        # Cheap tier (Luxor, Tower)
        assert hotel.get_stock_price("Luxor", 2) == 200
        assert hotel.get_stock_price("Tower", 2) == 200

        # Medium tier (American, Festival, Worldwide)
        assert hotel.get_stock_price("American", 2) == 300
        assert hotel.get_stock_price("Festival", 2) == 300
        assert hotel.get_stock_price("Worldwide", 2) == 300

        # Expensive tier (Imperial, Continental)
        assert hotel.get_stock_price("Imperial", 2) == 400
        assert hotel.get_stock_price("Continental", 2) == 400

        # Verify majority bonuses differ by tier
        # Majority = 10x stock price
        assert hotel.get_majority_bonus("Luxor", 2) == 2000  # Cheap
        assert hotel.get_majority_bonus("Festival", 2) == 3000  # Medium
        assert hotel.get_majority_bonus("Imperial", 2) == 4000  # Expensive


class TestCannotFoundEighthChain:
    """Tests for 8th chain restriction (Scenario 3.5)."""

    def test_scenario_3_5_cannot_found_eighth_chain(self, game_with_three_players):
        """Scenario 3.5: Cannot Found 8th Chain

        Tile that would create 8th chain is unplayable.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up all 7 chains
        builder.setup_chain("Luxor", 2, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=4, row="A")
        builder.setup_chain("American", 2, start_col=7, row="A")
        builder.setup_chain("Festival", 2, start_col=10, row="A")
        builder.setup_chain("Worldwide", 2, start_col=1, row="C")
        builder.setup_chain("Continental", 2, start_col=4, row="C")
        builder.setup_chain("Imperial", 2, start_col=7, row="C")

        # Place orphan tiles that could form 8th chain
        builder.setup_lone_tiles([(8, "E")])

        player = game.get_current_player()

        # Give player tile 8F (adjacent to orphan 8E)
        tile = Tile(8, "F")
        give_player_tile(player, tile, game)

        # This tile would create an 8th chain - should be unplayable
        assert not Rules.can_place_tile(game.board, tile, game.hotel)


class TestChainSelectionStrategy:
    """Tests for strategic chain selection (Scenarios 3.7 - 3.8)."""

    def test_scenario_3_7_strategic_cheap_tier_selection(self, game_with_three_players):
        """Scenario 3.7: Strategic Cheap Tier Selection

        Cheap tier allows more shares with limited money.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Place orphan tile
        builder.setup_lone_tiles([(5, "C")])

        player = game.get_current_player()
        player._money = 2000  # Limited budget

        # Give player a founding tile
        tile = Tile(5, "D")
        give_player_tile(player, tile, game)

        # Found Tower (Cheap tier, $200/share for 2 tiles)
        game.play_tile(player.player_id, tile)
        game.found_chain(player.player_id, "Tower")

        # Player has 1 free stock from founder bonus
        assert player.get_stock_count("Tower") == 1

        # Buy 3 more stocks ($600 total)
        game.buy_stocks(player.player_id, ["Tower", "Tower", "Tower"])

        # Player should have 4 total stocks
        assert player.get_stock_count("Tower") == 4
        assert player.money == 2000 - 600  # $1400 remaining

    def test_scenario_3_8_strategic_expensive_tier_selection(
        self, game_with_three_players
    ):
        """Scenario 3.8: Strategic Expensive Tier Selection

        Expensive tier has higher bonus potential.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Place orphan tile
        builder.setup_lone_tiles([(5, "C")])

        player = game.get_current_player()

        # Give player a founding tile
        tile = Tile(5, "D")
        give_player_tile(player, tile, game)

        # Found Continental (Expensive tier, $400/share for 2 tiles)
        game.play_tile(player.player_id, tile)
        game.found_chain(player.player_id, "Continental")

        # Player has 1 free stock from founder bonus
        assert player.get_stock_count("Continental") == 1

        # Buy 3 more stocks ($1200 total)
        initial_money = player.money
        game.buy_stocks(player.player_id, ["Continental", "Continental", "Continental"])

        # Verify higher price
        assert player.get_stock_count("Continental") == 4
        assert player.money == initial_money - 1200

        # Verify higher bonus potential (if this chain were acquired)
        # 2-tile Continental: majority = $4000 (vs $2000 for cheap)
        assert game.hotel.get_majority_bonus("Continental", 2) == 4000


class TestRefoundingDefunctChains:
    """Tests for re-founding defunct chains (Scenarios 3.9 - 3.10)."""

    def test_scenario_3_9_refound_defunct_chain(self, game_with_three_players):
        """Scenario 3.9: Re-found Previously Defunct Chain

        A defunct chain can be re-founded.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # First, create and deactivate Tower
        builder.setup_chain("Tower", 2, start_col=1, row="A")
        game.hotel.deactivate_chain("Tower")
        assert not game.hotel.is_chain_active("Tower")

        # Player B holds Tower stock from before merger
        p2 = game.get_player("p2")
        p2._stocks["Tower"] = 3  # Held through merger

        # Place orphan tile for new founding
        builder.setup_lone_tiles([(8, "E")])

        player = game.get_current_player()

        # Give player a founding tile
        tile = Tile(8, "F")
        give_player_tile(player, tile, game)

        # Found Tower again (re-founding)
        game.play_tile(player.player_id, tile)
        game.found_chain(player.player_id, "Tower")

        # Tower should be active again
        assert game.hotel.is_chain_active("Tower")

        # Founder gets bonus
        assert player.get_stock_count("Tower") == 1

        # P2's held stock is now active again
        assert p2.get_stock_count("Tower") == 3

    def test_scenario_3_10_held_defunct_stock_regains_value(
        self, game_with_three_players
    ):
        """Scenario 3.10: Held Defunct Stock Regains Value on Re-founding

        Stock held through a merger regains value when chain is re-founded.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Simulate: Luxor was acquired, player held 5 shares
        p3 = game.get_player("p3")
        p3._stocks["Luxor"] = 5  # Held through merger

        # Luxor is currently defunct
        # (not on board, not active, but player holds stock)
        assert not game.hotel.is_chain_active("Luxor")

        # Place orphan tile for founding
        builder.setup_lone_tiles([(8, "E")])

        player = game.get_current_player()

        # Give player a founding tile
        tile = Tile(8, "F")
        give_player_tile(player, tile, game)

        # Found Luxor (re-founding)
        game.play_tile(player.player_id, tile)
        game.found_chain(player.player_id, "Luxor")

        # Luxor active again
        assert game.hotel.is_chain_active("Luxor")

        # P3's stock is now valuable
        # 2-tile Luxor: $200/share
        price = game.hotel.get_stock_price("Luxor", 2)
        assert price == 200

        # P3's 5 shares worth $1000
        assert p3.get_stock_count("Luxor") == 5
        stock_value = p3.get_stock_count("Luxor") * price
        assert stock_value == 1000
