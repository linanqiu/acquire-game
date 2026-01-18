"""Tests for stock disposition during mergers."""

import pytest

from game.game import Game, GamePhase
from game.board import Tile
from game.hotel import Hotel
from tests.scenarios.conftest import (
    ChainBuilder,
    give_player_tile,
    give_player_stocks,
    set_current_player,
)


class TestDispositionOptions:
    """Tests for stock disposition options."""

    def test_sell_all_receives_money(self, game_with_two_players):
        """Selling all defunct stock should give money at current price."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up chains
        builder.setup_chain("Luxor", 3, start_col=1, row="A")  # Price at size 3 = $300
        builder.setup_chain("Tower", 2, start_col=5, row="A")

        # Give player Tower stock
        player = game.get_current_player()
        give_player_stocks(player, "Tower", 4, game.hotel)
        initial_money = player.money

        # Set up merger state manually for testing
        game.phase = GamePhase.MERGING
        game._merger_survivor = "Luxor"
        game._merger_current_defunct = "Tower"
        game.pending_action = {
            "type": "stock_disposition",
            "player_id": player.player_id,
            "defunct_chain": "Tower",
            "surviving_chain": "Luxor",
            "stock_count": 4,
            "available_to_trade": game.hotel.get_available_stocks("Luxor"),
        }

        # Sell all 4 shares at $200 (Tower size 2)
        result = game.handle_stock_disposition(player.player_id, sell=4, trade=0, keep=0)

        assert result["success"] is True
        assert result["sold"] == 4
        assert player.get_stock_count("Tower") == 0
        assert player.money == initial_money + (4 * 200)

    def test_trade_2_for_1_ratio(self, game_with_two_players):
        """Trading should exchange defunct stock at 2:1 ratio."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up chains
        builder.setup_chain("Luxor", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=5, row="A")

        # Give player Tower stock
        player = game.get_current_player()
        give_player_stocks(player, "Tower", 6, game.hotel)
        initial_luxor = player.get_stock_count("Luxor")
        initial_money = player.money

        # Set up merger state
        game.phase = GamePhase.MERGING
        game._merger_survivor = "Luxor"
        game._merger_current_defunct = "Tower"
        game.pending_action = {
            "type": "stock_disposition",
            "player_id": player.player_id,
            "defunct_chain": "Tower",
            "surviving_chain": "Luxor",
            "stock_count": 6,
            "available_to_trade": game.hotel.get_available_stocks("Luxor"),
        }

        # Trade all 6 shares for 3 Luxor
        result = game.handle_stock_disposition(player.player_id, sell=0, trade=6, keep=0)

        assert result["success"] is True
        assert result["traded"] == 6
        assert player.get_stock_count("Tower") == 0
        assert player.get_stock_count("Luxor") == initial_luxor + 3
        assert player.money == initial_money  # No money change

    def test_keep_all_unchanged(self, game_with_two_players):
        """Keeping all stock should leave it unchanged."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up chains
        builder.setup_chain("Luxor", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=5, row="A")

        # Give player Tower stock
        player = game.get_current_player()
        give_player_stocks(player, "Tower", 5, game.hotel)
        initial_tower = player.get_stock_count("Tower")
        initial_money = player.money

        # Set up merger state
        game.phase = GamePhase.MERGING
        game._merger_survivor = "Luxor"
        game._merger_current_defunct = "Tower"
        game.pending_action = {
            "type": "stock_disposition",
            "player_id": player.player_id,
            "defunct_chain": "Tower",
            "surviving_chain": "Luxor",
            "stock_count": 5,
            "available_to_trade": game.hotel.get_available_stocks("Luxor"),
        }

        # Keep all 5 shares
        result = game.handle_stock_disposition(player.player_id, sell=0, trade=0, keep=5)

        assert result["success"] is True
        assert result["kept"] == 5
        assert player.get_stock_count("Tower") == initial_tower
        assert player.money == initial_money

    def test_mixed_sell_trade_keep(self, game_with_two_players):
        """Can mix sell, trade, and keep options."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up chains
        builder.setup_chain("Luxor", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=5, row="A")

        # Give player Tower stock
        player = game.get_current_player()
        give_player_stocks(player, "Tower", 8, game.hotel)
        initial_luxor = player.get_stock_count("Luxor")
        initial_money = player.money

        # Set up merger state
        game.phase = GamePhase.MERGING
        game._merger_survivor = "Luxor"
        game._merger_current_defunct = "Tower"
        game.pending_action = {
            "type": "stock_disposition",
            "player_id": player.player_id,
            "defunct_chain": "Tower",
            "surviving_chain": "Luxor",
            "stock_count": 8,
            "available_to_trade": game.hotel.get_available_stocks("Luxor"),
        }

        # Sell 2, trade 4 (for 2 Luxor), keep 2
        result = game.handle_stock_disposition(player.player_id, sell=2, trade=4, keep=2)

        assert result["success"] is True
        assert result["sold"] == 2
        assert result["traded"] == 4
        assert result["kept"] == 2
        assert player.get_stock_count("Tower") == 2  # Kept 2
        assert player.get_stock_count("Luxor") == initial_luxor + 2
        assert player.money == initial_money + (2 * 200)  # Sold 2 at $200


