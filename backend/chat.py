"""Public table chat: short text messages from seats to the whole table.

Chat is table talk, not a game action: it never goes through ``apply_action``,
never touches the game state, snapshots or fixtures, and nothing said is
binding (binding deals are trade offers). See
docs/architecture/seat-contract.md, "Table chat".

* Humans post over HTTP (``POST /room/{code}/chat/{player_id}``); everyone
  (players and the host/spectator view) receives ``chat_message`` over the
  WebSocket, and ``chat_history`` on (re)connect.
* An LLM seat may attach a short ``say`` to a move (no extra model call); the
  driver posts it with ``post_message(..., source="say")``.
* LLM seats may also speak off-turn at any time: after any human message,
  after another AI's message that names them or negotiates, and after
  notable game events that concern them, each seat gets a "do you want to
  say something?" call (``request_talk``) in a background task that never
  holds the room lock and never touches game state. Loop protection: a
  bounded AI-only streak, a per-seat cooldown, one call in flight per seat,
  and a generous per-game runaway cap (all settings).
* Every message (and every reply call, with its tokens) is written to the
  game transcript as ``chat`` / ``chat_reply`` lines, in order with the
  engine events (``after_seq``). Lobby messages are written at game start.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from app_state import session_manager
from config import get_settings
from transcripts.paths import utc_now

logger = logging.getLogger(__name__)

# Characters a message may not contain: control characters (newlines become
# spaces first). The frontend renders text as text, never as HTML.
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_SPACES = re.compile(r"\s+")


class ChatError(Exception):
    """A refused message: ``status`` is the HTTP status the route returns."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass
class ChatState:
    """Chat of one room (``GameRoom.chat``)."""

    messages: deque = field(default_factory=lambda: deque(maxlen=200))
    next_id: int = 1
    # player_id -> monotonic times of recent messages (rate limit)
    sent: dict = field(default_factory=dict)
    # (game key, player_id) -> {"count", "last", "in_flight"} for reply calls
    replies: dict = field(default_factory=dict)
    # monotonic time each message was posted (addressing window), by id
    posted_at: dict = field(default_factory=dict)
    # messages posted before the current game's transcript existed (lobby)
    unwritten: list = field(default_factory=list)
    # reply calls made before the transcript existed (their cost still counts)
    unwritten_replies: list = field(default_factory=list)
    tasks: set = field(default_factory=set)
    # consecutive AI messages since the last human message or game move
    ai_streak: int = 0
    closing: Any = None  # task closing a finished game's transcript


def chat_state(room) -> ChatState:
    state = getattr(room, "chat", None)
    if state is None:
        state = ChatState(
            messages=deque(maxlen=max(10, get_settings().chat_history_size))
        )
        room.chat = state
    return state


def clean_text(text: Any) -> str:
    """Plain text: control characters and runs of whitespace become one space."""
    if not isinstance(text, str):
        raise ChatError("text must be a string", 422)
    text = _SPACES.sub(" ", _CONTROL.sub(" ", text)).strip()
    if not text:
        raise ChatError("Message is empty", 422)
    cap = get_settings().chat_max_chars
    if len(text) > cap:
        raise ChatError(f"Message is longer than {cap} characters", 422)
    return text


def _rate_limited(state: ChatState, player_id: str, now: float) -> bool:
    s = get_settings()
    window = s.chat_rate_limit_window_s
    times = state.sent.setdefault(player_id, deque())
    while times and now - times[0] > window:
        times.popleft()
    return len(times) >= s.chat_rate_limit_count


def public_message(msg: dict) -> dict:
    """The message as clients see it (no server bookkeeping)."""
    return {
        k: msg.get(k)
        for k in (
            "id",
            "player_id",
            "name",
            "kind",
            "source",
            "text",
            "at",
            "after_seq",
            "reply_to",
        )
    }


def history(room, limit: int | None = None) -> list[dict]:
    state = chat_state(room)
    msgs = list(state.messages)
    if limit is not None:
        msgs = msgs[-limit:]
    return [public_message(m) for m in msgs]


