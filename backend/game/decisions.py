"""Decision seam between the rules engine and every kind of seat.

Humans, LLMs, heuristic bots and scripted test players all act through
``apply_action`` with the same wire-format action dicts, one decision at a
time. See ``docs/architecture/seat-contract.md`` for the contract.

Typical driver loop::

    while decisions := pending_decisions(game):
        decision = decisions[0]
        legal = legal_actions(game, decision)
        action = seat_for(decision.player_id).decide(decision, legal)
        if validate_action(game, decision.player_id, action) is not None:
            action = fallback(decision, legal)
        apply_action(game, decision.player_id, action)
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from game.action import TradeOffer
from game.board import Tile
from game.game import GamePhase
from game.merger import trade_multiple_error
from game.rules import PlacementResult, Rules

if TYPE_CHECKING:
    from game.game import Game
    from game.ruleset import Ruleset


# Decision kinds
PLACE_TILE = "place_tile"
FOUND_CHAIN = "found_chain"
CHOOSE_SURVIVOR = "choose_survivor"
CHOOSE_DEFUNCT_ORDER = "choose_defunct_order"
STOCK_DISPOSITION = "stock_disposition"
BUY_STOCKS = "buy_stocks"
TRADE_RESPONSE = "trade_response"

# Action types (wire format)
ACTION_TYPES = (
    "place_tile",
    "found_chain",
    "merger_choice",
    "merger_order",
    "merger_disposition",
    "buy_stocks",
    "end_turn",
    "declare_end_game",
    "propose_trade",
    "accept_trade",
    "reject_trade",
    "cancel_trade",
)


@dataclass(frozen=True)
class Decision:
    """A decision the engine is waiting for.

    Attributes:
        player_id: The seat that must decide
        kind: place_tile | found_chain | choose_survivor | choose_defunct_order |
            stock_disposition |
            buy_stocks | trade_response
        context: JSON-serialisable, public details of the decision (never a
            player's private hand; use legal_actions for the seat's options)
    """

    player_id: str
    kind: str
    context: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        """Convert to a JSON-serialisable dict."""
        return {
            "player_id": self.player_id,
            "kind": self.kind,
            "context": self.context,
        }


# =============================================================================
# Querying
# =============================================================================


def _flow_decision(game: Game) -> Decision | None:
    """The single blocking decision for the current game phase, if any."""
    phase = game.phase
    if phase in (GamePhase.LOBBY, GamePhase.GAME_OVER) or not game.players:
        return None

    current_id = game.get_current_player().player_id
    pending = game.pending_action or {}

    if phase == GamePhase.PLAYING:
        return Decision(current_id, PLACE_TILE, {})

    if phase == GamePhase.FOUNDING_CHAIN:
        tile = pending.get("tile")
        return Decision(
            current_id,
            FOUND_CHAIN,
            {
                "tile": str(tile) if tile else None,
                "available_chains": list(pending.get("available_chains", [])),
            },
        )

    if phase == GamePhase.MERGING:
        kind = pending.get("type")
        if kind == "choose_survivor":
            tile = pending.get("tile")
            return Decision(
                current_id,
                CHOOSE_SURVIVOR,
                {
                    "tile": str(tile) if tile else None,
                    "tied_chains": list(pending.get("tied_chains", [])),
                },
            )
        if kind == "choose_defunct_order":
            return Decision(
                current_id,
                CHOOSE_DEFUNCT_ORDER,
                {
                    "tied_chains": list(pending.get("tied_chains", [])),
                    "surviving_chain": game._merger.survivor,
                },
            )
        if kind == "stock_disposition":
            return Decision(
                pending["player_id"],
                STOCK_DISPOSITION,
                {
                    "defunct_chain": pending.get("defunct_chain"),
                    "surviving_chain": pending.get("surviving_chain"),
                    "stock_count": pending.get("stock_count"),
                    "available_to_trade": game.hotel.get_available_stocks(
                        pending.get("surviving_chain")
                    ),
                },
            )
        return None

    if phase == GamePhase.BUYING_STOCKS:
        return Decision(
            current_id,
            BUY_STOCKS,
            {"stocks_bought_this_turn": game.stocks_bought_this_turn},
        )

    return None


def pending_decisions(game: Game) -> list[Decision]:
    """List the decisions the engine is waiting for.

    Returns [] in LOBBY / GAME_OVER. Otherwise element 0 is the blocking flow
    decision; any further elements are ``trade_response`` decisions, one per
    pending trade offer (in proposal order), addressed to the recipient.
    Pure: never mutates the game.
    """
    flow = _flow_decision(game)
    if flow is None:
        return []
    decisions = [flow]
    for trade in game.pending_trades.values():
        decisions.append(
            Decision(trade.to_player_id, TRADE_RESPONSE, {"trade": trade.to_dict()})
        )
    return decisions


def _tile_option(game: Game, tile: Tile) -> dict:
    """Describe what placing ``tile`` would do (tile must be playable)."""
    result = Rules.get_placement_result(game.board, tile)
    if result.result_type == PlacementResult.EXPAND:
        outcome, chains = "expand", [result.chain]
    elif result.result_type == PlacementResult.MERGE:
        outcome, chains = "merge", list(result.chains)
    elif result.result_type == PlacementResult.FOUND:
        outcome, chains = "found", []
    else:
        outcome, chains = "nothing", []
    return {"tile": str(tile), "outcome": outcome, "chains": chains}


def _can_declare(game: Game, player_id: str) -> bool:
    return (
        game.get_current_player().player_id == player_id and game.can_declare_end_game()
    )


def legal_actions(game: Game, decision: Decision) -> dict:
    """Describe every legal answer to ``decision`` (JSON-serialisable).

    The ``place_tile`` description lists tiles from the deciding player's
    private hand: only show it to that player.
    """
    kind = decision.kind
    pid = decision.player_id
    player = game.get_player(pid)

    if kind == PLACE_TILE:
        tiles = []
        if player is not None:
            tiles = [
                _tile_option(game, t)
                for t in player.hand
                if Rules.can_place_tile(game.board, t, game.hotel)
            ]
        action_types = ["place_tile"]
        if _can_declare(game, pid):
            action_types.append("declare_end_game")
        return {"action_types": action_types, "tiles": tiles}

    if kind == FOUND_CHAIN:
        return {
            "action_types": ["found_chain"],
            "chains": list(decision.context.get("available_chains", [])),
        }

    if kind == CHOOSE_SURVIVOR:
        return {
            "action_types": ["merger_choice"],
            "chains": list(decision.context.get("tied_chains", [])),
        }

    if kind == CHOOSE_DEFUNCT_ORDER:
        return {
            "action_types": ["merger_order"],
            "chains": list(decision.context.get("tied_chains", [])),
        }

    if kind == STOCK_DISPOSITION:
        ctx = decision.context
        count = ctx.get("stock_count") or 0
        available = game.hotel.get_available_stocks(ctx.get("surviving_chain"))
        ratio = game.ruleset.merger_trade_ratio
        max_trade = min(count - count % ratio, available * ratio)
        out = {
            "action_types": ["merger_disposition"],
            "defunct_chain": ctx.get("defunct_chain"),
            "surviving_chain": ctx.get("surviving_chain"),
            "stock_count": count,
            "max_trade": max_trade,
            "rule": "sell+trade+hold == stock_count",
        }
        if ratio != 2:
            # Only present for non-2:1 rulesets, so default output is unchanged.
            out["trade_ratio"] = ratio
        return out

    if kind == BUY_STOCKS:
        money = player.money if player else 0
        action_types = []
        options = []
        max_buy = game.ruleset.max_stock_purchases_per_turn
        if not game.stocks_bought_this_turn:
            action_types.append("buy_stocks")
            for chain in game.hotel.get_active_chains():
                size = game.board.get_chain_size(chain)
                price = game.hotel.get_stock_price(chain, size)
                available = game.hotel.get_available_stocks(chain)
                max_affordable = min(
                    max_buy,
                    available,
                    money // price if price > 0 else max_buy,
                )
                options.append(
                    {
                        "chain": chain,
                        "price": price,
                        "available": available,
                        "max_affordable": max_affordable,
                    }
                )
        action_types.append("end_turn")
        if _can_declare(game, pid):
            action_types.append("declare_end_game")
        action_types.append("propose_trade")
        return {
            "action_types": action_types,
            "max_total": 0 if game.stocks_bought_this_turn else max_buy,
            "options": options,
            "money": money,
        }

    if kind == TRADE_RESPONSE:
        trade_dict = decision.context.get("trade", {})
        trade = game.pending_trades.get(trade_dict.get("trade_id"))
        can_accept = False
        if trade is not None:
            can_accept, _ = Rules.validate_trade(game, trade)
        return {
            "action_types": ["accept_trade", "reject_trade"],
            "trade": trade_dict,
            "can_accept": bool(can_accept),
        }

    return {"action_types": []}


# =============================================================================
# Parsing (wire dict -> engine arguments)
# =============================================================================


class _ActionError(Exception):
    """Raised internally when an action dict is malformed."""


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _non_negative_int(v: Any, name: str) -> int:
    if not _is_int(v) or v < 0:
        raise _ActionError(f"{name} must be a non-negative integer")
    return v


def _chain_name(v: Any, rs: Ruleset, name: str = "chain") -> str:
    if not rs.has_chain(v):
        raise _ActionError(f"Invalid {name}: {v!r}")
    return v


def _str_field(action: dict, key: str) -> str:
    v = action.get(key)
    if not isinstance(v, str) or not v:
        raise _ActionError(f"Missing or invalid '{key}'")
    return v


def _parse_tile(v: Any, rs: Ruleset) -> Tile:
    if not isinstance(v, str):
        raise _ActionError("Invalid tile")
    coords = rs.board.parse_tile_coords(v)
    if coords is None:
        raise _ActionError(
            f"Invalid tile format. Expected format like {rs.board.tile_example()}"
        )
    return Tile(coords[0], coords[1], rs.board)


def _parse_stock_dict(v: Any, name: str, rs: Ruleset) -> dict[str, int]:
    if v is None:
        return {}
    if not isinstance(v, dict):
        raise _ActionError(f"{name} must be an object")
    out = {}
    for chain, qty in v.items():
        _chain_name(chain, rs)
        out[chain] = _non_negative_int(qty, f"{name}[{chain}]")
    return out


def _parse_purchases(v: Any, rs: Ruleset) -> list[str]:
    """{"a": 2, "b": 1} -> ["a", "a", "b"] (chain id -> count, expanded)."""
    if v is None:
        v = {}
    if isinstance(v, list):
        # Engine-native form: list of chain names
        for chain in v:
            _chain_name(chain, rs)
        purchases = list(v)
    else:
        counts = _parse_stock_dict(v, "purchases", rs)
        purchases = []
        for chain, qty in counts.items():
            purchases.extend([chain] * qty)
    return purchases


def _parse_disposition(action: dict) -> tuple[int, int, int]:
    disp = action.get("disposition")
    if not isinstance(disp, dict):
        raise _ActionError("Missing or invalid 'disposition'")
    sell = _non_negative_int(disp.get("sell", 0), "sell")
    trade = _non_negative_int(disp.get("trade", 0), "trade")
    # Wire format says "hold"; accept the engine's "keep" as an alias.
    hold_value = disp["hold"] if "hold" in disp else disp.get("keep", 0)
    hold = _non_negative_int(hold_value, "hold")
    return sell, trade, hold


def _build_trade(player_id: str, action: dict, rs: Ruleset) -> TradeOffer:
    to_player_id = _str_field(action, "to_player_id")
    # Optional explicit id (deterministic fixtures/tests); random uuid otherwise.
    trade_id = action.get("trade_id")
    if trade_id is not None and (not isinstance(trade_id, str) or not trade_id):
        raise _ActionError("Invalid 'trade_id'")
    return TradeOffer(
        trade_id=trade_id,
        from_player_id=player_id,
        to_player_id=to_player_id,
        offering_stocks=_parse_stock_dict(
            action.get("offering_stocks"), "offering_stocks", rs
        ),
        offering_money=_non_negative_int(
            action.get("offering_money", 0), "offering_money"
        ),
        requesting_stocks=_parse_stock_dict(
            action.get("requesting_stocks"), "requesting_stocks", rs
        ),
        requesting_money=_non_negative_int(
            action.get("requesting_money", 0), "requesting_money"
        ),
    )


# =============================================================================
# Validation
# =============================================================================


def _not_flow_turn(game: Game, player_id: str, kinds: tuple[str, ...]) -> str:
    flow = _flow_decision(game)
    if flow is None:
        return "No decision pending"
    if flow.kind not in kinds:
        return f"Action not allowed now (waiting for {flow.kind})"
    if flow.player_id != player_id:
        return "Not your turn"
    return ""


def _validate(game: Game, player_id: str, action: Any) -> str | None:
    if not isinstance(action, dict):
        return "Action must be an object"
    action_type = action.get("action")
    if action_type not in ACTION_TYPES:
        return f"Unknown action: {action_type}"
    player = game.get_player(player_id)
    if player is None:
        return "Player not found"
    if game.phase == GamePhase.LOBBY:
        return "Game has not started"
    if game.phase == GamePhase.GAME_OVER:
        return "Game is already over"
    rs = game.ruleset

    if action_type == "place_tile":
        tile = _parse_tile(action.get("tile"), rs)
        err = _not_flow_turn(game, player_id, (PLACE_TILE,))
        if err:
            return err
        if not player.has_tile(tile):
            return "Tile not in hand"
        if not Rules.can_place_tile(game.board, tile, game.hotel):
            return "Tile cannot be placed"
        return None

    if action_type == "found_chain":
        chain = _chain_name(action.get("chain"), rs)
        err = _not_flow_turn(game, player_id, (FOUND_CHAIN,))
        if err:
            return err
        if chain not in game.pending_action.get("available_chains", []):
            return f"Chain {chain} not available"
        return None

    if action_type == "merger_choice":
        chain = _chain_name(action.get("surviving_chain"), rs, "surviving_chain")
        err = _not_flow_turn(game, player_id, (CHOOSE_SURVIVOR,))
        if err:
            return err
        if chain not in game.pending_action.get("tied_chains", []):
            return f"Chain {chain} not in tied chains"
        return None

    if action_type == "merger_order":
        chain = _chain_name(action.get("defunct_chain"), rs, "defunct_chain")
        err = _not_flow_turn(game, player_id, (CHOOSE_DEFUNCT_ORDER,))
        if err:
            return err
        if chain not in game.pending_action.get("tied_chains", []):
            return f"Chain {chain} not in tied chains"
        return None

    if action_type == "merger_disposition":
        defunct = _chain_name(action.get("defunct_chain"), rs, "defunct_chain")
        sell, trade, hold = _parse_disposition(action)
        err = _not_flow_turn(game, player_id, (STOCK_DISPOSITION,))
        if err:
            return err
        pending = game.pending_action
        if defunct != pending.get("defunct_chain"):
            return f"Pending disposition is for {pending.get('defunct_chain')}"
        if sell + trade + hold != pending.get("stock_count"):
            return "Stock counts don't add up"
        ratio = rs.merger_trade_ratio
        if trade % ratio != 0:
            return trade_multiple_error(ratio)
        survivor = pending.get("surviving_chain")
        if trade // ratio > game.hotel.get_available_stocks(survivor):
            return "Not enough survivor stock available to trade"
        return None

    if action_type == "buy_stocks":
        purchases = _parse_purchases(action.get("purchases"), rs)
        err = _not_flow_turn(game, player_id, (BUY_STOCKS,))
        if err:
            return err
        if game.stocks_bought_this_turn:
            return "Stocks already bought this turn"
        max_buy = rs.max_stock_purchases_per_turn
        if len(purchases) > max_buy:
            return f"Can only buy up to {max_buy} stocks"
        total_cost = 0
        counts: dict[str, int] = {}
        for chain in purchases:
            if not game.hotel.is_chain_active(chain):
                return f"Chain {chain} is not active"
            counts[chain] = counts.get(chain, 0) + 1
            total_cost += game.hotel.get_stock_price(
                chain, game.board.get_chain_size(chain)
            )
        if total_cost > player.money:
            return "Not enough money"
        for chain, count in counts.items():
            if game.hotel.get_available_stocks(chain) < count:
                return f"Not enough {chain} stock available"
        return None

    if action_type == "end_turn":
        return _not_flow_turn(game, player_id, (BUY_STOCKS,)) or None

    if action_type == "declare_end_game":
        if game.get_current_player().player_id != player_id:
            return "Only the current player can declare end game"
        if not game.can_declare_end_game():
            return "End game conditions are not met"
        return None

    if action_type == "propose_trade":
        trade = _build_trade(player_id, action, rs)
        if trade.trade_id in game.pending_trades:
            return "Trade id already in use"
        max_pending = rs.max_pending_trades_per_player
        if game._count_pending_trades_for_player(player_id) >= max_pending:
            return f"Maximum of {max_pending} pending trades per player"
        ok, error = Rules.validate_trade(game, trade)
        return None if ok else error

    # accept / reject / cancel
    trade_id = _str_field(action, "trade_id")
    trade = game.pending_trades.get(trade_id)
    if trade is None:
        return "Trade not found"
    if action_type == "cancel_trade":
        if trade.from_player_id != player_id:
            return "Only the trade proposer can cancel"
        return None
    if trade.to_player_id != player_id:
        verb = "accept" if action_type == "accept_trade" else "reject"
        return f"Only the trade recipient can {verb}"
    if action_type == "accept_trade":
        ok, error = Rules.validate_trade(game, trade)
        if not ok:
            return f"Trade is no longer valid: {error}"
    return None


def validate_action(game: Game, player_id: str, action: Any) -> str | None:
    """Return an error message if ``action`` is illegal now, else None.

    Never mutates the game and never raises.
    """
    try:
        return _validate(game, player_id, action)
    except _ActionError as e:
        return str(e)
    except Exception as e:  # noqa: BLE001 - malformed input must never raise
        return f"Invalid action: {e}"


def draft_trade(
    game: Game, player_id: str, action: Any
) -> tuple[TradeOffer | None, str]:
    """A ``propose_trade`` action that has not been sent: the offer it would
    create, and why it would be refused right now ("" when it would not).

    The verdict is ``validate_action``'s, the check ``apply_action`` itself
    runs, so a preview of a draft and the proposal agree. Never mutates the
    game and never raises; the offer is None when the action is malformed.
    """
    if not isinstance(action, dict):
        return None, "Action must be an object"
    action = {**action, "action": "propose_trade"}
    error = validate_action(game, player_id, action) or ""
    try:
        trade = _build_trade(player_id, action, game.ruleset)
    except _ActionError as e:
        return None, str(e)
    except Exception as e:  # noqa: BLE001 - malformed input must never raise
        return None, f"Invalid action: {e}"
    return trade, error


# =============================================================================
# Applying
# =============================================================================


def _dispatch(game: Game, player_id: str, action: dict):
    action_type = action["action"]
    rs = game.ruleset
    if action_type == "place_tile":
        return game.play_tile(player_id, _parse_tile(action["tile"], rs))
    if action_type == "found_chain":
        return game.found_chain(player_id, action["chain"])
    if action_type == "merger_choice":
        return game.choose_merger_survivor(player_id, action["surviving_chain"])
    if action_type == "merger_order":
        return game.choose_defunct_order(player_id, action["defunct_chain"])
    if action_type == "merger_disposition":
        sell, trade, hold = _parse_disposition(action)
        # Wire "hold" maps to the engine's "keep"
        return game.handle_stock_disposition(player_id, sell, trade, hold)
    if action_type == "buy_stocks":
        return game.buy_stocks(player_id, _parse_purchases(action.get("purchases"), rs))
    if action_type == "end_turn":
        return game.end_turn(player_id)
    if action_type == "declare_end_game":
        return game.declare_end_game(player_id)
    if action_type == "propose_trade":
        return game.propose_trade(_build_trade(player_id, action, rs))
    handlers: dict[str, Callable] = {
        "accept_trade": game.accept_trade,
        "reject_trade": game.reject_trade,
        "cancel_trade": game.cancel_trade,
    }
    return handlers[action_type](player_id, action["trade_id"])


def apply_action(game: Game, player_id: str, action: Any) -> dict:
    """THE single mutation entry point for every seat.

    Validates ``action`` (see validate_action), dispatches to the matching
    Game method, and returns its result's ``to_dict()`` (always has
    "success"; "error" when False). An illegal or malformed action leaves the
    game untouched. Never raises on bad input.
    """
    error = validate_action(game, player_id, action)
    if error is not None:
        return {"success": False, "error": error}
    try:
        result = _dispatch(game, player_id, action)
    except Exception as e:  # noqa: BLE001 - would be an engine bug
        return {"success": False, "error": f"Internal error: {e}"}
    return result.to_dict()


# =============================================================================
# Event log
# =============================================================================


def public_events(
    game: Game, viewer_id: str | None = None, since_seq: int = 0
) -> list[dict]:
    """Events visible to ``viewer_id`` (None = spectator: public only).

    Args:
        game: The game
        viewer_id: Player whose private events are included, if any
        since_seq: Only return events with seq >= since_seq
    """
    return [
        e
        for e in game.events[since_seq:]
        if e["private_to"] is None or e["private_to"] == viewer_id
    ]
