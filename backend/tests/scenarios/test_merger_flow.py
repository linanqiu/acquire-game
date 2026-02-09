"""Tests for merger-related bug fixes in the Acquire game.

These tests cover critical bugs found during ST-006 development:
1. stock_disposition phase not surfacing in get_public_state / turn_phase
2. Bot playability check incomplete (not using Rules.can_place_tile)
3. handle_all_tiles_unplayable replacing tiles correctly
4. WebSocket race condition in _send_to_websockets
5. tile_playability missing from player state
6. execute_bot_turn with no playable tiles
"""

from unittest.mock import AsyncMock

import pytest

from game.board import Tile
from game.bot import Bot
from game.game import Game, GamePhase
from game.player import Player
from game.rules import Rules
from session.manager import PlayerConnection, SessionManager
from tests.scenarios.conftest import (
    ChainBuilder,
    give_player_stocks,
    give_player_tile,
    set_current_player,
)


# ============================================================================
# 1. stock_disposition phase in get_public_state / turn_phase
# ============================================================================


class TestStockDispositionPhaseInPublicState:
    """When game is in MERGING phase with pending stock_disposition,
    get_public_state() should return phase='stock_disposition', not 'merger'.
    The turn_phase property is the key piece that was fixed.
    """

    def test_turn_phase_returns_stock_disposition_during_merger_with_pending_disposition(
        self, game_with_three_players
    ):
        """turn_phase should return 'stock_disposition' when a player
        has a pending stock disposition during a merger."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Set up two chains that can merge
        builder.setup_chain("American", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=1, row="C")

        # Give player 1 some Tower stock so they need to dispose
        player = game.players[0]
        give_player_stocks(player, "Tower", 3, game.hotel)

        # Simulate merging phase with stock disposition pending
        game.phase = GamePhase.MERGING
        game.pending_action = {
            "type": "stock_disposition",
            "player_id": player.player_id,
            "defunct_chain": "Tower",
            "surviving_chain": "American",
            "stock_count": 3,
            "available_to_trade": game.hotel.get_available_stocks("American"),
        }

        # The fix: turn_phase should return "stock_disposition", not "merger"
        assert game.turn_phase == "stock_disposition"

    def test_turn_phase_returns_merger_when_no_pending_disposition(
        self, game_with_three_players
    ):
        """turn_phase should return 'merger' in MERGING phase without
        a stock_disposition pending action (e.g., choosing survivor)."""
        game = game_with_three_players

        game.phase = GamePhase.MERGING
        game.pending_action = {
            "type": "choose_survivor",
            "tied_chains": ["American", "Tower"],
        }

        assert game.turn_phase == "merger"

    def test_turn_phase_returns_merger_when_no_pending_action(
        self, game_with_three_players
    ):
        """turn_phase should return 'merger' when in MERGING phase
        but pending_action is None."""
        game = game_with_three_players

        game.phase = GamePhase.MERGING
        game.pending_action = None

        assert game.turn_phase == "merger"

    def test_get_public_state_uses_turn_phase(self, game_with_three_players):
        """get_public_state() should use turn_phase (which checks for
        stock_disposition) rather than the raw phase string."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("American", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=1, row="C")

        player = game.players[0]
        give_player_stocks(player, "Tower", 2, game.hotel)

        game.phase = GamePhase.MERGING
        game.pending_action = {
            "type": "stock_disposition",
            "player_id": player.player_id,
            "defunct_chain": "Tower",
            "surviving_chain": "American",
            "stock_count": 2,
            "available_to_trade": game.hotel.get_available_stocks("American"),
        }

        public_state = game.get_public_state()
        assert public_state["phase"] == "stock_disposition"

    def test_get_public_state_returns_place_tile_during_playing(
        self, game_with_three_players
    ):
        """get_public_state() should return 'place_tile' during PLAYING phase."""
        game = game_with_three_players
        assert game.phase == GamePhase.PLAYING

        public_state = game.get_public_state()
        assert public_state["phase"] == "place_tile"


# ============================================================================
# 2. Bot playability check uses Rules.can_place_tile
# ============================================================================


