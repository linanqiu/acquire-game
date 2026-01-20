"""Action module tests (BH-010).

Tests for Action class creation, equality, hashing, and serialization.
"""

from game.action import Action, ActionType, TradeOffer


class TestActionCreation:
    """Tests for creating Action objects."""

    def test_create_play_tile_action(self):
        """Can create tile placement action."""
        action = Action.play_tile("5C")

        assert action.action_type == ActionType.PLAY_TILE
        assert action.tile == "5C"

    def test_create_play_tile_via_constructor(self):
        """Can create tile action via constructor."""
        action = Action(action_type=ActionType.PLAY_TILE, tile="5C")

        assert action.action_type == ActionType.PLAY_TILE
        assert action.tile == "5C"

    def test_create_found_chain_action(self):
        """Can create chain founding action."""
        action = Action.found_chain("American")

        assert action.action_type == ActionType.FOUND_CHAIN
        assert action.chain == "American"

    def test_create_buy_stocks_action(self):
        """Can create stock buying action."""
        action = Action.buy_stocks(["American", "American", "Luxor"])

        assert action.action_type == ActionType.BUY_STOCKS
        assert action.stocks == ["American", "American", "Luxor"]

    def test_create_stock_disposition_action(self):
        """Can create stock disposition action."""
        action = Action.stock_disposition(sell=2, trade=4, keep=1)

        assert action.action_type == ActionType.STOCK_DISPOSITION
        assert action.disposition == {"sell": 2, "trade": 4, "keep": 1}

    def test_create_end_turn_action(self):
        """Can create end turn action."""
        action = Action.end_turn()

        assert action.action_type == ActionType.END_TURN

    def test_create_end_game_action(self):
        """Can create end game action."""
        action = Action.end_game()

        assert action.action_type == ActionType.END_GAME

    def test_create_choose_merger_survivor_action(self):
        """Can create merger survivor choice action."""
        action = Action.choose_merger_survivor("Tower")

        assert action.action_type == ActionType.CHOOSE_MERGER_SURVIVOR
        assert action.chain == "Tower"


class TestTradeActions:
    """Tests for trade-related actions."""

    def test_create_trade_offer(self):
        """Can create a trade offer."""
        offer = TradeOffer(
            from_player_id="p1",
            to_player_id="p2",
            offering_stocks={"American": 2},
            offering_money=500,
            requesting_stocks={"Luxor": 3},
            requesting_money=0,
        )

        assert offer.from_player_id == "p1"
        assert offer.to_player_id == "p2"
        assert offer.offering_stocks == {"American": 2}
        assert offer.trade_id is not None

    def test_trade_offer_auto_generates_id(self):
        """Trade offer auto-generates unique ID."""
        offer1 = TradeOffer(from_player_id="p1", to_player_id="p2")
        offer2 = TradeOffer(from_player_id="p1", to_player_id="p2")

        assert offer1.trade_id is not None
        assert offer2.trade_id is not None
        assert offer1.trade_id != offer2.trade_id

    def test_create_propose_trade_action(self):
        """Can create propose trade action."""
        offer = TradeOffer(
            from_player_id="p1",
            to_player_id="p2",
            offering_stocks={"American": 1},
        )
        action = Action.propose_trade(offer)

        assert action.action_type == ActionType.PROPOSE_TRADE
        assert action.trade == offer

    def test_create_accept_trade_action(self):
        """Can create accept trade action."""
        action = Action.accept_trade("trade-123")

        assert action.action_type == ActionType.ACCEPT_TRADE
        assert action.trade_id == "trade-123"

    def test_create_reject_trade_action(self):
        """Can create reject trade action."""
        action = Action.reject_trade("trade-456")

        assert action.action_type == ActionType.REJECT_TRADE
        assert action.trade_id == "trade-456"

    def test_create_cancel_trade_action(self):
        """Can create cancel trade action."""
        action = Action.cancel_trade("trade-789")

        assert action.action_type == ActionType.CANCEL_TRADE
        assert action.trade_id == "trade-789"


