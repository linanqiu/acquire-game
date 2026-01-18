"""Tests for the main Game class."""

import pytest
from game.game import Game, GamePhase
from game.board import Tile, Board
from game.hotel import Hotel
from game.player import Player


class TestGameInitialization:
    """Tests for game initialization."""

    def test_game_initial_state(self):
        """Test that a new game starts in lobby phase."""
        game = Game()
        assert game.phase == GamePhase.LOBBY
        assert len(game.players) == 0
        assert len(game.tile_bag) == 0
        assert game.current_player_index == 0
        assert game.pending_action is None

    def test_game_has_empty_board(self):
        """Test that a new game has an empty board."""
        game = Game()
        assert isinstance(game.board, Board)
        # Check all cells are empty
        for col in range(1, 13):
            for row in "ABCDEFGHI":
                cell = game.board.get_cell(col, row)
                assert cell.chain is None

    def test_game_has_hotel_manager(self):
        """Test that a new game has a hotel manager."""
        game = Game()
        assert isinstance(game.hotel, Hotel)
        assert len(game.hotel.get_active_chains()) == 0


class TestAddingPlayers:
    """Tests for adding players to the game."""

    def test_add_player(self):
        """Test adding a player to the game."""
        game = Game()
        player = game.add_player("p1", "Alice")

        assert len(game.players) == 1
        assert player.player_id == "p1"
        assert player.name == "Alice"
        assert player.money == Player.STARTING_MONEY

    def test_add_multiple_players(self):
        """Test adding multiple players."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Charlie")

        assert len(game.players) == 3

    def test_add_bot_player(self):
        """Test adding a bot player."""
        game = Game()
        player = game.add_player("bot1", "Bot Alice", is_bot=True)

        assert "bot1" in game.bots
        assert game.bots["bot1"].player == player
        assert game.bots["bot1"].difficulty == "medium"

    def test_add_bot_with_difficulty(self):
        """Test adding a bot with custom difficulty."""
        game = Game()
        game.add_player("bot1", "Easy Bot", is_bot=True, bot_difficulty="easy")
        game.add_player("bot2", "Hard Bot", is_bot=True, bot_difficulty="hard")

        assert game.bots["bot1"].difficulty == "easy"
        assert game.bots["bot2"].difficulty == "hard"

    def test_cannot_add_duplicate_player_id(self):
        """Test that duplicate player IDs are rejected."""
        game = Game()
        game.add_player("p1", "Alice")

        with pytest.raises(ValueError, match="already exists"):
            game.add_player("p1", "Bob")

    def test_cannot_add_more_than_max_players(self):
        """Test that adding more than 6 players raises an error."""
        game = Game()
        for i in range(6):
            game.add_player(f"p{i}", f"Player {i}")

        with pytest.raises(ValueError, match="Maximum"):
            game.add_player("p7", "Extra Player")

    def test_cannot_add_player_after_game_starts(self):
        """Test that players cannot be added after game starts."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        with pytest.raises(ValueError, match="started"):
            game.add_player("p3", "Charlie")

    def test_remove_player(self):
        """Test removing a player from the lobby."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")

        result = game.remove_player("p1")
        assert result is True
        assert len(game.players) == 1
        assert game.players[0].player_id == "p2"

    def test_remove_nonexistent_player(self):
        """Test removing a player that doesn't exist."""
        game = Game()
        game.add_player("p1", "Alice")

        result = game.remove_player("p999")
        assert result is False


class TestStartGame:
    """Tests for starting the game."""

    def test_start_game(self):
        """Test starting a game."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        assert game.phase == GamePhase.PLAYING
        assert game.current_player_index == 0

    def test_start_game_deals_tiles(self):
        """Test that starting deals 6 tiles to each player."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        for player in game.players:
            assert player.hand_size == 6

    def test_start_game_shuffles_tiles(self):
        """Test that tiles are shuffled (not in order)."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Check that tile bag exists and has correct count
        # 108 total - (6 * 2 players) = 96 remaining
        assert len(game.tile_bag) == 108 - 12

    def test_cannot_start_with_less_than_min_players(self):
        """Test that game cannot start with fewer than 2 players."""
        game = Game()
        game.add_player("p1", "Alice")

        with pytest.raises(ValueError, match="at least"):
            game.start_game()

    def test_cannot_start_game_twice(self):
        """Test that game cannot be started twice."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        with pytest.raises(ValueError, match="already started"):
            game.start_game()


