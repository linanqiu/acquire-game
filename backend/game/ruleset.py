"""Rulesets: every game parameter (board, chains, prices, limits, theme words).

A ``Ruleset`` is an immutable, validated description of one game variant,
loaded from JSON (``backend/rulesets/<name>.json``). The engine never reads
global configuration: ``Game(ruleset=...)`` receives one explicitly, and the
engine objects it creates (``Board``, ``Hotel``, ``Player``) carry the same
instance. Omitting it means the built-in ``default`` ruleset.

File format (all keys required, unknown keys rejected)::

    {
      "id": "default",                 # wire-safe identifier
      "version": 1,                    # bump when the numbers change
      "title": "Grand Hotels",        # theme name (product name: GAME_BRAND_NAME)
      "theme": {                       # words the UI and LLM prompt use
        "chain_noun": "hotel chain", "chain_noun_plural": "hotel chains",
        "share_noun": "share", "share_noun_plural": "shares",
        "stock_label": "Stocks", "merger_noun": "merger",
        "merger_noun_plural": "mergers", "safe_phrase": "safe",
        "currency_symbol": "$", "tagline": "...", "game_description": "..."
      },
      "board": {"columns": 12, "rows": 9},   # tiles are "<column><row letter>"
      "tiers": [                             # cheapest first (tier rank = index)
        {"id": "cheap", "label": "cheap",
         "prices": [{"from": 2, "price": 200}, ..., {"from": 41, "price": 1000}]}
      ],
      "chains": [                            # order = display / state order
        {"id": "sandpiper", "name": "Sandpiper", "tier": "cheap",
         "color": "#E3B448", "abbreviation": "SP"}
      ],
      "bonuses": {"majority_multiplier": 10, "minority_multiplier": 5,
                  "tie_round_up_to": 100},
      "stocks_per_chain": 25, "starting_cash": 6000, "hand_size": 6,
      "max_stock_purchases_per_turn": 3, "safe_chain_size": 11,
      "end_game_chain_size": 41, "founder_bonus_shares": 1,
      "merger_trade_ratio": 2, "min_players": 3, "max_players": 6,
      "max_pending_trades_per_player": 5
    }

A price bracket applies from its ``from`` size up to the next bracket; the
last one is open-ended. Chains smaller than 2 tiles have no price.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import string
from dataclasses import dataclass, field, fields
from functools import lru_cache
from pathlib import Path
from typing import Any

RULESETS_DIR = Path(__file__).resolve().parents[1] / "rulesets"
DEFAULT_RULESET = "default"

MAX_COLUMNS = 50
MAX_ROWS = 26
ROW_LETTERS = string.ascii_uppercase
MIN_CHAIN_SIZE = 2  # a chain is founded by two connected tiles
MAX_CHAINS = 26

_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,31}$")
_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
_ABBR_RE = re.compile(r"^[A-Za-z0-9]{1,3}$")
# Column 1-99 (no leading zero) followed by one row letter.
_TILE_SHAPE_RE = re.compile(r"^([1-9][0-9]?)([A-Z])$")


class RulesetError(ValueError):
    """A ruleset file or dict is invalid."""


# ---------------------------------------------------------------------------
# Parts
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ThemeSpec:
    chain_noun: str
    chain_noun_plural: str
    share_noun: str
    share_noun_plural: str
    stock_label: str
    merger_noun: str
    merger_noun_plural: str
    safe_phrase: str
    currency_symbol: str
    tagline: str
    game_description: str


@dataclass(frozen=True)
class BoardSpec:
    columns: int
    rows: int

    @property
    def row_letters(self) -> str:
        return ROW_LETTERS[: self.rows]

    @property
    def area(self) -> int:
        return self.columns * self.rows

    def tile_example(self) -> str:
        """Example tile names for messages, e.g. "1A, 5E, 12I"."""
        mid_c = max(1, min(5, self.columns))
        mid_r = self.row_letters[min(4, self.rows - 1)]
        return f"1A, {mid_c}{mid_r}, {self.columns}{self.row_letters[-1]}"

    def parse_tile_coords(self, s: Any) -> tuple[int, str] | None:
        """(column, row) of a canonical-or-lowercase tile string on this board."""
        if not isinstance(s, str):
            return None
        m = _TILE_SHAPE_RE.match(s.strip().upper())
        if not m:
            return None
        col, row = int(m.group(1)), m.group(2)
        if col > self.columns or row not in self.row_letters:
            return None
        return col, row


@dataclass(frozen=True)
class TierSpec:
    id: str
    label: str
    prices: tuple[tuple[int, int], ...]  # (from_size, price), ascending


@dataclass(frozen=True)
class ChainSpec:
    id: str
    name: str
    tier: str
    color: str
    abbreviation: str


@dataclass(frozen=True)
class BonusSpec:
    majority_multiplier: int
    minority_multiplier: int
    tie_round_up_to: int


# ---------------------------------------------------------------------------
# Ruleset
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Ruleset:
    id: str
    version: int
    title: str
    theme: ThemeSpec
    board: BoardSpec
    tiers: tuple[TierSpec, ...]
    chains: tuple[ChainSpec, ...]
    bonuses: BonusSpec
    stocks_per_chain: int
    starting_cash: int
    hand_size: int
    max_stock_purchases_per_turn: int
    safe_chain_size: int
    end_game_chain_size: int
    founder_bonus_shares: int
    merger_trade_ratio: int
    min_players: int
    max_players: int
    max_pending_trades_per_player: int
    # Derived lookups (not part of the file format).
    _derived: dict = field(default=None, compare=False, repr=False, hash=False)

    # -- construction ------------------------------------------------------

    @classmethod
    def from_dict(cls, data: Any) -> Ruleset:
        """Validate ``data`` and build a Ruleset (raises RulesetError)."""
        return _parse(data)

    @classmethod
    def from_file(cls, path: str | Path) -> Ruleset:
        p = Path(path)
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except OSError as e:
            raise RulesetError(f"Cannot read ruleset file {p}: {e}") from e
        except json.JSONDecodeError as e:
            raise RulesetError(f"Ruleset file {p} is not valid JSON: {e}") from e
        try:
            return cls.from_dict(data)
        except RulesetError as e:
            raise RulesetError(f"{p.name}: {e}") from e

    @classmethod
    def from_public(cls, data: Any) -> Ruleset:
        """Rebuild from ``public_dict()`` output (ignores ``fingerprint``)."""
        if not isinstance(data, dict):
            raise RulesetError("ruleset must be an object")
        fp = data.get("fingerprint")
        key = json.dumps(data, sort_keys=True)
        cached = _PUBLIC_CACHE.get(key)
        if cached is not None:
            return cached
        rs = cls.from_dict({k: v for k, v in data.items() if k != "fingerprint"})
        if fp is not None and fp != rs.fingerprint:
            raise RulesetError("ruleset fingerprint does not match its contents")
        if len(_PUBLIC_CACHE) > 64:
            _PUBLIC_CACHE.clear()
        _PUBLIC_CACHE[key] = rs
        return rs

    def __post_init__(self):
        area = self.board.area
        tier_tables = {}
        for t in self.tiers:
            table = [0] * (area + 1)
            for size in range(MIN_CHAIN_SIZE, area + 1):
                price = 0
                for start, p in t.prices:
                    if size >= start:
                        price = p
                    else:
                        break
                table[size] = price
            tier_tables[t.id] = table
        derived = {
            "chain_index": {c.id: c for c in self.chains},
            "tier_index": {t.id: t for t in self.tiers},
            "tier_rank": {t.id: i for i, t in enumerate(self.tiers)},
            "tier_tables": tier_tables,
        }
        object.__setattr__(self, "_derived", derived)

    # Immutable: copies are the same object (Board deep copies stay cheap).
    def __copy__(self):
        return self

    def __deepcopy__(self, memo):
        return self

    # -- serialisation -----------------------------------------------------

    def to_dict(self) -> dict:
        """JSON-safe dict in canonical key order (the file format)."""
        return {
            "id": self.id,
            "version": self.version,
            "title": self.title,
            "theme": {f.name: getattr(self.theme, f.name) for f in fields(ThemeSpec)},
            "board": {"columns": self.board.columns, "rows": self.board.rows},
            "tiers": [
                {
                    "id": t.id,
                    "label": t.label,
                    "prices": [{"from": s, "price": p} for s, p in t.prices],
                }
                for t in self.tiers
            ],
            "chains": [
                {
                    "id": c.id,
                    "name": c.name,
                    "tier": c.tier,
                    "color": c.color,
                    "abbreviation": c.abbreviation,
                }
                for c in self.chains
            ],
            "bonuses": {
                "majority_multiplier": self.bonuses.majority_multiplier,
                "minority_multiplier": self.bonuses.minority_multiplier,
                "tie_round_up_to": self.bonuses.tie_round_up_to,
            },
            **{name: getattr(self, name) for name in _SCALARS},
        }

    @property
    def fingerprint(self) -> str:
        """Short stable hash of the canonical dict (12 hex chars)."""
        fp = self._derived.get("fingerprint")
        if fp is None:
            blob = json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))
            fp = hashlib.sha256(blob.encode("utf-8")).hexdigest()[:12]
            self._derived["fingerprint"] = fp
        return fp

    def public_dict(self) -> dict:
        """``to_dict()`` plus ``fingerprint``: what clients receive."""
        d = self._derived.get("public")
        if d is None:
            d = {**self.to_dict(), "fingerprint": self.fingerprint}
            self._derived["public"] = d
        return json.loads(json.dumps(d))  # fresh copy: callers may mutate

    # -- lookups -----------------------------------------------------------

    @property
    def chain_ids(self) -> list[str]:
        return [c.id for c in self.chains]

    def has_chain(self, chain_id: Any) -> bool:
        return isinstance(chain_id, str) and chain_id in self._derived["chain_index"]

    def chain(self, chain_id: str) -> ChainSpec:
        return self._derived["chain_index"][chain_id]

    def tier(self, tier_id: str) -> TierSpec:
        return self._derived["tier_index"][tier_id]

    def tier_rank(self, tier_id: str) -> int:
        """0 for the cheapest tier, len(tiers) - 1 for the most expensive."""
        return self._derived["tier_rank"][tier_id]

    def tier_price(self, tier_id: str, size: int) -> int:
        if size < MIN_CHAIN_SIZE:
            return 0
        table = self._derived["tier_tables"][tier_id]
        if size < len(table):
            return table[size]
        return self.tier(tier_id).prices[-1][1]

    def price(self, chain_id: str, size: int) -> int:
        return self.tier_price(self.chain(chain_id).tier, size)

    def majority_bonus(self, chain_id: str, size: int) -> int:
        return self.price(chain_id, size) * self.bonuses.majority_multiplier

    def minority_bonus(self, chain_id: str, size: int) -> int:
        return self.price(chain_id, size) * self.bonuses.minority_multiplier

    def round_split(self, amount: float) -> int:
        """Round a split bonus up to the configured step (e.g. $100)."""
        step = self.bonuses.tie_round_up_to
        return int(math.ceil(amount / step) * step)

    def next_price(self, chain_id: str, size: int) -> tuple[int | None, int | None]:
        """(size, price) of the next price bracket above ``size``, or (None, None)."""
        for start, p in self.tier(self.chain(chain_id).tier).prices:
            if start > size:
                return start, p
        return None, None

    @property
    def max_price(self) -> int:
        return max(p for t in self.tiers for _, p in t.prices)

    def is_safe_size(self, size: int) -> bool:
        return size >= self.safe_chain_size


_PUBLIC_CACHE: dict[str, Ruleset] = {}

_SCALARS = (
    "stocks_per_chain",
    "starting_cash",
    "hand_size",
    "max_stock_purchases_per_turn",
    "safe_chain_size",
    "end_game_chain_size",
    "founder_bonus_shares",
    "merger_trade_ratio",
    "min_players",
    "max_players",
    "max_pending_trades_per_player",
)
_TOP_KEYS = (
    "id",
    "version",
    "title",
    "theme",
    "board",
    "tiers",
    "chains",
    "bonuses",
    *_SCALARS,
)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _keys(obj: Any, expected: tuple[str, ...], where: str) -> dict:
    if not isinstance(obj, dict):
        raise RulesetError(f"{where} must be an object")
    unknown = sorted(set(obj) - set(expected))
    if unknown:
        raise RulesetError(f"{where}: unknown key(s) {unknown}")
    missing = [k for k in expected if k not in obj]
    if missing:
        raise RulesetError(f"{where}: missing key(s) {missing}")
    return obj


def _int(v: Any, where: str, lo: int | None = None, hi: int | None = None) -> int:
    if not isinstance(v, int) or isinstance(v, bool):
        raise RulesetError(f"{where} must be an integer, got {v!r}")
    if lo is not None and v < lo:
        raise RulesetError(f"{where} must be >= {lo}, got {v}")
    if hi is not None and v > hi:
        raise RulesetError(f"{where} must be <= {hi}, got {v}")
    return v


def _str(v: Any, where: str, max_len: int = 120) -> str:
    if not isinstance(v, str) or not v.strip():
        raise RulesetError(f"{where} must be a non-empty string")
    if len(v) > max_len:
        raise RulesetError(f"{where} is longer than {max_len} characters")
    return v


def _ident(v: Any, where: str) -> str:
    if not isinstance(v, str) or not _ID_RE.match(v):
        raise RulesetError(
            f"{where} must be a wire-safe id (letter, then up to 31 letters, "
            f"digits, '_' or '-'), got {v!r}"
        )
    return v


def _parse(data: Any) -> Ruleset:
    d = _keys(data, _TOP_KEYS, "ruleset")
    rid = _ident(d["id"], "id")
    version = _int(d["version"], "version", 1)
    title = _str(d["title"], "title", 60)

    th = _keys(d["theme"], tuple(f.name for f in fields(ThemeSpec)), "theme")
    theme = ThemeSpec(**{k: _str(th[k], f"theme.{k}", 200) for k in th})

    b = _keys(d["board"], ("columns", "rows"), "board")
    board = BoardSpec(
        columns=_int(b["columns"], "board.columns", 2, MAX_COLUMNS),
        rows=_int(b["rows"], "board.rows", 2, MAX_ROWS),
    )
    area = board.area

    if not isinstance(d["tiers"], list) or not d["tiers"]:
        raise RulesetError("tiers must be a non-empty list")
    tiers = []
    for i, t in enumerate(d["tiers"]):
        where = f"tiers[{i}]"
        t = _keys(t, ("id", "label", "prices"), where)
        tid = _ident(t["id"], f"{where}.id")
        label = _str(t["label"], f"{where}.label", 40)
        if not isinstance(t["prices"], list) or not t["prices"]:
            raise RulesetError(f"{where}.prices must be a non-empty list")
        prices = []
        for j, br in enumerate(t["prices"]):
            w = f"{where}.prices[{j}]"
            br = _keys(br, ("from", "price"), w)
            start = _int(br["from"], f"{w}.from", MIN_CHAIN_SIZE)
            price = _int(br["price"], f"{w}.price", 1)
            if prices and start <= prices[-1][0]:
                raise RulesetError(
                    f"{w}.from must be greater than the previous bracket"
                )
            if start > area:
                raise RulesetError(
                    f"{w}.from = {start} can never be reached on a {area}-tile board"
                )
            prices.append((start, price))
        if prices[0][0] != MIN_CHAIN_SIZE:
            raise RulesetError(
                f"{where}.prices must start at from = {MIN_CHAIN_SIZE} so every "
                "chain size has a price"
            )
        tiers.append(TierSpec(tid, label, tuple(prices)))
    tier_ids = [t.id for t in tiers]
    if len(set(tier_ids)) != len(tier_ids):
        raise RulesetError(f"tier ids must be unique: {tier_ids}")

    if not isinstance(d["chains"], list):
        raise RulesetError("chains must be a list")
    if not 2 <= len(d["chains"]) <= MAX_CHAINS:
        raise RulesetError(f"chains must have 2 to {MAX_CHAINS} entries")
    chains = []
    for i, c in enumerate(d["chains"]):
        where = f"chains[{i}]"
        c = _keys(c, ("id", "name", "tier", "color", "abbreviation"), where)
        cid = _ident(c["id"], f"{where}.id")
        name = _str(c["name"], f"{where}.name", 40)
        if c["tier"] not in tier_ids:
            raise RulesetError(
                f"{where}.tier {c['tier']!r} is not a defined tier {tier_ids}"
            )
        if not isinstance(c["color"], str) or not _COLOR_RE.match(c["color"]):
            raise RulesetError(f"{where}.color must be '#RRGGBB', got {c['color']!r}")
        if not isinstance(c["abbreviation"], str) or not _ABBR_RE.match(
            c["abbreviation"]
        ):
            raise RulesetError(
                f"{where}.abbreviation must be 1-3 letters/digits, "
                f"got {c['abbreviation']!r}"
            )
        chains.append(ChainSpec(cid, name, c["tier"], c["color"], c["abbreviation"]))
    for attr in ("id", "name", "abbreviation"):
        vals = [getattr(c, attr) for c in chains]
        if len(set(vals)) != len(vals):
            raise RulesetError(f"chain {attr}s must be unique: {vals}")
    colors = [c.color.upper() for c in chains]
    if len(set(colors)) != len(colors):
        raise RulesetError(f"chain colors must be unique: {colors}")

    bo = _keys(
        d["bonuses"],
        ("majority_multiplier", "minority_multiplier", "tie_round_up_to"),
        "bonuses",
    )
    bonuses = BonusSpec(
        majority_multiplier=_int(
            bo["majority_multiplier"], "bonuses.majority_multiplier", 0
        ),
        minority_multiplier=_int(
            bo["minority_multiplier"], "bonuses.minority_multiplier", 0
        ),
        tie_round_up_to=_int(bo["tie_round_up_to"], "bonuses.tie_round_up_to", 1),
    )

    stocks = _int(d["stocks_per_chain"], "stocks_per_chain", 1, 1000)
    scalars = {
        "stocks_per_chain": stocks,
        "starting_cash": _int(d["starting_cash"], "starting_cash", 0),
        "hand_size": _int(d["hand_size"], "hand_size", 1, 50),
        "max_stock_purchases_per_turn": _int(
            d["max_stock_purchases_per_turn"], "max_stock_purchases_per_turn", 0, 100
        ),
        "safe_chain_size": _int(
            d["safe_chain_size"], "safe_chain_size", MIN_CHAIN_SIZE + 1, area
        ),
        "end_game_chain_size": _int(
            d["end_game_chain_size"], "end_game_chain_size", MIN_CHAIN_SIZE + 1, area
        ),
        "founder_bonus_shares": _int(
            d["founder_bonus_shares"], "founder_bonus_shares", 1, stocks
        ),
        "merger_trade_ratio": _int(
            d["merger_trade_ratio"], "merger_trade_ratio", 1, 10
        ),
        "min_players": _int(d["min_players"], "min_players", 2, 26),
        "max_players": _int(d["max_players"], "max_players", 2, 26),
        "max_pending_trades_per_player": _int(
            d["max_pending_trades_per_player"], "max_pending_trades_per_player", 0, 100
        ),
    }
    if scalars["min_players"] > scalars["max_players"]:
        raise RulesetError("min_players must be <= max_players")
    needed = scalars["max_players"] * scalars["hand_size"]
    if area < needed:
        raise RulesetError(
            f"board has {area} tiles but {scalars['max_players']} players x "
            f"hand_size {scalars['hand_size']} needs {needed}"
        )
    return Ruleset(
        id=rid,
        version=version,
        title=title,
        theme=theme,
        board=board,
        tiers=tuple(tiers),
        chains=tuple(chains),
        bonuses=bonuses,
        **scalars,
    )


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def ruleset_path(name_or_path: str) -> Path:
    """``default`` -> backend/rulesets/default.json; anything path-like as is."""
    s = str(name_or_path).strip()
    if "/" in s or "\\" in s or s.endswith(".json"):
        return Path(s)
    if not _ID_RE.match(s):
        raise RulesetError(f"Bad ruleset name {s!r}")
    return RULESETS_DIR / f"{s}.json"


@lru_cache(maxsize=32)
def load_ruleset(name_or_path: str = DEFAULT_RULESET) -> Ruleset:
    """Load (and cache) a ruleset by name in ``backend/rulesets`` or by path."""
    return Ruleset.from_file(ruleset_path(name_or_path))


def available_rulesets() -> list[str]:
    return sorted(p.stem for p in RULESETS_DIR.glob("*.json"))


def default_ruleset() -> Ruleset:
    """The built-in default ruleset (today's game)."""
    return load_ruleset(DEFAULT_RULESET)


def resolve(ruleset: Ruleset | None) -> Ruleset:
    """``ruleset`` or the built-in default when None."""
    return ruleset if ruleset is not None else default_ruleset()


def ruleset_from_state(state: dict | None) -> Ruleset:
    """The ruleset carried by a public / player game state (``state["ruleset"]``,
    see ``Game.get_public_state``); default when absent or unreadable."""
    data = (state or {}).get("ruleset")
    if isinstance(data, dict):
        try:
            return Ruleset.from_public(data)
        except RulesetError:
            pass
    return default_ruleset()


__all__ = [
    "BoardSpec",
    "BonusSpec",
    "ChainSpec",
    "Ruleset",
    "RulesetError",
    "ThemeSpec",
    "TierSpec",
    "available_rulesets",
    "default_ruleset",
    "load_ruleset",
    "resolve",
    "ruleset_from_state",
    "ruleset_path",
]