class TestActionSerialization:
    """Tests for action serialization."""

    def test_to_dict_play_tile(self):
        """Play tile action serializes correctly."""
        action = Action.play_tile("5C")

        d = action.to_dict()

        assert d["action_type"] == "play_tile"
        assert d["tile"] == "5C"

    def test_to_dict_buy_stocks(self):
        """Buy stocks action serializes correctly."""
        action = Action.buy_stocks(["American", "Luxor"])

        d = action.to_dict()

        assert d["action_type"] == "buy_stocks"
        assert d["stocks"] == ["American", "Luxor"]

    def test_to_dict_disposition(self):
        """Stock disposition serializes correctly."""
        action = Action.stock_disposition(sell=1, trade=2, keep=3)

        d = action.to_dict()

        assert d["action_type"] == "stock_disposition"
        assert d["disposition"] == {"sell": 1, "trade": 2, "keep": 3}

    def test_from_dict_play_tile(self):
        """Can deserialize play tile action."""
        d = {"action_type": "play_tile", "tile": "5C"}

        action = Action.from_dict(d)

        assert action.action_type == ActionType.PLAY_TILE
        assert action.tile == "5C"

    def test_from_dict_round_trip(self):
        """Action survives to_dict/from_dict round trip."""
        original = Action.stock_disposition(sell=1, trade=2, keep=3)

        serialized = original.to_dict()
        restored = Action.from_dict(serialized)

        assert restored.action_type == original.action_type
        assert restored.disposition == original.disposition

    def test_trade_offer_to_dict(self):
        """Trade offer serializes correctly."""
        offer = TradeOffer(
            from_player_id="p1",
            to_player_id="p2",
            offering_stocks={"American": 2},
            offering_money=500,
            trade_id="test-trade-id",
        )

        d = offer.to_dict()

        assert d["from_player_id"] == "p1"
        assert d["to_player_id"] == "p2"
        assert d["offering_stocks"] == {"American": 2}
        assert d["offering_money"] == 500
        assert d["trade_id"] == "test-trade-id"

    def test_trade_offer_from_dict(self):
        """Trade offer deserializes correctly."""
        d = {
            "from_player_id": "p1",
            "to_player_id": "p2",
            "offering_stocks": {"Luxor": 1},
            "requesting_money": 1000,
            "trade_id": "test-id",
        }

        offer = TradeOffer.from_dict(d)

        assert offer.from_player_id == "p1"
        assert offer.to_player_id == "p2"
        assert offer.offering_stocks == {"Luxor": 1}
        assert offer.requesting_money == 1000
        assert offer.trade_id == "test-id"

    def test_propose_trade_serialization(self):
        """Propose trade action serializes with nested trade."""
        offer = TradeOffer(
            from_player_id="p1",
            to_player_id="p2",
            offering_stocks={"American": 1},
            trade_id="trade-123",
        )
        action = Action.propose_trade(offer)

        d = action.to_dict()

        assert d["action_type"] == "propose_trade"
        assert d["trade"]["trade_id"] == "trade-123"

    def test_propose_trade_deserialization(self):
        """Propose trade action deserializes with nested trade."""
        d = {
            "action_type": "propose_trade",
            "trade": {
                "from_player_id": "p1",
                "to_player_id": "p2",
                "offering_stocks": {"American": 1},
                "trade_id": "trade-123",
            },
        }

        action = Action.from_dict(d)

        assert action.action_type == ActionType.PROPOSE_TRADE
        assert action.trade is not None
        assert action.trade.trade_id == "trade-123"


class TestActionStringRepresentation:
    """Tests for action string representation."""

    def test_play_tile_repr(self):
        """Play tile action has readable string."""
        action = Action.play_tile("5C")

        s = repr(action)

        assert "5C" in s
        assert "play_tile" in s

    def test_buy_stocks_repr(self):
        """Buy stocks action has readable string."""
        action = Action.buy_stocks(["American", "Luxor"])

        s = repr(action)

        assert "buy_stocks" in s
        assert "American" in s or "Luxor" in s

    def test_disposition_repr(self):
        """Disposition action has readable string."""
        action = Action.stock_disposition(sell=1, trade=2, keep=3)

        s = repr(action)

        assert "stock_disposition" in s
        assert "sell" in s or "disposition" in s

    def test_end_turn_repr(self):
        """End turn action has readable string."""
        action = Action.end_turn()

        s = repr(action)

        assert "end_turn" in s


class TestActionTypeEnum:
    """Tests for ActionType enum."""

    def test_all_action_types_defined(self):
        """All expected action types are defined."""
        expected = [
            "PLAY_TILE",
            "FOUND_CHAIN",
            "CHOOSE_MERGER_SURVIVOR",
            "STOCK_DISPOSITION",
            "BUY_STOCKS",
            "END_TURN",
            "END_GAME",
            "PROPOSE_TRADE",
            "ACCEPT_TRADE",
            "REJECT_TRADE",
            "CANCEL_TRADE",
        ]

        for name in expected:
            assert hasattr(ActionType, name), f"Missing ActionType.{name}"

    def test_action_type_values_are_strings(self):
        """ActionType values are string identifiers."""
        for action_type in ActionType:
            assert isinstance(action_type.value, str)

    def test_action_type_values_are_unique(self):
        """All ActionType values are unique."""
        values = [at.value for at in ActionType]
        assert len(values) == len(set(values))


class TestOptionalFields:
    """Tests for optional Action fields."""

    def test_action_defaults_to_none(self):
        """Unset optional fields are None."""
        action = Action.end_turn()

        assert action.tile is None
        assert action.chain is None
        assert action.stocks is None
        assert action.disposition is None
        assert action.trade is None
        assert action.trade_id is None

    def test_only_relevant_fields_serialized(self):
        """Only non-None fields appear in serialized output."""
        action = Action.play_tile("3B")

        d = action.to_dict()

        assert "tile" in d
        assert "chain" not in d
        assert "stocks" not in d
        assert "disposition" not in d
