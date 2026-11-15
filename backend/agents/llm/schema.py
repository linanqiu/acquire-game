"""Answer schema and structural validation for LLM seats.

The model answers ``{"why": str, "action": {...}, "note": str}``. The schema is
built per decision and narrowed to the legal ``action_types`` (enums for tiles
and chains, bounded integer enums for share counts). Structured-output engines
cannot express open-ended maps, so map-valued fields (``purchases``, the stock
dicts of ``propose_trade``) list one integer property per chain; zero entries
are dropped by ``normalize_action`` so the action matches the wire format of
``docs/architecture/seat-contract.md`` exactly.

``check_against_legal`` is a pure structural validator used for the repair
step. It is not a substitute for the engine's ``validate_action`` (which the
server's driver still runs); it exists so most illegal answers are repaired
here, with a precise error message, before the driver ever sees them.

Chain enums come from the game's ruleset: pass ``chains=`` (and
``max_shares=``) built from ``ruleset_from_state(ctx.state)``; without them the
default ruleset's chains are used (``CHAINS`` below). The trade step of a
disposition comes from the legal options (``trade_ratio``, 2 when absent).
"""

from __future__ import annotations

import json
from typing import Any

from game.ruleset import default_ruleset

# Default aliases (defaults when the caller does not pass the game's ruleset).
CHAINS: tuple[str, ...] = tuple(default_ruleset().chain_ids)
MAX_SHARES: int = default_ruleset().stocks_per_chain

NOTE_MAX_CHARS = 300

# Stable order of variants in the schema (also the order the "fake LLM" tries).
ACTION_ORDER = (
    "place_tile",
    "found_chain",
    "merger_choice",
    "merger_disposition",
    "buy_stocks",
    "end_turn",
    "accept_trade",
    "reject_trade",
    "declare_end_game",
    "propose_trade",
)


def _obj(properties: dict, required: list[str] | None = None) -> dict:
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties) if required is None else required,
        "additionalProperties": False,
    }


def _enum_str(values: list[str]) -> dict:
    return {"type": "string", "enum": list(values)}


def _int_enum(values: list[int]) -> dict:
    return {"type": "integer", "enum": list(values)}


def legal_tiles(legal: dict) -> list[str]:
    out = []
    for t in legal.get("tiles", []) or []:
        out.append(t["tile"] if isinstance(t, dict) else str(t))
    return out


def _trade_step(legal: dict) -> int:
    step = legal.get("trade_ratio", 2)
    return step if isinstance(step, int) and step > 0 else 2


def _action_variant(
    action_type: str,
    legal: dict,
    other_player_ids: tuple[str, ...],
    chains: tuple[str, ...] = CHAINS,
    max_shares: int = MAX_SHARES,
) -> dict | None:
    head: dict[str, Any] = {"action": _enum_str([action_type])}
    if action_type == "place_tile":
        tiles = legal_tiles(legal)
        if not tiles:
            return None
        return _obj({**head, "tile": _enum_str(tiles)})
    if action_type == "found_chain":
        chains = list(legal.get("chains", []))
        if not chains:
            return None
        return _obj({**head, "chain": _enum_str(chains)})
    if action_type == "merger_choice":
        chains = list(legal.get("chains", []))
        if not chains:
            return None
        return _obj({**head, "surviving_chain": _enum_str(chains)})
    if action_type == "merger_disposition":
        n = int(legal.get("stock_count", 0))
        max_trade = int(legal.get("max_trade", 0))
        return _obj(
            {
                **head,
                "defunct_chain": _enum_str([legal.get("defunct_chain", "")]),
                "disposition": _obj(
                    {
                        "sell": _int_enum(list(range(n + 1))),
                        "trade": _int_enum(
                            list(range(0, min(max_trade, n) + 1, _trade_step(legal)))
                        ),
                        # Enum order is irrelevant to validity; listing "hold all" first
                        # makes the schema's first instance (sell 0, trade 0, hold n)
                        # a legal answer, which the offline fake seat relies on.
                        "hold": _int_enum([n, *range(n)]),
                    }
                ),
            }
        )
    if action_type == "buy_stocks":
        max_total = int(
            legal.get("max_total", default_ruleset().max_stock_purchases_per_turn)
        )
        props = {}
        for opt in legal.get("options", []) or []:
            cap = min(max_total, int(opt.get("max_affordable", 0)))
            if cap > 0:
                props[opt["chain"]] = _int_enum(list(range(cap + 1)))
        return _obj({**head, "purchases": _obj(props)})
    if action_type in ("accept_trade", "reject_trade"):
        if action_type == "accept_trade" and legal.get("can_accept") is False:
            return None
        trade_id = (legal.get("trade") or {}).get("trade_id")
        if not trade_id:
            return None
        return _obj({**head, "trade_id": _enum_str([trade_id])})
    if action_type == "propose_trade":
        if not other_player_ids:
            return None
        stock_map = _obj(
            {
                c: {"type": "integer", "enum": list(range(max_shares + 1))}
                for c in chains
            }
        )
        return _obj(
            {
                **head,
                "to_player_id": _enum_str(list(other_player_ids)),
                "offering_stocks": stock_map,
                "offering_money": {"type": "integer"},
                "requesting_stocks": stock_map,
                "requesting_money": {"type": "integer"},
            }
        )
    if action_type in ("end_turn", "declare_end_game"):
        return _obj(head)
    return None


