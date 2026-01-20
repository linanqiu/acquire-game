"""Phase transition tests (BH-012).

Tests for valid/invalid phase transitions in the game.
"""

import pytest
from game.game import Game, GamePhase
from game.board import Tile
from game.rules import Rules
from tests.scenarios.conftest import ChainBuilder, give_player_tile, give_player_stocks


class TestValidTransitions:
    """Tests for valid phase transitions."""

    def test_lobby_to_playing_on_start(self):
        """Game transitions from LOBBY to PLAYING on start."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")

        assert game.phase == GamePhase.LOBBY

        game.start_game()

        assert game.phase == GamePhase.PLAYING

    def test_playing_to_founding_chain(self):
        """Tile that could found leads to FOUNDING_CHAIN."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()

        # Place a lone tile first
        game.board.place_tile(Tile(5, "E"))

        # Give player a tile adjacent to it
        player = game.get_current_player()
        tile = Tile(5, "F")
        give_player_tile(player, tile, game)

        result = game.play_tile(player.player_id, tile)

        assert result["success"] is True
        assert game.phase == GamePhase.FOUNDING_CHAIN

    def test_founding_to_buying_stocks(self):
        """Choosing chain leads to BUYING_STOCKS."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()

        # Setup founding scenario
        game.board.place_tile(Tile(5, "E"))
        player = game.get_current_player()
        tile = Tile(5, "F")
        give_player_tile(player, tile, game)
        game.play_tile(player.player_id, tile)

        assert game.phase == GamePhase.FOUNDING_CHAIN

        result = game.found_chain(player.player_id, "American")

        assert result["success"] is True
        assert game.phase == GamePhase.BUYING_STOCKS

    def test_buying_stocks_to_playing(self):
        """After buying stocks and ending turn, next player's PLAYING phase."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()

        # Play a simple tile
        player = game.get_current_player()
        playable = Rules.get_playable_tiles(game.board, player.hand, game.hotel)
        if playable:
            game.play_tile(player.player_id, playable[0])

            if game.phase == GamePhase.FOUNDING_CHAIN:
                game.found_chain(player.player_id, "American")

            if game.phase == GamePhase.BUYING_STOCKS:
                current = game.get_current_player()
                game.buy_stocks(current.player_id, [])
                game.end_turn(current.player_id)

                assert game.phase == GamePhase.PLAYING

    def test_playing_to_merging(self):
        """Tile that merges chains leads to MERGING."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()

        builder = ChainBuilder(game)

        # Setup two chains
        builder.setup_chain("American", 4, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=6, row="A")

        # Give player the merger tile
        player = game.get_current_player()
        tile = Tile(5, "A")
        give_player_tile(player, tile, game)

        result = game.play_tile(player.player_id, tile)

        assert result["success"] is True
        # Either MERGING or directly to disposition depending on stock holdings
        assert game.phase in (GamePhase.MERGING, GamePhase.BUYING_STOCKS)

    def test_merging_to_buying_stocks_no_stockholders(self):
        """Merger with no stockholders goes directly to BUYING_STOCKS."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()

        builder = ChainBuilder(game)

        # Setup two chains, no one owns stock
        builder.setup_chain("American", 4, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=6, row="A")

        # Verify no one owns Tower stock
        assert game.hotel.get_available_stocks("Tower") == 25

        player = game.get_current_player()
        tile = Tile(5, "A")
        give_player_tile(player, tile, game)

        game.play_tile(player.player_id, tile)

        # Should skip disposition since no one has Tower stock
        assert game.phase == GamePhase.BUYING_STOCKS

    def test_disposition_to_buying_stocks(self):
        """After all dispositions complete, proceed to BUYING_STOCKS."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()

        builder = ChainBuilder(game)

        # Setup merger with only one stockholder
        builder.setup_chain("American", 4, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=6, row="A")

        # Give only p1 Tower stock
        p1 = game.get_player("p1")
        give_player_stocks(p1, "Tower", 2, game.hotel)

        # Make p1 current player
        while game.get_current_player().player_id != "p1":
            game._advance_turn()

        tile = Tile(5, "A")
        give_player_tile(p1, tile, game)

        game.play_tile("p1", tile)

        # Should be in disposition
        assert game.phase == GamePhase.MERGING

        # Dispose the stock
        game.handle_stock_disposition("p1", sell=2, trade=0, keep=0)

        assert game.phase == GamePhase.BUYING_STOCKS


class TestInvalidTransitions:
    """Tests for invalid phase transitions."""

    def test_cannot_start_started_game(self):
        """Cannot call start_game twice."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()

        with pytest.raises(ValueError):
            game.start_game()

    def test_cannot_start_with_one_player(self):
        """Cannot start game with only one player."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")

        with pytest.raises(ValueError):
            game.start_game()

        assert game.phase == GamePhase.LOBBY

    def test_cannot_place_tile_in_lobby(self):
        """Cannot place tile before game starts."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")

        result = game.play_tile("p1", Tile(1, "A"))

        assert result["success"] is False

    def test_cannot_found_chain_in_playing_phase(self):
        """Cannot choose chain when not in FOUNDING phase."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()

        assert game.phase == GamePhase.PLAYING

        result = game.found_chain("p1", "American")

        assert result["success"] is False

    def test_cannot_buy_stocks_in_playing_phase(self):
        """Cannot buy stocks before placing tile."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()

        assert game.phase == GamePhase.PLAYING

        result = game.buy_stocks("p1", {"American": 1})

        assert result["success"] is False