def prompt_messages(room, limit: int | None = None) -> list[dict]:
    """The last chat messages of the current game (and its lobby), bounded,
    for an LLM seat's decision prompt."""
    n = get_settings().chat_prompt_messages if limit is None else limit
    if n <= 0:
        return []
    game_id = getattr(room, "game_id", None)
    msgs = [
        m
        for m in chat_state(room).messages
        if m.get("game_id") in (None, game_id) and m.get("kind")
    ]
    return [public_message(m) for m in msgs[-n:]]


def _writer(room):
    w = getattr(room, "transcript", None)
    if w is None or w.closed or w.game is not room.game:
        return None
    return w


async def post_message(
    room_code: str,
    player_id: str,
    text: Any,
    *,
    source: str = "human",
    reply_to: int | None = None,
    decision_index: int | None = None,
) -> dict:
    """Validate, store, transcribe and broadcast one message.

    Raises ``ChatError`` (with an HTTP status) for an unknown room or seat, a
    human posting for an AI seat, empty/overlong text or the rate limit.
    Returns the public message. A human message may schedule LLM replies.
    """
    room = session_manager.get_room(room_code)
    if room is None:
        raise ChatError("Room not found", 404)
    seat = room.players.get(player_id)
    if seat is None:
        raise ChatError("Player not found", 404)
    if source == "human" and seat.is_agent:
        raise ChatError("This seat is played by an AI agent", 403)
    if source != "human" and seat.kind != "llm":
        raise ChatError("Only LLM seats talk", 403)
    text = clean_text(text)
    state = chat_state(room)
    now = time.monotonic()
    if _rate_limited(state, player_id, now):
        raise ChatError("You are sending messages too fast; wait a moment", 429)
    state.sent[player_id].append(now)

    game = room.game if room.started else None
    msg = {
        "id": state.next_id,
        "player_id": player_id,
        "name": seat.name,
        "kind": seat.kind,
        "source": source,
        "text": text,
        "at": utc_now(),
        "after_seq": len(game.events) - 1 if game is not None else -1,
        "reply_to": reply_to,
        "game_id": getattr(room, "game_id", None) if game is not None else None,
    }
    state.next_id += 1
    state.messages.append(msg)
    state.posted_at[msg["id"]] = now
    if len(state.posted_at) > 4 * state.messages.maxlen:
        for k in sorted(state.posted_at)[: state.messages.maxlen]:
            del state.posted_at[k]

    state.ai_streak = 0 if seat.kind == "human" else state.ai_streak + 1

    writer = _writer(room)
    if writer is not None:
        writer.record_chat({**public_message(msg), "decision_index": decision_index})
    elif game is None:
        state.unwritten.append(msg)

    out = public_message(msg)
    payload = {"type": "chat_message", "message": out}
    await session_manager.broadcast_to_room(room_code, payload)
    await session_manager.send_to_host(room_code, payload)
    schedule_replies(room_code, msg)
    return out


def write_lobby_chat(room) -> None:
    """Write the messages posted before this game's transcript existed (the
    lobby) into the new transcript, right after its opening lines."""
    state = getattr(room, "chat", None)
    if state is None:
        return
    writer = _writer(room)
    if writer is not None:
        for msg in state.unwritten:
            writer.record_chat({**public_message(msg), "decision_index": None})
        for kwargs in state.unwritten_replies:
            writer.record_chat_reply(**kwargs)
    state.unwritten.clear()
    state.unwritten_replies.clear()


async def send_history(room_code: str, player_id: str | None = None) -> None:
    """``chat_history`` to one (re)connecting player, or the host when
    ``player_id`` is None."""
    room = session_manager.get_room(room_code)
    if room is None:
        return
    messages = history(room, 100)
    if not messages:
        return  # nothing said yet: no message (clients start empty)
    msg = {"type": "chat_history", "messages": messages}
    if player_id is None:
        await session_manager.send_to_host(room_code, msg)
    else:
        await session_manager.send_to_player(room_code, player_id, msg)