def build_schema(
    legal: dict,
    *,
    other_player_ids: tuple[str, ...] | list[str] = (),
    chains: tuple[str, ...] | list[str] | None = None,
    max_shares: int | None = None,
) -> dict:
    """JSON schema of the answer, narrowed to ``legal``.

    ``chains`` / ``max_shares``: the game's chain ids and shares per chain
    (default: the default ruleset).
    """
    chain_ids = tuple(chains) if chains is not None else CHAINS
    cap = max_shares if max_shares is not None else MAX_SHARES
    types = list(legal.get("action_types", []))
    ordered = [t for t in ACTION_ORDER if t in types] + [
        t for t in types if t not in ACTION_ORDER
    ]
    variants = []
    for t in ordered:
        v = _action_variant(t, legal, tuple(other_player_ids), chain_ids, cap)
        if v is not None:
            variants.append(v)
    if not variants:
        raise ValueError(
            f"no answerable action in legal set: {json.dumps(legal)[:200]}"
        )
    action = variants[0] if len(variants) == 1 else {"anyOf": variants}
    return _obj(
        {
            # "why" first so the model commits to a reason before the action.
            "why": {"type": "string"},
            "action": action,
            "note": {"type": "string"},
        }
    )


# ---------------------------------------------------------------------------
# Answer parsing / normalisation
# ---------------------------------------------------------------------------

_ACTION_KEYS: dict[str, tuple[str, ...]] = {
    "place_tile": ("tile",),
    "found_chain": ("chain",),
    "merger_choice": ("surviving_chain",),
    "merger_disposition": ("defunct_chain", "disposition"),
    "buy_stocks": ("purchases",),
    "end_turn": (),
    "declare_end_game": (),
    "accept_trade": ("trade_id",),
    "reject_trade": ("trade_id",),
    "cancel_trade": ("trade_id",),
    "propose_trade": (
        "to_player_id",
        "offering_stocks",
        "offering_money",
        "requesting_stocks",
        "requesting_money",
    ),
}


def _drop_zero(d: Any) -> Any:
    if isinstance(d, dict):
        return {k: v for k, v in d.items() if not (isinstance(v, int) and v == 0)}
    return d


def normalize_action(action: dict) -> dict:
    """Keep only wire-format keys for the action type and drop zero entries
    from stock maps. Unknown action types are returned unchanged."""
    t = action.get("action")
    keys = _ACTION_KEYS.get(t)
    if keys is None:
        return dict(action)
    out: dict[str, Any] = {"action": t}
    for k in keys:
        if k in action:
            out[k] = action[k]
    if t == "buy_stocks":
        out["purchases"] = _drop_zero(out.get("purchases", {}))
        out.setdefault("purchases", {})
    if t == "propose_trade":
        for k in ("offering_stocks", "requesting_stocks"):
            out[k] = _drop_zero(out.get(k, {}))
        for k in ("offering_money", "requesting_money"):
            out.setdefault(k, 0)
    return out


