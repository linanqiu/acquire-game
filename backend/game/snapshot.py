"""Complete, JSON-safe snapshots of a Game and restoration from them.

``to_snapshot(game)`` captures every piece of mutable engine state (board,
hotel, players, tile bag order, RNG state, merger state, pending action,
pending trades, bots, events...). ``from_snapshot(data)`` rebuilds a Game that
behaves identically to the original under any subsequent action sequence.

The snapshot is plain JSON data: ``json.loads(json.dumps(snap)) == snap``.

Drift protection: ``HANDLED_GAME_ATTRS`` lists every instance attribute of
``Game`` this module knows about. ``tests/test_snapshot.py`` fails if
``vars(Game())`` contains anything else, so new engine state cannot silently
go missing from snapshots.
"""

import random
from typing import Any

from game.action import TradeOffer
from game.board import BoardCell, Tile, TileState
from game.bot import Bot
from game.game import Game, GamePhase, MergerState
from game.hotel import Hotel
from game.player import Player

SNAPSHOT_VERSION = 1

# Game instance attributes that are serialised (directly or via a sub-object).
HANDLED_GAME_ATTRS = frozenset(
    {
        "seed",
        "_tile_order",
        "rng",
        "board",
        "hotel",
        "players",
        "bots",
        "tile_bag",
        "current_player_index",
        "phase",
        "pending_action",
        "_merger",
        "pending_trades",
        "events",
        "stocks_bought_this_turn",
    }
)

# Attributes of the sub-objects, for drift tests.
HANDLED_PLAYER_ATTRS = frozenset({"player_id", "name", "_money", "_hand", "_stocks"})
HANDLED_BOT_ATTRS = frozenset({"player", "difficulty", "rng"})
HANDLED_HOTEL_ATTRS = frozenset({"_available_stocks", "_active_chains"})
HANDLED_BOARD_ATTRS = frozenset({"_grid"})
HANDLED_MERGER_FIELDS = frozenset(
    {
        "chains",
        "survivor",
        "defunct_queue",
        "current_defunct",
        "stock_players",
        "stock_index",
        "tile",
    }
)

_TILE_KEY = "__tile__"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _tile_from_str(s: Any) -> Tile:
    _require(isinstance(s, str), f"Bad tile {s!r}")
    try:
        tile = Tile.from_string(s)
    except (ValueError, IndexError) as e:
        raise ValueError(f"Bad tile {s!r}") from e
    if str(tile) != s:
        raise ValueError(f"Non-canonical tile {s!r}")
    return tile