# ---------------------------------------------------------------------------
# Off-turn talk of LLM seats
# ---------------------------------------------------------------------------
#
# A "talk call" asks one LLM seat "do you want to say something?" outside its
# decisions. Triggers (``Trigger.kind``):
#
# * ``message``: a human message (the seats it names; spoken to the table, at
#   most ``chat_reply_table_seats`` seats), and an AI message that names the
#   seat AND floats a deal or asks something (a question or a deal word),
#   while the AI streak is below ``chat_ai_streak_max``;
# * ``event``: the game events listed in ``chat_reply_events`` after a move
#   (``on_action``); by default only the end of the game.
#
# Every trigger is a paid model call, so who is asked is decided here by
# rules, never by asking the model "do you want to speak?" on every line.
#
# Guards (settings): a per-seat cooldown (``chat_reply_cooldown_s``; a trigger
# arriving meanwhile is kept, the most important one, and fires when the
# cooldown ends), one call in flight per seat, the AI streak (consecutive AI
# messages since the last human message or game move: AI messages stop
# triggering talk at ``chat_ai_streak_max``) and a generous per-game runaway
# cap (``chat_reply_max_per_game``). A talk call never holds the room lock,
# never touches game state and never delays a move; its tokens are counted in
# the transcript totals (``chat_reply`` lines).

# Words that make an AI message an offer or a question worth answering.
_NEGOTIATION = re.compile(
    r"\?|\b(deal|trade|offer|swap|sell|buy|majority|minority|split|agree|"
    r"propose|bonus|merge|merger|price|shares?)\b",
    re.IGNORECASE,
)
PRIORITY = {"human": 3, "event": 2, "ai": 1}


def _talking_seats(room) -> list:
    """LLM seats that take part in table talk (agent ``table_talk`` true)."""
    return [
        s
        for s in room.players.values()
        if s.kind == "llm"
        and callable(getattr(s.agent, "reply", None))
        and getattr(s.agent, "table_talk", False)
    ]


def _mentions(text: str, name: str) -> bool:
    name = name.strip().lower()
    if not name:
        return False
    return re.search(r"(?<![\w])@?" + re.escape(name) + r"(?![\w])", text) is not None


def _short_names(seats) -> dict[str, str]:
    """First word of each seat name when it is distinctive (3+ characters and
    no other seat starts with it): "baron" for "Baron Brick"."""
    from session.seat_names import short_names

    return short_names({s.player_id: s.name for s in seats})


def named_seats(room, msg: dict) -> list:
    """Seats (any kind, not the sender) named in a message: full name,
    ``@name`` or a distinctive first word."""
    text = msg["text"].lower()
    others = [s for s in room.players.values() if s.player_id != msg["player_id"]]
    short = _short_names(room.players.values())  # distinctive at the whole table
    return [
        s
        for s in others
        if _mentions(text, s.name)
        or (s.player_id in short and _mentions(text, short[s.player_id]))
    ]


def message_targets(room, msg: dict) -> list:
    """Talking seats a new message gives the chance to speak. Decided by
    rules alone, before any model call, since every chance is a paid call.

    Human message: the talking seats it names; when it names none but
    continues a one-to-one exchange with one seat, that seat
    (``_conversation_partner``); otherwise (spoken to the table), at most
    ``chat_reply_table_seats`` of them, the ones that
    have had the fewest talk calls so far. AI message: only the talking
    seats it names, and only when it floats a deal or asks something (a
    question mark or a deal word); never while the AI streak is at
    ``chat_ai_streak_max``.
    """
    talking = [s for s in _talking_seats(room) if s.player_id != msg["player_id"]]
    if not talking:
        return []
    named = {s.player_id for s in named_seats(room, msg)}
    addressed = [s for s in talking if s.player_id in named]
    state = chat_state(room)
    settings = get_settings()
    if msg.get("kind") == "human":
        if addressed:
            return addressed
        partner = _conversation_partner(state, msg, talking)
        if partner is not None:
            return [partner]
        cap = max(0, settings.chat_reply_table_seats)
        order = sorted(
            range(len(talking)),
            key=lambda i: (_slot(state, room, talking[i].player_id)["count"], i),
        )
        return [talking[i] for i in sorted(order[:cap])]
    if state.ai_streak >= settings.chat_ai_streak_max:
        return []
    if not _NEGOTIATION.search(msg["text"]):
        return []
    return addressed


