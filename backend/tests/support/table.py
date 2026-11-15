"""Build game positions through real play.

A ``Table`` is a started game whose tile bag is stacked so that every player
holds, and later draws, exactly the tiles a test scripts for them. Every move
then goes through ``game.decisions.apply_action`` (the single entry point all
seats use), so a position is only reachable if the rules allow it: no board
surgery, no private state.

    t = Table([["1A", "4A"], ["2A"], ["5A", "3A"]])   # scripts for p1, p2, p3
    t.turn("1A")                                      # p1: lone tile
    t.turn("2A", found="sandpiper")                       # p2 founds sandpiper
    t.turn("5A", buy={"sandpiper": 2})                    # p3

A script lists the tiles a player will place, in order. The first
``hand_size`` are dealt; the rest arrive one per turn through the normal
end-of-turn draw. Empty slots are filled with "filler" tiles that are never
adjacent to a scripted tile, so they cannot disturb the position.
"""

from __future__ import annotations

from game.decisions import apply_action, legal_actions, pending_decisions
from game.game import Game
from game.ruleset import Ruleset, resolve


class Table:
    def __init__(
        self,
        scripts: list[list[str]],
        ruleset: Ruleset | None = None,
        bag_tail: list[str] | None = None,
    ):
        """
        Args:
            scripts: per player, the tiles they will place in order
            ruleset: game parameters (default: the default ruleset)
            bag_tail: tiles drawn next once the scripted draws (one round
                beyond the longest script) are used up, in draw order
        """
        rs = resolve(ruleset)
        self.ruleset = rs
        n = len(scripts)
        hand = rs.hand_size
        scripted = [t.upper() for s in scripts for t in s] + list(bag_tail or [])
        self.scripted = set(scripted)
        if len(set(scripted)) != len(scripted):
            raise ValueError("a tile is scripted twice")
        probe = Game(ruleset=rs)
        near = set()
        for s in scripted:
            tile = probe.board.tile_from_string(s)
            near.add(str(tile))
            near.update(str(a) for a in probe.board.get_adjacent_tiles(tile))
        fillers = [str(t) for t in probe.board.all_tiles() if str(t) not in near]
        # Spread fillers out so that they are not adjacent to each other either
        # (a filler pair could otherwise look like a founding opportunity).
        spaced, taken = [], set()
        for f in fillers:
            tile = probe.board.tile_from_string(f)
            if any(str(a) in taken for a in probe.board.get_adjacent_tiles(tile)):
                continue
            spaced.append(f)
            taken.add(f)
        rest = [f for f in fillers if f not in taken]
        filler_iter = iter(spaced + rest)

        def take(seq, i):
            return seq[i].upper() if i < len(seq) else next(filler_iter)

        draw_order = []  # in pop order
        for p in range(n):
            draw_order.extend(take(scripts[p], k) for k in range(hand))
        longest = max(len(s) for s in scripts)
        rounds = max(0, longest - hand) + 1
        for r in range(rounds):
            for p in range(n):
                draw_order.append(take(scripts[p], hand + r))
        draw_order.extend(t.upper() for t in (bag_tail or []))
        used = set(draw_order)
        bottom = [str(t) for t in probe.board.all_tiles() if str(t) not in used]
        self.fillers_left = bottom
        # Game.draw_tile pops from the end of the bag.
        order = bottom + list(reversed(draw_order))
        self.game = Game(tile_order=order, ruleset=rs)
        for i in range(n):
            self.game.add_player(f"p{i + 1}", f"Player {i + 1}")
        self.game.start_game()

    # ------------------------------------------------------------------ helpers

    @property
    def current(self) -> str:
        return self.game.get_current_player().player_id

    def player(self, pid: str):
        return self.game.get_player(pid)

    def decision(self):
        return pending_decisions(self.game)[0]

    def legal(self) -> dict:
        """legal_actions for the blocking decision."""
        return legal_actions(self.game, self.decision())

    def offered_tiles(self) -> list[str]:
        return [o["tile"] for o in self.legal().get("tiles", [])]

    def act(self, pid: str, **action) -> dict:
        """Apply an action and assert that the engine accepted it."""
        result = apply_action(self.game, pid, action)
        assert result["success"], f"{pid} {action} -> {result}"
        return result

    def try_act(self, pid: str, **action) -> dict:
        """Apply an action that may be refused (returns the result dict)."""
        return apply_action(self.game, pid, action)

    def place(self, tile: str) -> dict:
        return self.act(self.current, action="place_tile", tile=tile)

    def found(self, chain: str) -> dict:
        return self.act(self.current, action="found_chain", chain=chain)

    def buy(self, purchases: dict[str, int]) -> dict:
        return self.act(self.current, action="buy_stocks", purchases=purchases)

    def end(self) -> dict:
        return self.act(self.current, action="end_turn")

    def dispose(self, pid: str, chain: str, sell=0, trade=0, hold=0) -> dict:
        return self.act(
            pid,
            action="merger_disposition",
            defunct_chain=chain,
            disposition={"sell": sell, "trade": trade, "hold": hold},
        )

    def turn(self, tile: str, found: str | None = None, buy=None) -> None:
        """One complete simple turn: place, found if asked, buy, end."""
        self.place(tile)
        if found is not None:
            self.found(found)
        if buy:
            self.buy(buy)
        self.end()

    def place_filler(self) -> dict:
        """The player on turn places an unscripted (lone filler) tile."""
        hand = [str(x) for x in self.player(self.current).hand]
        return self.place(next(x for x in hand if x not in self.scripted))

    def pass_turn(self) -> None:
        """Place a lone filler tile and end the turn without buying."""
        self.place_filler()
        self.end()

    def size(self, chain: str) -> int:
        return self.game.board.get_chain_size(chain)

    def money(self, pid: str) -> int:
        return self.player(pid).money

    def shares(self, pid: str, chain: str) -> int:
        return self.player(pid).get_stock_count(chain)

    def events(self, kind: str, since: int = 0) -> list[dict]:
        return [e for e in self.game.events[since:] if e["type"] == kind]

    def mark(self) -> int:
        """Event-log position, for ``events(kind, since=t.mark())``."""
        return len(self.game.events)

    def play(self, moves: list) -> None:
        """Play ``moves`` (see ``scripts_for``), one complete turn each."""
        for move in moves:
            if isinstance(move, tuple):
                tile, kw = move
                self.turn(tile, **kw)
            else:
                self.turn(move)


