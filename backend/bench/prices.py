"""Price table: USD per million tokens per model, from an editable JSON file.

Unknown (null / missing) prices yield ``None`` costs, never a guess.
"""

from __future__ import annotations

import json
from pathlib import Path

DEFAULT_PATH = Path(__file__).with_name("prices.json")
_FIELDS = ("input", "output", "cache_read", "cache_write")


class PriceTable:
    def __init__(self, models: dict[str, dict] | None = None):
        self.models = models or {}

    @classmethod
    def load(cls, path: str | Path | None = None) -> PriceTable:
        data = json.loads(Path(path or DEFAULT_PATH).read_text(encoding="utf-8"))
        return cls(dict(data.get("models", {})))

    def known(self, model: str | None) -> bool:
        """True when input and output prices are both set for ``model``."""
        p = self.models.get(model or "")
        return bool(p) and p.get("input") is not None and p.get("output") is not None

    def cost(
        self,
        model: str | None,
        input_tokens: int,
        output_tokens: int,
        cache_read_tokens: int = 0,
        cache_write_tokens: int = 0,
    ) -> float | None:
        """Estimated USD, or None when the model or a price needed for the
        non-zero usage is unknown."""
        p = self.models.get(model or "")
        if not p:
            return None
        usage = {
            "input": input_tokens,
            "output": output_tokens,
            "cache_read": cache_read_tokens,
            "cache_write": cache_write_tokens,
        }
        total = 0.0
        for field in _FIELDS:
            n = usage[field]
            if not n:
                continue
            price = p.get(field)
            if price is None:
                return None
            total += n * float(price) / 1_000_000
        return total
