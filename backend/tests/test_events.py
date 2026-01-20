"""Tests for the game event system."""

import pytest
from datetime import datetime

from game.events import EventType, GameEvent, create_event
from game.game import Game, GamePhase
from game.board import Tile
from game.action import TradeOffer


class TestGameEvent:
    """Tests for the GameEvent dataclass."""

    def test_create_event(self):
        """Test creating an event with the helper function."""
        event = create_event(
            EventType.TILE_PLACED,
            "player1",
            "Alice placed 5C",
            {"tile": "5C"},
        )

        assert event.event_type == EventType.TILE_PLACED
        assert event.player_id == "player1"
        assert event.message == "Alice placed 5C"
        assert event.details == {"tile": "5C"}
        assert isinstance(event.timestamp, datetime)

    def test_event_to_dict(self):
        """Test serializing an event to a dictionary."""
        event = create_event(
            EventType.CHAIN_FOUNDED,
            "player1",
            "American founded with 3 tiles",
            {"chain": "American", "size": 3},
        )

        data = event.to_dict()

        assert data["type"] == "chain_founded"
        assert data["player_id"] == "player1"
        assert data["message"] == "American founded with 3 tiles"
        assert data["details"]["chain"] == "American"
        assert data["details"]["size"] == 3
        assert "timestamp" in data

    def test_event_from_dict(self):
        """Test deserializing an event from a dictionary."""
        data = {
            "timestamp": "2024-01-15T10:30:00+00:00",
            "type": "stock_purchased",
            "player_id": "p1",
            "message": "Alice bought 1 American for $600",
            "details": {"purchases": [{"chain": "American", "price": 600}]},
        }

        event = GameEvent.from_dict(data)

        assert event.event_type == EventType.STOCK_PURCHASED
        assert event.player_id == "p1"
        assert event.message == "Alice bought 1 American for $600"
        assert event.details["purchases"][0]["chain"] == "American"

    def test_event_roundtrip(self):
        """Test that events survive serialization roundtrip."""
        original = create_event(
            EventType.MERGER_STARTED,
            "player2",
            "Tower merging into American",
            {"survivor": "American", "defunct": ["Tower"]},
        )

        data = original.to_dict()
        restored = GameEvent.from_dict(data)

        assert restored.event_type == original.event_type
        assert restored.player_id == original.player_id
        assert restored.message == original.message
        assert restored.details == original.details