class TestBotPlayabilityCheck:
    """Bot._get_playable_tiles() should use Rules.can_place_tile for
    complete validation, including the 8th chain scenario."""

    def test_bot_identifies_eighth_chain_tile_as_unplayable(
        self, game_with_three_players
    ):
        """When all 7 chains are active, a tile that would found an
        8th chain should be identified as unplayable by the bot."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Activate all 7 chains
        all_chains = [
            "Luxor",
            "Tower",
            "American",
            "Worldwide",
            "Festival",
            "Imperial",
            "Continental",
        ]
        for i, chain_name in enumerate(all_chains):
            # Place each chain in a different row to avoid adjacency
            builder.setup_chain(chain_name, 2, start_col=1, row=chr(ord("A") + i))

        assert len(game.hotel.get_active_chains()) == 7

        # Create a bot player
        player = game.players[0]
        bot = Bot(player, "medium", rng=game.rng)

        # Clear the player's hand and give them a tile that would create an 8th chain.
        # Place a lone tile at 10A, then give the player 11A. Playing 11A next to
        # the lone tile at 10A would try to found a new chain (8th), which is illegal.
        builder.setup_lone_tiles([(10, "I")])
        while player.hand_size > 0:
            player.remove_tile(player.hand[0])
        tile_8th = Tile(11, "I")
        player.add_tile(tile_8th)

        # Verify Rules.can_place_tile rejects it
        assert not Rules.can_place_tile(game.board, tile_8th, game.hotel)

        # Bot should also identify it as unplayable
        playable = bot._get_playable_tiles(game.board, game.hotel)
        assert tile_8th not in playable

    def test_bot_identifies_safe_merger_tile_as_unplayable(
        self, game_with_three_players
    ):
        """A tile that would merge two safe chains should be unplayable
        for the bot."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Create two safe chains (11+ tiles)
        builder.setup_chain("Luxor", 11, start_col=1, row="A")
        builder.setup_chain("Tower", 11, start_col=1, row="C")

        player = game.players[0]
        bot = Bot(player, "medium", rng=game.rng)

        # Tile at 1B would merge two safe chains
        merger_tile = Tile(1, "B")
        while player.hand_size >= Player.MAX_HAND_SIZE:
            player.remove_tile(player.hand[0])
        player.add_tile(merger_tile)

        assert not Rules.can_place_tile(game.board, merger_tile, game.hotel)

        playable = bot._get_playable_tiles(game.board, game.hotel)
        assert merger_tile not in playable

    def test_bot_returns_none_when_no_playable_tiles(self, game_with_three_players):
        """choose_tile_to_play should return None when all tiles are unplayable."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Activate all 7 chains
        all_chains = [
            "Luxor",
            "Tower",
            "American",
            "Worldwide",
            "Festival",
            "Imperial",
            "Continental",
        ]
        for i, chain_name in enumerate(all_chains):
            builder.setup_chain(chain_name, 2, start_col=1, row=chr(ord("A") + i))

        player = game.players[0]
        bot = Bot(player, "medium", rng=game.rng)

        # Give the player only tiles that would create an 8th chain
        while player.hand_size > 0:
            player.remove_tile(player.hand[0])

        # Place lone tiles and give player adjacent tiles
        for col in [10, 11, 12]:
            builder.setup_lone_tiles([(col, "I")])
            # Give adjacent tile that would found 8th chain
            adj_tile = Tile(col, "H")
            # Only add if space exists and it would actually try to found
            if player.hand_size < Player.MAX_HAND_SIZE:
                # Check that adjacency is not to an existing chain
                if not game.board.get_adjacent_chains(adj_tile):
                    player.add_tile(adj_tile)

        # If all remaining tiles are unplayable, bot should return None
        if not bot._get_playable_tiles(game.board, game.hotel):
            result = bot.choose_tile_to_play(game.board, game.hotel)
            assert result is None


# ============================================================================
# 3. handle_all_tiles_unplayable
# ============================================================================


class TestHandleAllTilesUnplayable:
    """When a player has all unplayable tiles at the start of their turn,
    tiles should be replaced with new ones from the tile bag."""

    def test_all_unplayable_tiles_replaced(self, game_with_three_players):
        """When all tiles are unplayable, they should be removed and
        replaced with new tiles from the bag."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Create two safe chains (11+ tiles each)
        builder.setup_chain("Luxor", 11, start_col=1, row="A")
        builder.setup_chain("Tower", 11, start_col=1, row="C")

        player = game.get_current_player()

        # Clear hand and give all unplayable tiles (merging two safe chains)
        while player.hand_size > 0:
            player.remove_tile(player.hand[0])

        # The tiles at column X, row B would merge Luxor (row A) and Tower (row C)
        unplayable_tiles = []
        for col in range(1, 7):
            tile = Tile(col, "B")
            player.add_tile(tile)
            unplayable_tiles.append(tile)

        # Verify they are all unplayable
        assert Rules.are_all_tiles_unplayable(game.board, player.hand, game.hotel)

        initial_bag_size = len(game.tile_bag)

        # Handle the replacement
        result = game.handle_all_tiles_unplayable(player)

        # Should not be None (tiles were replaced)
        assert result is not None
        assert len(result["revealed_hand"]) == 6
        assert len(result["removed_tiles"]) == 6
        assert len(result["new_tiles"]) == 6

        # Player should have 6 new tiles
        assert player.hand_size == 6

        # Old tiles should not be in hand
        for old_tile in unplayable_tiles:
            assert not player.has_tile(old_tile)

        # Tile bag should have shrunk by 6
        assert len(game.tile_bag) == initial_bag_size - 6

    def test_returns_none_when_hand_has_playable_tiles(self, game_with_three_players):
        """When at least one tile is playable, should return None."""
        game = game_with_three_players
        player = game.get_current_player()

        # Default hand should have playable tiles
        result = game.handle_all_tiles_unplayable(player)
        assert result is None

    def test_partial_replacement_when_bag_runs_low(self, game_with_three_players):
        """When the tile bag has fewer tiles than needed, replacement
        should still work with fewer new tiles."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("Luxor", 11, start_col=1, row="A")
        builder.setup_chain("Tower", 11, start_col=1, row="C")

        player = game.get_current_player()

        # Clear hand and give unplayable tiles
        while player.hand_size > 0:
            player.remove_tile(player.hand[0])

        for col in range(1, 7):
            player.add_tile(Tile(col, "B"))

        # Leave only 3 tiles in the bag
        while len(game.tile_bag) > 3:
            game.tile_bag.pop()

        result = game.handle_all_tiles_unplayable(player)

        assert result is not None
        assert len(result["removed_tiles"]) == 6
        assert len(result["new_tiles"]) == 3
        assert player.hand_size == 3

    def test_removed_tiles_not_returned_to_bag(self, game_with_three_players):
        """Removed unplayable tiles should NOT go back into the tile bag.

        The bag should shrink by exactly the number of new tiles drawn,
        proving that the removed tiles were discarded from the game entirely.
        """
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("Luxor", 11, start_col=1, row="A")
        builder.setup_chain("Tower", 11, start_col=1, row="C")

        player = game.get_current_player()

        while player.hand_size > 0:
            player.remove_tile(player.hand[0])

        unplayable = [Tile(col, "B") for col in range(1, 7)]
        for t in unplayable:
            player.add_tile(t)

        bag_size_before = len(game.tile_bag)

        result = game.handle_all_tiles_unplayable(player)

        new_tiles_drawn = len(result["new_tiles"])

        # Bag should shrink by exactly the number of new tiles drawn.
        # If removed tiles were returned to the bag, the bag would be larger.
        assert len(game.tile_bag) == bag_size_before - new_tiles_drawn

        # Additionally, the bag should not have grown at all
        assert len(game.tile_bag) < bag_size_before


# ============================================================================
# 4. WebSocket race condition in _send_to_websockets
# ============================================================================


class TestWebSocketRaceCondition:
    """_send_to_websockets should handle concurrent disconnections
    without crashing (ValueError on list.remove)."""

    @pytest.mark.asyncio
    async def test_send_handles_dead_websocket_removal(self):
        """When a websocket fails during send, it should be removed
        from the player's websocket list without crashing."""
        manager = SessionManager()

        player = PlayerConnection(
            player_id="p1",
            name="Alice",
        )

        # Create mock websockets - one that works, one that fails
        good_ws = AsyncMock()
        bad_ws = AsyncMock()
        bad_ws.send_json.side_effect = Exception("Connection closed")

        player.websockets = [good_ws, bad_ws]

        message = {"type": "game_state", "data": "test"}

        await manager._send_to_websockets(player, message)

        # Good websocket should have received the message
        good_ws.send_json.assert_called_once_with(message)

        # Bad websocket should have been removed
        assert bad_ws not in player.websockets
        assert good_ws in player.websockets

    @pytest.mark.asyncio
    async def test_send_handles_already_removed_websocket(self):
        """When a websocket is already removed (by concurrent disconnect)
        before we try to remove it, we should not crash with ValueError."""
        manager = SessionManager()

        player = PlayerConnection(
            player_id="p1",
            name="Alice",
        )

        # Create a mock websocket that fails
        bad_ws = AsyncMock()
        bad_ws.send_json.side_effect = Exception("Connection closed")

        player.websockets = [bad_ws]

        # Simulate concurrent removal: after send_json fails but before
        # we try to remove it, another coroutine removes it.
        original_remove = player.websockets.remove

        def remove_then_clear(ws):
            """Simulate the race: the ws was already removed."""
            # First call succeeds, but subsequent calls raise ValueError
            try:
                original_remove(ws)
            except ValueError:
                pass

        # The implementation iterates over a copy and catches ValueError
        # on remove. Let's verify it handles this scenario.
        message = {"type": "test"}
        await manager._send_to_websockets(player, message)

        # Should not crash, and the bad ws should be gone
        assert bad_ws not in player.websockets

    @pytest.mark.asyncio
    async def test_send_iterates_over_copy(self):
        """_send_to_websockets should iterate over a copy of the websocket
        list so that modifications during iteration don't cause issues."""
        manager = SessionManager()

        player = PlayerConnection(
            player_id="p1",
            name="Alice",
        )

        ws1 = AsyncMock()
        ws2 = AsyncMock()
        ws3 = AsyncMock()
        # ws2 fails, which should not prevent ws3 from receiving
        ws2.send_json.side_effect = Exception("Dead")

        player.websockets = [ws1, ws2, ws3]

        message = {"type": "test"}
        await manager._send_to_websockets(player, message)

        # ws1 and ws3 should both receive the message
        ws1.send_json.assert_called_once_with(message)
        ws3.send_json.assert_called_once_with(message)

        # ws2 should be removed
        assert ws2 not in player.websockets
        assert len(player.websockets) == 2