def _conversation_partner(state, msg: dict, talking: list):
    """The talking seat in a one-to-one exchange with the writer: everything
    said since the writer's previous message came from that one seat, and it
    was a reply to the writer (or a ``say`` with a move). An unnamed
    follow-up such as "if I give you SP..." continues that exchange (LO-013).
    None when several seats answered (a table conversation)."""
    before = [m for m in state.messages if m.get("id") != msg.get("id")]
    if not before:
        return None
    mine = [i for i, m in enumerate(before) if m.get("player_id") == msg["player_id"]]
    since = before[mine[-1] + 1 :] if mine else before[-1:]
    speakers = {m.get("player_id") for m in since}
    if len(speakers) != 1:
        return None
    seat = next((s for s in talking if s.player_id in speakers), None)
    if seat is None:
        return None
    asked = before[mine[-1]].get("id") if mine else None
    if any(
        m.get("source") == "say" or (asked is not None and m.get("reply_to") == asked)
        for m in since
    ):
        return seat
    return None


def _slot(state, room, player_id: str) -> dict:
    key = (getattr(room, "game_id", None) if room.started else None, player_id)
    return state.replies.setdefault(
        key,
        {
            "count": 0,
            "last": None,
            "in_flight": False,
            "pending": None,
            "timer": None,
            "skipped": 0,
        },
    )


def request_talk(room_code: str, player_id: str, trigger: dict) -> bool:
    """Give one seat the chance to speak about ``trigger``. Starts the call
    now, or keeps the trigger (the most important of those waiting) until the
    seat's cooldown ends or its call in flight returns. False when refused
    (talk disabled, unknown seat, per-game cap reached)."""
    s = get_settings()
    room = session_manager.get_room(room_code)
    if room is None or not s.chat_replies_enabled:
        return False
    seat = room.players.get(player_id)
    if seat is None or seat not in _talking_seats(room):
        return False
    state = chat_state(room)
    slot = _slot(state, room, player_id)
    if slot["count"] >= s.chat_reply_max_per_game:
        slot["skipped"] += 1
        return False
    now = time.monotonic()
    wait = 0.0
    if slot["last"] is not None:
        wait = max(0.0, s.chat_reply_cooldown_s - (now - slot["last"]))
    if slot["in_flight"] or wait > 0:
        old = slot["pending"]
        if old is not None:
            slot["skipped"] += 1
        if old is None or PRIORITY[trigger["source"]] >= PRIORITY[old["source"]]:
            slot["pending"] = trigger
        if not slot["in_flight"] and slot["timer"] is None:
            slot["timer"] = asyncio.get_running_loop().call_later(
                wait, _fire_pending, room_code, player_id
            )
        return True
    _start(room_code, room, state, slot, player_id, trigger)
    return True


def _start(room_code, room, state, slot, player_id: str, trigger: dict) -> None:
    slot.update(in_flight=True, last=time.monotonic(), count=slot["count"] + 1)
    task = asyncio.get_running_loop().create_task(
        _talk(room_code, player_id, trigger, slot)
    )
    state.tasks.add(task)
    task.add_done_callback(state.tasks.discard)


def _fire_pending(room_code: str, player_id: str) -> None:
    room = session_manager.get_room(room_code)
    if room is None or getattr(room, "chat", None) is None:
        return
    slot = _slot(room.chat, room, player_id)
    slot["timer"] = None
    trigger, slot["pending"] = slot["pending"], None
    if trigger is not None:
        request_talk(room_code, player_id, trigger)


def schedule_replies(room_code: str, msg: dict) -> list[str]:
    """After a new message: give each target seat its chance to speak.
    Returns the player ids asked (now or after their cooldown)."""
    room = session_manager.get_room(room_code)
    if room is None:
        return []
    source = "human" if msg.get("kind") == "human" else "ai"
    trigger = {"source": source, "message": public_message(msg), "events": []}
    return [
        s.player_id
        for s in message_targets(room, msg)
        if request_talk(room_code, s.player_id, trigger)
    ]


# --------------------------------------------------------------- game events


def top_holders(game) -> dict[str, set]:
    """Chain -> players holding the most shares (ties included), for chains
    on the board with any holder."""
    out: dict[str, set] = {}
    try:
        active = [c for c in game.ruleset.chain_ids if game.hotel.is_chain_active(c)]
    except Exception:  # noqa: BLE001 - observability only
        return out
    for c in active:
        held = {p.player_id: p.stocks.get(c, 0) for p in game.players}
        best = max(held.values(), default=0)
        if best > 0:
            out[c] = {pid for pid, n in held.items() if n == best}
    return out