def _encode(value: Any) -> Any:
    """Encode a pending_action-style value (Tiles become tagged dicts)."""
    if isinstance(value, Tile):
        return {_TILE_KEY: str(value)}
    if isinstance(value, dict):
        for k in value:
            if not isinstance(k, str):
                raise TypeError(f"Non-string key {k!r} cannot be snapshotted")
        return {k: _encode(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        if isinstance(value, tuple):
            raise TypeError("tuples cannot be snapshotted losslessly")
        return [_encode(v) for v in value]
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    raise TypeError(f"Cannot snapshot value of type {type(value).__name__}")


def _decode(value: Any) -> Any:
    if isinstance(value, dict):
        if set(value) == {_TILE_KEY}:
            return _tile_from_str(value[_TILE_KEY])
        return {k: _decode(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_decode(v) for v in value]
    return value


def _rng_to_json(rng: random.Random) -> list:
    version, internal, gauss = rng.getstate()
    return [version, list(internal), gauss]


def _rng_from_json(data: Any, rng: random.Random) -> None:
    try:
        version, internal, gauss = data
        rng.setstate((version, tuple(internal), gauss))
    except (TypeError, ValueError) as e:
        raise ValueError(f"Bad rng state: {e}") from e


def _require(cond: bool, msg: str) -> None:
    if not cond:
        raise ValueError(msg)


def _check_chain(name: Any) -> str:
    _require(isinstance(name, str) and name in Hotel.CHAINS, f"Unknown chain {name!r}")
    return name


def _check_int(value: Any, what: str) -> int:
    _require(isinstance(value, int) and not isinstance(value, bool), f"Bad {what}")
    return value


# ---------------------------------------------------------------------------
# to_snapshot
# ---------------------------------------------------------------------------


def _merger_to_dict(m: MergerState) -> dict:
    return {
        "chains": list(m.chains),
        "survivor": m.survivor,
        "defunct_queue": list(m.defunct_queue),
        "current_defunct": m.current_defunct,
        "stock_players": list(m.stock_players),
        "stock_index": m.stock_index,
        "tile": str(m.tile) if m.tile is not None else None,
    }


def to_snapshot(game: Game) -> dict:
    """Serialise ``game`` to a JSON-safe dict (see module docstring)."""
    cells = {}
    for (col, row), cell in game.board._grid.items():
        if cell.state != TileState.EMPTY:
            cells[f"{col}{row}"] = {"state": cell.state.value, "chain": cell.chain}

    bots = {}
    for pid, bot in game.bots.items():
        entry: dict = {"difficulty": bot.difficulty, "rng_shared": bot.rng is game.rng}
        if not entry["rng_shared"]:
            entry["rng_state"] = _rng_to_json(bot.rng)
        bots[pid] = entry

    snap: dict = {
        "version": SNAPSHOT_VERSION,
        "seed": game.seed,
        "tile_order": list(game._tile_order) if game._tile_order is not None else None,
        "rng_state": _rng_to_json(game.rng),
        "phase": game.phase.value,
        "current_player_index": game.current_player_index,
        "board": {"cells": cells},
        "hotel": {
            "available_stocks": dict(game.hotel._available_stocks),
            "active_chains": sorted(game.hotel._active_chains),
        },
        "players": [
            {
                "player_id": p.player_id,
                "name": p.name,
                "money": p._money,
                "hand": [str(t) for t in p._hand],
                "stocks": dict(p._stocks),
            }
            for p in game.players
        ],
        "bots": bots,
        "tile_bag": [str(t) for t in game.tile_bag],
        "pending_action": _encode(game.pending_action),
        "merger": _merger_to_dict(game._merger),
        "pending_trades": [
            {"key": key, "trade": trade.to_dict()}
            for key, trade in game.pending_trades.items()
        ],
    }
    snap["events"] = _copy_json(game.events)
    snap["stocks_bought_this_turn"] = bool(game.stocks_bought_this_turn)
    return snap


def _copy_json(value: Any) -> Any:
    """Deep copy of plain JSON data (so snapshots don't alias the game)."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        return {k: _copy_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_copy_json(v) for v in value]
    raise TypeError(f"Non-JSON value {type(value).__name__} in snapshot data")


# ---------------------------------------------------------------------------
# from_snapshot
# ---------------------------------------------------------------------------


def from_snapshot(data: dict) -> Game:
    """Rebuild a Game from ``to_snapshot`` output.

    Raises:
        ValueError: on a wrong version or malformed data.
    """
    _require(isinstance(data, dict), "Snapshot must be a dict")
    _require(
        data.get("version") == SNAPSHOT_VERSION,
        f"Unsupported snapshot version {data.get('version')!r}",
    )
    try:
        return _build(data)
    except ValueError:
        raise
    except (KeyError, TypeError, AttributeError, IndexError) as e:
        raise ValueError(f"Malformed snapshot: {type(e).__name__}: {e}") from e


def _build(data: dict) -> Game:
    seed = data["seed"]
    _require(seed is None or isinstance(seed, int), "Bad seed")
    tile_order = data["tile_order"]
    if tile_order is not None:
        _require(isinstance(tile_order, list), "Bad tile_order")
        for s in tile_order:
            _tile_from_str(s)
        tile_order = list(tile_order)

    game = Game(seed=seed, tile_order=tile_order)
    _rng_from_json(data["rng_state"], game.rng)

    try:
        game.phase = GamePhase(data["phase"])
    except ValueError as e:
        raise ValueError(f"Unknown phase {data['phase']!r}") from e

    # Board
    cells = data["board"]["cells"]
    _require(isinstance(cells, dict), "Bad board cells")
    for key, cell in cells.items():
        tile = _tile_from_str(key)
        try:
            state = TileState(cell["state"])
        except ValueError as e:
            raise ValueError(f"Bad cell state {cell['state']!r}") from e
        _require(state != TileState.EMPTY, "Empty cell must not be serialised")
        chain = cell["chain"]
        if chain is not None:
            _check_chain(chain)
        game.board._grid[tile.coords] = BoardCell(state=state, chain=chain)

    # Hotel
    available = data["hotel"]["available_stocks"]
    _require(
        isinstance(available, dict) and set(available) == set(Hotel.CHAINS),
        "Bad hotel available_stocks",
    )
    for name, n in available.items():
        _check_int(n, f"available stocks for {name}")
    active = data["hotel"]["active_chains"]
    _require(isinstance(active, list), "Bad active_chains")
    for name in active:
        _check_chain(name)
    game.hotel._available_stocks = dict(available)
    game.hotel._active_chains = set(active)

    # Players (written directly; add_player is lobby-only)
    players = data["players"]
    _require(isinstance(players, list), "Bad players")
    seen_ids = set()
    for p in players:
        pid = p["player_id"]
        _require(isinstance(pid, str) and pid not in seen_ids, f"Bad player id {pid!r}")
        seen_ids.add(pid)
        _require(isinstance(p["name"], str), "Bad player name")
        player = Player(pid, p["name"])
        player._money = _check_int(p["money"], "money")
        stocks = p["stocks"]
        _require(
            isinstance(stocks, dict) and set(stocks) == set(Hotel.CHAINS),
            "Bad player stocks",
        )
        player._stocks = {c: _check_int(n, "stock count") for c, n in stocks.items()}
        _require(isinstance(p["hand"], list), "Bad hand")
        player._hand = [_tile_from_str(s) for s in p["hand"]]
        game.players.append(player)

    idx = _check_int(data["current_player_index"], "current_player_index")
    _require(0 <= idx < max(len(players), 1), "current_player_index out of range")
    game.current_player_index = idx

    # Bots: recreate exactly as Game.add_player(..., is_bot=True) does.
    bots = data["bots"]
    _require(isinstance(bots, dict), "Bad bots")
    for pid, entry in bots.items():
        player = game.get_player(pid)
        _require(player is not None, f"Bot for unknown player {pid!r}")
        difficulty = entry["difficulty"]
        if entry["rng_shared"]:
            game.bots[pid] = Bot(player, difficulty, rng=game.rng)
        else:
            rng = random.Random()
            _rng_from_json(entry["rng_state"], rng)
            game.bots[pid] = Bot(player, difficulty, rng=rng)

    # Tile bag
    _require(isinstance(data["tile_bag"], list), "Bad tile_bag")
    game.tile_bag = [_tile_from_str(s) for s in data["tile_bag"]]

    # Pending action
    pending = _decode(data["pending_action"])
    _require(pending is None or isinstance(pending, dict), "Bad pending_action")
    game.pending_action = pending

    # Merger
    m = data["merger"]
    merger = game._merger
    merger.chains = [_check_chain(c) for c in m["chains"]]
    merger.survivor = None if m["survivor"] is None else _check_chain(m["survivor"])
    merger.defunct_queue = [_check_chain(c) for c in m["defunct_queue"]]
    merger.current_defunct = (
        None if m["current_defunct"] is None else _check_chain(m["current_defunct"])
    )
    _require(isinstance(m["stock_players"], list), "Bad merger stock_players")
    merger.stock_players = list(m["stock_players"])
    merger.stock_index = _check_int(m["stock_index"], "stock_index")
    merger.tile = None if m["tile"] is None else _tile_from_str(m["tile"])

    # Trades
    _require(isinstance(data["pending_trades"], list), "Bad pending_trades")
    for item in data["pending_trades"]:
        trade = TradeOffer.from_dict(item["trade"])
        game.pending_trades[item["key"]] = trade

    # Event log and per-turn buy flag
    events = data["events"]
    _require(
        isinstance(events, list) and all(isinstance(e, dict) for e in events),
        "Bad events",
    )
    game.events = _copy_json(events)
    flag = data["stocks_bought_this_turn"]
    _require(isinstance(flag, bool), "Bad stocks_bought_this_turn")
    game.stocks_bought_this_turn = flag

    return game


__all__ = [
    "HANDLED_GAME_ATTRS",
    "SNAPSHOT_VERSION",
    "from_snapshot",
    "to_snapshot",
]