def parse_answer(data: dict) -> tuple[dict | None, str, str]:
    """Split a model answer into ``(action | None, note, why)``.

    Tolerates a model that returned the bare action object instead of the
    envelope, and an ``action`` given as a JSON string.
    """
    if not isinstance(data, dict):
        return None, "", ""
    action = data.get("action")
    if isinstance(action, str) and action.lstrip().startswith("{"):
        try:
            action = json.loads(action)
        except ValueError:
            action = None
    elif isinstance(action, str):
        # bare action object: {"action": "place_tile", "tile": "5C"}
        action = {k: v for k, v in data.items() if k not in ("note", "why")}
    if not isinstance(action, dict):
        return None, "", ""
    note = data.get("note")
    why = data.get("why")
    return (
        normalize_action(action),
        note.strip()[:NOTE_MAX_CHARS] if isinstance(note, str) else "",
        why.strip() if isinstance(why, str) else "",
    )


# ---------------------------------------------------------------------------
# Structural validation against the legal set
# ---------------------------------------------------------------------------


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _check_stock_map(name: str, m: Any, chains: tuple[str, ...]) -> str | None:
    if not isinstance(m, dict):
        return f"{name} must be an object mapping chain name to a positive integer"
    for chain, qty in m.items():
        if chain not in chains:
            return f"{name} has unknown chain {chain!r} (chains: {', '.join(chains)})"
        if not _is_int(qty) or qty < 0:
            return f"{name}[{chain}] must be a non-negative integer"
    return None


def _view_chains(view: dict | None) -> tuple[str, ...] | None:
    """Chain ids named in a trade view's share maps (the calculator lists every
    chain of the game's ruleset for every player)."""
    seen: dict[str, None] = {}
    for p in ((view or {}).get("players") or {}).values():
        shares = p.get("shares") if isinstance(p, dict) else None
        if isinstance(shares, dict):
            seen.update(dict.fromkeys(shares))
    return tuple(seen) or None


def check_against_legal(
    action: Any,
    legal: dict,
    *,
    view: dict | None = None,
    chains: tuple[str, ...] | list[str] | None = None,
) -> str | None:
    """Return an error message if ``action`` is not a legal answer, else None.

    ``view`` (optional) enables affordability checks for ``propose_trade``::

        {"self_id": "p1",
         "players": {"p1": {"cash": 4200, "shares": {"<chain id>": 3, ...}}, ...}}

    ``chains``: the game's chain ids (default: taken from ``view``'s share
    maps, else the default chains).
    """
    if not isinstance(action, dict):
        return "action must be a JSON object"
    t = action.get("action")
    allowed = list(legal.get("action_types", []))
    if t not in allowed:
        return f"action {t!r} is not allowed here; allowed action types: {allowed}"

    if t == "place_tile":
        tiles = legal_tiles(legal)
        if action.get("tile") not in tiles:
            return (
                f"tile {action.get('tile')!r} is not playable; playable tiles: {tiles}"
            )
        return None

    if t == "found_chain":
        chains = legal.get("chains", [])
        if action.get("chain") not in chains:
            return (
                f"chain {action.get('chain')!r} cannot be founded; choose from {chains}"
            )
        return None

    if t == "merger_choice":
        chains = legal.get("chains", [])
        if action.get("surviving_chain") not in chains:
            return (
                f"surviving_chain {action.get('surviving_chain')!r} is not one of the "
                f"tied chains {chains}"
            )
        return None

    if t == "merger_disposition":
        if action.get("defunct_chain") != legal.get("defunct_chain"):
            return (
                f"defunct_chain must be {legal.get('defunct_chain')!r}, "
                f"got {action.get('defunct_chain')!r}"
            )
        d = action.get("disposition")
        if not isinstance(d, dict):
            return "disposition must be an object with integer sell, trade, hold"
        vals = {}
        for k in ("sell", "trade", "hold"):
            v = d.get(k, 0)
            if not _is_int(v) or v < 0:
                return f"disposition.{k} must be a non-negative integer"
            vals[k] = v
        extra = set(d) - {"sell", "trade", "hold"}
        if extra:
            return f"disposition has unknown keys {sorted(extra)}"
        n = legal.get("stock_count")
        if sum(vals.values()) != n:
            return (
                f"sell + trade + hold must equal {n} (the number of "
                f"{legal.get('defunct_chain')} shares you hold), got "
                f"{vals['sell']} + {vals['trade']} + {vals['hold']} = {sum(vals.values())}"
            )
        step = _trade_step(legal)
        if vals["trade"] % step:
            if step == 2:
                return f"trade must be an even number (2 defunct shares per survivor share), got {vals['trade']}"
            return f"trade must be a multiple of {step} ({step} defunct shares per survivor share), got {vals['trade']}"
        mt = legal.get("max_trade", 0)
        if vals["trade"] > mt:
            return f"trade {vals['trade']} exceeds the maximum allowed {mt}"
        return None

    if t == "buy_stocks":
        p = action.get("purchases")
        if not isinstance(p, dict):
            return "purchases must be an object mapping chain name to count ({} buys nothing)"
        options = {o["chain"]: o for o in legal.get("options", []) or []}
        total = 0
        cost = 0
        for chain, qty in p.items():
            if not _is_int(qty) or qty < 0:
                return f"purchases[{chain}] must be a non-negative integer"
            if qty == 0:
                continue
            if chain not in options:
                return f"cannot buy {chain!r}: not buyable now (buyable: {sorted(options)})"
            o = options[chain]
            if qty > o.get("available", 0):
                return f"only {o.get('available')} {chain} shares are available, asked {qty}"
            if qty > o.get("max_affordable", 0):
                return (
                    f"you can buy at most {o.get('max_affordable')} {chain} "
                    f"(cash/availability/limit), asked {qty}"
                )
            total += qty
            cost += qty * o.get("price", 0)
        max_total = legal.get(
            "max_total", default_ruleset().max_stock_purchases_per_turn
        )
        if total > max_total:
            return f"at most {max_total} shares per turn in total, asked {total}"
        money = legal.get("money")
        if money is not None and cost > money:
            return f"purchases cost ${cost} but you only have ${money}"
        return None

    if t in ("accept_trade", "reject_trade"):
        tid = (legal.get("trade") or {}).get("trade_id")
        if action.get("trade_id") != tid:
            return f"trade_id must be {tid!r}, got {action.get('trade_id')!r}"
        if t == "accept_trade" and legal.get("can_accept") is False:
            return "you cannot accept this trade (insufficient holdings); reject it"
        return None

    if t == "propose_trade":
        known = tuple(chains) if chains is not None else (_view_chains(view) or CHAINS)
        return _check_propose(action, view, known)

    # end_turn / declare_end_game: allowed by action_types, nothing else to check.
    return None