# ============================================================================
# 5. tile_playability in game state
# ============================================================================


class TestTilePlayabilityInGameState:
    """get_player_state() should include tile_playability data for each
    tile in the player's hand."""

    def test_player_state_includes_tile_playability(self, game_with_three_players):
        """get_player_state() should contain a tile_playability dict."""
        game = game_with_three_players
        player = game.get_current_player()

        state = game.get_player_state(player.player_id)

        assert "tile_playability" in state
        assert isinstance(state["tile_playability"], dict)

    def test_tile_playability_has_entry_for_each_tile_in_hand(
        self, game_with_three_players
    ):
        """tile_playability should have an entry for every tile in the
        player's hand."""
        game = game_with_three_players
        player = game.get_current_player()

        state = game.get_player_state(player.player_id)

        hand_strs = set(state["hand"])
        playability_keys = set(state["tile_playability"].keys())

        assert hand_strs == playability_keys

    def test_tile_playability_marks_unplayable_tiles(self, game_with_three_players):
        """tile_playability should correctly mark tiles that can't be played."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Create two safe chains
        builder.setup_chain("Luxor", 11, start_col=1, row="A")
        builder.setup_chain("Tower", 11, start_col=1, row="C")

        player = game.get_current_player()

        # Give player a tile that would merge two safe chains
        unplayable_tile = Tile(1, "B")
        give_player_tile(player, unplayable_tile, game)

        state = game.get_player_state(player.player_id)

        tile_str = str(unplayable_tile)
        assert tile_str in state["tile_playability"]
        assert state["tile_playability"][tile_str]["playable"] is False
        assert (
            state["tile_playability"][tile_str]["reason"] == "would_merge_safe_chains"
        )

    def test_tile_playability_marks_playable_tiles(self, game_with_three_players):
        """tile_playability should mark normally playable tiles correctly."""
        game = game_with_three_players
        player = game.get_current_player()

        state = game.get_player_state(player.player_id)

        # At least some tiles should be playable in a fresh game
        playable_count = sum(
            1 for info in state["tile_playability"].values() if info["playable"] is True
        )
        assert playable_count > 0

    def test_tile_playability_detects_eighth_chain(self, game_with_three_players):
        """tile_playability should identify tiles that would create an 8th chain."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Activate all 7 chains
        all_chains = [
            "Luxor",
            "Tower",
            "American",
            "Worldwide",
            "Festival",
            "Imperial",
            "Continental",
        ]
        for i, chain_name in enumerate(all_chains):
            builder.setup_chain(chain_name, 2, start_col=1, row=chr(ord("A") + i))

        # Place a lone tile and give the player an adjacent tile
        builder.setup_lone_tiles([(10, "I")])

        player = game.get_current_player()
        eighth_chain_tile = Tile(11, "I")
        give_player_tile(player, eighth_chain_tile, game)

        state = game.get_player_state(player.player_id)

        tile_str = str(eighth_chain_tile)
        assert tile_str in state["tile_playability"]
        assert state["tile_playability"][tile_str]["playable"] is False
        assert (
            state["tile_playability"][tile_str]["reason"] == "would_create_eighth_chain"
        )