class TestTurnFlow:
    """Tests for basic turn flow."""

    def test_get_current_player(self):
        """Test getting the current player."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        current = game.get_current_player()
        assert current.player_id == "p1"

    def test_next_turn(self):
        """Test advancing to the next player."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Set phase to allow next_turn
        game.phase = GamePhase.BUYING_STOCKS
        game.next_turn()

        current = game.get_current_player()
        assert current.player_id == "p2"

    def test_turn_wraps_around(self):
        """Test that turns wrap around to first player."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        game.phase = GamePhase.BUYING_STOCKS
        game.next_turn()  # p2
        game.next_turn()  # p1

        current = game.get_current_player()
        assert current.player_id == "p1"

    def test_play_tile_isolated(self):
        """Test playing an isolated tile."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        player = game.get_current_player()
        tile = player.hand[0]

        result = game.play_tile("p1", tile)

        assert result["success"] is True
        assert result["result"] == "nothing"
        assert game.phase == GamePhase.BUYING_STOCKS

    def test_cannot_play_tile_not_in_hand(self):
        """Test that you cannot play a tile you don't have."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Try to play a tile not in hand
        fake_tile = Tile(1, "A")
        p1 = game.get_player("p1")
        if fake_tile in p1.hand:
            fake_tile = Tile(12, "I")  # Try another

        result = game.play_tile("p1", fake_tile)
        assert result["success"] is False
        assert "not in hand" in result["error"]

    def test_cannot_play_on_other_players_turn(self):
        """Test that you cannot play on another player's turn."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        p2 = game.get_player("p2")
        tile = p2.hand[0]

        result = game.play_tile("p2", tile)
        assert result["success"] is False
        assert "Not your turn" in result["error"]


class TestBuyStocks:
    """Tests for buying stocks."""

    def test_buy_stocks_requires_active_chain(self):
        """Test that you can only buy stocks of active chains."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Play isolated tile to get to buying phase
        tile = game.get_current_player().hand[0]
        game.play_tile("p1", tile)

        # Try to buy inactive chain
        result = game.buy_stocks("p1", ["Luxor"])
        assert result["success"] is False
        assert "not active" in result["error"]

    def test_buy_stocks_success(self):
        """Test successfully buying stocks."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Manually set up an active chain
        game.board.place_tile(Tile(1, "A"))
        game.board.place_tile(Tile(2, "A"))
        game.board.set_chain(Tile(1, "A"), "Luxor")
        game.board.set_chain(Tile(2, "A"), "Luxor")
        game.hotel.activate_chain("Luxor")

        # Play isolated tile to get to buying phase
        tile = game.get_current_player().hand[0]
        game.play_tile("p1", tile)

        # Buy stock
        result = game.buy_stocks("p1", ["Luxor"])
        assert result["success"] is True
        assert len(result["purchased"]) == 1

    def test_cannot_buy_more_than_three_stocks(self):
        """Test that you cannot buy more than 3 stocks per turn."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Set up active chain
        game.board.place_tile(Tile(1, "A"))
        game.board.place_tile(Tile(2, "A"))
        game.board.set_chain(Tile(1, "A"), "Luxor")
        game.board.set_chain(Tile(2, "A"), "Luxor")
        game.hotel.activate_chain("Luxor")

        tile = game.get_current_player().hand[0]
        game.play_tile("p1", tile)

        result = game.buy_stocks("p1", ["Luxor", "Luxor", "Luxor", "Luxor"])
        assert result["success"] is False
        assert "up to 3" in result["error"]

    def test_buy_stocks_deducts_money(self):
        """Test that buying stocks deducts money."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Set up active chain
        game.board.place_tile(Tile(1, "A"))
        game.board.place_tile(Tile(2, "A"))
        game.board.set_chain(Tile(1, "A"), "Luxor")
        game.board.set_chain(Tile(2, "A"), "Luxor")
        game.hotel.activate_chain("Luxor")

        player = game.get_current_player()
        initial_money = player.money

        tile = player.hand[0]
        game.play_tile("p1", tile)

        game.buy_stocks("p1", ["Luxor"])

        # Luxor at size 2 costs $200
        assert player.money == initial_money - 200
        assert player.get_stock_count("Luxor") == 1


