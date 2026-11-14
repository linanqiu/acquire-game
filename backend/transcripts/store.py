"""Listing and reading transcripts (the ``/games`` HTTP routes use this).

* ``read_transcript(path)`` -> ``{"header", "entries", "footer"}`` (a torn last
  line from a killed process is skipped).
* ``redact(transcript)`` applies the privacy rule for unfinished games.
* ``TranscriptStore`` lists games newest first with cursor pagination. It reads
  the small ``<game_id>.summary.json`` sidecars, not the transcripts; a missing
  or stale sidecar (a footer was written by another process, or a crash lost
  it) is rebuilt from the transcript once.

Status: ``finished`` (footer, reason not ``abandoned``), ``abandoned`` (footer
with reason ``abandoned``, or no footer and no running game), ``live`` (no
footer and the game is running: in this process for live games; for bench
transcripts written by another process, modified within ``stale_after_s``).
"""

from __future__ import annotations

import copy
import json
import os
import time
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

from transcripts.paths import valid_game_id
from transcripts.writer import SUMMARY_SUFFIX, dumps

_REDACT_LLM = ("user_prompt", "why", "note", "error")
_REDACT_ATTEMPT = ("raw", "retry_prompt")
HIDDEN_ERROR = "rejected (details are shown when the game is over)"
_REDACT_HEADER = ("seed", "tile_order")
_SUMMARY_KEYS = (
    "game_id",
    "source",
    "status",
    "started_at",
    "ended_at",
    "room_code",
    "series_id",
    "seats",
    "winners",
    "turns",
)


# --------------------------------------------------------------------- reading


def read_lines(path: Path) -> Iterable[dict]:
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except ValueError:
                continue  # torn last line of a killed process


def read_transcript(path: str | Path) -> dict:
    """``{"header", "entries", "footer"}``; ``footer`` None when unfinished."""
    header = None
    footer = None
    entries: list[dict] = []
    for obj in read_lines(Path(path)):
        t = obj.get("type")
        if t == "header" and header is None:
            header = obj
        elif t == "footer":
            footer = obj
        else:
            entries.append(obj)
    return {"header": header, "entries": entries, "footer": footer}


def has_footer(path: Path) -> bool:
    """Cheap check: is the last complete line a footer? (reads the tail only)"""
    try:
        size = path.stat().st_size
        with open(path, "rb") as fh:
            fh.seek(max(0, size - 65536))
            tail = fh.read().decode("utf-8", errors="replace")
    except OSError:
        return False
    lines = [ln for ln in tail.splitlines() if ln.strip()]
    if not lines:
        return False
    try:
        return json.loads(lines[-1]).get("type") == "footer"
    except ValueError:
        return False


def summarize(transcript: dict, path: Path | None = None) -> dict:
    """Summary dict (same keys as ``TranscriptWriter.summary``) from a parsed
    transcript."""
    h = transcript["header"] or {}
    footer = transcript["footer"]
    turns = sum(1 for e in transcript["entries"] if _event_type(e) == "turn_ended")
    standings = (footer or {}).get("standings") or []
    if footer is None:
        status = "abandoned"
    else:
        status = "abandoned" if footer.get("reason") == "abandoned" else "finished"
    return {
        "game_id": h.get("game_id"),
        "source": h.get("source"),
        "status": status,
        "started_at": h.get("started_at"),
        "ended_at": (footer or {}).get("ended_at"),
        "room_code": h.get("room_code"),
        "series_id": (h.get("bench") or {}).get("series_id"),
        "seats": [
            {
                "player_id": s.get("player_id"),
                "name": s.get("name"),
                "kind": s.get("kind"),
                "agent_label": s.get("agent_label"),
                "model": s.get("model"),
            }
            for s in h.get("seats") or []
        ],
        "winners": [s["player_id"] for s in standings if s.get("rank") == 1],
        "turns": turns,
        "end_reason": (footer or {}).get("reason"),
        "standings": standings,
        "totals": (footer or {}).get("totals") or {},
        "prompt_version": h.get("prompt_version"),
        "bench": h.get("bench"),
        "loaded_from_snapshot": h.get("loaded_from_snapshot", False),
        "finished": footer is not None,
        "file": path.name if path is not None else None,
    }


def _event_type(entry: dict) -> str | None:
    """Engine event type of an ``event`` line (``{"type": "event", "event":
    {...}}``), None for other lines."""
    if entry.get("type") != "event":
        return None
    return (entry.get("event") or {}).get("type")