class TestCompleteFlows:
    """Tests for complete game flows."""

    def test_full_turn_cycle(self):
        """Complete turn: PLAYING → BUYING_STOCKS → PLAYING."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()

        p1 = game.get_current_player()

        # Play a tile
        playable = Rules.get_playable_tiles(game.board, p1.hand, game.hotel)
        if playable:
            game.play_tile(p1.player_id, playable[0])

        # Handle founding if needed
        if game.phase == GamePhase.FOUNDING_CHAIN:
            game.found_chain(p1.player_id, "American")

        # Buy stocks and end turn
        if game.phase == GamePhase.BUYING_STOCKS:
            game.buy_stocks(p1.player_id, [])
            game.end_turn(p1.player_id)

        # Should be next player's turn
        assert game.phase == GamePhase.PLAYING
        assert game.get_current_player().player_id != p1.player_id

    def test_founding_flow_complete(self):
        """Complete founding: PLAYING → FOUNDING_CHAIN → BUYING_STOCKS."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()

        # Setup founding opportunity
        game.board.place_tile(Tile(5, "E"))
        player = game.get_current_player()
        tile = Tile(5, "F")
        give_player_tile(player, tile, game)

        assert game.phase == GamePhase.PLAYING

        # Place tile - triggers founding
        game.play_tile(player.player_id, tile)
        assert game.phase == GamePhase.FOUNDING_CHAIN

        # Choose chain
        game.found_chain(player.player_id, "Luxor")
        assert game.phase == GamePhase.BUYING_STOCKS


class TestEndGameTransitions:
    """Tests for end game phase transitions."""

    def test_can_end_game_when_conditions_met(self):
        """Game can transition to GAME_OVER when conditions met."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()

        # Setup end game condition - all active chains are safe
        builder = ChainBuilder(game)
        builder.setup_chain("American", 11, start_col=1, row="A")

        # Force into buying stocks phase
        game.phase = GamePhase.BUYING_STOCKS

        # End game
        result = game.end_game()

        if result["success"]:
            assert game.phase == GamePhase.GAME_OVER

    def test_game_over_is_final(self):
        """GAME_OVER phase is terminal - no further transitions."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()

        # Force game over
        game.phase = GamePhase.GAME_OVER
        game.winners = [game.get_player("p1")]

        # Cannot play tiles
        result = game.play_tile("p1", Tile(1, "A"))
        assert result["success"] is False

        # Cannot start game (raises ValueError since game already started)
        with pytest.raises(ValueError):
            game.start_game()


class TestPhaseStateConsistency:
    """Tests for consistent phase state."""

    def test_phase_enum_values_defined(self):
        """All expected phases are defined."""
        expected = [
            "LOBBY",
            "PLAYING",
            "FOUNDING_CHAIN",
            "MERGING",
            "BUYING_STOCKS",
            "GAME_OVER",
        ]

        for name in expected:
            assert hasattr(GamePhase, name), f"Missing GamePhase.{name}"

    def test_game_starts_in_lobby(self):
        """New game starts in LOBBY phase."""
        game = Game(seed=42)

        assert game.phase == GamePhase.LOBBY

    def test_pending_action_cleared_after_phase_complete(self):
        """Pending action is cleared when moving to next phase."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()

        # Setup founding opportunity
        game.board.place_tile(Tile(5, "E"))
        player = game.get_current_player()
        tile = Tile(5, "F")
        give_player_tile(player, tile, game)

        # Trigger founding
        game.play_tile(player.player_id, tile)
        assert game.pending_action is not None

        # Complete founding
        game.found_chain(player.player_id, "American")

        # After founding, pending_action should be None or updated
        # (depends on whether we're now in buy stocks)
        if game.phase == GamePhase.BUYING_STOCKS:
            # Should not have founding action pending
            if game.pending_action:
                assert game.pending_action.get("type") != "found_chain"