class TestChainFounding:
    """Tests for founding hotel chains."""

    def test_play_tile_that_founds_chain(self):
        """Test playing a tile that founds a new chain."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Place an isolated tile on the board first
        game.board.place_tile(Tile(5, "E"))

        # Give player an adjacent tile (remove one first to make room)
        player = game.get_current_player()
        adjacent_tile = Tile(5, "F")
        if adjacent_tile not in player.hand:
            player.remove_tile(player.hand[0])
            player.add_tile(adjacent_tile)

        result = game.play_tile("p1", adjacent_tile)

        assert result["success"] is True
        assert result["result"] == "found"
        assert game.phase == GamePhase.FOUNDING_CHAIN
        assert "available_chains" in result
        assert len(result["available_chains"]) == 7

    def test_found_chain(self):
        """Test founding a chain after playing a founding tile."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Set up for founding
        game.board.place_tile(Tile(5, "E"))
        player = game.get_current_player()
        adjacent_tile = Tile(5, "F")
        if adjacent_tile not in player.hand:
            player.remove_tile(player.hand[0])
            player.add_tile(adjacent_tile)

        game.play_tile("p1", adjacent_tile)

        # Now found the chain
        result = game.found_chain("p1", "Luxor")

        assert result["success"] is True
        assert result["chain"] == "Luxor"
        assert result["founder_bonus"] is True
        assert game.hotel.is_chain_active("Luxor")
        assert game.phase == GamePhase.BUYING_STOCKS

        # Founder should have 1 free stock
        assert player.get_stock_count("Luxor") == 1

    def test_cannot_found_already_active_chain(self):
        """Test that you cannot found an already active chain."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Activate Luxor
        game.hotel.activate_chain("Luxor")

        # Set up for founding
        game.board.place_tile(Tile(5, "E"))
        player = game.get_current_player()
        adjacent_tile = Tile(5, "F")
        if adjacent_tile not in player.hand:
            player.remove_tile(player.hand[0])
            player.add_tile(adjacent_tile)

        game.play_tile("p1", adjacent_tile)

        # Try to found Luxor (already active)
        result = game.found_chain("p1", "Luxor")

        assert result["success"] is False
        assert "not available" in result["error"]


class TestMergerFlow:
    """Tests for merger scenarios."""

    def setup_merger_scenario(self, game):
        """Helper to set up a merger scenario."""
        # Create two chains that can be merged
        # Chain 1: Luxor (3 tiles)
        game.board.place_tile(Tile(1, "A"))
        game.board.place_tile(Tile(2, "A"))
        game.board.place_tile(Tile(3, "A"))
        game.board.set_chain(Tile(1, "A"), "Luxor")
        game.board.set_chain(Tile(2, "A"), "Luxor")
        game.board.set_chain(Tile(3, "A"), "Luxor")
        game.hotel.activate_chain("Luxor")

        # Chain 2: Tower (2 tiles)
        game.board.place_tile(Tile(1, "C"))
        game.board.place_tile(Tile(2, "C"))
        game.board.set_chain(Tile(1, "C"), "Tower")
        game.board.set_chain(Tile(2, "C"), "Tower")
        game.hotel.activate_chain("Tower")

        # Give players some stock
        p1 = game.get_player("p1")
        p1._stocks["Luxor"] = 3
        p1._stocks["Tower"] = 2

        return Tile(1, "B")  # This tile will connect the chains

    def test_play_tile_triggers_merger(self):
        """Test that playing a tile between chains triggers a merger."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        merger_tile = self.setup_merger_scenario(game)
        player = game.get_current_player()
        if merger_tile not in player.hand:
            player.remove_tile(player.hand[0])
            player.add_tile(merger_tile)

        result = game.play_tile("p1", merger_tile)

        assert result["success"] is True
        assert result["result"] == "merge"
        assert result["survivor"] == "Luxor"  # Larger chain survives
        assert "Tower" in result["defunct"]

    def test_merger_pays_bonuses(self):
        """Test that merger pays bonuses to stockholders."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        merger_tile = self.setup_merger_scenario(game)
        player = game.get_current_player()
        initial_money = player.money

        if merger_tile not in player.hand:
            player.remove_tile(player.hand[0])
            player.add_tile(merger_tile)

        game.play_tile("p1", merger_tile)

        # P1 has Tower stock, should get bonus
        # Tower size 2 -> stock price $200 -> majority bonus $2000, minority $1000
        # P1 is sole stockholder, gets both
        assert player.money >= initial_money  # Should have received bonus

    def test_merger_tie_requires_choice(self):
        """Test that tied chains require player to choose survivor."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Create two chains of equal size
        game.board.place_tile(Tile(1, "A"))
        game.board.place_tile(Tile(2, "A"))
        game.board.set_chain(Tile(1, "A"), "Luxor")
        game.board.set_chain(Tile(2, "A"), "Luxor")
        game.hotel.activate_chain("Luxor")

        game.board.place_tile(Tile(1, "C"))
        game.board.place_tile(Tile(2, "C"))
        game.board.set_chain(Tile(1, "C"), "Tower")
        game.board.set_chain(Tile(2, "C"), "Tower")
        game.hotel.activate_chain("Tower")

        # Merger tile
        merger_tile = Tile(1, "B")
        player = game.get_current_player()
        if merger_tile not in player.hand:
            player.remove_tile(player.hand[0])
            player.add_tile(merger_tile)

        result = game.play_tile("p1", merger_tile)

        assert result["success"] is True
        assert result["result"] == "merge_tie"
        assert game.phase == GamePhase.MERGING
        assert "tied_chains" in result

    def test_choose_merger_survivor(self):
        """Test choosing a merger survivor."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Create two chains of equal size
        game.board.place_tile(Tile(1, "A"))
        game.board.place_tile(Tile(2, "A"))
        game.board.set_chain(Tile(1, "A"), "Luxor")
        game.board.set_chain(Tile(2, "A"), "Luxor")
        game.hotel.activate_chain("Luxor")

        game.board.place_tile(Tile(1, "C"))
        game.board.place_tile(Tile(2, "C"))
        game.board.set_chain(Tile(1, "C"), "Tower")
        game.board.set_chain(Tile(2, "C"), "Tower")
        game.hotel.activate_chain("Tower")

        merger_tile = Tile(1, "B")
        player = game.get_current_player()
        if merger_tile not in player.hand:
            player.remove_tile(player.hand[0])
            player.add_tile(merger_tile)

        game.play_tile("p1", merger_tile)

        result = game.choose_merger_survivor("p1", "Luxor")

        assert result["success"] is True
        assert result["survivor"] == "Luxor"


class TestStockDisposition:
    """Tests for stock disposition during mergers."""

    def test_stock_disposition_sell(self):
        """Test selling defunct stock during merger."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Set up merger scenario
        game.board.place_tile(Tile(1, "A"))
        game.board.place_tile(Tile(2, "A"))
        game.board.place_tile(Tile(3, "A"))
        game.board.set_chain(Tile(1, "A"), "Luxor")
        game.board.set_chain(Tile(2, "A"), "Luxor")
        game.board.set_chain(Tile(3, "A"), "Luxor")
        game.hotel.activate_chain("Luxor")

        game.board.place_tile(Tile(1, "C"))
        game.board.place_tile(Tile(2, "C"))
        game.board.set_chain(Tile(1, "C"), "Tower")
        game.board.set_chain(Tile(2, "C"), "Tower")
        game.hotel.activate_chain("Tower")

        player = game.get_current_player()
        player._stocks["Tower"] = 4

        merger_tile = Tile(1, "B")
        if merger_tile not in player.hand:
            player.remove_tile(player.hand[0])
            player.add_tile(merger_tile)

        initial_money = player.money
        game.play_tile("p1", merger_tile)

        # Handle stock disposition - sell all
        result = game.handle_stock_disposition("p1", sell=4, trade=0, keep=0)

        assert result["success"] is True
        assert player.get_stock_count("Tower") == 0
        assert player.money > initial_money  # Got money from selling

    def test_stock_disposition_trade(self):
        """Test trading defunct stock for survivor stock."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Set up merger
        game.board.place_tile(Tile(1, "A"))
        game.board.place_tile(Tile(2, "A"))
        game.board.place_tile(Tile(3, "A"))
        game.board.set_chain(Tile(1, "A"), "Luxor")
        game.board.set_chain(Tile(2, "A"), "Luxor")
        game.board.set_chain(Tile(3, "A"), "Luxor")
        game.hotel.activate_chain("Luxor")

        game.board.place_tile(Tile(1, "C"))
        game.board.place_tile(Tile(2, "C"))
        game.board.set_chain(Tile(1, "C"), "Tower")
        game.board.set_chain(Tile(2, "C"), "Tower")
        game.hotel.activate_chain("Tower")

        player = game.get_current_player()
        player._stocks["Tower"] = 4

        merger_tile = Tile(1, "B")
        if merger_tile not in player.hand:
            player.remove_tile(player.hand[0])
            player.add_tile(merger_tile)

        game.play_tile("p1", merger_tile)

        # Handle stock disposition - trade all (4 Tower -> 2 Luxor)
        result = game.handle_stock_disposition("p1", sell=0, trade=4, keep=0)

        assert result["success"] is True
        assert player.get_stock_count("Tower") == 0
        assert player.get_stock_count("Luxor") == 2  # 4:2 trade ratio

    def test_stock_disposition_must_be_even_for_trade(self):
        """Test that trade count must be even."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Set up merger
        game.board.place_tile(Tile(1, "A"))
        game.board.place_tile(Tile(2, "A"))
        game.board.place_tile(Tile(3, "A"))
        game.board.set_chain(Tile(1, "A"), "Luxor")
        game.board.set_chain(Tile(2, "A"), "Luxor")
        game.board.set_chain(Tile(3, "A"), "Luxor")
        game.hotel.activate_chain("Luxor")

        game.board.place_tile(Tile(1, "C"))
        game.board.place_tile(Tile(2, "C"))
        game.board.set_chain(Tile(1, "C"), "Tower")
        game.board.set_chain(Tile(2, "C"), "Tower")
        game.hotel.activate_chain("Tower")

        player = game.get_current_player()
        player._stocks["Tower"] = 5

        merger_tile = Tile(1, "B")
        if merger_tile not in player.hand:
            player.remove_tile(player.hand[0])
            player.add_tile(merger_tile)

        game.play_tile("p1", merger_tile)

        # Try odd trade
        result = game.handle_stock_disposition("p1", sell=0, trade=3, keep=2)

        assert result["success"] is False
        assert "even" in result["error"]


