"""Server -> client messages: game state, lobby updates and notifications.

Every notification is derived from engine output (the event log and the
pending decisions), never from which code path performed the action, so a
human action and an agent action produce identical messages.

Messages (shapes unchanged from the pre-seat server unless noted):

* ``game_state`` - public state; per player ``kind``, ``is_bot``,
  ``agent_label`` (new); top-level ``awaiting``, ``pending_trades`` and
  ``ruleset`` (the game's ruleset dict + ``fingerprint``) (new); each
  ``hotel.chains`` entry also carries ``color`` (new);
  to each player also ``your_hand``, ``end_game_available``, and (new)
  ``tile_playability``, ``incoming_trades``, ``outgoing_trades``.
* ``lobby_update`` - players carry ``kind`` and ``agent_label`` (new).
* ``choose_chain`` / ``choose_merger_survivor`` / ``stock_disposition_required``
  - sent to the human whose decision just became pending.
* ``can_end_game`` - to the human whose turn just started when declaring is legal.
* ``all_tiles_unplayable`` (room) / ``tiles_replaced`` (that player).
* ``trade_proposed`` / ``trade_accepted`` / ``trade_rejected`` /
  ``trade_canceled`` - to both trade parties and the host.
* ``agent_fallback`` - room and host: the rules-based bot decided for an LLM
  seat (``player_id, player_name, agent_label, reason, decision, message``);
  ``game_state`` players also carry ``fallbacks: {count, last_reason}``.
* ``game_over`` - room and host; carries ``game_id`` (also in ``game_state``)
  so clients can link to ``/games/{game_id}``.
* ``error`` - to the acting human only.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app_state import session_manager
from game.decisions import Decision, pending_decisions
from game.rules import Rules

if TYPE_CHECKING:
    from game.game import Game
    from session.manager import GameRoom


# ---------------------------------------------------------------------------
# Seats
# ---------------------------------------------------------------------------


def seat_kind(room: GameRoom, player_id: str) -> str:
    seat = room.players.get(player_id)
    return seat.kind if seat is not None else "human"


def seat_info(room: GameRoom, player_id: str) -> dict:
    seat = room.players.get(player_id)
    if seat is None:
        return {"kind": "human", "is_bot": False, "agent_label": None}
    return {
        "kind": seat.kind,
        "is_bot": bool(seat.is_bot or seat.is_agent),
        "agent_label": seat.agent_label,
    }


def seat_fallbacks(room: GameRoom, player_id: str) -> dict:
    """``{count, last_reason}``: how often the rules-based bot decided for this
    seat (``last_reason``: timeout | error | illegal | cap | None)."""
    seen = getattr(room.runtime, "seat_fallbacks", None) or {}
    rec = seen.get(player_id) or {}
    return {"count": int(rec.get("count", 0)), "last_reason": rec.get("last_reason")}


def is_human(room: GameRoom, player_id: str) -> bool:
    return seat_kind(room, player_id) == "human"


def min_to_start(room: GameRoom) -> int:
    """Seats needed to start: the room's minimum, but never below the
    ruleset's ``min_players`` (3 in classic; starting with fewer used to 500
    and leave the room marked started without a game)."""
    from game.ruleset import resolve

    return max(room.min_players, resolve(room.ruleset).min_players)


def lobby_players(room: GameRoom) -> list[dict]:
    return [
        {"player_id": p.player_id, "name": p.name, **seat_info(room, p.player_id)}
        for p in room.players.values()
    ]


# ---------------------------------------------------------------------------
# Game state
# ---------------------------------------------------------------------------


def compute_awaiting(room: GameRoom, game: Game) -> dict | None:
    """``{player_id, kind, decision}`` for the decision the table waits on.

    While the driver is waiting on an agent this is that agent's decision
    (which may be a trade response while a human holds the flow decision);
    otherwise it is the blocking flow decision. None when nothing is pending.
    """
    runtime = room.runtime
    thinking = getattr(runtime, "thinking", None)
    if thinking is not None:
        return dict(thinking)
    decisions = pending_decisions(game)
    if not decisions:
        return None
    d = decisions[0]
    return {
        "player_id": d.player_id,
        "kind": seat_kind(room, d.player_id),
        "decision": d.kind,
    }


def build_public_state(room: GameRoom, game: Game) -> dict:
    """The JSON-safe ``game_state`` message as everyone (host/spectator) sees it."""
    game_state = game.get_public_state()

    chains_info = [
        {
            "name": name,
            "size": data["size"],
            "price": data["stock_price"],
            "stocks_available": data["available_stocks"],
            "color": data["color"],
        }
        for name, data in game_state["chains"].items()
    ]
    hotel_state = {
        "chains": chains_info,
        "available_stocks": {
            name: data["available_stocks"]
            for name, data in game_state["chains"].items()
        },
        "active_chains": [
            name for name, data in game_state["chains"].items() if data["active"]
        ],
    }
    players = {}
    for p in game_state["players"]:
        players[p["player_id"]] = {
            "name": p["name"],
            "money": p["money"],
            "stocks": p["stocks"],
            "hand_size": p["tile_count"],
            **seat_info(room, p["player_id"]),
            "fallbacks": seat_fallbacks(room, p["player_id"]),
        }
    # Note: game_state["pending_action"] may hold Tile objects; it is not sent.
    return {
        "type": "game_state",
        "board": game_state["board"],
        "hotel": hotel_state,
        "turn_order": [p["player_id"] for p in game_state["players"]],
        "current_player": game_state["current_player"],
        "phase": game_state["phase"],
        "players": players,
        "tiles_remaining": game_state["tiles_remaining"],
        "pending_trades": game_state["pending_trades"],
        "awaiting": compute_awaiting(room, game),
        "game_id": getattr(room, "game_id", None),
        "ruleset": game_state["ruleset"],
    }


def private_fields(game: Game, player_id: str) -> dict:
    """The fields only ``player_id`` may see."""
    player = game.get_player(player_id)
    if player is None:
        return {}
    current = game.get_current_player_id()
    return {
        "your_hand": [str(t) for t in player.hand],
        "tile_playability": Rules.get_tiles_playability(
            game.board, player.hand, game.hotel
        ),
        "end_game_available": bool(
            current == player_id and game.can_declare_end_game()
        ),
        "incoming_trades": [
            t.to_dict() for t in game.get_incoming_trades_for_player(player_id)
        ],
        "outgoing_trades": [
            t.to_dict() for t in game.get_outgoing_trades_for_player(player_id)
        ],
    }


async def broadcast_game_state(room_code: str) -> None:
    """Send the current state to the host and every connected human."""
    room = session_manager.get_room(room_code)
    if room is None or room.game is None:
        return
    game = room.game
    public_state = build_public_state(room, game)
    await session_manager.send_to_host(room_code, public_state)
    for player in game.players:
        seat = room.players.get(player.player_id)
        if seat is None or not seat.websockets:
            continue
        await session_manager.send_to_player(
            room_code,
            player.player_id,
            {**public_state, **private_fields(game, player.player_id)},
        )


async def broadcast_lobby_update(room_code: str) -> None:
    room = session_manager.get_room(room_code)
    if room is None:
        return
    players = lobby_players(room)
    message = {
        "type": "lobby_update",
        "players": players,
        "can_start": len(players) >= min_to_start(room),
    }
    await session_manager.send_to_host(room_code, message)
    await session_manager.broadcast_to_room(room_code, message)


async def broadcast_agent_fallback(
    room_code: str,
    *,
    player_id: str,
    player_name: str,
    agent_label: str,
    reason: str,
    decision: str,
    message: str,
) -> None:
    """Tell the table (every player and the host) that the rules-based bot made
    a decision on behalf of an LLM seat."""
    msg = {
        "type": "agent_fallback",
        "player_id": player_id,
        "player_name": player_name,
        "agent_label": agent_label,
        "reason": reason,
        "decision": decision,
        "message": message,
    }
    await session_manager.broadcast_to_room(room_code, msg)
    await session_manager.send_to_host(room_code, msg)


# ---------------------------------------------------------------------------
# Decision prompts
# ---------------------------------------------------------------------------


def flow_decision(game: Game) -> Decision | None:
    decisions = pending_decisions(game)
    return decisions[0] if decisions else None


def prompt_for(game: Game, decision: Decision) -> dict | None:
    """The private prompt message a human gets for ``decision``, if any."""
    ctx = decision.context
    if decision.kind == "found_chain":
        return {
            "type": "choose_chain",
            "available_chains": ctx.get("available_chains", []),
        }
    if decision.kind == "choose_survivor":
        return {
            "type": "choose_merger_survivor",
            "tied_chains": ctx.get("tied_chains", []),
        }
    if decision.kind == "stock_disposition":
        return {
            "type": "stock_disposition_required",
            "defunct_chain": ctx.get("defunct_chain"),
            "surviving_chain": ctx.get("surviving_chain"),
            "stock_count": ctx.get("stock_count"),
            "available_to_trade": ctx.get("available_to_trade"),
        }
    return None


async def send_prompts(room_code: str, game: Game, decision: Decision | None) -> None:
    """Prompt the human who owns ``decision`` (no-op for agent seats)."""
    room = session_manager.get_room(room_code)
    if room is None or decision is None or not is_human(room, decision.player_id):
        return
    prompt = prompt_for(game, decision)
    if prompt is not None:
        await session_manager.send_to_player(room_code, decision.player_id, prompt)
    if (
        decision.kind in ("place_tile", "buy_stocks")
        and game.get_current_player_id() == decision.player_id
        and game.can_declare_end_game()
    ):
        await session_manager.send_to_player(
            room_code,
            decision.player_id,
            {"type": "can_end_game", "message": "You may choose to end the game"},
        )


# ---------------------------------------------------------------------------
# Event-derived notifications
# ---------------------------------------------------------------------------


def _trade_parties(game: Game, trade_id: str) -> tuple[str | None, str | None]:
    for e in reversed(game.events):
        if e["type"] == "trade_proposed" and e["trade"].get("trade_id") == trade_id:
            return e["trade"]["from_player_id"], e["trade"]["to_player_id"]
    return None, None


async def _send_both(room_code: str, a: str | None, b: str | None, msg: dict) -> None:
    """Trade notifications go to both parties and the host display."""
    for pid in dict.fromkeys(x for x in (a, b) if x):
        await session_manager.send_to_player(room_code, pid, msg)
    await session_manager.send_to_host(room_code, msg)


async def publish_events(room_code: str, game: Game, since_seq: int) -> None:
    """Translate events ``game.events[since_seq:]`` into client notifications."""
    events = game.events[since_seq:]
    declared_by = None
    for e in events:
        etype = e["type"]
        pid = e.get("player_id")
        if etype == "tiles_replaced":
            player = game.get_player(pid)
            if e.get("reason") == "all_unplayable":
                await session_manager.broadcast_to_room(
                    room_code,
                    {
                        "type": "all_tiles_unplayable",
                        "player_id": pid,
                        "player_name": player.name if player else "",
                        "revealed_hand": e.get("revealed_hand", []),
                        "removed_tiles": e.get("removed_tiles", []),
                        "new_tiles_count": e.get("new_tile_count", 0),
                    },
                )
            if player is not None:
                await session_manager.send_to_player(
                    room_code,
                    pid,
                    {
                        "type": "tiles_replaced",
                        "removed_tiles": e.get("removed_tiles", []),
                        "new_hand": [str(t) for t in player.hand],
                    },
                )
        elif etype == "trade_proposed":
            trade = e["trade"]
            await _send_both(
                room_code,
                trade["from_player_id"],
                trade["to_player_id"],
                {"type": "trade_proposed", "trade": trade},
            )
        elif etype == "trade_accepted":
            trade = e["trade"]
            await _send_both(
                room_code,
                trade["from_player_id"],
                trade["to_player_id"],
                {
                    "type": "trade_accepted",
                    "trade_id": trade["trade_id"],
                    "from_player": trade["from_player_id"],
                    "to_player": trade["to_player_id"],
                },
            )
        elif etype == "trade_rejected":
            a, b = _trade_parties(game, e["trade_id"])
            await _send_both(
                room_code,
                a,
                b,
                {
                    "type": "trade_rejected",
                    "trade_id": e["trade_id"],
                    "rejected_by": pid,
                },
            )
        elif etype == "trade_cancelled":
            a, b = _trade_parties(game, e["trade_id"])
            await _send_both(
                room_code,
                a,
                b,
                {
                    "type": "trade_canceled",
                    "trade_id": e["trade_id"],
                    "canceled_by": pid,
                },
            )
        elif etype == "end_game_declared":
            declared_by = pid
        elif etype == "game_ended":
            room = session_manager.get_room(room_code)
            msg = game_over_message(
                game, e, declared_by, game_id=getattr(room, "game_id", None)
            )
            await session_manager.broadcast_to_room(room_code, msg)
            await session_manager.send_to_host(room_code, msg)


def game_over_message(
    game: Game, ended: dict, declared_by: str | None, game_id: str | None = None
) -> dict:
    """The ``game_over`` message for a ``game_ended`` event.

    Each score carries the final ``money`` plus its breakdown: ``bonuses`` (final
    majority/minority bonuses paid at game end) and ``stock_sales`` (cash from
    liquidating stock), so clients can show cash before / bonuses / sales without
    guessing. ``money`` already includes both.
    """
    bonuses: dict[str, int] = {}
    for ev in game.events:
        if ev["type"] == "bonuses_paid" and ev.get("final"):
            for pid, b in ev.get("bonuses", {}).items():
                bonuses[pid] = (
                    bonuses.get(pid, 0) + b.get("majority", 0) + b.get("minority", 0)
                )
    sales = ended.get("final_sales", {})
    scores = {
        s["player_id"]: {
            "name": s["name"],
            "money": s["money"],
            "bonuses": bonuses.get(s["player_id"], 0),
            "stock_sales": sales.get(s["player_id"], 0),
        }
        for s in ended.get("standings", [])
    }
    msg = {
        "type": "game_over",
        "scores": scores,
        "winner": ended.get("winner"),
        "game_id": game_id,
    }
    if declared_by is not None:
        msg["declared_by"] = declared_by
    return msg


def final_game_over(game: Game, game_id: str | None = None) -> dict | None:
    """The ``game_over`` message of a finished game (re-sent on reconnect), else None."""
    ended = next((e for e in reversed(game.events) if e["type"] == "game_ended"), None)
    if ended is None:
        return None
    declared = next(
        (e for e in reversed(game.events) if e["type"] == "end_game_declared"), None
    )
    return game_over_message(
        game, ended, declared.get("player_id") if declared else None
    )


async def send_player_state(room_code: str, player_id: str) -> None:
    """State for a (re)connecting player, plus any prompt still pending for them
    (and the final scores when the game is already over)."""
    room = session_manager.get_room(room_code)
    if room is None:
        return
    if room.started and room.game:
        await broadcast_game_state(room_code)
        await send_prompts(room_code, room.game, _decision_for(room.game, player_id))
        over = final_game_over(room.game, getattr(room, "game_id", None))
        if over is not None:
            await session_manager.send_to_player(room_code, player_id, over)
    else:
        await broadcast_lobby_update(room_code)


def _decision_for(game: Game, player_id: str) -> Decision | None:
    d = flow_decision(game)
    return d if d is not None and d.player_id == player_id else None


async def send_host_state(room_code: str) -> None:
    room = session_manager.get_room(room_code)
    if room is None:
        return
    if room.started and room.game:
        await broadcast_game_state(room_code)
        over = final_game_over(room.game, getattr(room, "game_id", None))
        if over is not None:
            await session_manager.send_to_host(room_code, over)
    else:
        await broadcast_lobby_update(room_code)