def scripts_for(moves: list, players: int, extra: dict | None = None) -> list:
    """Per-player scripts for ``moves`` played in seat order (move i by player
    i % players). A move is a tile or ``(tile, {"found": .., "buy": {..}})``.
    ``extra`` appends tiles to a player's script (index -> tiles) for turns
    the test plays by hand afterwards."""
    scripts: list[list[str]] = [[] for _ in range(players)]
    for i, move in enumerate(moves):
        scripts[i % players].append(move[0] if isinstance(move, tuple) else move)
    for idx, tiles in (extra or {}).items():
        scripts[idx].extend(tiles)
    return scripts


def line(row: str, first: int, last: int) -> list[str]:
    """Tiles ``first..last`` of a row, e.g. line("A", 1, 3) -> 1A 2A 3A."""
    return [f"{c}{row}" for c in range(first, last + 1)]


def snake(rs, n: int) -> list[str]:
    """``n`` connected tiles from 1A, row by row (A left-to-right, B
    right-to-left, ...)."""
    cols = rs.board.columns
    out = []
    for i, row in enumerate(rs.board.row_letters):
        tiles = line(row, 1, cols)
        out.extend(tiles if i % 2 == 0 else tiles[::-1])
    return out[:n]


def grow_two_chains(rs, big: int, small: int):
    """Chain 0 grown to ``big`` tiles along the snake from 1A, chain 1 grown
    to ``small`` tiles along the bottom row; returns (table, next big tile,
    next small tile)."""
    players = rs.min_players if rs.min_players > 2 else 3
    big_path = snake(rs, big + 1)
    bottom = rs.board.row_letters[-1]
    small_path = line(bottom, 1, small + 1)
    a, b = rs.chain_ids[0], rs.chain_ids[1]
    moves = [small_path[0], (small_path[1], {"found": b})]
    moves += small_path[2:small]
    moves += [big_path[0], (big_path[1], {"found": a})] + big_path[2:big]
    extra = {len(moves) % players: [big_path[big]]}
    extra.setdefault((len(moves) + 1) % players, []).append(small_path[small])
    t = Table(scripts_for(moves, players, extra), ruleset=rs)
    t.play(moves)
    assert (t.size(a), t.size(b)) == (big, small)
    return t, big_path[big], small_path[small]