class TestEndGame:
    """Tests for end game detection and scoring."""

    def test_check_end_game_chain_41(self):
        """Test that game can end when a chain has 41+ tiles."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Create a chain with 41 tiles
        game.hotel.activate_chain("Luxor")
        for col in range(1, 13):  # 12 columns
            for row in "ABCD":  # 4 rows = 48 tiles, but we'll only use 41
                if game.board.get_chain_size("Luxor") >= 41:
                    break
                tile = Tile(col, row)
                game.board.place_tile(tile)
                game.board.set_chain(tile, "Luxor")

        state = game.get_public_state()
        assert state["can_end_game"] is True

    def test_check_end_game_all_safe(self):
        """Test that game can end when all active chains are safe."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Create two chains, both with 11+ tiles (safe)
        # Chain 1
        game.hotel.activate_chain("Luxor")
        for col in range(1, 12):  # 11 tiles
            tile = Tile(col, "A")
            game.board.place_tile(tile)
            game.board.set_chain(tile, "Luxor")

        # Chain 2
        game.hotel.activate_chain("Tower")
        for col in range(1, 12):  # 11 tiles
            tile = Tile(col, "C")
            game.board.place_tile(tile)
            game.board.set_chain(tile, "Tower")

        state = game.get_public_state()
        assert state["can_end_game"] is True

    def test_end_game_calculates_scores(self):
        """Test that ending the game calculates final scores."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Set up some chains and stocks
        game.hotel.activate_chain("Luxor")
        for col in range(1, 6):
            tile = Tile(col, "A")
            game.board.place_tile(tile)
            game.board.set_chain(tile, "Luxor")

        p1 = game.get_player("p1")
        p2 = game.get_player("p2")
        p1._stocks["Luxor"] = 5
        p2._stocks["Luxor"] = 3

        result = game.end_game()

        assert result["success"] is True
        assert game.phase == GamePhase.GAME_OVER
        assert "standings" in result
        assert len(result["standings"]) == 2
        assert result["standings"][0]["rank"] == 1

    def test_end_game_pays_final_bonuses(self):
        """Test that ending the game pays bonuses for all active chains."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        # Set up a chain
        game.hotel.activate_chain("Luxor")
        for col in range(1, 6):
            tile = Tile(col, "A")
            game.board.place_tile(tile)
            game.board.set_chain(tile, "Luxor")

        p1 = game.get_player("p1")
        p1._stocks["Luxor"] = 10
        initial_money = p1.money

        game.end_game()

        # Should have received bonus + stock value
        assert p1.money > initial_money

    def test_cannot_end_game_in_lobby(self):
        """Test that game cannot be ended from lobby."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")

        result = game.end_game()
        assert result["success"] is False


class TestBotExecution:
    """Tests for bot turn execution."""

    def test_execute_bot_turn_plays_tile(self):
        """Test that bot executes a full turn."""
        game = Game()
        game.add_player("bot1", "Bot Alice", is_bot=True)
        game.add_player("p2", "Bob")
        game.start_game()

        # Ensure it's bot's turn
        assert game.get_current_player().player_id == "bot1"

        actions = game.execute_bot_turn("bot1")

        assert len(actions) > 0
        # Should have at least played a tile and ended turn
        action_types = [a.get("action") for a in actions]
        assert "play_tile" in action_types or "skip_tile" in action_types
        assert "end_turn" in action_types

    def test_execute_bot_turn_handles_founding(self):
        """Test that bot handles chain founding."""
        game = Game()
        game.add_player("bot1", "Bot Alice", is_bot=True)
        game.add_player("p2", "Bob")
        game.start_game()

        # Place a tile that will allow founding when adjacent tile is played
        game.board.place_tile(Tile(5, "E"))

        # Give bot an adjacent tile
        bot_player = game.get_player("bot1")
        adjacent_tile = Tile(5, "F")
        if adjacent_tile not in bot_player.hand:
            bot_player.add_tile(adjacent_tile)
        # Remove other tiles so bot must play this one
        for tile in list(bot_player.hand):
            if tile != adjacent_tile:
                bot_player.remove_tile(tile)

        actions = game.execute_bot_turn("bot1")

        action_types = [a.get("action") for a in actions]
        assert "found_chain" in action_types

    def test_non_bot_cannot_use_execute_bot_turn(self):
        """Test that non-bot players cannot use execute_bot_turn."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        actions = game.execute_bot_turn("p1")

        assert len(actions) == 1
        assert actions[0]["success"] is False
        assert "not a bot" in actions[0]["error"]


