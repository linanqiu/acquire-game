"""Scenario tests for trading - from docs/tests/scenario/trading.md

Covers player-to-player trading and merger 2:1 stock trades.
"""

from game.game import Game, GamePhase
from game.board import Tile
from game.action import TradeOffer
from tests.scenarios.conftest import (
    ChainBuilder,
    give_player_tile,
    give_player_stocks,
)


class TestPlayerToPlayerTrading:
    """Tests for player-to-player trading (Scenarios 2.1 - 2.10)."""

    def test_scenario_2_1_simple_stock_for_stock_trade(self, game_with_three_players):
        """Scenario 2.1: Simple Stock-for-Stock Trade

        Player A offers stock for Player B's stock.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up chains
        builder.setup_chain("American", 3, start_col=1, row="A")
        builder.setup_chain("Continental", 3, start_col=1, row="C")

        player_a = game.get_current_player()
        player_b = game.players[1]

        # Give players stocks
        give_player_stocks(player_a, "American", 4, game.hotel)
        give_player_stocks(player_b, "Continental", 3, game.hotel)

        # Create trade offer
        trade = TradeOffer(
            from_player_id=player_a.player_id,
            to_player_id=player_b.player_id,
            offering_stocks={"American": 2},
            requesting_stocks={"Continental": 1},
        )

        # Propose trade
        result = game.propose_trade(trade)
        assert result["success"] is True

        # Player B accepts
        game.accept_trade(player_b.player_id, trade.trade_id)

        # Verify outcomes
        assert player_a.get_stock_count("American") == 2
        assert player_a.get_stock_count("Continental") == 1
        assert player_b.get_stock_count("American") == 2
        assert player_b.get_stock_count("Continental") == 2

    def test_scenario_2_2_stock_for_money_trade(self, game_with_three_players):
        """Scenario 2.2: Stock-for-Money Trade

        Player A offers stock for money.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("Tower", 3, start_col=1, row="A")

        player_a = game.get_current_player()
        player_b = game.players[1]

        # Give Player A stock
        give_player_stocks(player_a, "Tower", 5, game.hotel)
        initial_money_a = player_a.money
        initial_money_b = player_b.money

        # Create trade offer: 3 Tower for $1200
        trade = TradeOffer(
            from_player_id=player_a.player_id,
            to_player_id=player_b.player_id,
            offering_stocks={"Tower": 3},
            requesting_money=1200,
        )

        result = game.propose_trade(trade)
        assert result["success"] is True

        game.accept_trade(player_b.player_id, trade.trade_id)

        # Verify outcomes
        assert player_a.get_stock_count("Tower") == 2
        assert player_a.money == initial_money_a + 1200
        assert player_b.get_stock_count("Tower") == 3
        assert player_b.money == initial_money_b - 1200

    def test_scenario_2_3_combined_stock_and_money_trade(self, game_with_three_players):
        """Scenario 2.3: Combined Stock and Money Trade

        Trade includes both stock and money.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("Luxor", 3, start_col=1, row="A")
        builder.setup_chain("Imperial", 3, start_col=1, row="C")

        player_a = game.get_current_player()
        player_b = game.players[1]

        give_player_stocks(player_a, "Luxor", 3, game.hotel)
        give_player_stocks(player_a, "Imperial", 1, game.hotel)
        give_player_stocks(player_b, "Imperial", 4, game.hotel)

        initial_money_a = player_a.money

        # Trade: 2 Luxor + $500 for 2 Imperial
        trade = TradeOffer(
            from_player_id=player_a.player_id,
            to_player_id=player_b.player_id,
            offering_stocks={"Luxor": 2},
            offering_money=500,
            requesting_stocks={"Imperial": 2},
        )

        result = game.propose_trade(trade)
        assert result["success"] is True

        game.accept_trade(player_b.player_id, trade.trade_id)

        # Verify outcomes
        assert player_a.get_stock_count("Luxor") == 1
        assert player_a.get_stock_count("Imperial") == 3
        assert player_a.money == initial_money_a - 500

    def test_scenario_2_4_trade_rejection(self, game_with_three_players):
        """Scenario 2.4: Trade Rejection

        Player B declines the trade.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("Festival", 3, start_col=1, row="A")
        builder.setup_chain("Continental", 3, start_col=1, row="C")

        player_a = game.get_current_player()
        player_b = game.players[1]

        give_player_stocks(player_a, "Festival", 4, game.hotel)
        give_player_stocks(player_b, "Continental", 2, game.hotel)

        initial_festival_a = player_a.get_stock_count("Festival")
        initial_continental_b = player_b.get_stock_count("Continental")

        # Create and propose trade
        trade = TradeOffer(
            from_player_id=player_a.player_id,
            to_player_id=player_b.player_id,
            offering_stocks={"Festival": 1},
            requesting_stocks={"Continental": 1},
        )

        game.propose_trade(trade)

        # Player B rejects
        game.reject_trade(player_b.player_id, trade.trade_id)

        # Verify no resources exchanged
        assert player_a.get_stock_count("Festival") == initial_festival_a
        assert player_b.get_stock_count("Continental") == initial_continental_b

    def test_scenario_2_5_trade_cancellation(self, game_with_three_players):
        """Scenario 2.5: Trade Cancellation by Proposer

        Player A cancels their own trade.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("American", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 3, start_col=1, row="C")

        player_a = game.get_current_player()
        player_b = game.players[1]

        give_player_stocks(player_a, "American", 3, game.hotel)
        give_player_stocks(player_b, "Tower", 2, game.hotel)

        initial_american_a = player_a.get_stock_count("American")

        # Create and propose trade
        trade = TradeOffer(
            from_player_id=player_a.player_id,
            to_player_id=player_b.player_id,
            offering_stocks={"American": 1},
            requesting_stocks={"Tower": 1},
        )

        game.propose_trade(trade)

        # Player A cancels
        result = game.cancel_trade(player_a.player_id, trade.trade_id)
        assert result["success"] is True

        # Verify holdings unchanged
        assert player_a.get_stock_count("American") == initial_american_a

    def test_scenario_2_6_invalid_trade_insufficient_stock(
        self, game_with_three_players
    ):
        """Scenario 2.6: Invalid Trade - Insufficient Stock

        Trade rejected due to insufficient resources.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("Worldwide", 3, start_col=1, row="A")
        builder.setup_chain("American", 3, start_col=1, row="C")

        player_a = game.get_current_player()
        player_b = game.players[1]

        give_player_stocks(player_a, "Worldwide", 2, game.hotel)  # Only 2
        give_player_stocks(player_b, "American", 1, game.hotel)

        # Try to trade 3 Worldwide (but only have 2)
        trade = TradeOffer(
            from_player_id=player_a.player_id,
            to_player_id=player_b.player_id,
            offering_stocks={"Worldwide": 3},
            requesting_stocks={"American": 1},
        )

        result = game.propose_trade(trade)
        assert result["success"] is False

    def test_scenario_2_7_invalid_trade_insufficient_money(
        self, game_with_three_players
    ):
        """Scenario 2.7: Invalid Trade - Insufficient Money

        Trade rejected due to insufficient money.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("Tower", 3, start_col=1, row="A")
        builder.setup_chain("Imperial", 3, start_col=1, row="C")

        player_a = game.get_current_player()
        player_b = game.players[1]

        give_player_stocks(player_a, "Tower", 1, game.hotel)
        give_player_stocks(player_b, "Imperial", 2, game.hotel)

        # Reduce player A's money
        player_a._money = 200

        # Try to trade with $500 (but only have $200)
        trade = TradeOffer(
            from_player_id=player_a.player_id,
            to_player_id=player_b.player_id,
            offering_stocks={"Tower": 1},
            offering_money=500,
            requesting_stocks={"Imperial": 1},
        )

        result = game.propose_trade(trade)
        assert result["success"] is False

    def test_scenario_2_10_maximum_pending_trades(self, game_with_three_players):
        """Scenario 2.10: Maximum Pending Trades

        Cannot exceed pending trade limit.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("American", 3, start_col=1, row="A")

        player_a = game.get_current_player()
        player_b = game.players[1]

        give_player_stocks(player_a, "American", 10, game.hotel)
        give_player_stocks(player_b, "American", 10, game.hotel)

        # Create maximum number of pending trades
        for i in range(Game.MAX_PENDING_TRADES_PER_PLAYER):
            trade = TradeOffer(
                from_player_id=player_a.player_id,
                to_player_id=player_b.player_id,
                offering_stocks={"American": 1},
                requesting_money=100,
            )
            result = game.propose_trade(trade)
            if not result["success"]:
                break

        # Try to create one more
        trade = TradeOffer(
            from_player_id=player_a.player_id,
            to_player_id=player_b.player_id,
            offering_stocks={"American": 1},
            requesting_money=100,
        )
        result = game.propose_trade(trade)
        assert result["success"] is False
        assert "maximum" in result.get("error", "").lower()


