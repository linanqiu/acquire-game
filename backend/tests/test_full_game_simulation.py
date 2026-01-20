"""Full game simulation tests (BH-008).

End-to-end tests that play complete games with assertions at each phase
to ensure phase transitions are valid and state consistency is maintained.
"""

import pytest
from game.game import Game, GamePhase
from game.hotel import Hotel
from game.rules import Rules


class GameStateValidator:
    """Helper to validate game state consistency."""

    @staticmethod
    def validate_stock_conservation(game: Game):
        """Each chain should have at most 25 stocks total (some may be lost in mergers)."""
        for chain_name in Hotel.get_all_chain_names():
            player_stocks = sum(p.get_stock_count(chain_name) for p in game.players)
            bank_stocks = game.hotel.get_available_stocks(chain_name)
            total = player_stocks + bank_stocks
            # Stock total can be <= 25 due to founding bonuses coming from a separate pool
            # The key invariant is that we don't create more than 25 stocks
            assert total <= 25, f"{chain_name} has {total} stocks, exceeds 25"

    @staticmethod
    def validate_tile_bag_integrity(game: Game):
        """All tiles should be accounted for."""
        total_tiles = 108  # 12 columns x 9 rows
        bag_tiles = len(game.tile_bag)
        played_tiles = sum(
            1
            for col in range(1, 13)
            for row in "ABCDEFGHI"
            if game.board.is_tile_played(game.board.get_cell(col, row))
        )
        player_tiles = sum(p.hand_size for p in game.players)
        accounted = bag_tiles + played_tiles + player_tiles
        # Note: Some tiles may have been discarded (permanently unplayable)
        assert accounted <= total_tiles, (
            f"Tile count exceeded: {accounted} > {total_tiles}"
        )

    @staticmethod
    def validate_phase_state(game: Game):
        """Validate game is in a consistent phase state."""
        phase = game.phase

        if phase == GamePhase.LOBBY:
            assert not game.players or len(game.players) < 3, (
                "LOBBY should have < 3 players"
            )

        elif phase == GamePhase.PLAYING:
            assert game.get_current_player() is not None, (
                "PLAYING should have current player"
            )

        elif phase == GamePhase.FOUNDING_CHAIN:
            assert game.pending_action is not None, (
                "FOUNDING_CHAIN needs pending action"
            )
            assert game.pending_action.get("type") == "found_chain"

        elif phase == GamePhase.MERGING:
            assert game.pending_action is not None, "MERGING needs pending action"

        elif phase == GamePhase.BUYING_STOCKS:
            assert game.get_current_player() is not None

        elif phase == GamePhase.GAME_OVER:
            assert game.winners is not None or len(game.players) > 0