def event_targets(room, game, events: list[dict], before: dict, actor) -> dict:
    """``{player_id: [events]}``: which talking seats a move's public events
    concern. Founded chain and merger: every talking seat but the mover (who
    can ``say`` with its move); trade accepted/rejected: the other party;
    game over: everyone; a seat that lost its majority in a chain (someone
    overtook it): that seat (as a synthetic ``majority_lost`` event)."""
    talking = {s.player_id for s in _talking_seats(room)}
    wanted = {
        t.strip() for t in get_settings().chat_reply_events.split(",") if t.strip()
    }
    if not talking or not wanted:
        return {}
    out: dict[str, list] = {}

    def add(pid, e):
        if pid in talking and e.get("type") in wanted:
            out.setdefault(pid, []).append(e)

    for e in events:
        if e.get("private_to"):
            continue
        t = e.get("type")
        if t in ("chain_founded", "merger_started"):
            for pid in talking - {actor}:
                add(pid, e)
        elif t in ("trade_accepted", "trade_rejected"):
            trade = e.get("trade") or {}
            parties = {trade.get("from_player_id"), trade.get("to_player_id")}
            if t == "trade_rejected":
                for x in reversed(game.events):
                    if x.get("type") == "trade_proposed" and x["trade"].get(
                        "trade_id"
                    ) == e.get("trade_id"):
                        tr = x["trade"]
                        parties = {tr.get("from_player_id"), tr.get("to_player_id")}
                        break
            for pid in parties - {e.get("player_id"), None}:
                add(pid, e)
        elif t == "game_ended":
            for pid in talking:
                add(pid, e)
    if "majority_lost" not in wanted:
        return out
    after = top_holders(game)
    for chain, holders in before.items():
        now = after.get(chain)
        if not now:
            continue
        for pid in holders - now:
            add(
                pid,
                {
                    "type": "majority_lost",
                    "chain": chain,
                    "player_id": actor,
                    "now_top": sorted(now),
                },
            )
    return out


def on_action(room_code: str, room, game, since: int, before: dict, actor) -> None:
    """After a successful move: reset the AI streak and give the seats the
    move's notable events concern a chance to speak."""
    state = chat_state(room)
    state.ai_streak = 0
    if not get_settings().chat_replies_enabled:
        return
    events = game.events[since:]
    for pid, evs in event_targets(room, game, events, before, actor).items():
        request_talk(
            room_code, pid, {"source": "event", "message": None, "events": evs}
        )


def close_when_quiet(room) -> None:
    """Close a finished game's transcript once the talk calls in flight are
    done (so their lines and cost are in it), at most after the reply timeout."""
    writer = room.transcript
    if writer is None or writer.closed:
        return
    state = getattr(room, "chat", None)
    tasks = [t for t in (state.tasks if state else ()) if not t.done()]
    if not tasks:
        writer.close_from_game()
        return

    async def later():
        try:
            await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True),
                get_settings().chat_reply_timeout_s + 5,
            )
        except (asyncio.TimeoutError, Exception):  # noqa: BLE001
            pass
        if not writer.closed:
            writer.close_from_game()

    task = asyncio.get_running_loop().create_task(later())
    state.closing = task


# -------------------------------------------------------------- the call


def talk_view(room, seat, trigger: dict) -> dict:
    """What a talk call shows the seat: the decision-prompt context (own
    hand and holdings, public standings, chains with majorities and bonuses,
    recent events with the chat interleaved) when a game runs, the seat list
    in the lobby, plus the trigger."""
    game = room.game if room.started else None
    view: dict = {
        "player_id": seat.player_id,
        "name": seat.name,
        "trigger": trigger,
        "chat": prompt_messages(room),
        "lobby_players": [
            {"player_id": p.player_id, "name": p.name, "kind": p.kind}
            for p in room.players.values()
        ],
        "kinds": {p.player_id: p.kind for p in room.players.values()},
    }
    if game is not None:
        from game.calculator import build_calculator_pack
        from game.decisions import public_events

        view["state"] = game.get_player_state(seat.player_id)
        view["events"] = public_events(game, seat.player_id)
        view["calc"] = build_calculator_pack(game, seat.player_id)
        # Computed facts about a deal under discussion, only when the
        # trigger mentions a chain or a deal, or an offer is open (LO-013).
        from agents.llm.deal_facts import deal_facts

        view["deal_facts"] = deal_facts(game, seat.player_id, trigger)
    return view


