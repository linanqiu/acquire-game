"""Computed facts about a deal under discussion, for the table-talk prompt.

A talk call answers prose ("if I give you SP you can get ahead of lil John").
Left alone, a model has to work out the direction and the value of such a
proposal itself and gets it backwards. ``deal_facts`` gives it the numbers,
only when the trigger needs them (cost, docs/ai/table-talk.md):

* the trigger is a chat message from another player that mentions a chain
  (by name, or by its board abbreviation in capitals: "SP") or a deal word
  ("trade", "give", "swap", ...); or
* an offer between the seat and that player is open, or was answered in the
  last few events ("no but that gives you majority").

For each relevant chain it shows what moving 1, 2 or 3 shares between the
seat and the speaker would do to both bonus positions, in both directions,
using ``game.trade_value.trade_valuation`` on one-sided hypothetical trades
(no rule is re-implemented here). Open offers between the two are shown the
right way round: what the seat gives, what it gets, and the net value.

Everything is built from public information (holdings, cash, chain sizes).
"""

from __future__ import annotations

import re
from typing import Any

from game.calculator import _standing
from game.tile_value import _bonus
from game.trade_value import trade_valuation

MAX_SHARES = 3
MAX_CHAINS = 3
# How far back (events) an answered offer between the two still counts as
# "that" in a message: only right after it, so later small talk stays cheap.
RECENT_EVENTS = 6
ANSWERED = {"trade_accepted", "trade_rejected", "trade_cancelled"}
DEAL_WORDS = re.compile(
    r"\b(trade|trades|trading|deal|swap|offer|offers|give|giving|sell|selling|"
    r"buy|share|shares|stock|stocks|majority|minority|exchange|propose)\b",
    re.IGNORECASE,
)
# A pact about holdings rather than a swap: "truce at 4 on HA", "let's tie
# Halcyon and split the bonus", "I'll merge it for us".
PACT_WORDS = re.compile(
    r"\b(truce|tie|tied|split|splitting|pact|alliance|ally|agree|agreed|"
    r"ceasefire|cease|freeze|cap|capped|level|even|both|stop buying|"
    r"merge it|merge them|merging it|share the bonus|share it)\b",
    re.IGNORECASE,
)
_NUMBER = re.compile(r"(?<![\w$])(\d{1,2})(?![\w%])")
# Narrower: talk about an actual offer (the decision prompt's follow-up block).
OFFER_WORDS = re.compile(
    r"\b(trade|trades|trading|deal|swap|offer|offers|propose|proposal|give|"
    r"giving|sell|exchange)\b",
    re.IGNORECASE,
)


def mentioned_chains(game, text: str) -> list[str]:
    """Chains a message names: the chain id or its display name (any case),
    or the board abbreviation written in capitals ("SP", not "me")."""
    out = []
    low = text.lower()
    for c in game.ruleset.chains:
        names = {c.id.lower(), str(getattr(c, "name", c.id)).lower()}
        hit = any(
            re.search(r"(?<![\w])" + re.escape(n) + r"(?![\w])", low) for n in names
        )
        abbr = getattr(c, "abbreviation", "")
        if not hit and len(abbr) >= 2:
            hit = re.search(r"(?<![\w])" + re.escape(abbr) + r"(?![\w])", text)
        if hit:
            out.append(c.id)
    return out


def _gift(frm: str, to: str, chain: str, n: int) -> dict:
    return {
        "from_player_id": frm,
        "to_player_id": to,
        "offering_stocks": {chain: n},
        "offering_money": 0,
        "requesting_stocks": {},
        "requesting_money": 0,
        "trade_id": "talk-facts",
    }


def share_moves(game, me: str, other: str, chain: str) -> dict:
    """What moving 1..MAX_SHARES shares of ``chain`` between ``me`` and
    ``other`` would do, both ways (``receive``: other gives them to me;
    ``give``: I give them to other). Each move: ``{n, me: (before, after),
    other: (before, after), my_bonus: change in my bonus if the chain were
    acquired now}``; a move the giver cannot make is left out."""
    holdings = {p.player_id: p.get_stock_count(chain) for p in game.players}
    base_me, base_other = _standing(holdings, me), _standing(holdings, other)
    out: dict[str, Any] = {
        "chain": chain,
        "holdings": holdings,
        "bank": game.hotel.get_available_stocks(chain),
        "receive": [],
        "give": [],
    }
    for way, frm, to in (("receive", other, me), ("give", me, other)):
        for n in range(1, MAX_SHARES + 1):
            if holdings.get(frm, 0) < n:
                break
            v = trade_valuation(game, _gift(frm, to, chain, n), me)
            if not v.get("valid"):
                break
            after = {(r["player_id"]): r["after"] for r in v.get("rank_changes") or []}
            counts = dict(holdings)
            counts[to] += n
            counts[frm] -= n
            rival = max(
                (pid for pid in counts if pid != me),
                key=lambda pid: counts[pid],
                default=None,
            )
            out[way].append(
                {
                    "n": n,
                    "me": (base_me, after.get(me, base_me)),
                    "other": (base_other, after.get(other, base_other)),
                    "my_bonus": v["viewer"]["bonus_change_now"],
                    # shares at their value + weighted bonus change, as
                    # trade_valuation counts a position (no cash moves)
                    "value": v["viewer"]["change"],
                    "my_shares": counts[me],
                    "top_rival": (rival, counts.get(rival, 0)),
                }
            )
    return out