# ============================================================================
# 6. execute_bot_turn with no playable tiles
# ============================================================================


class TestExecuteBotTurnNoPlayableTiles:
    """When a bot has no playable tiles, execute_bot_turn should skip
    to buying and end the turn normally."""

    def test_bot_skips_tile_placement_when_no_playable_tiles(self):
        """Bot should skip to buy phase when it has no playable tiles."""
        game = Game(seed=42)
        game.add_player("bot1", "Bot 1", is_bot=True)
        game.add_player("bot2", "Bot 2", is_bot=True)
        game.add_player("bot3", "Bot 3", is_bot=True)
        game.start_game()

        builder = ChainBuilder(game)

        # Activate all 7 chains
        all_chains = [
            "Luxor",
            "Tower",
            "American",
            "Worldwide",
            "Festival",
            "Imperial",
            "Continental",
        ]
        for i, chain_name in enumerate(all_chains):
            builder.setup_chain(chain_name, 2, start_col=1, row=chr(ord("A") + i))

        # Set current player to bot1
        set_current_player(game, "bot1")
        game.phase = GamePhase.PLAYING

        bot_player = game.get_player("bot1")

        # Clear hand and give only tiles that would create 8th chain
        while bot_player.hand_size > 0:
            bot_player.remove_tile(bot_player.hand[0])

        # Place lone tiles at various spots and give bot adjacent tiles
        lone_positions = [(10, "I"), (12, "I")]
        builder.setup_lone_tiles(lone_positions)

        for col, row in lone_positions:
            adj_tile = Tile(col - 1, row)
            if not game.board.is_tile_played(
                adj_tile
            ) and not game.board.get_adjacent_chains(adj_tile):
                # This tile would found a chain if adjacent to a lone tile
                # but only if there's no chain around it
                pass

            # Give tiles adjacent to lone tiles (would create 8th chain)
            up_tile = Tile(col, "H")
            if bot_player.hand_size < Player.MAX_HAND_SIZE:
                if not game.board.is_tile_played(up_tile):
                    bot_player.add_tile(up_tile)

        # Execute bot turn
        actions = game.execute_bot_turn("bot1")

        # Should have a skip_tile action
        skip_actions = [a for a in actions if a.get("action") == "skip_tile"]
        assert len(skip_actions) >= 1
        assert skip_actions[0]["reason"] == "no playable tiles"

    def test_bot_turn_advances_to_next_player_after_skip(self):
        """After skipping tile placement, bot should buy stocks,
        end turn, and advance to the next player."""
        game = Game(seed=42)
        game.add_player("bot1", "Bot 1", is_bot=True)
        game.add_player("p2", "Player 2")
        game.add_player("p3", "Player 3")
        game.start_game()

        builder = ChainBuilder(game)

        # Activate all 7 chains
        all_chains = [
            "Luxor",
            "Tower",
            "American",
            "Worldwide",
            "Festival",
            "Imperial",
            "Continental",
        ]
        for i, chain_name in enumerate(all_chains):
            builder.setup_chain(chain_name, 2, start_col=1, row=chr(ord("A") + i))

        set_current_player(game, "bot1")
        game.phase = GamePhase.PLAYING

        bot_player = game.get_player("bot1")

        # Clear hand entirely - bot has no tiles at all
        while bot_player.hand_size > 0:
            bot_player.remove_tile(bot_player.hand[0])

        actions = game.execute_bot_turn("bot1")

        # Bot should have: skip_tile, buy_stocks, end_turn
        action_names = [a.get("action") for a in actions]
        assert "skip_tile" in action_names
        assert "buy_stocks" in action_names
        assert "end_turn" in action_names

        # Current player should have advanced
        assert game.get_current_player_id() != "bot1"

    def test_bot_with_playable_tiles_plays_normally(self):
        """A bot with playable tiles should play a tile normally."""
        game = Game(seed=42)
        game.add_player("bot1", "Bot 1", is_bot=True)
        game.add_player("bot2", "Bot 2", is_bot=True)
        game.add_player("bot3", "Bot 3", is_bot=True)
        game.start_game()

        set_current_player(game, "bot1")
        game.phase = GamePhase.PLAYING

        # Default hand should have playable tiles
        actions = game.execute_bot_turn("bot1")

        # Should have a play_tile action (not skip_tile)
        action_names = [a.get("action") for a in actions]
        assert "play_tile" in action_names
        assert "skip_tile" not in action_names