class TestGameEventEmission:
    """Tests for event emission in the Game class."""

    @pytest.fixture
    def started_game(self):
        """Create a game that's ready to play."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()
        return game

    def test_game_started_event(self):
        """Test that starting a game emits an event."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")

        game.start_game()

        events = game.get_events()
        assert len(events) == 1
        assert events[0].event_type == EventType.GAME_STARTED
        assert "3 players" in events[0].message
        assert events[0].details["players"] == ["Alice", "Bob", "Carol"]

    def test_tile_placed_event(self, started_game):
        """Test that placing a tile emits an event."""
        game = started_game
        current_player = game.get_current_player()
        tile = current_player.hand[0]

        game.play_tile(current_player.player_id, tile)

        events = game.get_events()
        tile_events = [e for e in events if e.event_type == EventType.TILE_PLACED]
        assert len(tile_events) >= 1
        assert current_player.name in tile_events[-1].message
        assert str(tile) in tile_events[-1].message

    def test_chain_founded_event(self, started_game):
        """Test that founding a chain emits an event."""
        game = started_game

        # Place tiles to set up founding
        game.board.place_tile(Tile.from_string("5A"))
        game.board.place_tile(Tile.from_string("5B"))

        current_player = game.get_current_player()
        # Remove a tile to make room and add the connecting tile
        current_player.remove_tile(current_player.hand[0])
        connecting_tile = Tile.from_string("5C")
        current_player.add_tile(connecting_tile)

        result = game.play_tile(current_player.player_id, connecting_tile)
        assert result["success"]
        assert result["result"] == "found"

        # Now found the chain
        result = game.found_chain(current_player.player_id, "American")
        assert result["success"]

        events = game.get_events()
        found_events = [e for e in events if e.event_type == EventType.CHAIN_FOUNDED]
        assert len(found_events) == 1
        assert "American" in found_events[0].message
        assert "founded" in found_events[0].message

    def test_stock_purchase_event(self, started_game):
        """Test that buying stocks emits an event."""
        game = started_game

        # Set up an active chain
        game.hotel.activate_chain("Tower")
        game.board.place_tile(Tile.from_string("1A"))
        game.board.place_tile(Tile.from_string("2A"))
        game.board.set_chain(Tile.from_string("1A"), "Tower")
        game.board.set_chain(Tile.from_string("2A"), "Tower")

        # Move to buying stocks phase
        game.phase = GamePhase.BUYING_STOCKS
        current_player = game.get_current_player()

        game.buy_stocks(current_player.player_id, ["Tower"])

        events = game.get_events()
        purchase_events = [
            e for e in events if e.event_type == EventType.STOCK_PURCHASED
        ]
        assert len(purchase_events) == 1
        assert "Tower" in purchase_events[0].message
        assert current_player.name in purchase_events[0].message

    def test_turn_ended_event(self, started_game):
        """Test that ending a turn emits an event."""
        game = started_game
        game.phase = GamePhase.BUYING_STOCKS
        current_player = game.get_current_player()

        game.end_turn(current_player.player_id)

        events = game.get_events()
        end_events = [e for e in events if e.event_type == EventType.TURN_ENDED]
        assert len(end_events) == 1
        assert current_player.name in end_events[0].message

    def test_game_ended_event(self, started_game):
        """Test that ending the game emits an event."""
        game = started_game

        result = game.end_game()

        assert result["success"]
        events = game.get_events()
        end_events = [e for e in events if e.event_type == EventType.GAME_ENDED]
        assert len(end_events) == 1
        assert "Game over" in end_events[0].message

    def test_max_events_limit(self):
        """Test that events are trimmed to MAX_EVENTS."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()

        # Emit more than MAX_EVENTS events
        for i in range(60):
            game._emit_event(
                EventType.TILE_PLACED,
                "p1",
                f"Test event {i}",
                {"index": i},
            )

        # Should be capped at MAX_EVENTS
        assert len(game._events) == Game.MAX_EVENTS

        # Most recent events should be preserved
        assert game._events[-1].details["index"] == 59

    def test_events_in_public_state(self, started_game):
        """Test that events are included in public state."""
        game = started_game

        state = game.get_public_state()

        assert "recent_events" in state
        assert isinstance(state["recent_events"], list)
        # Should have at least the game_started event
        assert len(state["recent_events"]) >= 1

    def test_events_serialization(self, started_game):
        """Test that events survive save/load cycle."""
        game = started_game

        # Get full state
        state = game.get_full_state()
        assert "events" in state

        # Restore from state
        restored = Game.from_state(state)

        # Events should be preserved
        assert len(restored._events) == len(game._events)
        assert restored._events[0].message == game._events[0].message

    def test_events_cloned(self, started_game):
        """Test that events are copied when cloning."""
        game = started_game
        initial_events = len(game._events)

        cloned = game.clone()

        assert len(cloned._events) == initial_events
        # Modifying clone shouldn't affect original
        cloned._emit_event(EventType.TILE_PLACED, "p1", "Clone event", {})
        assert len(cloned._events) == initial_events + 1
        assert len(game._events) == initial_events


class TestTradeEvents:
    """Tests for trade-related events."""

    @pytest.fixture
    def game_with_stocks(self):
        """Create a game where players have stocks to trade."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()

        # Set up an active chain with stocks
        game.hotel.activate_chain("American")
        game.board.place_tile(Tile.from_string("1A"))
        game.board.place_tile(Tile.from_string("2A"))
        game.board.set_chain(Tile.from_string("1A"), "American")
        game.board.set_chain(Tile.from_string("2A"), "American")

        # Give players some stocks
        game.players[0].add_stocks("American", 5)
        game.players[1].add_stocks("American", 3)

        return game

    def test_trade_proposed_event(self, game_with_stocks):
        """Test that proposing a trade emits an event."""
        game = game_with_stocks

        trade = TradeOffer(
            from_player_id="p1",
            to_player_id="p2",
            offering_stocks={"American": 2},
            offering_money=0,
            requesting_stocks={},
            requesting_money=500,
        )

        result = game.propose_trade(trade)
        assert result["success"]

        events = game.get_events()
        trade_events = [e for e in events if e.event_type == EventType.TRADE_PROPOSED]
        assert len(trade_events) == 1
        assert "Alice" in trade_events[0].message
        assert "Bob" in trade_events[0].message

    def test_trade_accepted_event(self, game_with_stocks):
        """Test that accepting a trade emits an event."""
        game = game_with_stocks

        trade = TradeOffer(
            from_player_id="p1",
            to_player_id="p2",
            offering_stocks={"American": 2},
            offering_money=0,
            requesting_stocks={},
            requesting_money=500,
        )

        game.propose_trade(trade)
        result = game.accept_trade("p2", trade.trade_id)
        assert result["success"]

        events = game.get_events()
        accept_events = [e for e in events if e.event_type == EventType.TRADE_ACCEPTED]
        assert len(accept_events) == 1
        assert "Trade accepted" in accept_events[0].message

    def test_trade_rejected_event(self, game_with_stocks):
        """Test that rejecting a trade emits an event."""
        game = game_with_stocks

        trade = TradeOffer(
            from_player_id="p1",
            to_player_id="p2",
            offering_stocks={"American": 2},
            offering_money=0,
            requesting_stocks={},
            requesting_money=500,
        )

        game.propose_trade(trade)
        result = game.reject_trade("p2", trade.trade_id)
        assert result["success"]

        events = game.get_events()
        reject_events = [e for e in events if e.event_type == EventType.TRADE_REJECTED]
        assert len(reject_events) == 1
        assert "rejected" in reject_events[0].message

    def test_trade_canceled_event(self, game_with_stocks):
        """Test that canceling a trade emits an event."""
        game = game_with_stocks

        trade = TradeOffer(
            from_player_id="p1",
            to_player_id="p2",
            offering_stocks={"American": 2},
            offering_money=0,
            requesting_stocks={},
            requesting_money=500,
        )

        game.propose_trade(trade)
        result = game.cancel_trade("p1", trade.trade_id)
        assert result["success"]

        events = game.get_events()
        cancel_events = [e for e in events if e.event_type == EventType.TRADE_CANCELED]
        assert len(cancel_events) == 1
        assert "canceled" in cancel_events[0].message