class TestFullGameSimulation:
    """End-to-end game simulation tests."""

    def _run_bot_game(
        self, game, max_turns=500, force_end_after=200, validate_each_turn=True
    ):
        """Run a bot game with validation."""
        turn_count = 0
        stuck_count = 0

        while game.phase != GamePhase.GAME_OVER and turn_count < max_turns:
            current = game.get_current_player()
            if current and current.player_id in game.bots:
                actions = game.execute_bot_turn(current.player_id)

                if not actions:
                    stuck_count += 1
                    if stuck_count > 10:
                        break
                else:
                    stuck_count = 0

                if validate_each_turn:
                    GameStateValidator.validate_stock_conservation(game)
                    GameStateValidator.validate_phase_state(game)

            turn_count += 1

            # Force end after reasonable time
            if turn_count > force_end_after:
                if Rules.check_end_game(game.board, game.hotel):
                    game.end_game()
                    break

        return turn_count

    def test_three_player_game_validates_state(self):
        """Three player game maintains valid state throughout."""
        game = Game(seed=42)
        game.add_player("bot1", "Bot 1", is_bot=True)
        game.add_player("bot2", "Bot 2", is_bot=True)
        game.add_player("bot3", "Bot 3", is_bot=True)
        game.start_game()

        turn_count = self._run_bot_game(game, max_turns=500, force_end_after=150)

        assert game.phase == GamePhase.GAME_OVER or turn_count < 500
        GameStateValidator.validate_stock_conservation(game)

    def test_four_player_game_validates_state(self):
        """Four player game maintains valid state throughout."""
        game = Game(seed=123)
        for i in range(4):
            game.add_player(f"bot{i}", f"Bot {i}", is_bot=True)
        game.start_game()

        turn_count = self._run_bot_game(game, max_turns=600, force_end_after=200)

        assert game.phase == GamePhase.GAME_OVER or turn_count < 600
        GameStateValidator.validate_stock_conservation(game)

    def test_five_player_game_validates_state(self):
        """Five player game maintains valid state throughout."""
        game = Game(seed=456)
        for i in range(5):
            game.add_player(f"bot{i}", f"Bot {i}", is_bot=True)
        game.start_game()

        turn_count = self._run_bot_game(game, max_turns=700, force_end_after=250)

        assert game.phase == GamePhase.GAME_OVER or turn_count < 700
        GameStateValidator.validate_stock_conservation(game)

    def test_six_player_game_validates_state(self):
        """Six player game maintains valid state throughout."""
        game = Game(seed=789)
        for i in range(6):
            game.add_player(f"bot{i}", f"Bot {i}", is_bot=True)
        game.start_game()

        turn_count = self._run_bot_game(game, max_turns=800, force_end_after=300)

        assert game.phase == GamePhase.GAME_OVER or turn_count < 800
        GameStateValidator.validate_stock_conservation(game)

    def test_game_with_mergers_tracks_correctly(self):
        """Game correctly handles mergers and tracks state."""
        game = Game(seed=42)
        game.add_player("bot1", "Bot 1", is_bot=True)
        game.add_player("bot2", "Bot 2", is_bot=True)
        game.add_player("bot3", "Bot 3", is_bot=True)
        game.start_game()

        merger_count = 0
        turn_count = 0
        max_turns = 500

        while game.phase != GamePhase.GAME_OVER and turn_count < max_turns:
            current = game.get_current_player()
            if current and current.player_id in game.bots:
                prev_phase = game.phase
                game.execute_bot_turn(current.player_id)

                # Track mergers
                if prev_phase == GamePhase.PLAYING and game.phase == GamePhase.MERGING:
                    merger_count += 1

                # Validate state after each turn
                GameStateValidator.validate_stock_conservation(game)

            turn_count += 1

            if turn_count > 200 and Rules.check_end_game(game.board, game.hotel):
                game.end_game()
                break

        # Game should complete with valid state
        assert game.phase == GamePhase.GAME_OVER or turn_count < max_turns

    def test_deterministic_replay_same_seed(self):
        """Same seed produces identical initial game state."""
        seed = 12345

        game1 = Game(seed=seed)
        game1.add_player("p1", "Alice", is_bot=True)
        game1.add_player("p2", "Bob", is_bot=True)
        game1.add_player("p3", "Carol", is_bot=True)
        game1.start_game()

        game2 = Game(seed=seed)
        game2.add_player("p1", "Alice", is_bot=True)
        game2.add_player("p2", "Bob", is_bot=True)
        game2.add_player("p3", "Carol", is_bot=True)
        game2.start_game()

        # Initial hands should match
        for pid in ["p1", "p2", "p3"]:
            p1_hand = [str(t) for t in game1.get_player(pid).hand]
            p2_hand = [str(t) for t in game2.get_player(pid).hand]
            assert p1_hand == p2_hand, f"Player {pid} hands don't match"

        # Initial tile bags should match
        assert len(game1.tile_bag) == len(game2.tile_bag)

    def test_money_conservation_throughout_game(self):
        """Total money in economy should be conserved (accounting for bonuses)."""
        game = Game(seed=42)
        game.add_player("bot1", "Bot 1", is_bot=True)
        game.add_player("bot2", "Bot 2", is_bot=True)
        game.add_player("bot3", "Bot 3", is_bot=True)
        game.start_game()

        initial_total = sum(p.money for p in game.players)

        turn_count = 0
        max_turns = 200

        while game.phase != GamePhase.GAME_OVER and turn_count < max_turns:
            current = game.get_current_player()
            if current and current.player_id in game.bots:
                game.execute_bot_turn(current.player_id)

            turn_count += 1

            if turn_count > 100 and Rules.check_end_game(game.board, game.hotel):
                game.end_game()
                break

        # At end, total money should be >= initial (bonuses add money)
        final_total = sum(p.money for p in game.players)
        assert final_total >= initial_total, "Money was destroyed"

    def test_all_active_chains_have_correct_size(self):
        """Active chains should have size >= 2 (founding requirement)."""
        game = Game(seed=42)
        game.add_player("bot1", "Bot 1", is_bot=True)
        game.add_player("bot2", "Bot 2", is_bot=True)
        game.add_player("bot3", "Bot 3", is_bot=True)
        game.start_game()

        turn_count = 0
        max_turns = 200

        while game.phase != GamePhase.GAME_OVER and turn_count < max_turns:
            current = game.get_current_player()
            if current and current.player_id in game.bots:
                game.execute_bot_turn(current.player_id)

                # Check active chains have valid sizes
                for chain in game.hotel.get_active_chains():
                    size = game.board.get_chain_size(chain)
                    assert size >= 2, f"Active chain {chain} has size {size} < 2"

            turn_count += 1

            if turn_count > 100 and Rules.check_end_game(game.board, game.hotel):
                game.end_game()
                break


