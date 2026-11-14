"""``TranscriptWriter``: one append-only JSON Lines file per game.

Format (docs/architecture/seat-contract.md, "Game transcripts"):

    header                      (first line)
    event | decision | state    (in the order they happened)
    footer                      (last line; absent = unfinished/abandoned)

The writer tails ``game.events`` itself: every call writes the events it has
not written yet, so the engine needs no hooks. Whoever drives the game calls
``record_decision`` after each applied action (the server's one action path,
the benchmark runner) and ``close`` at the end. Every line is flushed as it is
written, so a process that dies mid-game leaves a valid, footer-less file.

Writing never breaks a game: any I/O or serialisation error is logged once,
the writer disables itself, and the game goes on without a transcript.
A small sidecar ``<game_id>.summary.json`` (written at open and at close) lets
listings avoid parsing multi-MB transcripts.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, is_dataclass
from enum import Enum
from pathlib import Path
from typing import Any

from transcripts.paths import new_game_id, transcript_dir, utc_now, valid_game_id

logger = logging.getLogger(__name__)

TRANSCRIPT_VERSION = 1
SUMMARY_SUFFIX = ".summary.json"
FOOTER_REASONS = ("declared", "no_playable_tiles", "forced", "abandoned")
# engine ``game_ended.reason`` -> footer reason
_END_REASON = {"declared": "declared", "no_playable_tiles": "no_playable_tiles"}
_LLM_KEYS = ("model", "system_prompt_id", "user_prompt", "attempts", "why", "note")
_ATTEMPT_KEYS = (
    "raw",
    "parsed",
    "error",
    "latency_s",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "retry_prompt",
)


def _default(obj: Any) -> Any:
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, (set, frozenset, tuple)):
        return list(obj)
    if is_dataclass(obj) and not isinstance(obj, type):
        return asdict(obj)
    to_dict = getattr(obj, "to_dict", None)
    if callable(to_dict):
        return to_dict()
    return str(obj)  # Tile and friends


def dumps(obj: Any) -> str:
    return json.dumps(obj, default=_default, separators=(",", ":"), ensure_ascii=False)


def competition_ranks(scores: list[int]) -> list[int]:
    """1 = best; ties share the best rank (1, 1, 3)."""
    return [1 + sum(1 for t in scores if t > s) for s in scores]


def standings_from_game(game) -> list[dict]:
    """``[{player_id, name, rank, score}]`` best first (score = final money)."""
    players = list(getattr(game, "players", []))
    scores = [int(p.money) for p in players]
    ranks = competition_ranks(scores)
    order = sorted(range(len(players)), key=lambda i: (ranks[i], i))
    return [
        {
            "player_id": players[i].player_id,
            "name": players[i].name,
            "rank": ranks[i],
            "score": scores[i],
        }
        for i in order
    ]


def _seat(s: dict) -> dict:
    return {
        "player_id": s["player_id"],
        "name": s.get("name"),
        "kind": s.get("kind") or "human",
        "agent_id": s.get("agent_id"),
        "agent_label": s.get("agent_label"),
        "model": s.get("model"),
        "is_bot": bool(s.get("is_bot", s.get("kind") not in (None, "human"))),
    }


def _empty_totals() -> dict:
    return {
        "decisions": 0,
        "llm_calls": 0,
        "retries": 0,
        "fallbacks": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "cost_usd": None,
        "latency_s": 0.0,
    }


class TranscriptWriter:
    """Writes one game's transcript. Create with ``TranscriptWriter.open``."""

    def __init__(
        self,
        game,
        path: Path,
        header: dict,
        *,
        start_seq: int = 0,
        prices: Any = None,
    ):
        self.game = game
        self.path = Path(path)
        self.header = header
        self.game_id: str = header["game_id"]
        self.prices = prices
        self.turns = 0
        self.decisions = 0
        self.closed = False
        self.broken = False
        self.footer: dict | None = None
        self._next_seq = start_seq
        self._index = 0
        self._state_seq: int | None = None  # after_seq of the last state line
        self._known_prompts = set(header.get("system_prompts") or {})
        self.totals: dict[str, dict] = {
            s["player_id"]: _empty_totals() for s in header["seats"]
        }
        self._fh = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._fh = open(self.path, "a", encoding="utf-8")  # noqa: SIM115
        except OSError as exc:
            self._fail(exc)
            return
        self._write(header)
        self._write_sidecar()

    # ------------------------------------------------------------- creating

    @classmethod
    def open(
        cls,
        game,
        *,
        seats: list[dict],
        source: str = "live",
        directory: str | Path | None = None,
        game_id: str | None = None,
        room_code: str | None = None,
        bench: dict | None = None,
        prompt_version: str | None = None,
        system_prompts: dict[str, str] | None = None,
        loaded_from_snapshot: bool = False,
        prices: Any = None,
    ) -> TranscriptWriter | None:
        """Start a transcript for ``game`` (already started). Returns None when
        transcripts are disabled (``ACQUIRE_TRANSCRIPT_DIR`` empty/``off`` and
        no ``directory``) or the file cannot be created.

        ``seats``: ``[{player_id, name, kind, agent_id, agent_label, model,
        is_bot}]`` in seating order (``Game.add_player`` order). A loaded
        snapshot starts the transcript at the current state: earlier events
        are not copied (``start_seq`` in the header says where it starts).
        """
        try:
            folder = Path(directory) if directory is not None else transcript_dir()
            if folder is None:
                return None
            gid = game_id or new_game_id()
            if not valid_game_id(gid):
                raise ValueError(f"invalid game id {gid!r}")
            start_seq = len(game.events) if loaded_from_snapshot else 0
            header = {
                "type": "header",
                "transcript_version": TRANSCRIPT_VERSION,
                "game_id": gid,
                "source": source,
                "room_code": room_code,
                "bench": bench,
                "started_at": utc_now(),
                "seed": getattr(game, "seed", None),
                "tile_order": getattr(game, "_tile_order", None),
                "seats": [_seat(s) for s in seats],
                "prompt_version": prompt_version,
                "system_prompts": dict(system_prompts or {}),
                "loaded_from_snapshot": bool(loaded_from_snapshot),
                "start_seq": start_seq,
            }
            writer = cls(
                game,
                folder / f"{gid}.jsonl",
                header,
                start_seq=start_seq,
                prices=prices,
            )
            if writer.broken:
                return None
            writer.sync()
            if writer._state_seq is None:
                writer._write_state()
            return writer
        except Exception as exc:  # noqa: BLE001 - never break a game
            logger.warning("transcript disabled for this game: %s", exc)
            return None

    # ------------------------------------------------------------- writing

    def sync(self) -> None:
        """Write every engine event not written yet, then a ``state`` line if
        any were written (used after mutations that are not seat actions,
        e.g. the host forcing the end)."""
        if self._inactive:
            return
        try:
            before = self._next_seq
            self._sync_events()
            if self._next_seq != before:
                self._write_state()
        except Exception as exc:  # noqa: BLE001
            self._fail(exc)

    def record_decision(
        self,
        *,
        player_id: str,
        kind: str,
        action: dict,
        source: str,
        after_seq: int,
        legal: dict | None = None,
        fallback: dict | None = None,
        latency_s: float | None = None,
        llm: dict | None = None,
    ) -> None:
        """Record one APPLIED action. Call right after ``apply_action``
        succeeded: ``after_seq`` is the seq of the last event before it
        (``len(game.events) - 1`` taken before applying). Writes pending
        events up to ``after_seq``, the decision line, the action's events,
        then a ``state`` line."""
        if self._inactive:
            return
        try:
            self._sync_events(upto=after_seq)
            action = self._complete_action(action, after_seq)
            entry = self._llm_entry(llm)
            line = {
                "type": "decision",
                "index": self._index,
                "after_seq": after_seq,
                "player_id": player_id,
                "kind": kind,
                "legal": legal,
                "action": action,
                "source": source,
                "fallback": fallback,
                "latency_s": None if latency_s is None else round(latency_s, 4),
                "llm": entry,
            }
            self._write(line)
            self._index += 1
            self.decisions += 1
            self._count(player_id, source, latency_s, entry)
            self._sync_events()
            self._write_state()
        except Exception as exc:  # noqa: BLE001
            self._fail(exc)

    def close(
        self,
        reason: str,
        standings: list[dict] | None = None,
        totals: dict | None = None,
        detail: str | None = None,
    ) -> None:
        """Write the footer and close the file. ``reason``: declared |
        no_playable_tiles | forced | abandoned. ``standings`` default to the
        final money of every player (``[]`` for an abandoned game);
        ``totals`` default to what this writer counted."""
        if self.closed:
            return
        self.closed = True
        if self.broken or self._fh is None:
            return
        try:
            self._sync_events()
            if self._state_seq != self._next_seq - 1:
                self._write_state()
            if standings is None:
                standings = (
                    [] if reason == "abandoned" else standings_from_game(self.game)
                )
            self.footer = {
                "type": "footer",
                "ended_at": utc_now(),
                "reason": reason,
                "standings": standings,
                "totals": totals if totals is not None else self.final_totals(),
            }
            if detail:
                self.footer["detail"] = detail
            self._write(self.footer)
            self._fh.close()
            self._write_sidecar()
        except Exception as exc:  # noqa: BLE001
            self._fail(exc)

    def close_from_game(self) -> None:
        """Close with the reason and standings of the engine's ``game_ended``
        event (``forced`` for a host-forced end)."""
        ended = next(
            (e for e in reversed(self.game.events) if e.get("type") == "game_ended"),
            None,
        )
        reason = _END_REASON.get((ended or {}).get("reason"), "forced")
        self.close(reason)

    # ------------------------------------------------------------- reading

    def final_totals(self) -> dict:
        out = {}
        models = {s["player_id"]: s.get("model") for s in self.header["seats"]}
        for pid, t in self.totals.items():
            t = dict(t)
            tokens = (
                t["input_tokens"]
                + t["output_tokens"]
                + t["cache_read_tokens"]
                + t["cache_write_tokens"]
            )
            if not tokens:
                t["cost_usd"] = 0.0
            elif self.prices is not None:
                t["cost_usd"] = self.prices.cost(
                    models.get(pid),
                    t["input_tokens"],
                    t["output_tokens"],
                    t["cache_read_tokens"],
                    t["cache_write_tokens"],
                )
            t["latency_s"] = round(t["latency_s"], 4)
            out[pid] = t
        return out

    def summary(self) -> dict:
        """Listing summary (``GET /games`` row plus ``standings``/``totals``)."""
        h = self.header
        footer = self.footer
        if footer is None:
            status = "live"
        else:
            status = "abandoned" if footer["reason"] == "abandoned" else "finished"
        standings = footer["standings"] if footer else []
        return {
            "game_id": self.game_id,
            "source": h["source"],
            "status": status,
            "started_at": h["started_at"],
            "ended_at": footer["ended_at"] if footer else None,
            "room_code": h.get("room_code"),
            "series_id": (h.get("bench") or {}).get("series_id"),
            "seats": [
                {k: s.get(k) for k in ("player_id", "name", "kind", "agent_label")}
                | {"model": s.get("model")}
                for s in h["seats"]
            ],
            "winners": [s["player_id"] for s in standings if s.get("rank") == 1],
            "turns": self.turns,
            "end_reason": footer["reason"] if footer else None,
            "standings": standings,
            "totals": footer["totals"] if footer else self.final_totals(),
            "prompt_version": h.get("prompt_version"),
            "bench": h.get("bench"),
            "loaded_from_snapshot": h.get("loaded_from_snapshot", False),
            "finished": footer is not None,
            "file": self.path.name,
        }

    # ------------------------------------------------------------ internals

    @property
    def _inactive(self) -> bool:
        return self.closed or self.broken or self._fh is None

    def _write(self, obj: dict) -> None:
        self._fh.write(dumps(obj) + "\n")
        self._fh.flush()

    def _sync_events(self, upto: int | None = None) -> None:
        events = self.game.events
        end = len(events) if upto is None else min(len(events), upto + 1)
        while self._next_seq < end:
            e = events[self._next_seq]
            self._write({"type": "event", "event": e})
            if e.get("type") == "turn_ended":
                self.turns += 1
            self._next_seq += 1

    def _write_state(self) -> None:
        after = self._next_seq - 1
        self._write(
            {
                "type": "state",
                "after_seq": after,
                "public": self.game.get_public_state(),
            }
        )
        self._state_seq = after

    def _complete_action(self, action: dict, after_seq: int) -> dict:
        """A ``propose_trade`` without ``trade_id`` gets the id the engine
        assigned, so replaying the recorded actions reproduces the game."""
        if (
            isinstance(action, dict)
            and action.get("action") == "propose_trade"
            and not action.get("trade_id")
        ):
            for e in self.game.events[after_seq + 1 :]:
                if e.get("type") == "trade_proposed":
                    return {**action, "trade_id": e["trade"].get("trade_id")}
        return action

    def _llm_entry(self, rec: dict | None) -> dict | None:
        if not rec:
            return None
        entry = {k: rec.get(k) for k in _LLM_KEYS}
        entry["attempts"] = [
            {k: a.get(k) for k in _ATTEMPT_KEYS} for a in (rec.get("attempts") or [])
        ]
        if rec.get("outcome") is not None:
            entry["outcome"] = rec.get("outcome")
        if rec.get("error"):
            entry["error"] = rec.get("error")
        sp_id, text = rec.get("system_prompt_id"), rec.get("system_prompt")
        if sp_id and sp_id not in self._known_prompts and text:
            # not in the header (a custom agent): stored inline, once
            entry["system_prompt"] = text
            self._known_prompts.add(sp_id)
        return entry

    def _count(self, pid: str, source: str, latency, entry: dict | None) -> None:
        t = self.totals.setdefault(pid, _empty_totals())
        t["decisions"] += 1
        if source == "fallback":
            t["fallbacks"] += 1
        if latency is not None and source != "human":
            t["latency_s"] += float(latency)
        if entry:
            attempts = entry["attempts"]
            t["llm_calls"] += sum(1 for a in attempts if a.get("raw") is not None)
            t["retries"] += max(0, len(attempts) - 1)
            for k in (
                "input_tokens",
                "output_tokens",
                "cache_read_tokens",
                "cache_write_tokens",
            ):
                t[k] += sum(int(a.get(k) or 0) for a in attempts)

    def _write_sidecar(self) -> None:
        try:
            target = self.path.with_name(self.game_id + SUMMARY_SUFFIX)
            tmp = target.with_suffix(".tmp")
            tmp.write_text(dumps(self.summary()), encoding="utf-8")
            os.replace(tmp, target)
        except OSError as exc:
            logger.warning("could not write transcript summary: %s", exc)

    def _fail(self, exc: Exception) -> None:
        if not self.broken:
            logger.warning(
                "transcript %s disabled after an error: %s",
                getattr(self, "game_id", "?"),
                exc,
            )
        self.broken = True
        try:
            if self._fh is not None:
                self._fh.close()
        except Exception:  # noqa: BLE001
            pass
