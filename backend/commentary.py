"""Commentary: a non-playing voice that narrates a game for spectators.

The commentator is not a seat. It never goes through ``apply_action``, never
touches the game state, snapshots or fixtures, and sees only public
information (the public event log and the calculator's public views: no
hands, no private events, no seat notes). See docs/ai/commentary.md and
docs/architecture/seat-contract.md, "Commentary".

* **When it speaks** is decided here by rules, never by a model call per
  event. After every applied action ``on_action`` turns the new public events
  and the changes they made (majorities, the lead, safe chains) into
  *moments*. Moments wait in a batch; a line is made from the batch at most
  once every ``commentary_min_gap_s`` seconds, and only when the batch holds
  a moment worth a line by itself. A quiet stretch of
  ``commentary_quiet_turns`` turns gives one "state of the table" moment.
  At most ``commentary_max_lines_per_game`` lines per game (the final result
  is always said).
* **What it says** comes from one small model call per line (cached static
  system prompt, low effort, small output), or from the rules-only templates
  when no model is configured (``GAME_COMMENTARY_MODEL``), a cap is reached
  (``commentary_max_calls_per_game``, ``commentary_max_spend_usd``) or the
  call fails or makes up a number.
* **Cost control**: nothing happens unless commentary is enabled for the room
  AND a spectator (the host/watch WebSocket) is attached.
* **Never delays the game**: ``on_action`` only reads the game and schedules;
  the model call runs in a background task that holds no lock.
* **Delivery**: ``commentary`` messages to the host/watch connection,
  ``commentary_history`` when it (re)connects and when the setting changes;
  every line (and its model call, with tokens) is written to the game
  transcript as a ``commentary`` line.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from agents.llm import commentary as words
from app_state import session_manager
from config import get_settings
from game.calculator import public_chain_holders
from transcripts.paths import utc_now

logger = logging.getLogger(__name__)

#: Moments older than this many turns are dropped from a batch (old news).
STALE_TURNS = 6
#: Moments given to one line: the most important one, and at most this
#: many others of at least ``SECOND_PRIORITY`` (a passing change never rides
#: along: the line would try to say it all).
EXTRA_MOMENTS = 1
SECOND_PRIORITY = 5
#: A majority changing hands is worth a line by itself only when the new
#: top holding is at least this many shares (early one- and two-share
#: skirmishes are routine) ...
MAJORITY_MIN_SHARES = 5
#: ... the majority bonus at stake is at least this much ...
MAJORITY_MIN_BONUS = 3000
#: ... at most once per chain in this many turns, and at most one such
#: moment (any chain) in ``MAJORITY_GAP_TURNS`` turns.
MAJORITY_COOLDOWN_TURNS = 6
MAJORITY_GAP_TURNS = 4
#: Consecutive failed model calls after which a game goes rules-only.
MAX_FAILURES = 3


@dataclass
class CommentaryState:
    """Commentary of one room (``GameRoom.commentary``)."""

    enabled: bool = False
    lines: deque = field(default_factory=lambda: deque(maxlen=200))
    next_id: int = 1
    # --- the game being narrated (reset by ``_new_game``)
    game: Any = None
    track: dict | None = None  # what was true after the last action
    pending: list = field(default_factory=list)  # moments waiting for a line
    memory: deque = field(default_factory=lambda: deque(maxlen=6))
    last_at: float | None = None  # monotonic time of the last line (or call start)
    last_line_turn: int = 0
    last_spoke_turn: int = 0  # turn of the last batch taken (line or call)
    timer: Any = None
    in_flight: bool = False
    flush: bool = False  # the final result waits for the call in flight
    line_count: int = 0
    model_lines: int = 0
    calls: int = 0
    spend_usd: float = 0.0
    failures: int = 0
    skipped: int = 0  # batches dropped (line cap)
    tasks: set = field(default_factory=set)


def commentary_state(room) -> CommentaryState:
    st = getattr(room, "commentary", None)
    if st is None:
        st = CommentaryState(
            enabled=bool(getattr(room, "commentary_default", False)),
            lines=deque(maxlen=max(10, get_settings().commentary_history_size)),
            memory=deque(maxlen=max(1, get_settings().commentary_memory_lines)),
        )
        room.commentary = st
    return st


def spectator_attached(room) -> bool:
    return getattr(room, "host_websocket", None) is not None


def _test_mode() -> bool:
    import os

    return os.environ.get("GAME_TEST_MODE") == "1"


def min_gap() -> float:
    s = get_settings()
    return max(
        0.0,
        s.test_mode_commentary_min_gap_s if _test_mode() else s.commentary_min_gap_s,
    )


def _model_usable(st: CommentaryState) -> bool:
    s = get_settings()
    return (
        st.failures < MAX_FAILURES
        and st.calls < s.commentary_max_calls_per_game
        and st.spend_usd < s.commentary_max_spend_usd
    )


def mode(room) -> str:
    """``model`` when the next line would come from a model, else ``rules``."""
    st = commentary_state(room)
    return (
        "model" if words.resolve_model() is not None and _model_usable(st) else "rules"
    )


def public_line(line: dict) -> dict:
    return {
        k: line.get(k)
        for k in ("id", "text", "source", "turn", "after_seq", "at", "moments")
    }


def history(room, limit: int = 100) -> list[dict]:
    """The lines of the room's current game, oldest first."""
    st = commentary_state(room)
    game_id = getattr(room, "game_id", None)
    return [public_line(x) for x in st.lines if x.get("game_id") == game_id][-limit:]