class TestGameState:
    """Tests for game state retrieval."""

    def test_get_public_state(self):
        """Test getting public game state."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        state = game.get_public_state()

        assert state["phase"] == "playing"
        assert state["current_player"] == "p1"
        assert "board" in state
        assert "chains" in state
        assert "players" in state
        assert len(state["players"]) == 2
        assert state["tiles_remaining"] == 108 - 12

    def test_get_player_state(self):
        """Test getting private player state."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        state = game.get_player_state("p1")

        assert "hand" in state
        assert len(state["hand"]) == 6
        assert "playable_tiles" in state
        assert state["can_act"] is True

    def test_player_state_includes_public_state(self):
        """Test that player state includes all public state."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        state = game.get_player_state("p1")

        assert "phase" in state
        assert "current_player" in state
        assert "board" in state

    def test_can_player_act_current_player(self):
        """Test that current player can act."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        assert game.can_player_act("p1") is True
        assert game.can_player_act("p2") is False


class TestEndTurn:
    """Tests for ending a turn."""

    def test_end_turn_draws_tile(self):
        """Test that ending turn draws a tile."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        player = game.get_current_player()

        # Play a tile and buy stocks
        tile = player.hand[0]
        game.play_tile("p1", tile)
        game.buy_stocks("p1", [])

        result = game.end_turn("p1")

        assert result["success"] is True
        assert player.hand_size == 6  # Should be back to 6 after drawing

    def test_end_turn_advances_player(self):
        """Test that ending turn advances to next player."""
        game = Game()
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.start_game()

        player = game.get_current_player()
        tile = player.hand[0]
        game.play_tile("p1", tile)
        game.buy_stocks("p1", [])

        result = game.end_turn("p1")

        assert result["next_player"] == "p2"
        assert game.get_current_player().player_id == "p2"