def _check_propose(
    action: dict, view: dict | None, chains: tuple[str, ...] = CHAINS
) -> str | None:
    to = action.get("to_player_id")
    if not isinstance(to, str) or not to:
        return "propose_trade needs to_player_id (a player id string)"
    for k in ("offering_stocks", "requesting_stocks"):
        err = _check_stock_map(k, action.get(k, {}), chains)
        if err:
            return err
    for k in ("offering_money", "requesting_money"):
        v = action.get(k, 0)
        if not _is_int(v) or v < 0:
            return f"{k} must be a non-negative integer"
    give = sum(action.get("offering_stocks", {}).values()) + action.get(
        "offering_money", 0
    )
    get = sum(action.get("requesting_stocks", {}).values()) + action.get(
        "requesting_money", 0
    )
    if give == 0 and get == 0:
        return "a trade must exchange at least one share or some money"
    if view:
        me = view.get("self_id")
        players = view.get("players", {})
        if to == me:
            return "you cannot trade with yourself"
        if to not in players:
            return f"unknown player {to!r}; players: {sorted(p for p in players if p != me)}"
        mine, theirs = players.get(me, {}), players[to]
        for who, holder, stocks, money in (
            (
                "you",
                mine,
                action.get("offering_stocks", {}),
                action.get("offering_money", 0),
            ),
            (
                to,
                theirs,
                action.get("requesting_stocks", {}),
                action.get("requesting_money", 0),
            ),
        ):
            if holder.get("cash") is not None and money > holder["cash"]:
                return f"{who} only has ${holder['cash']}, trade needs ${money}"
            for chain, qty in stocks.items():
                if qty > holder.get("shares", {}).get(chain, 0):
                    return f"{who} holds only {holder.get('shares', {}).get(chain, 0)} {chain} shares, trade needs {qty}"
    return None