def state_message(room) -> dict:
    st = commentary_state(room)
    return {
        "type": "commentary_history",
        "enabled": st.enabled,
        "mode": mode(room),
        "lines": history(room),
    }


async def send_state(room_code: str) -> None:
    """``commentary_history`` (setting, mode and the lines so far) to the
    host/watch connection: on (re)connect and when the setting changes."""
    room = session_manager.get_room(room_code)
    if room is None:
        return
    await session_manager.send_to_host(room_code, state_message(room))


async def set_enabled(room_code: str, enabled: bool) -> dict:
    """Turn commentary on or off for the room. Off stops everything: no
    moments are collected and no model is called."""
    room = session_manager.get_room(room_code)
    st = commentary_state(room)
    st.enabled = bool(enabled)
    if not st.enabled:
        _stop(st)
    await send_state(room_code)
    return {"enabled": st.enabled, "mode": mode(room)}


def _stop(st: CommentaryState) -> None:
    """Forget what was waiting (commentary off, or nobody is watching)."""
    if st.timer is not None:
        st.timer.cancel()
        st.timer = None
    st.pending.clear()
    st.track = None
    st.flush = False


def _new_game(st: CommentaryState, game) -> None:
    _stop(st)
    st.game = game
    st.memory.clear()
    st.last_at = None
    st.last_line_turn = st.last_spoke_turn = 0
    st.line_count = st.model_lines = st.calls = st.failures = st.skipped = 0
    st.spend_usd = 0.0


# ---------------------------------------------------------------------------
# Moments: which events matter (rules, no model)
# ---------------------------------------------------------------------------


def _roles(game) -> dict[str, dict]:
    """Per active chain: who holds the majority and the minority position
    (as the engine would pay them now) and every holder's shares."""
    out = {}
    for chain, info in public_chain_holders(game).items():
        hs = info.get("holders") or []
        out[chain] = {
            "majority": frozenset(h["player_id"] for h in hs if h["majority"]),
            "minority": frozenset(
                h["player_id"] for h in hs if h["minority"] and not h["majority"]
            ),
            "shares": {h["player_id"]: h["shares"] for h in hs},
        }
    return out


def _safe_chains(game) -> set[str]:
    rs = game.ruleset
    return {
        c
        for c in game.hotel.get_active_chains()
        if rs.is_safe_size(game.board.get_chain_size(c))
    }


def _sole_leader(game) -> tuple[str | None, list[dict]]:
    rows = words.standings(game)
    top = [r for r in rows if r["rank"] == 1]
    return (top[0]["player_id"] if len(top) == 1 else None), rows


def _snapshot(game) -> dict:
    leader, _rows = _sole_leader(game)
    return {
        "roles": _roles(game),
        "safe": _safe_chains(game),
        "leader": leader,
        "lead_turn": words.turn_number(game),
        "end_available": bool(words.end_reason(game)[0]),
        "merger": None,  # the merger_started event in progress
        "dispositions": [],
    }


def _side(rs, stocks: dict | None, cash: int | None) -> str:
    parts = [
        f"{n} {words.chain_name(rs, c)}" for c, n in (stocks or {}).items() if n
    ] + ([words.money(rs, cash)] if cash else [])
    return " and ".join(parts) or "nothing"


def _poss(name: str) -> str:
    return name + ("'" if name.endswith("s") else "'s")


def _join(names: list[str]) -> str:
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]


def _bonus_parts(rs, bonuses: dict, names: dict) -> list[tuple[str, int, str]]:
    """``[(name, amount, role)]`` of a ``bonuses_paid`` event, largest first."""
    major = [p for p, b in bonuses.items() if b.get("majority")]
    minor = [p for p, b in bonuses.items() if b.get("minority")]
    out = []
    for pid, b in bonuses.items():
        got = int(b.get("majority", 0)) + int(b.get("minority", 0))
        if not got:
            continue
        if b.get("majority") and b.get("minority"):
            role = "majority and minority, the only holder"
        elif b.get("majority"):
            role = words.TIED_MAJORITY if len(major) > 1 else "majority"
        else:
            role = "tied for second" if len(minor) > 1 else "minority"
        out.append((names.get(pid, pid), got, role))
    return sorted(out, key=lambda x: -x[1])


def _paid_text(parts: list[tuple[str, int, str]], M) -> str:
    """ "A $4,000 (majority), B and C $1,000 each (tied for second)"."""
    out, seen = [], set()
    for _name, amount, role in parts:
        if (amount, role) in seen:
            continue
        seen.add((amount, role))
        who = [n for n, a, r in parts if (a, r) == (amount, role)]
        each = " each" if len(who) > 1 else ""
        out.append(f"{_join(who)} {M(amount)}{each} ({role})")
    return ", ".join(out) or "nobody"


def _proposed(game, trade_id) -> dict:
    for e in reversed(game.events):
        if (
            e.get("type") == "trade_proposed"
            and (e.get("trade") or {}).get("trade_id") == trade_id
        ):
            return e["trade"]
    return {}


