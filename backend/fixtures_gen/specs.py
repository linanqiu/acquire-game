"""Fixture definitions: what state each fixture must reach.

A fixture is a list of *criteria* evaluated on a real game state (never
constructed). Required criteria define the fixture; ideal criteria are
preferred extras (the search keeps the state meeting the most of them and the
file records which were met and which were not). The provenance tests
re-evaluate the recorded criteria against the replayed game.

``tail`` fixtures append a few real actions (e.g. a trade proposal, declaring
the end game) to a found state; ``pre`` gates whether a state is worth trying.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from game.decisions import (
    BUY_STOCKS,
    CHOOSE_SURVIVOR,
    FOUND_CHAIN,
    PLACE_TILE,
    STOCK_DISPOSITION,
    TRADE_RESPONSE,
    legal_actions,
    pending_decisions,
    validate_action,
)
from game.game import Game, GamePhase
from game.rules import Rules, UnplayableReason

HUMAN = "p1"


class Ctx:
    """A game state plus lazily cached decision info for criteria."""

    def __init__(self, game: Game, n_actions: int = 0, human: str = HUMAN):
        self.game = game
        self.human = human
        self.n_actions = n_actions
        self.decisions = pending_decisions(game)
        self.flow = self.decisions[0] if self.decisions else None
        self._legal: dict[int, dict] = {}

    def legal(self, decision) -> dict:
        key = id(decision)
        if key not in self._legal:
            self._legal[key] = legal_actions(self.game, decision)
        return self._legal[key]

    @property
    def human_player(self):
        return self.game.get_player(self.human)

    def flow_is(self, kind: str, who: str | None = None) -> bool:
        who = who or self.human
        return bool(self.flow and self.flow.kind == kind and self.flow.player_id == who)

    def active(self) -> dict[str, int]:
        g = self.game
        return {c: g.board.get_chain_size(c) for c in g.hotel.get_active_chains()}

    def price(self, chain: str) -> int:
        g = self.game
        return g.hotel.get_stock_price(chain, g.board.get_chain_size(chain))

    def tile_reasons(self) -> dict[str, str | None]:
        g = self.game
        play = Rules.get_tiles_playability(g.board, self.human_player.hand, g.hotel)
        return {t: v["reason"] for t, v in play.items() if not v["playable"]}


Criterion = tuple[str, Callable[[Ctx], bool], bool]  # (name, fn, required)


@dataclass
class Fixture:
    name: str
    description: str
    players: tuple[int, ...]
    criteria: list[Criterion]
    pre: Callable[[Ctx], bool] | None = None
    tail: Callable[[Ctx], list[tuple[str, dict]] | None] | None = None
    human_seat: str = HUMAN
    ideal_hint: str = ""
    extra: dict = field(default_factory=dict)


def req(name, fn) -> Criterion:
    return (name, fn, True)


def ideal(name, fn) -> Criterion:
    return (name, fn, False)


# ---------------------------------------------------------------------------
# criteria helpers
# ---------------------------------------------------------------------------


def _disp(ctx: Ctx):
    return ctx.flow.context if ctx.flow_is(STOCK_DISPOSITION) else None


def _human_hold(ctx: Ctx, chain: str) -> int:
    return ctx.human_player.get_stock_count(chain)


def _buy_options(ctx: Ctx) -> list[dict]:
    return ctx.legal(ctx.flow)["options"] if ctx.flow_is(BUY_STOCKS) else []


def _fresh_buy(ctx: Ctx) -> bool:
    return ctx.flow_is(BUY_STOCKS) and not ctx.game.stocks_bought_this_turn


def _multi_chain_buy_cash(ctx: Ctx) -> bool:
    opts = _buy_options(ctx)
    return bool(opts) and ctx.human_player.money >= 3 * max(o["price"] for o in opts)


def _multi_chain_buy_cheap(ctx: Ctx) -> bool:
    opts = _buy_options(ctx)
    return bool(opts) and ctx.human_player.money >= 3 * min(o["price"] for o in opts)


def _unaffordable_or_sold_out(ctx: Ctx) -> bool:
    return any(o["max_affordable"] == 0 for o in _buy_options(ctx))


def _sold_out(ctx: Ctx) -> bool:
    return any(o["available"] == 0 for o in _buy_options(ctx))


def _trade_limited(ctx: Ctx) -> bool:
    if not ctx.flow_is(STOCK_DISPOSITION):
        return False
    legal = ctx.legal(ctx.flow)
    count = legal["stock_count"]
    return count >= 2 and legal["max_trade"] < count - count % 2


def _trade_limited_nonzero(ctx: Ctx) -> bool:
    return _trade_limited(ctx) and ctx.legal(ctx.flow)["max_trade"] > 0


def _waiting_on_other(ctx: Ctx) -> bool:
    g = ctx.game
    if not (ctx.flow and ctx.flow.kind == STOCK_DISPOSITION):
        return False
    if ctx.flow.player_id == ctx.human:
        return False
    queue = g._merger.stock_players[g._merger.stock_index + 1 :]
    return ctx.human in queue


def _disp_first_human(ctx: Ctx) -> bool:
    d = _disp(ctx)
    if d is None:
        return False
    count = d["stock_count"]
    legal = ctx.legal(ctx.flow)
    g = ctx.game
    return (
        count >= 3
        and count % 2 == 1
        and legal["max_trade"] >= 2
        and g._merger.stock_index == 0
    )


def _others_follow_in_queue(ctx: Ctx) -> bool:
    g = ctx.game
    return len(g._merger.stock_players) > g._merger.stock_index + 1


def _merge_chain_count(ctx: Ctx) -> int:
    return len(ctx.game._merger.chains)


def _tied_human_holds(ctx: Ctx) -> bool:
    return ctx.flow_is(CHOOSE_SURVIVOR) and any(
        _human_hold(ctx, c) > 0 for c in ctx.flow.context["tied_chains"]
    )


def _holds_in_chains(ctx: Ctx, n: int) -> bool:
    return sum(1 for c in ctx.active() if _human_hold(ctx, c) > 0) >= n


def _has_reason(ctx: Ctx, reason: UnplayableReason) -> bool:
    return reason.value in ctx.tile_reasons().values()


def _human_has_playable(ctx: Ctx) -> bool:
    return bool(ctx.flow_is(PLACE_TILE) and ctx.legal(ctx.flow)["tiles"])


def _can_declare_in_legal(ctx: Ctx) -> bool:
    if not (ctx.flow and ctx.flow.player_id == ctx.human):
        return False
    return "declare_end_game" in ctx.legal(ctx.flow)["action_types"]


def _low_cash(ctx: Ctx) -> bool:
    if not _fresh_buy(ctx):
        return False
    opts = _buy_options(ctx)
    return bool(opts) and all(
        o["max_affordable"] == 0 and o["available"] > 0 for o in opts
    )


def _standings(ctx: Ctx) -> list[dict]:
    ended = [e for e in ctx.game.events if e["type"] == "game_ended"]
    return ended[-1]["standings"] if ended else []


def _clear_winner(ctx: Ctx) -> bool:
    s = _standings(ctx)
    return len(s) >= 2 and s[0]["money"] > s[1]["money"]


def _tied_winner(ctx: Ctx) -> bool:
    s = _standings(ctx)
    return len(s) >= 2 and s[0]["money"] == s[1]["money"]


# ---------------------------------------------------------------------------
# trade tails
# ---------------------------------------------------------------------------


def _in_trade_phase(ctx: Ctx) -> bool:
    return ctx.game.phase in (GamePhase.PLAYING, GamePhase.BUYING_STOCKS)


def _propose_sale(ctx: Ctx, seller: str, buyer: str, trade_id: str):
    """seller offers up to 2 shares of the chain they hold most of, for cash."""
    g = ctx.game
    seller_p, buyer_p = g.get_player(seller), g.get_player(buyer)
    held = [
        (n, c)
        for c, n in sorted(seller_p.stocks.items())
        if n > 0 and g.hotel.is_chain_active(c)
    ]
    if not held:
        return None
    count, chain = max(held, key=lambda t: (t[0], t[1]))
    qty = min(2, count)
    cash = qty * ctx.price(chain)
    if cash > buyer_p.money:
        return None
    action = {
        "action": "propose_trade",
        "to_player_id": buyer,
        "offering_stocks": {chain: qty},
        "offering_money": 0,
        "requesting_stocks": {},
        "requesting_money": cash,
        "trade_id": trade_id,
    }
    if validate_action(g, seller, action) is not None:
        return None
    return [(seller, action)]


def _incoming_tail(my_turn: bool):
    def pre(ctx: Ctx) -> bool:
        return (
            _in_trade_phase(ctx)
            and (ctx.game.get_current_player().player_id == ctx.human) == my_turn
        )

    def tail(ctx: Ctx):
        for p in ctx.game.players:
            if p.player_id == ctx.human:
                continue
            steps = _propose_sale(ctx, p.player_id, ctx.human, "trade-1")
            if steps:
                return steps
        return None

    return pre, tail


def _outgoing_pre(ctx: Ctx) -> bool:
    return _in_trade_phase(ctx) and ctx.game.get_current_player().player_id == ctx.human


def _outgoing_tail(ctx: Ctx):
    for p in ctx.game.players:
        if p.player_id == ctx.human:
            continue
        steps = _propose_sale(ctx, ctx.human, p.player_id, "trade-1")
        if steps:
            return steps
    return None


def _incoming_pending(ctx: Ctx) -> bool:
    return any(
        d.kind == TRADE_RESPONSE and d.player_id == ctx.human for d in ctx.decisions
    )


def _outgoing_pending(ctx: Ctx) -> bool:
    return any(t.from_player_id == ctx.human for t in ctx.game.pending_trades.values())


def _incoming_acceptable(ctx: Ctx) -> bool:
    return any(
        d.kind == TRADE_RESPONSE
        and d.player_id == ctx.human
        and ctx.legal(d)["can_accept"]
        for d in ctx.decisions
    )


# ---------------------------------------------------------------------------
# end game tails
# ---------------------------------------------------------------------------


def _declare_pre(ctx: Ctx) -> bool:
    return bool(
        ctx.flow
        and ctx.flow.kind in (PLACE_TILE, BUY_STOCKS)
        and ctx.game.can_declare_end_game()
    )


def _declare_tail(ctx: Ctx):
    return [(ctx.flow.player_id, {"action": "declare_end_game"})]


def _game_over(ctx: Ctx) -> bool:
    return ctx.game.phase == GamePhase.GAME_OVER


def _human_won(ctx: Ctx) -> bool:
    s = _standings(ctx)
    return bool(s) and s[0]["player_id"] == ctx.human


# ---------------------------------------------------------------------------
# the fixtures
# ---------------------------------------------------------------------------


def _others_tail(ctx: Ctx):
    """One opponent offers another opponent shares for cash (the human is not
    a party: offers are public, so the human sees it)."""
    others = [p.player_id for p in ctx.game.players if p.player_id != ctx.human]
    for seller in others:
        for buyer in others:
            if buyer == seller:
                continue
            steps = _propose_sale(ctx, seller, buyer, "trade-1")
            if steps:
                return steps
    return None


def _others_offer(ctx: Ctx):
    return next(
        (
            t
            for t in ctx.game.pending_trades.values()
            if ctx.human not in (t.from_player_id, t.to_player_id)
        ),
        None,
    )


def _human_can_compete(ctx: Ctx) -> bool:
    """The human holds a share of what is offered and both parties still have
    cash: a competing offer to either side can be prefilled with something."""
    t = _others_offer(ctx)
    me = ctx.game.get_player(ctx.human)
    return (
        t is not None
        and any(me.stocks.get(c, 0) > 0 for c in t.offering_stocks)
        and me.money >= t.requesting_money
    )


_inc_my_pre, _inc_my_tail = _incoming_tail(True)
_inc_other_pre, _inc_other_tail = _incoming_tail(False)


def _midgame(count: int, min_tiles: int, min_chains: int) -> list[Criterion]:
    return [
        req("human_to_place_tile", lambda c: c.flow_is(PLACE_TILE)),
        req(
            "busy_board", lambda c: len(c.game.board.get_state()["cells"]) >= min_tiles
        ),
        req("chains", lambda c: len(c.active()) >= min_chains),
        ideal("human_holds_3_chains", lambda c: _holds_in_chains(c, 3)),
        ideal(
            "very_busy_board",
            lambda c: len(c.game.board.get_state()["cells"]) >= min_tiles + 12,
        ),
        ideal("more_chains", lambda c: len(c.active()) >= min_chains + 1),
    ]


FIXTURES: list[Fixture] = [
    Fixture(
        "opening-place-tile",
        "Turn 1: empty board, the human holds 6 tiles and must place one.",
        (4,),
        [
            req("no_actions_played", lambda c: c.n_actions == 0),
            req("human_to_place_tile", lambda c: c.flow_is(PLACE_TILE)),
            ideal(
                "hand_spans_4_columns",
                lambda c: len({str(t)[:-1] for t in c.human_player.hand}) >= 4,
            ),
        ],
    ),
    Fixture(
        "found-chain-choice",
        "The human just placed a tile that founds a chain and must choose among "
        "at least 3 available chains (some chains already on the board).",
        (4,),
        [
            req("human_found_chain", lambda c: c.flow_is(FOUND_CHAIN)),
            req(
                "three_plus_available",
                lambda c: len(c.flow.context["available_chains"]) >= 3,
            ),
            ideal("a_chain_already_active", lambda c: len(c.active()) >= 1),
            ideal(
                "some_chains_unavailable",
                lambda c: len(c.flow.context["available_chains"]) <= 5,
            ),
        ],
    ),
    Fixture(
        "buy-phase-multi-chain",
        "The human is in the buy phase with at least 3 active chains and enough "
        "cash for 3 shares of any of them.",
        (4,),
        [
            req("human_buy_phase", _fresh_buy),
            req("three_plus_chains", lambda c: len(c.active()) >= 3),
            req("cash_for_3_cheapest", _multi_chain_buy_cheap),
            ideal("cash_for_3_priciest", _multi_chain_buy_cash),
            ideal("a_chain_unaffordable_or_sold_out", _unaffordable_or_sold_out),
            ideal("a_chain_sold_out", _sold_out),
        ],
    ),
    Fixture(
        "merger-survivor-tie",
        "The human merged two equal-size chains and must choose the survivor.",
        (4,),
        [
            req("human_choose_survivor", lambda c: c.flow_is(CHOOSE_SURVIVOR)),
            ideal("human_holds_tied_stock", _tied_human_holds),
        ],
    ),
    Fixture(
        "disposition-human-first",
        "The human is first to dispose of defunct stock: holds an odd number "
        "(>= 3) of shares and a 2:1 trade is possible.",
        (4,),
        [
            req("human_disposition_first", _disp_first_human),
            ideal("others_wait_behind", _others_follow_in_queue),
        ],
    ),
    Fixture(
        "disposition-waiting-on-other",
        "A merger is in progress; another player is deciding on defunct stock "
        "and the human (a stockholder) is queued behind them.",
        (4,),
        [
            req("other_disposes_human_queued", _waiting_on_other),
            ideal(
                "human_holds_3_defunct",
                lambda c: (
                    c.game.get_player(c.human).get_stock_count(
                        c.game.pending_action["defunct_chain"]
                    )
                    >= 3
                ),
            ),
        ],
    ),
    Fixture(
        "disposition-trade-limited",
        "The human disposes defunct stock but the survivor's remaining bank "
        "stock limits the 2:1 trade below the human's even share count.",
        (4, 3, 5),
        [
            req("trade_limited", _trade_limited),
            ideal("some_trade_still_possible", _trade_limited_nonzero),
        ],
    ),
    Fixture(
        "multi-chain-merger",
        "One tile merged 3 chains; the human is a stockholder deciding on defunct stock.",
        (4, 3, 5),
        [
            req("human_disposition", lambda c: c.flow_is(STOCK_DISPOSITION)),
            req("three_chains_merging", lambda c: _merge_chain_count(c) >= 3),
            ideal(
                "more_defunct_to_follow",
                lambda c: bool(c.game._merger.defunct_queue),
            ),
        ],
    ),
    Fixture(
        "safe-chain-on-board",
        "A safe chain (11+ tiles) is on the board and the human holds a tile that "
        "cannot be played because it would merge two safe chains.",
        (4, 3, 5),
        [
            req("human_to_place_tile", lambda c: c.flow_is(PLACE_TILE)),
            req(
                "a_safe_chain",
                lambda c: any(
                    s >= c.game.ruleset.safe_chain_size for s in c.active().values()
                ),
            ),
            ideal(
                "human_holds_merge_safe_tile",
                lambda c: _has_reason(c, UnplayableReason.MERGE_SAFE_CHAINS),
            ),
            ideal("human_also_has_playable_tile", _human_has_playable),
        ],
    ),
    Fixture(
        "dead-tile-in-hand",
        "All 7 chains are active and the human holds a tile that would create an "
        "8th chain (unplayable).",
        (4, 3, 5),
        [
            req("human_to_place_tile", lambda c: c.flow_is(PLACE_TILE)),
            req(
                "seven_chains",  # name kept: fixtures are default (7 chains)
                lambda c: len(c.active()) == len(c.game.ruleset.chains),
            ),
            req(
                "human_holds_eighth_chain_tile",
                lambda c: _has_reason(c, UnplayableReason.EIGHTH_CHAIN),
            ),
            ideal("human_also_has_playable_tile", _human_has_playable),
        ],
    ),
    Fixture(
        "trade-incoming",
        "It is the human's turn and another player has proposed a trade to them "
        "(stock for cash).",
        (4,),
        [
            req("trade_response_for_human", _incoming_pending),
            req("human_has_turn", lambda c: c.flow and c.flow.player_id == c.human),
            ideal("acceptable", _incoming_acceptable),
            ideal("human_buy_phase", lambda c: c.flow_is(BUY_STOCKS)),
        ],
        pre=_inc_my_pre,
        tail=_inc_my_tail,
    ),
    Fixture(
        "trade-incoming-not-my-turn",
        "Another player's turn; a third player has proposed a trade to the human.",
        (4,),
        [
            req("trade_response_for_human", _incoming_pending),
            req("not_human_turn", lambda c: c.flow and c.flow.player_id != c.human),
            ideal("acceptable", _incoming_acceptable),
        ],
        pre=_inc_other_pre,
        tail=_inc_other_tail,
    ),
    Fixture(
        "trade-outgoing-pending",
        "The human proposed a trade (stock for cash) and is awaiting the answer.",
        (4,),
        [
            req("human_proposal_pending", _outgoing_pending),
            req("human_has_turn", lambda c: c.flow and c.flow.player_id == c.human),
            ideal("human_buy_phase", lambda c: c.flow_is(BUY_STOCKS)),
        ],
        pre=_outgoing_pre,
        tail=_outgoing_tail,
    ),
    Fixture(
        "trade-between-others",
        "The human's turn; one opponent has proposed a trade (stock for cash) to "
        "another opponent. The human is not a party but sees the public offer.",
        (4,),
        [
            req("offer_between_others", lambda c: _others_offer(c) is not None),
            req("nothing_for_human", lambda c: not _incoming_pending(c)),
            req("human_has_turn", lambda c: c.flow and c.flow.player_id == c.human),
            req("human_can_compete", _human_can_compete),
            ideal("human_buy_phase", lambda c: c.flow_is(BUY_STOCKS)),
        ],
        pre=_outgoing_pre,
        tail=_others_tail,
    ),
    Fixture(
        "end-game-available",
        "The human's turn (place tile) and declaring the end game is legal.",
        (4,),
        [
            req("human_to_place_tile", lambda c: c.flow_is(PLACE_TILE)),
            req("declare_legal", _can_declare_in_legal),
            ideal("human_has_playable_tile", _human_has_playable),
        ],
    ),
    Fixture(
        "last-turn-before-game-over",
        "The human already bought stock this turn and declaring the end game "
        "(one action) ends the game.",
        (4,),
        [
            req(
                "human_bought_then_can_declare",
                lambda c: c.flow_is(BUY_STOCKS) and c.game.stocks_bought_this_turn,
            ),
            req("declare_legal", _can_declare_in_legal),
        ],
    ),
    Fixture(
        "game-over",
        "A finished game (end declared) with final standings and a single winner.",
        (4,),
        [
            req("game_over", _game_over),
            req("clear_winner", _clear_winner),
            ideal("human_won", _human_won),
        ],
        pre=_declare_pre,
        tail=_declare_tail,
    ),
    Fixture(
        "game-over-tie",
        "A finished game where the top two players tie on final cash.",
        (4, 3, 5, 6),
        [
            req("game_over", _game_over),
            req("tied_top", _tied_winner),
        ],
        pre=_declare_pre,
        tail=_declare_tail,
    ),
    Fixture(
        "low-cash",
        "The human is in the buy phase and cannot afford any stock.",
        (4,),
        [
            req("human_buy_phase", _fresh_buy),
            req("cannot_afford_any", _low_cash),
            ideal("human_holds_3_chains", lambda c: _holds_in_chains(c, 3)),
            ideal("human_holds_2_chains", lambda c: _holds_in_chains(c, 2)),
        ],
    ),
    Fixture(
        "six-player-midgame",
        "Six players, busy mid-game board, the human to place a tile.",
        (6,),
        _midgame(6, 30, 4),
    ),
    Fixture(
        "three-player-midgame",
        "Three players, busy mid-game board, the human to place a tile.",
        (3,),
        _midgame(3, 30, 4),
    ),
]

FIXTURES_BY_NAME = {f.name: f for f in FIXTURES}


def evaluate(fixture: Fixture, ctx: Ctx) -> tuple[list[str], list[str]] | None:
    """Return (met, missed) criteria names, or None if a required one fails."""
    met, missed = [], []
    for name, fn, required in fixture.criteria:
        if fn(ctx):
            met.append(name)
        elif required:
            return None
        else:
            missed.append(name)
    return met, missed


__all__ = [
    "FIXTURES",
    "FIXTURES_BY_NAME",
    "HUMAN",
    "Ctx",
    "Fixture",
    "evaluate",
]