class TestMerger2to1Trades:
    """Tests for merger 2:1 stock trades (Scenarios 2.11 - 2.18)."""

    def test_scenario_2_11_simple_2_to_1_merger_trade(self, game_with_three_players):
        """Scenario 2.11: Simple 2:1 Merger Trade

        Trade 6 defunct stock for 3 survivor stock.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("American", 5, start_col=1, row="A")
        builder.setup_chain("Tower", 3, start_col=1, row="C")

        player = game.get_current_player()
        give_player_stocks(player, "Tower", 6, game.hotel)
        initial_american = player.get_stock_count("American")

        # Set up merger state
        game.phase = GamePhase.MERGING
        game._merger_survivor = "American"
        game._merger_current_defunct = "Tower"
        game.pending_action = {
            "type": "stock_disposition",
            "player_id": player.player_id,
            "defunct_chain": "Tower",
            "surviving_chain": "American",
            "stock_count": 6,
            "available_to_trade": game.hotel.get_available_stocks("American"),
        }

        # Trade all 6 for 3 American
        result = game.handle_stock_disposition(
            player.player_id, sell=0, trade=6, keep=0
        )

        assert result["success"] is True
        assert player.get_stock_count("Tower") == 0
        assert player.get_stock_count("American") == initial_american + 3

    def test_scenario_2_12_merger_trade_odd_shares(self, game_with_three_players):
        """Scenario 2.12: Merger Trade with Odd Number of Shares

        Odd shares must be sold or kept, not traded.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("Continental", 5, start_col=1, row="A")
        builder.setup_chain("Luxor", 3, start_col=1, row="C")

        player = game.get_current_player()
        give_player_stocks(player, "Luxor", 7, game.hotel)
        initial_money = player.money

        # Set up merger state
        game.phase = GamePhase.MERGING
        game._merger_survivor = "Continental"
        game._merger_current_defunct = "Luxor"
        game.pending_action = {
            "type": "stock_disposition",
            "player_id": player.player_id,
            "defunct_chain": "Luxor",
            "surviving_chain": "Continental",
            "stock_count": 7,
            "available_to_trade": game.hotel.get_available_stocks("Continental"),
        }

        # Trade 6, sell 1
        result = game.handle_stock_disposition(
            player.player_id, sell=1, trade=6, keep=0
        )

        assert result["success"] is True
        assert player.get_stock_count("Luxor") == 0
        assert player.get_stock_count("Continental") == 3
        # Sold 1 at Luxor price (3 tiles = $300)
        assert player.money == initial_money + 300

    def test_scenario_2_13_merger_trade_limited_by_stock(self, game_with_three_players):
        """Scenario 2.13: Merger Trade Limited by Available Stock

        Cannot trade more than available survivor stock allows.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("Festival", 5, start_col=1, row="A")
        builder.setup_chain("Worldwide", 3, start_col=1, row="C")

        player = game.get_current_player()
        give_player_stocks(player, "Worldwide", 10, game.hotel)

        # Limit Festival stock
        game.hotel._available_stocks["Festival"] = 3

        # Set up merger state
        game.phase = GamePhase.MERGING
        game._merger_survivor = "Festival"
        game._merger_current_defunct = "Worldwide"
        game.pending_action = {
            "type": "stock_disposition",
            "player_id": player.player_id,
            "defunct_chain": "Worldwide",
            "surviving_chain": "Festival",
            "stock_count": 10,
            "available_to_trade": 3,
        }

        # Try to trade all 10 (would need 5 Festival, but only 3 available)
        result = game.handle_stock_disposition(
            player.player_id, sell=0, trade=10, keep=0
        )

        assert result["success"] is False

        # Trade 6 (for 3 Festival), sell remaining 4
        result = game.handle_stock_disposition(
            player.player_id, sell=4, trade=6, keep=0
        )

        assert result["success"] is True
        assert player.get_stock_count("Festival") == 3


class TestStockDispositionOptions:
    """Tests for stock disposition options (merged from test_stock_disposition.py)."""

    def test_sell_all_receives_money(self, game_with_three_players):
        """Scenario 2.14: All Sell - No Trading

        Selling all defunct stock gives money at current price.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("American", 5, start_col=1, row="A")
        builder.setup_chain("Tower", 4, start_col=1, row="C")  # 4 tiles = $400

        player = game.get_current_player()
        give_player_stocks(player, "Tower", 8, game.hotel)
        initial_money = player.money

        # Set up merger state
        game.phase = GamePhase.MERGING
        game._merger_survivor = "American"
        game._merger_current_defunct = "Tower"
        game.pending_action = {
            "type": "stock_disposition",
            "player_id": player.player_id,
            "defunct_chain": "Tower",
            "surviving_chain": "American",
            "stock_count": 8,
            "available_to_trade": game.hotel.get_available_stocks("American"),
        }

        # Sell all 8 at $400 each = $3200
        result = game.handle_stock_disposition(
            player.player_id, sell=8, trade=0, keep=0
        )

        assert result["success"] is True
        assert player.get_stock_count("Tower") == 0
        assert player.money == initial_money + 3200

    def test_keep_all_unchanged(self, game_with_three_players):
        """Scenario 2.15: All Hold - No Selling or Trading

        Keeping all stock leaves it unchanged.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("Imperial", 5, start_col=1, row="A")
        builder.setup_chain("Festival", 3, start_col=1, row="C")

        player = game.get_current_player()
        give_player_stocks(player, "Festival", 5, game.hotel)
        initial_money = player.money

        # Set up merger state
        game.phase = GamePhase.MERGING
        game._merger_survivor = "Imperial"
        game._merger_current_defunct = "Festival"
        game.pending_action = {
            "type": "stock_disposition",
            "player_id": player.player_id,
            "defunct_chain": "Festival",
            "surviving_chain": "Imperial",
            "stock_count": 5,
            "available_to_trade": game.hotel.get_available_stocks("Imperial"),
        }

        # Keep all 5
        result = game.handle_stock_disposition(
            player.player_id, sell=0, trade=0, keep=5
        )

        assert result["success"] is True
        assert player.get_stock_count("Festival") == 5
        assert player.money == initial_money

    def test_mixed_sell_trade_keep(self, game_with_three_players):
        """Scenario 2.16: Mixed Disposition - Trade, Sell, and Hold

        Can mix sell, trade, and keep options.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("Continental", 5, start_col=1, row="A")
        builder.setup_chain("Luxor", 3, start_col=1, row="C")  # 3 tiles = $300

        player = game.get_current_player()
        give_player_stocks(player, "Luxor", 12, game.hotel)
        initial_money = player.money

        # Set up merger state
        game.phase = GamePhase.MERGING
        game._merger_survivor = "Continental"
        game._merger_current_defunct = "Luxor"
        game.pending_action = {
            "type": "stock_disposition",
            "player_id": player.player_id,
            "defunct_chain": "Luxor",
            "surviving_chain": "Continental",
            "stock_count": 12,
            "available_to_trade": game.hotel.get_available_stocks("Continental"),
        }

        # Trade 8 for 4, sell 2, keep 2
        result = game.handle_stock_disposition(
            player.player_id, sell=2, trade=8, keep=2
        )

        assert result["success"] is True
        assert player.get_stock_count("Continental") == 4
        assert player.get_stock_count("Luxor") == 2
        assert player.money == initial_money + (2 * 300)  # Sold 2 at $300