def _safe_words(chain: str):
    def words_now(game):
        rs = game.ruleset
        names = words.player_names(game)
        info = public_chain_holders(game).get(chain)
        if info is None or not rs.is_safe_size(info.get("size", 0)):
            return None
        c = words.chain_name(rs, chain)
        return (
            f"{c} reached {rs.safe_chain_size} or more tiles ({info['size']} now) "
            f"and is {rs.theme.safe_phrase}: it can never be acquired. Holders: "
            f"{words.holders_text(rs, info, names)}. Its bonuses are paid at the "
            f"end of the game; at its size now: "
            f"{words.payout_text(rs, info, names)}.",
            f"{c} is {rs.theme.safe_phrase} at {info['size']} tiles: it cannot be "
            f"bought out now, and its bonuses wait for the end of the game.",
        )

    return words_now


def _when(game, chain: str) -> str:
    return (
        "at the end of the game, at its size now"
        if chain in _safe_chains(game)
        else "if acquired now"
    )


def _majority_words(chain: str, holders: frozenset, was: str, how: str):
    def words_now(game):
        rs = game.ruleset
        names = words.player_names(game)
        info = public_chain_holders(game).get(chain)
        now = _roles(game).get(chain)
        if info is None or now is None or now["majority"] != holders:
            return None  # changed again since (a newer moment says so)
        c = words.chain_name(rs, chain)
        sh = now["shares"]
        top = sorted(holders, key=lambda p: names.get(p, p))
        n_top = sh.get(top[0], 0)
        rest = sorted((n, p) for p, n in sh.items() if p not in holders and n)
        pay = words.payout_text(rs, info, names)
        if len(top) == 1:
            rival = (
                f" to {_poss(names.get(rest[-1][1], rest[-1][1]))} {rest[-1][0]}"
                if rest
                else ""
            )
            say = (
                f"{names.get(top[0], top[0])} takes the {c} majority, "
                f"{words.count(rs, n_top)}{rival}."
            )
        else:
            say = (
                f"{_join([names.get(p, p) for p in top])} are level in {c} at "
                f"{words.count(rs, n_top)} each."
            )
        return (
            f"The {c} majority changed hands {how}. Before: "
            f"{was}. Holders now: {words.holders_text(rs, info, names)}. "
            f"Bonuses {_when(game, chain)}: {pay}.",
            say,
        )

    return words_now


def _minority_words(chain: str, holders: frozenset, how: str):
    def words_now(game):
        rs = game.ruleset
        names = words.player_names(game)
        info = public_chain_holders(game).get(chain)
        now = _roles(game).get(chain)
        if info is None or now is None or now["minority"] != holders:
            return None
        c = words.chain_name(rs, chain)
        second = sorted(names.get(p, p) for p in holders)
        return (
            f"Second place in {c} changed {how}. Holders now: "
            f"{words.holders_text(rs, info, names)}. Bonuses "
            f"{_when(game, chain)}: {words.payout_text(rs, info, names)}.",
            f"{_join(second)} {'moves' if len(second) == 1 else 'move'} into "
            f"second place in {c}.",
        )

    return words_now


def _lead_words(leader: str, before: str):
    def words_now(game):
        rs = game.ruleset
        now, rows = _sole_leader(game)
        if now != leader or len(rows) < 2:
            return None  # no longer alone in front
        first, second = rows[0], rows[1]
        margin = first["net_worth"] - second["net_worth"]

        def M(n) -> str:
            return words.money(rs, n)

        return (
            f"{first['name']} took the lead on net worth: {M(first['net_worth'])} "
            f"now, {M(margin)} ahead of {second['name']} "
            f"({M(second['net_worth'])}). Leader before: {before}.",
            f"{first['name']} moves into the lead on net worth: "
            f"{M(first['net_worth'])}, {M(margin)} ahead of {second['name']}.",
        )

    return words_now