# ------------------------------------------------------------------ redaction


def redact(transcript: dict) -> dict:
    """Copy of ``transcript`` with what reveals hands or private plans removed.

    Removed: events with ``private_to``; per decision ``llm.user_prompt``,
    ``llm.why``, ``llm.note``, ``llm.error``, each attempt's ``raw`` and
    ``retry_prompt``, ``fallback.detail`` and the tile lists inside ``legal``. Blanked (key kept,
    so clients need no special case): each attempt's ``parsed`` -> null and a
    non-null ``error`` -> a generic text (both can name a tile in hand; the
    attempt also gets ``rejected: bool``), and the header's ``seed`` and
    ``tile_order`` -> null (either one determines every hand and the bag).
    """
    out = {
        "header": copy.deepcopy(transcript.get("header")),
        "entries": [],
        "footer": copy.deepcopy(transcript.get("footer")),
    }
    if out["header"]:
        for k in _REDACT_HEADER:
            if k in out["header"]:
                out["header"][k] = None
    for e in transcript.get("entries", []):
        if e.get("type") == "event":
            if (e.get("event") or {}).get("private_to"):
                continue
            out["entries"].append(e)
            continue
        if e.get("type") != "decision":
            out["entries"].append(e)
            continue
        d = dict(e)
        if isinstance(d.get("fallback"), dict) and "detail" in d["fallback"]:
            # the raw failure text can quote a tile in hand
            d["fallback"] = {k: v for k, v in d["fallback"].items() if k != "detail"}
        legal = d.get("legal")
        if isinstance(legal, dict) and "tiles" in legal:
            d["legal"] = {k: v for k, v in legal.items() if k != "tiles"}
        llm = d.get("llm")
        if isinstance(llm, dict):
            llm = {k: v for k, v in llm.items() if k not in _REDACT_LLM}
            llm["attempts"] = [
                {k: v for k, v in a.items() if k not in _REDACT_ATTEMPT}
                | {
                    "parsed": None,
                    "error": None if a.get("error") is None else HIDDEN_ERROR,
                    "rejected": a.get("error") is not None,
                }
                for a in llm.get("attempts") or []
            ]
            d["llm"] = llm
        out["entries"].append(d)
    return out