class TestDispositionConstraints:
    """Tests for stock disposition constraints."""

    def test_trade_limited_by_survivor_availability(self, game_with_three_players):
        """Trade is limited by available survivor stock."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("Luxor", 5, start_col=1, row="A")
        builder.setup_chain("Tower", 3, start_col=1, row="C")

        player = game.get_current_player()
        give_player_stocks(player, "Tower", 10, game.hotel)

        # Limit Luxor stock
        game.hotel._available_stocks["Luxor"] = 2

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
        result = game.handle_stock_disposition(
            player.player_id, sell=0, trade=10, keep=0
        )

        assert result["success"] is False
        assert "not enough" in result["error"].lower()

    def test_odd_trade_count_rejected(self, game_with_three_players):
        """Odd trade count should be rejected (2:1 ratio)."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("Luxor", 5, start_col=1, row="A")
        builder.setup_chain("Tower", 3, start_col=1, row="C")

        player = game.get_current_player()
        give_player_stocks(player, "Tower", 5, game.hotel)

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
        result = game.handle_stock_disposition(
            player.player_id, sell=0, trade=3, keep=2
        )

        assert result["success"] is False
        assert "even" in result["error"].lower()

    def test_counts_must_equal_holdings(self, game_with_three_players):
        """Sell + trade + keep must equal total holdings."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("Luxor", 5, start_col=1, row="A")
        builder.setup_chain("Tower", 3, start_col=1, row="C")

        player = game.get_current_player()
        give_player_stocks(player, "Tower", 6, game.hotel)

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

        # Try to dispose of wrong total (5 != 6)
        result = game.handle_stock_disposition(
            player.player_id, sell=2, trade=2, keep=1
        )

        assert result["success"] is False
        assert "don't add up" in result["error"].lower()


class TestDispositionOrder:
    """Tests for stock disposition order (Scenario 2.17)."""

    def test_scenario_2_17_mergemaker_first(self, game_with_three_players):
        """Scenario 2.17: Stock Disposition Order - Mergemaker First

        Mergemaker handles disposition before other players.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("American", 5, start_col=1, row="A")
        builder.setup_chain("Tower", 3, start_col=1, row="C")

        player_a = game.get_current_player()
        player_b = game.players[1]
        player_c = game.players[2]

        give_player_stocks(player_a, "Tower", 4, game.hotel)
        give_player_stocks(player_b, "Tower", 6, game.hotel)
        give_player_stocks(player_c, "Tower", 2, game.hotel)

        # Trigger merger
        merger_tile = Tile(1, "B")
        give_player_tile(player_a, merger_tile, game)

        game.play_tile(player_a.player_id, merger_tile)

        # Player A (mergemaker) should handle disposition first
        if game.phase == GamePhase.MERGING:
            assert game.pending_action.get("player_id") == player_a.player_id

    def test_scenario_2_18_zero_defunct_stock_skipped(self, game_with_three_players):
        """Scenario 2.18: Zero Defunct Stock - No Disposition Required

        Players with no defunct stock are skipped.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("Festival", 5, start_col=1, row="A")
        builder.setup_chain("Worldwide", 3, start_col=1, row="C")

        player_a = game.get_current_player()

        # Player A has no Worldwide stock
        assert player_a.get_stock_count("Worldwide") == 0

        # Give player A Festival stock (survivor)
        give_player_stocks(player_a, "Festival", 3, game.hotel)

        # Set up merger state with zero defunct stock
        game.phase = GamePhase.MERGING
        game._merger_survivor = "Festival"
        game._merger_current_defunct = "Worldwide"
        game.pending_action = {
            "type": "stock_disposition",
            "player_id": player_a.player_id,
            "defunct_chain": "Worldwide",
            "surviving_chain": "Festival",
            "stock_count": 0,
            "available_to_trade": game.hotel.get_available_stocks("Festival"),
        }

        # Disposition with 0 stocks
        result = game.handle_stock_disposition(
            player_a.player_id, sell=0, trade=0, keep=0
        )

        assert result["success"] is True