def detect(game, events: list[dict], track: dict, actor: str | None) -> list[dict]:
    """Moments in ``events`` (the public events of one applied action) and in
    what they changed since ``track`` (updated in place)."""
    rs = game.ruleset
    names = words.player_names(game)
    turn = words.turn_number(game)
    share, shares = rs.theme.share_noun, rs.theme.share_noun_plural
    out: list[dict] = []

    def nm(pid) -> str:
        return names.get(pid, str(pid))

    def C(chain) -> str:
        return words.chain_name(rs, chain)

    def M(n) -> str:
        return words.money(rs, n)

    def add(kind, seq, priority, fact, say, *, solo=True, key=None, refresh=None):
        out.append(
            {
                "type": kind,
                "seq": seq,
                "turn": turn,
                "priority": priority,
                "fact": fact,
                "say": say,
                "solo": solo,
                "key": key or (kind, seq),
                # ``refresh(game) -> (fact, say) | None``: the words again
                # from the table as it is when the line is made (None: no
                # longer true, the moment is dropped)
                "refresh": refresh,
            }
        )

    founded_now: set[str] = set()
    merged_now = False
    cause = "purchase"
    declared_by = None
    counts = None
    for e in events:
        if e.get("private_to"):
            continue  # never private information
        t, pid, seq = e.get("type"), e.get("player_id"), e.get("seq", 0)
        if t == "chain_founded":
            chain, size = e.get("chain"), e.get("size", 2)
            founded_now.add(chain)
            price = M(rs.price(chain, size))
            free = (
                f" {nm(pid)} got {e.get('founder_bonus_value')} free founder's "
                f"{share if e.get('founder_bonus_value') == 1 else shares}."
                if e.get("founder_bonus_type") == "stock"
                else ""
            )
            active = set(game.hotel.get_active_chains())
            on_board = len(active)
            tier = rs.tier(rs.chain(chain).tier).label
            # A chain that was acquired earlier and is founded again is
            # routine, unless someone kept its shares for this.
            again = any(
                x.get("type") == "chain_founded"
                and x.get("chain") == chain
                and x.get("seq") != seq
                for x in game.events
            )
            kept = [
                p
                for p in game.players
                if p.player_id != pid and p.get_stock_count(chain) > 0
            ]
            back = ""
            if again:
                back = (
                    f" {C(chain)} was acquired earlier in this game and is back "
                    "on the board."
                    + (
                        f" {_join([p.name for p in kept])} kept {C(chain)} "
                        f"{shares} from before, and they count again."
                        if kept
                        else ""
                    )
                )
            add(
                "chain_founded",
                seq,
                6 if not again or kept else 4,
                f"{nm(pid)} founded {C(chain)} by placing {e.get('tile')}: "
                f"{size} tiles, {price} a {share} ({tier} tier).{free}{back} "
                f"{rs.theme.chain_noun_plural.capitalize()} on the board now: "
                f"{on_board} of {len(rs.chains)} "
                f"({', '.join(C(c) for c in rs.chain_ids if c in active)})."
                + ("" if again else " A plain founding: one short sentence is enough."),
                f"{nm(pid)} founds {C(chain)} "
                f"{'again ' if again else ''}at {e.get('tile')}: {size} tiles, "
                f"{price} a {share}, and the founder's {share} goes to {nm(pid)}.",
                solo=not again or bool(kept),
                key=("chain_founded", chain),
            )
        elif t == "merger_started":
            track["merger"] = e
            track["dispositions"] = []
            merged_now = True
        elif t == "bonuses_paid" and not e.get("final"):
            merged_now = True
            m = track.get("merger") or {}
            by, survivor = m.get("player_id"), m.get("survivor")
            chain = e.get("chain")
            parts = _bonus_parts(rs, e.get("bonuses") or {}, names)
            paid = _paid_text(parts, M)
            sizes = m.get("sizes") or {}
            got = (e.get("bonuses") or {}).get(by) or {}
            own = int(got.get("majority", 0)) + int(got.get("minority", 0))
            if counts is None:
                counts = words.history_counts(game)
            mine = counts.get(by) or {"mergers": 1, "own_merger_bonus": own}
            total = sum(c["mergers"] for c in counts.values())
            nth = (
                f" {nm(by)} has now set off {mine['mergers']} of the {total} "
                f"{rs.theme.merger_noun_plural} of this game, and collected "
                f"{M(mine['own_merger_bonus']) if mine['own_merger_bonus'] else 'nothing'}"
                f" from those {mine['mergers']} together."
                if mine["mergers"] > 1
                else ""
            )
            fact = (
                f"{nm(by)} placed {m.get('tile')} and merged {C(chain)} "
                f"({e.get('chain_size')} tiles) into {C(survivor)} "
                f"({sizes.get(survivor)} tiles, "
                f"{rs.theme.safe_phrase if rs.is_safe_size(sizes.get(survivor) or 0) else 'not yet ' + rs.theme.safe_phrase}"
                f"). Bonuses paid for {C(chain)}: "
                f"{paid}. {nm(by)}, who set it off, collected "
                f"{M(own) if own else 'nothing'} from it.{nth}"
            )
            say_paid = _join([f"{n} {M(a)}" for n, a, _r in parts[:3]]) or "nobody"
            tail = "" if own or by is None else f" Nothing for {nm(by)}."
            add(
                "merger",
                seq,
                9,
                fact,
                f"{nm(by)} merges {C(chain)} into {C(survivor)}; the bonuses: "
                f"{say_paid}.{tail}",
                key=("merger", m.get("seq"), chain),
            )
        elif t == "stock_disposition":
            merged_now = True
            bits = []
            if e.get("sell"):
                bits.append(f"sold {e['sell']} for {M(e.get('sale_proceeds'))}")
            if e.get("trade"):
                bits.append(
                    f"traded {e['trade']} for {e.get('survivor_shares_received')} "
                    f"{C(e.get('surviving_chain'))}"
                )
            if e.get("hold"):
                bits.append(f"kept {e['hold']}")
            track.setdefault("dispositions", []).append(
                f"{nm(pid)} {', '.join(bits) or 'had nothing to do'}"
            )
        elif t == "merger_completed":
            merged_now = True
            survivor, size = e.get("survivor"), e.get("survivor_size")
            done = "; ".join(track.get("dispositions") or []) or "no holders"
            defunct = _join([C(c) for c in e.get("defunct") or []])
            add(
                "merger_done",
                seq,
                4,
                f"The {rs.theme.merger_noun} is settled: {C(survivor)} is now "
                f"{size} tiles. What the {defunct} holders did with their "
                f"{shares}: {done}.",
                f"{C(survivor)} stands at {size} tiles after taking over {defunct}.",
                solo=False,
                key=("merger_done", (track.get("merger") or {}).get("seq")),
            )
            track["merger"] = None
            track["dispositions"] = []
        elif t in ("trade_accepted", "trade_rejected"):
            cause = "trade"
            tr = e.get("trade") or _proposed(game, e.get("trade_id"))
            frm, to = tr.get("from_player_id"), tr.get("to_player_id")
            gave = _side(rs, tr.get("offering_stocks"), tr.get("offering_money"))
            asked = _side(rs, tr.get("requesting_stocks"), tr.get("requesting_money"))
            if t == "trade_accepted":
                add(
                    "trade_accepted",
                    seq,
                    7,
                    f"{nm(to)} accepted a trade offer from {nm(frm)}: {nm(frm)} "
                    f"gave {gave} and got {asked} from {nm(to)}.",
                    f"{nm(frm)} and {nm(to)} trade: {gave} from {nm(frm)} for "
                    f"{asked} from {nm(to)}.",
                )
            else:
                add(
                    "trade_rejected",
                    seq,
                    4,
                    f"{nm(to)} rejected a trade offer from {nm(frm)}: {nm(frm)} "
                    f"offered {gave} for {asked}.",
                    f"{nm(to)} turns down {_poss(nm(frm))} offer of {gave} for "
                    f"{asked}.",
                )
        elif t == "end_game_declared":
            declared_by = pid
        elif t == "game_ended":
            add(
                "game_ended",
                seq,
                10,
                *_final(game, e, declared_by, names),
                key=("game_ended",),
            )

    over = any(m["type"] == "game_ended" for m in out)
    last_seq = events[-1].get("seq", 0) if events else 0

    # --- chains that became safe
    safe_now = _safe_chains(game)
    for chain in sorted(safe_now - track["safe"]):
        refresh = _safe_words(chain)
        add(
            "chain_safe",
            last_seq,
            6,
            *refresh(game),
            key=("chain_safe", chain),
            refresh=refresh,
        )
    track["safe"] = safe_now

    # --- majority and second place changing hands. Not while a merger is
    # being settled (the defunct chain's holders are selling out; the
    # survivor is compared once, when the merger is done).
    roles_now = _roles(game)
    chains_now = public_chain_holders(game)
    if track.get("merger") is None:
        how = (
            f"in the {rs.theme.merger_noun}"
            if merged_now
            else f"after {nm(actor)}'s {cause}"
        )
        told = track.setdefault("majority_turn", {})
        for chain, now in roles_now.items():
            before = track["roles"].get(chain)
            if over or before is None or chain in founded_now:
                continue
            if now["majority"] != before["majority"] and now["majority"]:
                was = (
                    _join(
                        [
                            f"{nm(p)} ({before['shares'].get(p, 0)})"
                            for p in sorted(before["majority"], key=nm)
                        ]
                    )
                    or "nobody"
                )
                info = chains_now.get(chain) or {}
                notable = (
                    max(now["shares"].values(), default=0) >= MAJORITY_MIN_SHARES
                    and info.get("majority_bonus", 0) >= MAJORITY_MIN_BONUS
                    and turn - told.get(chain, -99) >= MAJORITY_COOLDOWN_TURNS
                    and turn - told.get("", -99) >= MAJORITY_GAP_TURNS
                )
                if notable:
                    told[chain] = told[""] = turn
                refresh = _majority_words(chain, now["majority"], was, how)
                add(
                    "majority",
                    last_seq,
                    7 if notable else 3,
                    *refresh(game),
                    solo=notable,
                    key=("majority", chain),
                    refresh=refresh,
                )
            elif now["minority"] != before["minority"] and now["minority"]:
                refresh = _minority_words(chain, now["minority"], how)
                add(
                    "minority",
                    last_seq,
                    2,
                    *refresh(game),
                    solo=False,
                    key=("minority", chain),
                    refresh=refresh,
                )
        track["roles"] = roles_now

    # --- the lead in net worth
    leader, rows = _sole_leader(game)
    if leader is not None and leader != track["leader"] and not over:
        held = turn - track.get("lead_turn", turn)
        if turn > len(game.players) and len(rows) > 1:
            prev = track["leader"]
            refresh = _lead_words(leader, nm(prev) if prev else "nobody alone")
            add(
                "lead",
                last_seq,
                5,
                *refresh(game),
                solo=prev is None or held >= 4,
                key=("lead",),
                refresh=refresh,
            )
        track["leader"] = leader
        track["lead_turn"] = turn

    # --- the game can be ended
    can_end, reason = words.end_reason(game)
    if can_end and not track["end_available"] and not over:
        add(
            "end_available",
            last_seq,
            5,
            f"From now on the player whose turn it is may end the game "
            f"({reason}). Nobody has to end it.",
            f"The end can be called from here: {reason}.",
            key=("end_available",),
        )
    track["end_available"] = bool(can_end)
    return out