async def _talk(room_code: str, player_id: str, trigger: dict, slot: dict) -> None:
    """One off-turn talk call (background task, no lock held)."""
    s = get_settings()
    t0 = time.monotonic()
    record: dict | None = None
    text: str | None = None
    outcome = "failed"
    try:
        room = session_manager.get_room(room_code)
        seat = room.players.get(player_id) if room is not None else None
        if seat is None or seat.agent is None:
            return
        game_at_start = room.game if room.started else None
        view = talk_view(room, seat, trigger)
        try:
            text, record = await asyncio.wait_for(
                seat.agent.reply(
                    view,
                    max_tokens=s.chat_reply_max_tokens,
                    timeout=s.chat_reply_timeout_s,
                    effort=s.chat_reply_effort or None,
                ),
                s.chat_reply_timeout_s + 5,
            )
            outcome = "replied" if text else "silent"
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - talk never breaks a game
            logger.warning("table talk call by %s failed: %s", player_id, exc)
            record = getattr(exc, "record", None) or {
                "error": f"{type(exc).__name__}: {exc}"[:300]
            }
        room = session_manager.get_room(room_code)
        if room is None or player_id not in room.players:
            return
        message_id = None
        reply_to = (trigger.get("message") or {}).get("id")
        if text:
            try:
                posted = await post_message(
                    room_code, player_id, text, source="reply", reply_to=reply_to
                )
                message_id = posted["id"]
            except ChatError as exc:
                outcome = "dropped"
                logger.info("table talk by %s dropped: %s", player_id, exc)
        call = {
            "player_id": player_id,
            "trigger": trigger_summary(trigger),
            "reply_to": reply_to,
            "outcome": outcome,
            "message_id": message_id,
            "llm": record,
            "latency_s": time.monotonic() - t0,
        }
        current = room.game if room.started else None
        writer = room.transcript
        if game_at_start is None and current is None:
            chat_state(room).unwritten_replies.append(call)
        elif writer is not None and writer.game is game_at_start:
            writer.record_chat_reply(**call)
    finally:
        slot["in_flight"] = False
        if slot["pending"] is not None and slot["timer"] is None:
            s = get_settings()
            wait = max(0.0, s.chat_reply_cooldown_s - (time.monotonic() - slot["last"]))
            try:
                slot["timer"] = asyncio.get_running_loop().call_later(
                    wait, _fire_pending, room_code, player_id
                )
            except RuntimeError:  # loop closing
                pass


def trigger_summary(trigger: dict) -> dict:
    """The trigger as the transcript records it."""
    msg = trigger.get("message") or {}
    return {
        "source": trigger.get("source"),
        "message_id": msg.get("id"),
        "events": [e.get("type") for e in trigger.get("events") or []],
    }


async def wait_replies(room_code: str, timeout: float = 10.0) -> None:
    """Wait until no talk call is in flight or waiting in the room (tests)."""
    room = session_manager.get_room(room_code)
    if room is None:
        return
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = getattr(room, "chat", None)
        if state is None:
            return
        busy = [t for t in state.tasks if not t.done()]
        waiting = any(
            slot["pending"] is not None or slot["in_flight"]
            for slot in state.replies.values()
        )
        if not busy and not waiting:
            return
        if busy:
            await asyncio.wait(busy, timeout=max(0.01, deadline - time.monotonic()))
        else:
            await asyncio.sleep(0.02)
    raise asyncio.TimeoutError("table talk still running")


def reply_debug(room) -> dict:
    """Talk-call counters per seat for ``GET /room/{code}/debug``."""
    state = getattr(room, "chat", None)
    if state is None:
        return {}
    out: dict = {}
    current = getattr(room, "game_id", None) if room.started else None
    for (game_id, pid), slot in state.replies.items():
        if game_id != current:
            continue
        out[pid] = {
            "count": slot["count"],
            "skipped": slot["skipped"],
            "in_flight": slot["in_flight"],
            "pending": slot["pending"] is not None,
        }
    return out
