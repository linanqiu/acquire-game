"""Per-decision observability for LLM seats (LO-007).

Every decision appends one record to

* an in-memory ring buffer owned by the agent (``recent(n)``),
* the ``acquire.llm`` Python logger (one compact line, no prompts),
* optionally JSONL under ``ACQUIRE_LLM_LOG_DIR`` including the full prompts and
  raw responses (``decisions.jsonl``).

Running totals (calls, tokens, failures, latency) are kept for the benchmark
harness.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections import deque
from typing import Any

logger = logging.getLogger("acquire.llm")

_file_lock = threading.Lock()


class DecisionLog:
    def __init__(
        self,
        agent_id: str,
        model: str = "",
        *,
        capacity: int = 200,
        log_dir: str | None = None,
    ):
        self.agent_id = agent_id
        self.model = model
        self._records: deque[dict] = deque(maxlen=capacity)
        self._log_dir = log_dir  # None -> read ACQUIRE_LLM_LOG_DIR at write time
        self.totals: dict[str, Any] = {
            "decisions": 0,
            "calls": 0,
            "repairs": 0,
            "failures": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
            "latency_s": 0.0,
        }

    def record(self, *, full: dict | None = None, **fields: Any) -> dict:
        """Append a record. ``fields`` are the compact (logged + buffered) part;
        ``full`` (prompts, raw responses) goes only to the JSONL file."""
        rec = {"ts": time.time(), "agent_id": self.agent_id, "model": self.model}
        rec.update(fields)
        rec.setdefault("error", None)
        rec.setdefault("repaired", False)
        rec.setdefault("fallback", False)
        self._records.append(rec)

        t = self.totals
        t["decisions"] += 1
        t["calls"] += int(rec.get("calls", 1))
        t["repairs"] += int(bool(rec["repaired"]))
        t["failures"] += int(bool(rec["error"]))
        for k in (
            "input_tokens",
            "output_tokens",
            "cache_read_tokens",
            "cache_write_tokens",
        ):
            t[k] += int(rec.get(k, 0) or 0)
        t["latency_s"] += float(rec.get("latency_s", 0.0) or 0.0)

        logger.info(
            "decision agent=%s kind=%s ok=%s repaired=%s latency=%.2fs in=%s out=%s why=%s%s",
            self.agent_id,
            rec.get("decision_kind"),
            rec["error"] is None,
            rec["repaired"],
            rec.get("latency_s", 0.0),
            rec.get("input_tokens"),
            rec.get("output_tokens"),
            rec.get("why"),
            f" error={rec['error']}" if rec["error"] else "",
        )
        self._write_jsonl({**rec, **(full or {})})
        return rec

    def annotate_last(self, **fields: Any) -> None:
        """Amend the newest record (e.g. the driver marks ``fallback=True``)."""
        if self._records:
            self._records[-1].update(fields)
            if fields.get("fallback"):
                logger.info("decision agent=%s fell back to heuristic", self.agent_id)

    def recent(self, n: int = 20) -> list[dict]:
        return list(self._records)[-n:] if n > 0 else []

    def _write_jsonl(self, rec: dict) -> None:
        log_dir = self._log_dir or os.environ.get("ACQUIRE_LLM_LOG_DIR")
        if not log_dir:
            return
        try:
            os.makedirs(log_dir, exist_ok=True)
            line = json.dumps(rec, default=str)
            with (
                _file_lock,
                open(
                    os.path.join(log_dir, "decisions.jsonl"), "a", encoding="utf-8"
                ) as fh,
            ):
                fh.write(line + "\n")
        except OSError as exc:  # logging must never break a game
            logger.warning("could not write decision log: %s", exc)