def _final(game, ended: dict, declared_by, names: dict) -> tuple[str, str]:
    """(fact, rules line) of the final result."""
    rs = game.ruleset
    rows = ended.get("standings") or []

    def M(n) -> str:
        return words.money(rs, n)

    table = "; ".join(f"{r['rank']}. {r['name']} {M(r['money'])}" for r in rows)
    winners = [r for r in rows if r.get("rank") == 1]
    rest = [r for r in rows if r.get("rank") != 1]
    who = _join([r["name"] for r in winners])
    how = (
        f"{names.get(declared_by, declared_by)} declared the end of the game."
        if declared_by
        else "The game is over."
    )
    if len(winners) == 1 and rest:
        margin = winners[0]["money"] - rest[0]["money"]
        verdict = f"Winner: {who} with {M(winners[0]['money'])}, {M(margin)} ahead of {rest[0]['name']}."
        say = (
            f"{who} wins with {M(winners[0]['money'])}, {M(margin)} clear of "
            f"{rest[0]['name']} on {M(rest[0]['money'])}."
        )
    elif winners:
        verdict = f"Tie for first: {who}, {M(winners[0]['money'])} each."
        say = f"{who} share the win on {M(winners[0]['money'])} each."
    else:
        verdict, say = "No result.", "The game is over."
    start = (
        f"{names.get(declared_by, declared_by)} calls the end. " if declared_by else ""
    )
    fact = (
        f"{how} All bonuses were paid and all {rs.theme.share_noun_plural} sold. "
        f"Final cash: {table}. {verdict}"
    )
    return fact, start + say