def pact_facts(game, me: str, other: str, chain: str, text: str) -> dict | None:
    """A truce on ``chain`` (both players hold the same number of shares and
    stop buying): what it pays each of them if the chain were acquired now,
    against what they would get now. The level is the number in the message
    (1-25), else the higher of the two holdings."""
    holdings = {p.player_id: p.get_stock_count(chain) for p in game.players}
    nums = [int(x) for x in _NUMBER.findall(text) if 1 <= int(x) <= 25]
    level = nums[0] if nums else max(holdings[me], holdings[other], 1)
    size = game.board.get_chain_size(chain)
    now = _bonus(holdings, chain, size, game.hotel)
    pact = dict(holdings)
    pact[me] = max(pact[me], level)
    pact[other] = max(pact[other], level)
    then = _bonus(pact, chain, size, game.hotel)
    above = [pid for pid, n in pact.items() if pid not in (me, other) and n > level]
    return {
        "chain": chain,
        "level": level,
        "size": size,
        "holdings": holdings,
        "need": {me: pact[me] - holdings[me], other: pact[other] - holdings[other]},
        "over": {me: holdings[me] > level, other: holdings[other] > level},
        "bank": game.hotel.get_available_stocks(chain),
        "price": game.hotel.get_stock_price(chain, size),
        "now": {me: now.get(me, 0), other: now.get(other, 0)},
        "pact": {me: then.get(me, 0), other: then.get(other, 0)},
        "third_above": above,
        "majority": game.hotel.get_majority_bonus(chain, size),
        "minority": game.hotel.get_minority_bonus(chain, size),
    }


def _flips(m: dict) -> bool:
    return any(
        x["me"][0] != x["me"][1] or x["other"][0] != x["other"][1]
        for x in m["receive"] + m["give"]
    )


def deal_facts(game, me: str, trigger: dict) -> dict | None:
    """The facts for a talk call (see module docstring), or None when the
    trigger needs none. JSON-serialisable."""
    msg = (trigger or {}).get("message") or {}
    other = msg.get("player_id")
    if not msg or other == me or game.get_player(other or "") is None:
        return None
    if game.get_player(me) is None:
        return None
    text = str(msg.get("text") or "")
    offers = [
        t
        for t in game.pending_trades.values()
        if {t.from_player_id, t.to_player_id} == {me, other}
    ]
    chains = [c for c in mentioned_chains(game, text) if game.hotel.is_chain_active(c)]
    last = None
    if not offers:
        # "no but that gives you majority": the offer just answered
        for e in reversed(game.events[-RECENT_EVENTS:]):
            t = e.get("trade") or {}
            if e.get("type") in ANSWERED and {
                t.get("from_player_id"),
                t.get("to_player_id"),
            } == {me, other}:
                last = {"trade": t, "outcome": e["type"]}
                if e["type"] != "trade_accepted":  # what it would do now
                    last["valuation"] = trade_valuation(game, t, me)
                break
    if not chains and not offers and not last and not DEAL_WORDS.search(text):
        return None
    for t in [x.to_dict() for x in offers] + ([last["trade"]] if last else []):
        for c in list(t.get("offering_stocks") or {}) + list(
            t.get("requesting_stocks") or {}
        ):
            if c not in chains and game.hotel.is_chain_active(c):
                chains.append(c)
    pacts = (
        [pact_facts(game, me, other, c, text) for c in chains[:MAX_CHAINS]]
        if PACT_WORDS.search(text)
        else []
    )
    moves = [share_moves(game, me, other, c) for c in chains[:MAX_CHAINS]]
    if not moves:
        # a deal word but no chain named: the chains where 1-3 shares between
        # the two would change a bonus position
        active = [c for c in game.ruleset.chain_ids if game.hotel.is_chain_active(c)]
        moves = [
            m for m in (share_moves(game, me, other, c) for c in active) if _flips(m)
        ]
        moves = moves[:MAX_CHAINS]
    return {
        "other_id": other,
        "named": bool(chains),
        "chains": moves,
        "pacts": [x for x in pacts if x],
        "offers": [
            {"trade": t.to_dict(), "valuation": trade_valuation(game, t, me)}
            for t in offers
        ],
        "last_offer": last,
    }


__all__ = [
    "DEAL_WORDS",
    "OFFER_WORDS",
    "PACT_WORDS",
    "deal_facts",
    "mentioned_chains",
    "pact_facts",
    "share_moves",
]