def totals_from_entries(transcript: dict) -> dict:
    """Per-seat totals recomputed from decision lines (unfinished games not
    running in this process). ``cost_usd`` is null (unknown here)."""
    seats = (transcript.get("header") or {}).get("seats") or []
    out = {
        s["player_id"]: {
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
        for s in seats
    }
    for e in transcript.get("entries", []):
        if e.get("type") != "decision" or e.get("player_id") not in out:
            continue
        t = out[e["player_id"]]
        t["decisions"] += 1
        t["fallbacks"] += int(e.get("source") == "fallback")
        if e.get("latency_s") is not None and e.get("source") != "human":
            t["latency_s"] = round(t["latency_s"] + float(e["latency_s"]), 4)
        attempts = (e.get("llm") or {}).get("attempts") or []
        t["llm_calls"] += sum(1 for a in attempts if a.get("raw") is not None)
        t["retries"] += sum(1 for a in attempts if a.get("error") is not None)
        for k in (
            "input_tokens",
            "output_tokens",
            "cache_read_tokens",
            "cache_write_tokens",
        ):
            t[k] += sum(int(a.get(k) or 0) for a in attempts)
    return out


# ---------------------------------------------------------------------- store


class TranscriptStore:
    """Lists and reads transcripts from one or more directories.

    ``dirs``: directories (or a callable returning them, re-evaluated on every
    call). ``live``: callable returning ``{game_id: TranscriptWriter}`` for
    games running in this process (their summaries come from memory).
    """

    def __init__(
        self,
        dirs: Iterable[Path] | Callable[[], Iterable[Path]],
        *,
        live: Callable[[], dict[str, Any]] | None = None,
        stale_after_s: float = 900.0,
    ):
        self._dirs = dirs
        self._live = live or (lambda: {})
        self.stale_after_s = stale_after_s
        self._cache: dict[Path, tuple[float, int, dict]] = {}

    def dirs(self) -> list[Path]:
        raw = self._dirs() if callable(self._dirs) else self._dirs
        out = []
        for d in raw:
            d = Path(d)
            if d.is_dir() and d not in out:
                out.append(d)
        return out

    def path_for(self, game_id: str) -> Path | None:
        if not valid_game_id(game_id):
            return None
        for d in self.dirs():
            p = d / f"{game_id}.jsonl"
            if p.is_file():
                return p
        return None

    # summaries -------------------------------------------------------------

    def _summary_for(self, path: Path, live: dict) -> dict | None:
        gid = path.stem
        writer = live.get(gid)
        if writer is not None and not getattr(writer, "closed", True):
            return writer.summary()
        try:
            st = path.stat()
        except OSError:
            return None
        cached = self._cache.get(path)
        if cached and cached[0] == st.st_mtime and cached[1] == st.st_size:
            summary = dict(cached[2])
        else:
            summary = self._load_summary(path)
            if summary is None:
                return None
            self._cache[path] = (st.st_mtime, st.st_size, summary)
            summary = dict(summary)
        if not summary.get("finished"):
            recent = time.time() - st.st_mtime < self.stale_after_s
            summary["status"] = (
                "live" if summary.get("source") == "bench" and recent else "abandoned"
            )
        return summary

    def _load_summary(self, path: Path) -> dict | None:
        side = path.with_name(path.stem + SUMMARY_SUFFIX)
        summary = None
        try:
            summary = json.loads(side.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            summary = None
        if summary is not None and (summary.get("finished") or not has_footer(path)):
            if not summary.get("finished"):
                summary["turns"] = summary.get("turns", 0)
            return summary
        # missing, unreadable or stale (footer written but sidecar not): rebuild
        try:
            t = read_transcript(path)
        except OSError:
            return None
        if t["header"] is None:
            return None
        summary = summarize(t, path)
        if summary["finished"]:
            try:
                tmp = side.with_suffix(".tmp")
                tmp.write_text(dumps(summary), encoding="utf-8")
                os.replace(tmp, side)
            except OSError:
                pass
        return summary

    def summaries(self, source: str | None = None) -> list[dict]:
        live = self._live()
        seen: set[str] = set()
        out = []
        for d in self.dirs():
            for path in d.glob("*.jsonl"):
                if path.stem in seen or not valid_game_id(path.stem):
                    continue
                s = self._summary_for(path, live)
                if s is None or (source and s.get("source") != source):
                    continue
                seen.add(path.stem)
                out.append(s)
        out.sort(
            key=lambda s: (s.get("started_at") or "", s.get("game_id") or ""),
            reverse=True,
        )
        return out

    def list(
        self, *, source: str | None = None, limit: int = 50, before: str | None = None
    ) -> dict:
        """``{"games": [summary rows], "next": game_id | None}``, newest first.
        ``before``: return the games after (older than) that id; an unknown id
        yields an empty page."""
        rows = self.summaries(source)
        if before:
            idx = next((i for i, s in enumerate(rows) if s["game_id"] == before), None)
            rows = [] if idx is None else rows[idx + 1 :]
        limit = max(1, min(int(limit), 500))
        page = rows[:limit]
        return {
            "games": [{k: s.get(k) for k in _SUMMARY_KEYS} for s in page],
            "next": page[-1]["game_id"] if len(rows) > limit else None,
        }

    def detail(self, game_id: str) -> dict | None:
        """Summary row plus ``standings``, ``totals``, ``end_reason``,
        ``prompt_version``, ``bench``, ``loaded_from_snapshot``."""
        path = self.path_for(game_id)
        if path is None:
            return None
        s = self._summary_for(path, self._live())
        if s is None:
            return None
        row = {k: s.get(k) for k in _SUMMARY_KEYS}
        for k in (
            "standings",
            "totals",
            "end_reason",
            "prompt_version",
            "bench",
            "loaded_from_snapshot",
        ):
            row[k] = s.get(k)
        return row

    def transcript(self, game_id: str) -> dict | None:
        """The contract's response: ``{header, entries, footer, redacted}``;
        redacted while the game is unfinished."""
        path = self.path_for(game_id)
        if path is None:
            return None
        t = read_transcript(path)
        if t["header"] is None:
            return None
        live = self._live().get(game_id)
        if live is not None and not getattr(live, "closed", True):
            t["footer"] = None  # a footer cannot exist yet; be explicit
        if t["footer"] is None:
            out = redact(t)
            out["redacted"] = True
            out["live_totals"] = (
                live.final_totals()
                if live is not None and not getattr(live, "closed", True)
                else totals_from_entries(t)
            )
            return out
        t["redacted"] = False
        return t