def _quiet_moment(game, turn: int, quiet: int) -> dict | None:
    """The "state of the table" moment of a quiet stretch."""
    rs = game.ruleset
    names = words.player_names(game)
    rows = words.standings(game)
    if not rows:
        return None
    bag = game.get_public_state().get("tiles_remaining")
    race = words.closest_race(game)
    race_fact = race_say = ""
    if race:
        (p1, n1), (p2, n2) = race["first"], race["second"]
        c = words.chain_name(rs, race["chain"])
        race_fact = (
            f" Closest race for a majority: {c}, {names.get(p1, p1)} {n1} to "
            f"{names.get(p2, p2)} {n2}."
        )
        race_say = (
            f" Closest race: {c}, {names.get(p1, p1)} {n1} to {names.get(p2, p2)} {n2}."
        )
    top = [r for r in rows if r["rank"] == 1]
    if len(top) == 1 and len(rows) > 1:
        margin = rows[0]["net_worth"] - rows[1]["net_worth"]
        lead = (
            f"{rows[0]['name']} leads on net worth with "
            f"{words.money(rs, rows[0]['net_worth'])}, "
            f"{words.money(rs, margin)} ahead of {rows[1]['name']}."
        )
    else:
        lead = (
            f"{_join([r['name'] for r in top])} are level on net worth at "
            f"{words.money(rs, top[0]['net_worth'])}."
        )
    return {
        "type": "quiet",
        "seq": len(game.events) - 1,
        "turn": turn,
        "priority": 3,
        "fact": "State of the table (no single event; say where things "
        f"stand): {bag} tiles left in the bag. {lead}{race_fact}",
        "say": f"{bag} tiles left in the bag. {lead}{race_say}",
        "solo": True,
        "key": ("quiet",),
        "quiet": quiet,
        "refresh": None,
    }


# ---------------------------------------------------------------------------
# Scheduling (rate limit, batching, caps)
# ---------------------------------------------------------------------------


def on_action(room_code: str, room, game, since: int, actor: str | None) -> None:
    """After a successful action: collect its moments and schedule a line.
    Cheap and synchronous; never awaits, never raises into the game."""
    try:
        _on_action(room_code, room, game, since, actor)
    except Exception:  # noqa: BLE001 - commentary never breaks a game
        logger.exception("commentary failed in room %s", room_code)
        st = getattr(room, "commentary", None)
        if st is not None:
            st.track = None
            st.pending.clear()


def _on_action(room_code: str, room, game, since: int, actor) -> None:
    st = getattr(room, "commentary", None)
    if st is None:
        if not getattr(room, "commentary_default", False):
            return  # never enabled in this room: no state, no work
        st = commentary_state(room)
    if not st.enabled or not spectator_attached(room):
        _stop(st)  # off, or nobody watches: nothing is collected
        return
    if st.game is not game:
        _new_game(st, game)
    events = [e for e in game.events[since:] if not e.get("private_to")]
    if st.track is None:
        # First action seen (commentary just turned on, or a spectator just
        # arrived): what the table was before it is not known, so only the
        # action's own events are told, no "changed hands" comparisons.
        st.track = _snapshot(game)
        st.track["roles"] = {}
        st.track["merger"] = next(
            (
                e
                for e in reversed(game.events[:since])
                if e.get("type") == "merger_started"
            ),
            None,
        )
    moments = detect(game, events, st.track, actor)
    turn = words.turn_number(game)
    for m in moments:
        st.pending = [p for p in st.pending if p["key"] != m["key"]]
        st.pending.append(m)
    final = any(m["type"] == "game_ended" for m in moments)
    if (
        not final
        and any(e.get("type") == "turn_ended" for e in events)
        and not any(m["solo"] for m in st.pending)
    ):
        quiet = get_settings().commentary_quiet_turns
        since_line = turn - max(st.last_line_turn, st.last_spoke_turn, 1)
        if quiet > 0 and since_line >= quiet:
            q = _quiet_moment(game, turn, since_line)
            if q is not None:
                st.pending.append(q)
    _schedule(room_code, room, st, final=final)


def _schedule(room_code: str, room, st: CommentaryState, *, final: bool = False):
    """Speak now, or when the minimum gap since the last line has passed."""
    if final:
        st.flush = True
    if st.in_flight:
        return  # the call in flight reschedules when it returns
    if not any(m["solo"] for m in st.pending):
        return
    now = time.monotonic()
    wait = 0.0
    if st.last_at is not None and not st.flush:
        wait = max(0.0, min_gap() - (now - st.last_at))
    if wait <= 0:
        if st.timer is not None:
            st.timer.cancel()
            st.timer = None
        _speak(room_code, room, st)
    elif st.timer is None:
        st.timer = asyncio.get_running_loop().call_later(wait, _fire, room_code)