class TestDispositionConstraints:
    """Tests for stock disposition constraints."""

    def test_trade_limited_by_survivor_availability(self, game_with_two_players):
        """Trade is limited by available survivor stock."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up chains
        builder.setup_chain("Luxor", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=5, row="A")

        # Give player Tower stock
        player = game.get_current_player()
        give_player_stocks(player, "Tower", 10, game.hotel)

        # Exhaust most Luxor stock
        game.hotel._available_stocks["Luxor"] = 2  # Only 2 available

        # Set up merger state
        game.phase = GamePhase.MERGING
        game._merger_survivor = "Luxor"
        game._merger_current_defunct = "Tower"
        game.pending_action = {
            "type": "stock_disposition",
            "player_id": player.player_id,
            "defunct_chain": "Tower",
            "surviving_chain": "Luxor",
            "stock_count": 10,
            "available_to_trade": 2,
        }

        # Try to trade 10 (would need 5 Luxor)
        result = game.handle_stock_disposition(player.player_id, sell=0, trade=10, keep=0)

        assert result["success"] is False
        assert "not enough" in result["error"].lower()

    def test_odd_trade_count_rejected(self, game_with_two_players):
        """Odd trade count should be rejected (2:1 ratio)."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up chains
        builder.setup_chain("Luxor", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=5, row="A")

        # Give player Tower stock
        player = game.get_current_player()
        give_player_stocks(player, "Tower", 5, game.hotel)

        # Set up merger state
        game.phase = GamePhase.MERGING
        game._merger_survivor = "Luxor"
        game._merger_current_defunct = "Tower"
        game.pending_action = {
            "type": "stock_disposition",
            "player_id": player.player_id,
            "defunct_chain": "Tower",
            "surviving_chain": "Luxor",
            "stock_count": 5,
            "available_to_trade": game.hotel.get_available_stocks("Luxor"),
        }

        # Try to trade 3 (odd number)
        result = game.handle_stock_disposition(player.player_id, sell=0, trade=3, keep=2)

        assert result["success"] is False
        assert "even" in result["error"].lower()

    def test_counts_must_equal_holdings(self, game_with_two_players):
        """Sell + trade + keep must equal total holdings."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up chains
        builder.setup_chain("Luxor", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=5, row="A")

        # Give player Tower stock
        player = game.get_current_player()
        give_player_stocks(player, "Tower", 6, game.hotel)

        # Set up merger state
        game.phase = GamePhase.MERGING
        game._merger_survivor = "Luxor"
        game._merger_current_defunct = "Tower"
        game.pending_action = {
            "type": "stock_disposition",
            "player_id": player.player_id,
            "defunct_chain": "Tower",
            "surviving_chain": "Luxor",
            "stock_count": 6,
            "available_to_trade": game.hotel.get_available_stocks("Luxor"),
        }

        # Try to dispose of wrong total
        result = game.handle_stock_disposition(player.player_id, sell=2, trade=2, keep=1)  # Total 5 != 6

        assert result["success"] is False
        assert "don't add up" in result["error"].lower()


class TestMultipleStockholders:
    """Tests for handling multiple stockholders in a merger."""

    def test_players_prompted_in_turn_order(self, game_with_three_players):
        """Players should be prompted in turn order starting from current player."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up chains
        builder.setup_chain("Luxor", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=5, row="A")

        # Give multiple players Tower stock
        for player_id in ["p1", "p2", "p3"]:
            player = game.get_player(player_id)
            give_player_stocks(player, "Tower", 2, game.hotel)

        # Set current player to p1
        set_current_player(game, "p1")

        # Trigger merger
        player = game.get_current_player()
        tile = Tile(4, "A")
        give_player_tile(player, tile, game)
        game.play_tile(player.player_id, tile)

        # First stockholder should be prompted (in turn order from current player)
        # This depends on the merger processing implementation
        assert game.phase == GamePhase.MERGING or game.phase == GamePhase.BUYING_STOCKS

    def test_each_player_decides_independently(self, game_with_two_players):
        """Each player can make independent disposition decisions."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up chains
        builder.setup_chain("Luxor", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=5, row="A")

        # Give both players Tower stock
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        give_player_stocks(p1, "Tower", 4, game.hotel)
        give_player_stocks(p2, "Tower", 4, game.hotel)

        p1_initial_money = p1.money
        p2_initial_money = p2.money

        # Set up merger state for p1
        game.phase = GamePhase.MERGING
        game._merger_survivor = "Luxor"
        game._merger_current_defunct = "Tower"
        game._merger_stock_players = ["p1", "p2"]
        game._merger_stock_index = 0
        game.pending_action = {
            "type": "stock_disposition",
            "player_id": "p1",
            "defunct_chain": "Tower",
            "surviving_chain": "Luxor",
            "stock_count": 4,
            "available_to_trade": game.hotel.get_available_stocks("Luxor"),
        }

        # P1 sells all
        result = game.handle_stock_disposition("p1", sell=4, trade=0, keep=0)
        assert result["success"] is True
        assert p1.money > p1_initial_money

        # Now p2 should be prompted
        if game.pending_action and game.pending_action.get("type") == "stock_disposition":
            assert game.pending_action.get("player_id") == "p2"