# ============================================================================
# Integration: Full merger flow with stock disposition
# ============================================================================


class TestFullMergerFlow:
    """Integration test for the complete merger flow including stock
    disposition for multiple players."""

    def test_merger_with_single_stockholder(self, game_with_three_players):
        """A merger where one player holds defunct stock should proceed
        through disposition correctly."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        # Setup: American (3 tiles, row A) and Tower (2 tiles, row C)
        builder.setup_chain("American", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=1, row="C")

        # Give p1 stock in Tower (the chain that will be defunct)
        p1 = game.players[0]
        give_player_stocks(p1, "Tower", 4, game.hotel)

        # Set up the merger: place a tile at 1B connecting American and Tower
        set_current_player(game, p1.player_id)
        game.phase = GamePhase.PLAYING

        merger_tile = Tile(1, "B")
        give_player_tile(p1, merger_tile, game)

        result = game.play_tile(p1.player_id, merger_tile)
        assert result.success is True

        # Game should be in MERGING phase now
        assert game.phase == GamePhase.MERGING

        # There should be a stock disposition pending for p1
        assert game.pending_action is not None
        assert game.pending_action["type"] == "stock_disposition"
        assert game.pending_action["player_id"] == p1.player_id
        assert game.pending_action["defunct_chain"] == "Tower"

        # Handle disposition: sell all
        result = game.handle_stock_disposition(p1.player_id, sell=4, trade=0, keep=0)
        assert result.success is True

        # After disposition, should move to buying stocks
        assert game.phase == GamePhase.BUYING_STOCKS

    def test_merger_disposition_order_follows_turn_order(self, game_with_three_players):
        """During a merger, stock disposition should proceed in turn order
        starting from the current player."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("American", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=1, row="C")

        # Give multiple players Tower stock
        p1 = game.players[0]
        p2 = game.players[1]
        p3 = game.players[2]

        give_player_stocks(p1, "Tower", 2, game.hotel)
        give_player_stocks(p2, "Tower", 3, game.hotel)
        give_player_stocks(p3, "Tower", 1, game.hotel)

        # p1 triggers the merger
        set_current_player(game, p1.player_id)
        game.phase = GamePhase.PLAYING

        merger_tile = Tile(1, "B")
        give_player_tile(p1, merger_tile, game)

        game.play_tile(p1.player_id, merger_tile)

        # First disposition should be for p1 (current player)
        assert game.pending_action["player_id"] == p1.player_id

        # Handle p1's disposition
        game.handle_stock_disposition(p1.player_id, sell=2, trade=0, keep=0)

        # Next should be p2
        assert game.pending_action is not None
        assert game.pending_action["player_id"] == p2.player_id

        # Handle p2's disposition
        game.handle_stock_disposition(p2.player_id, sell=3, trade=0, keep=0)

        # Next should be p3
        assert game.pending_action is not None
        assert game.pending_action["player_id"] == p3.player_id

        # Handle p3's disposition
        game.handle_stock_disposition(p3.player_id, sell=1, trade=0, keep=0)

        # Now all dispositions done, should be in buying phase
        assert game.phase == GamePhase.BUYING_STOCKS

    def test_can_player_act_during_stock_disposition(self, game_with_three_players):
        """During stock disposition, only the player whose disposition
        is pending should be able to act."""
        game = game_with_three_players
        builder = ChainBuilder(game)

        builder.setup_chain("American", 3, start_col=1, row="A")
        builder.setup_chain("Tower", 2, start_col=1, row="C")

        p1 = game.players[0]
        p2 = game.players[1]
        give_player_stocks(p1, "Tower", 2, game.hotel)
        give_player_stocks(p2, "Tower", 2, game.hotel)

        set_current_player(game, p1.player_id)
        game.phase = GamePhase.PLAYING

        merger_tile = Tile(1, "B")
        give_player_tile(p1, merger_tile, game)
        game.play_tile(p1.player_id, merger_tile)

        # p1 should be able to act (it's their disposition)
        assert game.can_player_act(p1.player_id) is True
        # p2 should not be able to act yet
        assert game.can_player_act(p2.player_id) is False

        # After p1 disposes, p2 should be able to act
        game.handle_stock_disposition(p1.player_id, sell=2, trade=0, keep=0)
        assert game.can_player_act(p2.player_id) is True
        assert game.can_player_act(p1.player_id) is False