def _fire(room_code: str) -> None:
    room = session_manager.get_room(room_code)
    st = getattr(room, "commentary", None) if room is not None else None
    if st is None:
        return
    st.timer = None
    if not st.enabled or not spectator_attached(room) or st.game is not room.game:
        _stop(st)
        return
    try:
        _schedule(room_code, room, st)
    except Exception:  # noqa: BLE001
        logger.exception("commentary failed in room %s", room_code)


def _take_batch(st: CommentaryState, turn: int) -> list[dict]:
    """The moments of the next line: the most important one that is not old
    news and at most ``EXTRA_MOMENTS`` others of some weight, most important
    first, worded from the table as it is now. Everything waiting is
    consumed."""
    fresh = []
    for m in st.pending:
        if turn - m["turn"] > STALE_TURNS and m["type"] != "game_ended":
            continue
        if m["type"] == "quiet":
            m = _quiet_moment(st.game, turn, m["quiet"]) or m
        elif m.get("refresh") is not None:
            again = m["refresh"](st.game)
            if again is None:
                continue  # no longer true
            m = {**m, "fact": again[0], "say": again[1]}
        fresh.append(m)
    st.pending = []
    if any(m["type"] == "game_ended" for m in fresh):
        # the result is the line; what led to it may be mentioned
        fresh = [m for m in fresh if m["type"] in ("game_ended", "merger")]
    # most important first (the prompt says so; the rules line leads with it)
    ranked = sorted(fresh, key=lambda m: (-m["priority"], -m["seq"]))
    extra = [m for m in ranked[1:] if m["priority"] >= SECOND_PRIORITY]
    return ranked[:1] + extra[:EXTRA_MOMENTS]


def _speak(room_code: str, room, st: CommentaryState) -> None:
    """Make one line from the waiting moments (model call in the background,
    or the rules line at once)."""
    game = st.game
    s = get_settings()
    batch = _take_batch(st, words.turn_number(game))
    final = any(m["type"] == "game_ended" for m in batch)
    st.flush = False
    if not batch or not any(m["solo"] for m in batch):
        return
    if st.line_count >= s.commentary_max_lines_per_game and not final:
        st.skipped += 1
        return
    st.last_at = time.monotonic()
    st.last_spoke_turn = words.turn_number(game)
    game_id = getattr(room, "game_id", None)
    snap = {
        "game": game,
        "game_id": game_id,
        "moments": batch,
        "turn": max(m["turn"] for m in batch),
        "after_seq": len(game.events) - 1,
        # its latest lines (shown to the model) and everything said in this
        # game (nothing is said twice, however long ago)
        "memory": list(st.memory),
        "said": [x["text"] for x in st.lines if x.get("game_id") == game_id],
    }
    entry = words.resolve_model() if _model_usable(st) else None
    if entry is None:
        _publish(room_code, room, st, snap, words.rules_line(batch, snap["said"]))
        return
    # facts are read now, in this turn of the event loop: the table cannot
    # change under them, and the model call below holds no lock
    rs = game.ruleset
    system = words.build_system_prompt(rs)
    snap["system"] = system
    snap["system_prompt_id"] = words.system_prompt_id(system, rs)
    snap["user"] = words.build_user_prompt(
        batch, words.table_facts(game), words.history_facts(game), snap["memory"]
    )
    snap["symbol"] = rs.theme.currency_symbol
    st.in_flight = True
    st.calls += 1
    task = asyncio.get_running_loop().create_task(
        _model_line(room_code, st, snap, entry)
    )
    st.tasks.add(task)
    task.add_done_callback(st.tasks.discard)


_PRICES: list = []


def _cost(model: str | None, a: dict) -> float | None:
    if not _PRICES:
        try:
            from bench.prices import PriceTable

            _PRICES.append(PriceTable.load())
        except Exception:  # noqa: BLE001 - costs are optional
            _PRICES.append(None)
    if _PRICES[0] is None:
        return None
    return _PRICES[0].cost(
        model,
        int(a.get("input_tokens") or 0),
        int(a.get("output_tokens") or 0),
        int(a.get("cache_read_tokens") or 0),
        int(a.get("cache_write_tokens") or 0),
    )