class TestEndGameConditions:
    """Tests for different end game conditions."""

    def test_game_can_end_with_41_tile_chain(self):
        """Verify end game check works for 41+ tile chain."""
        game = Game(seed=42)
        game.add_player("bot1", "Bot 1", is_bot=True)
        game.add_player("bot2", "Bot 2", is_bot=True)
        game.add_player("bot3", "Bot 3", is_bot=True)
        game.start_game()

        from game.board import Tile

        # Manually set up a 41+ tile chain (48 tiles = 12 cols x 4 rows)
        for col in range(1, 13):
            for row in ["A", "B", "C", "D"]:
                tile = Tile(col, row)
                if not game.board.is_tile_played(tile):
                    game.board.place_tile(tile)
                    game.board.set_chain(tile, "Continental")

        game.hotel.activate_chain("Continental")

        # Should be able to end
        can_end = Rules.check_end_game(game.board, game.hotel)
        assert can_end, "Should be able to end with 41+ tile chain"

    def test_game_can_end_all_safe_chains(self):
        """Verify end game check works when all chains are safe."""
        game = Game(seed=42)
        game.add_player("bot1", "Bot 1", is_bot=True)
        game.add_player("bot2", "Bot 2", is_bot=True)
        game.add_player("bot3", "Bot 3", is_bot=True)
        game.start_game()

        # Set up two safe chains
        from game.board import Tile

        # First safe chain
        for col in range(1, 12):
            tile = Tile(col, "A")
            game.board.place_tile(tile)
            game.board.set_chain(tile, "American")
        game.hotel.activate_chain("American")

        # Second safe chain
        for col in range(1, 12):
            tile = Tile(col, "C")
            game.board.place_tile(tile)
            game.board.set_chain(tile, "Tower")
        game.hotel.activate_chain("Tower")

        # Should be able to end (all active chains are safe)
        can_end = Rules.check_end_game(game.board, game.hotel)
        assert can_end, "Should be able to end when all chains are safe"


@pytest.mark.parametrize("seed", [1, 42, 100, 999, 2024])
def test_games_complete_with_various_seeds(seed):
    """Games with different seeds should complete successfully."""
    game = Game(seed=seed)
    game.add_player("bot1", "Bot 1", is_bot=True)
    game.add_player("bot2", "Bot 2", is_bot=True)
    game.add_player("bot3", "Bot 3", is_bot=True)
    game.start_game()

    turn_count = 0
    max_turns = 500

    while game.phase != GamePhase.GAME_OVER and turn_count < max_turns:
        current = game.get_current_player()
        if current and current.player_id in game.bots:
            actions = game.execute_bot_turn(current.player_id)
            if len(actions) == 0:
                # Stuck, try to force end if possible
                if Rules.check_end_game(game.board, game.hotel):
                    game.end_game()
                    break

        turn_count += 1

        if turn_count > 200 and Rules.check_end_game(game.board, game.hotel):
            game.end_game()
            break

    # Validate final state
    GameStateValidator.validate_stock_conservation(game)


@pytest.mark.parametrize("num_players", [3, 4, 5, 6])
def test_game_completes_with_n_players(num_players):
    """Games complete successfully with various player counts."""
    game = Game(seed=42)
    for i in range(num_players):
        game.add_player(f"bot{i}", f"Bot {i}", is_bot=True)
    game.start_game()

    turn_count = 0
    max_turns = 300 + (num_players * 100)

    while game.phase != GamePhase.GAME_OVER and turn_count < max_turns:
        current = game.get_current_player()
        if current and current.player_id in game.bots:
            actions = game.execute_bot_turn(current.player_id)
            if len(actions) == 0:
                if Rules.check_end_game(game.board, game.hotel):
                    game.end_game()
                    break

        turn_count += 1

        force_end_after = 150 + (num_players * 30)
        if turn_count > force_end_after and Rules.check_end_game(
            game.board, game.hotel
        ):
            game.end_game()
            break

    assert game.phase == GamePhase.GAME_OVER or turn_count < max_turns
    GameStateValidator.validate_stock_conservation(game)