class TestMergerEvents:
    """Tests for merger-related events."""

    @pytest.fixture
    def merger_setup_game(self):
        """Create a game set up for a merger."""
        game = Game(seed=42)
        game.add_player("p1", "Alice")
        game.add_player("p2", "Bob")
        game.add_player("p3", "Carol")
        game.start_game()

        # Set up two chains that can merge
        game.hotel.activate_chain("American")
        game.hotel.activate_chain("Tower")

        # American chain (larger - will survive)
        game.board.place_tile(Tile.from_string("1A"))
        game.board.place_tile(Tile.from_string("2A"))
        game.board.place_tile(Tile.from_string("3A"))
        game.board.set_chain(Tile.from_string("1A"), "American")
        game.board.set_chain(Tile.from_string("2A"), "American")
        game.board.set_chain(Tile.from_string("3A"), "American")

        # Tower chain (smaller - will be defunct)
        game.board.place_tile(Tile.from_string("5A"))
        game.board.place_tile(Tile.from_string("6A"))
        game.board.set_chain(Tile.from_string("5A"), "Tower")
        game.board.set_chain(Tile.from_string("6A"), "Tower")

        # Remove a tile from player's hand to make room
        current_player = game.get_current_player()
        current_player.remove_tile(current_player.hand[0])

        # Give player the connecting tile
        connecting_tile = Tile.from_string("4A")
        current_player.add_tile(connecting_tile)

        # Give player some defunct stock
        current_player.add_stocks("Tower", 4)

        return game

    def test_merger_started_event(self, merger_setup_game):
        """Test that a merger emits a started event."""
        game = merger_setup_game
        current_player = game.get_current_player()
        connecting_tile = Tile.from_string("4A")

        game.play_tile(current_player.player_id, connecting_tile)

        events = game.get_events()
        merger_events = [e for e in events if e.event_type == EventType.MERGER_STARTED]
        assert len(merger_events) == 1
        assert "Tower" in merger_events[0].message
        assert "American" in merger_events[0].message

    def test_stock_disposition_event(self, merger_setup_game):
        """Test that stock disposition emits an event."""
        game = merger_setup_game
        current_player = game.get_current_player()
        connecting_tile = Tile.from_string("4A")

        game.play_tile(current_player.player_id, connecting_tile)

        # Handle stock disposition
        game.handle_stock_disposition(current_player.player_id, 2, 2, 0)

        events = game.get_events()
        disp_events = [e for e in events if e.event_type == EventType.STOCK_DISPOSED]
        assert len(disp_events) == 1
        assert "sold" in disp_events[0].message or "traded" in disp_events[0].message

    def test_bonuses_paid_event(self, merger_setup_game):
        """Test that bonuses emit an event."""
        game = merger_setup_game
        current_player = game.get_current_player()
        connecting_tile = Tile.from_string("4A")

        game.play_tile(current_player.player_id, connecting_tile)

        events = game.get_events()
        bonus_events = [e for e in events if e.event_type == EventType.BONUSES_PAID]
        assert len(bonus_events) == 1
        assert "Tower" in bonus_events[0].message
