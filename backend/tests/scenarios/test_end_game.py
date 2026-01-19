"""Tests for end game conditions and finalization."""


from game.game import GamePhase
from game.board import Tile
from game.rules import Rules
from tests.scenarios.conftest import (
    ChainBuilder,
    give_player_stocks,
)


class TestEndGameConditions:
    """Tests for end game trigger conditions."""

    def test_ends_when_chain_reaches_41(self, game_with_two_players):
        """Game can end when any chain reaches 41+ tiles."""
        game = game_with_two_players

        # Create a chain with 41 tiles (need to span multiple rows)
        # Place 12 tiles each in rows A, B, C and 5 in row D
        for col in range(1, 13):
            tile = Tile(col, "A")
            game.board.place_tile(tile)
            game.board.set_chain(tile, "Luxor")

        for col in range(1, 13):
            tile = Tile(col, "B")
            game.board.place_tile(tile)
            game.board.set_chain(tile, "Luxor")

        for col in range(1, 13):
            tile = Tile(col, "C")
            game.board.place_tile(tile)
            game.board.set_chain(tile, "Luxor")

        for col in range(1, 6):  # 5 more tiles
            tile = Tile(col, "D")
            game.board.place_tile(tile)
            game.board.set_chain(tile, "Luxor")

        game.hotel.activate_chain("Luxor")

        # Total: 12 + 12 + 12 + 5 = 41 tiles
        assert game.board.get_chain_size("Luxor") == 41
        assert Rules.check_end_game(game.board, game.hotel) is True

    def test_ends_when_all_chains_safe(self, game_with_two_players):
        """Game can end when all active chains are safe (11+ tiles)."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Create two chains, both with 11 tiles (safe)
        builder.setup_chain("Luxor", 11, start_col=1, row="A")
        builder.setup_chain("Tower", 11, start_col=1, row="C")

        assert game.board.get_chain_size("Luxor") == 11
        assert game.board.get_chain_size("Tower") == 11

        can_end = Rules.check_end_game(game.board, game.hotel)
        assert can_end is True

    def test_not_ended_with_unsafe_chains(self, game_with_two_players):
        """Game cannot end if any active chain is unsafe."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # One safe chain, one unsafe chain
        builder.setup_chain("Luxor", 11, start_col=1, row="A")  # Safe
        builder.setup_chain("Tower", 5, start_col=1, row="C")   # Unsafe

        can_end = Rules.check_end_game(game.board, game.hotel)
        assert can_end is False

    def test_no_active_chains_cannot_end(self, game_with_two_players):
        """Game cannot end if there are no active chains."""
        game = game_with_two_players

        # No chains on board
        can_end = Rules.check_end_game(game.board, game.hotel)
        assert can_end is False


class TestEndGameFinalization:
    """Tests for end game finalization mechanics."""

    def test_final_bonuses_paid_all_chains(self, game_with_two_players):
        """Final bonuses should be paid for all active chains."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up two chains
        builder.setup_chain("Luxor", 5, start_col=1, row="A")
        builder.setup_chain("Tower", 4, start_col=7, row="A")

        # Give players stocks
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")

        give_player_stocks(p1, "Luxor", 5, game.hotel)
        give_player_stocks(p2, "Tower", 3, game.hotel)

        initial_p1_money = p1.money
        initial_p2_money = p2.money

        # End the game
        result = game.end_game()

        assert result["success"] is True

        # Both players should have received bonuses
        # P1: Luxor majority + minority (sole holder)
        # P2: Tower majority + minority (sole holder)
        assert p1.money > initial_p1_money
        assert p2.money > initial_p2_money

    def test_all_stocks_liquidated_at_price(self, game_with_two_players):
        """All stocks should be liquidated at current prices."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up chain
        builder.setup_chain("Luxor", 5, start_col=1, row="A")  # $500 price

        # Give player stocks
        p1 = game.get_player("p1")
        give_player_stocks(p1, "Luxor", 10, game.hotel)

        initial_money = p1.money

        # End the game
        result = game.end_game()

        assert result["success"] is True

        # Player should have sold all stocks at $500 each
        # Plus majority + minority bonuses ($5000 + $2500)
        expected_from_stocks = 10 * 500
        expected_bonuses = 5000 + 2500
        expected_gain = expected_from_stocks + expected_bonuses

        assert p1.money == initial_money + expected_gain
        assert p1.get_stock_count("Luxor") == 0

    def test_standings_sorted_by_money(self, game_with_three_players):
        """Final standings should be sorted by money descending."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up chain
        builder.setup_chain("Luxor", 5, start_col=1, row="A")

        # Give different amounts of stocks to create different final scores
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p3 = game.get_player("p3")

        give_player_stocks(p1, "Luxor", 2, game.hotel)   # Least
        give_player_stocks(p2, "Luxor", 10, game.hotel)  # Most
        give_player_stocks(p3, "Luxor", 5, game.hotel)   # Middle

        # End the game
        result = game.end_game()

        assert result["success"] is True
        standings = result["standings"]

        # P2 should be first (most stocks -> highest bonuses + liquidation)
        assert standings[0]["player_id"] == "p2"
        # Verify descending order
        for i in range(len(standings) - 1):
            assert standings[i]["money"] >= standings[i + 1]["money"]

    def test_no_actions_after_game_over(self, game_with_two_players):
        """No actions should be allowed after game ends."""
        game = game_with_two_players

        # End the game
        game.end_game()
        assert game.phase == GamePhase.GAME_OVER

        # Try to end again
        result = game.end_game()
        assert result["success"] is False
        assert "already over" in result["error"].lower()

        # Try to play a tile
        tile = Tile(1, "A")
        result = game.play_tile("p1", tile)
        assert result["success"] is False

    def test_winner_determined_correctly(self, game_with_two_players):
        """Winner should be the player with most money."""
        game = game_with_two_players
        builder = ChainBuilder(game)

        # Set up chain
        builder.setup_chain("Imperial", 10, start_col=1, row="A")

        # Give more stocks to p1
        p1 = game.get_player("p1")
        p2 = game.get_player("p2")

        give_player_stocks(p1, "Imperial", 15, game.hotel)  # Clear winner
        give_player_stocks(p2, "Imperial", 2, game.hotel)

        # End the game
        result = game.end_game()

        assert result["success"] is True
        assert result["winner"]["player_id"] == "p1"


class TestEndGameFromLobby:
    """Tests for end game edge cases."""

    def test_cannot_end_from_lobby(self, game_in_lobby):
        """Cannot end game that hasn't started."""
        game = game_in_lobby

        result = game.end_game()

        assert result["success"] is False
        assert "hasn't started" in result["error"].lower()

    def test_inactive_chain_stocks_worth_zero(self, game_with_two_players):
        """Stocks in inactive chains should be worth $0 at end."""
        game = game_with_two_players

        # Give player stocks in inactive chain
        p1 = game.get_player("p1")
        p1._stocks["Luxor"] = 10  # Directly set without activating chain

        # Set up another chain so game can technically end
        # Need to place tiles without going through normal chain setup to avoid
        # conflicts - let's use a simpler setup
        builder = ChainBuilder(game)

        # Create Tower with 11 tiles across rows (not 41 which would be harder)
        # 11 tiles makes it safe, which triggers end condition
        builder.setup_chain("Tower", 11, start_col=1, row="A")

        # End the game
        result = game.end_game()

        assert result["success"] is True
        # Player should have sold inactive chain stocks at $0
        # Money should remain unchanged from Luxor (it's inactive)
        # The only money change would be from Tower, but p1 has no Tower stock
        assert p1.get_stock_count("Luxor") == 0  # All stocks should be liquidated