async def _model_line(room_code: str, st: CommentaryState, snap: dict, entry) -> None:
    """One commentary call (background task; holds no lock). Any failure, an
    unusable answer or a made-up amount gives the rules line instead."""
    s = get_settings()
    t0 = time.monotonic()
    text: str | None = None
    attempt: dict = {
        "raw": None,
        "parsed": None,
        "error": None,
        "latency_s": None,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "retry_prompt": None,
    }
    model = entry.model
    try:
        provider = words.provider_for(entry)
        model = getattr(provider, "model", None) or entry.model
        try:
            result = await asyncio.wait_for(
                provider.complete(
                    system=snap["system"],
                    user=snap["user"],
                    schema=words.LINE_SCHEMA,
                    max_tokens=s.commentary_max_tokens,
                    timeout=s.commentary_timeout_s,
                    **(
                        {"effort": s.commentary_effort}
                        if s.commentary_effort and entry.provider != "openai"
                        else {}
                    ),
                ),
                s.commentary_timeout_s + 3,
            )
            model = result.model or model
            attempt.update(
                raw=result.raw,
                parsed=result.data,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
                cache_read_tokens=result.cache_read_tokens,
                cache_write_tokens=result.cache_write_tokens,
            )
            text = words.clean_line((result.data or {}).get("line"))
            style = words.style_problems(text) if text else []
            if text is None:
                attempt["error"] = "no usable line in the answer"
            elif style:
                attempt["error"] = "style: " + ", ".join(style)
                text = None
            else:
                made_up = words.unsupported_amounts(text, snap["user"], snap["symbol"])
                if made_up:
                    attempt["error"] = "amounts not in the prompt: " + ", ".join(
                        made_up
                    )
                    text = None
                elif words.repeats(text, snap["said"]):
                    attempt["error"] = "repeats an earlier line"
                    text = None
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - commentary never breaks a game
            attempt["error"] = f"{type(exc).__name__}: {exc}"[:300]
            logger.warning("commentary call failed in room %s: %s", room_code, exc)
        attempt["latency_s"] = round(time.monotonic() - t0, 4)
        cost = _cost(model, attempt)
        st.spend_usd += cost or 0.0
        if attempt["raw"] is None:
            st.failures += 1  # the provider failed (not: a refused answer)
        else:
            st.failures = 0
        llm = {
            "model": model,
            "system_prompt_id": snap["system_prompt_id"],
            "system_prompt": snap["system"],
            "user_prompt": snap["user"],
            "attempts": [attempt],
            "cost_usd": cost,
        }
        room = session_manager.get_room(room_code)
        if room is None or room.game is not snap["game"] or not st.enabled:
            # the game was replaced or commentary turned off meanwhile: the
            # line is not said, but the call was made and is still recorded
            _record(room, snap, None, llm, "dropped")
            return
        fallback = None if text else words.rules_line(snap["moments"], snap["said"])
        _publish(room_code, room, st, snap, text or fallback, llm=llm, model=bool(text))
    finally:
        st.in_flight = False
        room = session_manager.get_room(room_code)
        if room is not None and st.enabled and room.game is st.game:
            try:
                _schedule(room_code, room, st)
            except Exception:  # noqa: BLE001
                logger.exception("commentary failed in room %s", room_code)


def _writer(room, game):
    w = getattr(room, "transcript", None) if room is not None else None
    if w is None or w.closed or w.game is not game:
        return None
    return w


def _record(room, snap: dict, line: dict | None, llm: dict | None, outcome: str):
    writer = _writer(room, snap["game"])
    if writer is not None:
        writer.record_commentary(
            line=public_line(line) if line else None,
            after_seq=snap["after_seq"],
            moments=[m["type"] for m in snap["moments"]],
            outcome=outcome,
            llm=llm,
        )


def _publish(
    room_code: str,
    room,
    st: CommentaryState,
    snap: dict,
    text: str | None,
    *,
    llm: dict | None = None,
    model: bool = False,
) -> None:
    """Store, transcribe and send one line (``text`` None: nothing new to
    say; only the model call, if any, is recorded)."""
    if not text:
        if llm is not None:
            _record(room, snap, None, llm, "silent")
        return
    line = {
        "id": st.next_id,
        "text": text,
        "source": "model" if model else "rules",
        "turn": snap["turn"],
        "after_seq": snap["after_seq"],
        "at": utc_now(),
        "moments": [m["type"] for m in snap["moments"]],
        "game_id": snap["game_id"],
    }
    st.next_id += 1
    st.lines.append(line)
    st.memory.append(text)
    st.line_count += 1
    st.model_lines += int(model)
    st.last_line_turn = snap["turn"]
    _record(room, snap, line, llm, "model" if model else "rules")
    msg = {"type": "commentary", "line": public_line(line), "mode": mode(room)}
    task = asyncio.get_running_loop().create_task(
        session_manager.send_to_host(room_code, msg)
    )
    st.tasks.add(task)
    task.add_done_callback(st.tasks.discard)


# ---------------------------------------------------------------------------
# Closing, tests, debugging
# ---------------------------------------------------------------------------


def busy(room) -> bool:
    st = getattr(room, "commentary", None)
    if st is None:
        return False
    return (
        st.in_flight
        or st.timer is not None
        or st.flush
        or any(not t.done() for t in st.tasks)
    )


async def wait_quiet(room_code: str, timeout: float = 10.0) -> None:
    """Wait until no line is being made or waiting for its gap in the room
    (closing a finished game's transcript; tests)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        room = session_manager.get_room(room_code)
        if room is None or not busy(room):
            return
        await asyncio.sleep(0.02)
    raise asyncio.TimeoutError("commentary still running")


def closing_tasks(room) -> list:
    """Tasks a finished game's transcript waits for before it is closed, so
    the final line and its cost are in it."""
    st = getattr(room, "commentary", None)
    if st is None or not (st.in_flight or st.flush):
        return []
    loop = asyncio.get_running_loop()
    return [
        loop.create_task(
            wait_quiet(room.room_code, get_settings().commentary_timeout_s + 5)
        )
    ]


def debug(room) -> dict:
    """Counters for ``GET /room/{code}/debug``."""
    st = getattr(room, "commentary", None)
    if st is None:
        return {"enabled": bool(getattr(room, "commentary_default", False))}
    return {
        "enabled": st.enabled,
        "mode": mode(room),
        "spectator": spectator_attached(room),
        "lines": st.line_count,
        "model_lines": st.model_lines,
        "calls": st.calls,
        "spend_usd": round(st.spend_usd, 6),
        "failures": st.failures,
        "skipped": st.skipped,
        "pending": len(st.pending),
        "in_flight": st.in_flight,
    }
