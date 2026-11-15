"""Ties in the final standings: the engine is authoritative. Players tied on
final money share a rank (competition ranking 1, 1, 3) and all win; every
consumer (results, events, transcripts, benchmark, calculator) agrees."""

from __future__ import annotations

import asyncio

import pytest

from bench.runner import assign_ranks
from game.board import Tile
from game.calculator import build_calculator_pack
from game.game import Game, GamePhase
from game.ranking import competition_ranks
from transcripts.writer import standings_from_game


def game_with_money(money: list[int]) -> Game:
    """A started game with no chains on the board and the given cash."""
    g = Game(seed=1)
    for i, m in enumerate(money):
        g.add_player(f"p{i + 1}", f"Player {i + 1}")
    g.start_game()
    for p, m in zip(g.players, money, strict=True):
        p._money = m
    return g


@pytest.mark.parametrize(
    ("scores", "ranks"),
    [
        ([10, 30, 20], [3, 1, 2]),
        ([30, 30, 20], [1, 1, 3]),
        ([30, 20, 20, 10], [1, 2, 2, 4]),
        ([5, 5, 5], [1, 1, 1]),
        ([5, 9, 9, 9], [4, 1, 1, 1]),
    ],
)
def test_competition_ranks(scores, ranks):
    assert competition_ranks(scores) == ranks
    assert assign_ranks(scores) == ranks  # bench uses the same function


def test_end_game_tie_for_first_shares_rank_one_and_everyone_wins():
    g = game_with_money([5000, 7000, 7000, 3000])
    res = g.end_game()
    assert res.success
    got = [(s.player_id, s.rank) for s in res.standings]
    # tied players keep seating order within the tie; the next rank skips
    assert got == [("p2", 1), ("p3", 1), ("p1", 3), ("p4", 4)]
    assert [w.player_id for w in res.winners] == ["p2", "p3"]
    assert res.winner.player_id == "p2"  # first of the winners (compat)
    d = res.to_dict()
    assert [w["player_id"] for w in d["winners"]] == ["p2", "p3"]
    ended = [e for e in g.events if e["type"] == "game_ended"][-1]
    assert ended["winners"] == ["p2", "p3"] and ended["winner"] == "p2"
    assert [(s["player_id"], s["rank"]) for s in ended["standings"]] == got
    assert g.phase == GamePhase.GAME_OVER


def test_end_game_tie_below_first_does_not_make_two_winners():
    g = game_with_money([9000, 4000, 4000])
    res = g.end_game()
    assert [(s.player_id, s.rank) for s in res.standings] == [
        ("p1", 1),
        ("p2", 2),
        ("p3", 2),
    ]
    assert [w.player_id for w in res.winners] == ["p1"]
    assert [e for e in g.events if e["type"] == "game_ended"][-1]["winners"] == ["p1"]


def test_everyone_tied_everyone_wins():
    g = game_with_money([6000, 6000, 6000])
    res = g.end_game()
    assert {s.rank for s in res.standings} == {1}
    assert [w.player_id for w in res.winners] == ["p1", "p2", "p3"]


def test_declare_end_game_result_carries_winners():
    g = game_with_money([6000, 6000, 1000])
    g.board.place_tile(Tile(1, "A"))
    # not declarable (no end condition); the result type still exposes winners
    res = g.declare_end_game(g.get_current_player_id())
    assert not res.success
    from game.responses import DeclareEndGameResult, EndGameResult

    assert DeclareEndGameResult(success=True).winners == []
    assert EndGameResult(success=True).to_dict()["winners"] == []


def test_transcript_standings_agree_with_the_engine():
    g = game_with_money([7000, 7000, 2000])
    g.end_game()
    ended = [e for e in g.events if e["type"] == "game_ended"][-1]
    rows = standings_from_game(g)
    assert [(r["player_id"], r["rank"]) for r in rows] == [
        (s["player_id"], s["rank"]) for s in ended["standings"]
    ]
    assert [r["rank"] for r in rows] == [1, 1, 3]


def test_calculator_projected_ranks_share_rank_on_equal_projected_score():
    g = game_with_money([6000, 6000, 1000])
    pack = build_calculator_pack(g, "p1")
    ranks = {p["player_id"]: p["projected_rank"] for p in pack["players"]}
    assert ranks == {"p1": 1, "p2": 1, "p3": 3}


def test_bench_record_ratings_and_winners_split_a_tie(monkeypatch):
    """A bench game ending in a tie records equal ranks and both winners, and
    the rating treats it as a half-win each."""
    from bench import runner
    from bench.rating import bradley_terry

    monkeypatch.setattr("game.calculator.build_calculator_pack", lambda game, pid: {})
    real = Game.end_game

    def tied_end(self, reason="ended"):
        # no holdings -> no bonuses or sales: final score = cash; tie seats 1, 2
        for p in self.players:
            for chain in list(p._stocks):
                p._stocks[chain] = 0
        self.players[0]._money = self.players[1]._money = 50_000
        self.players[2]._money = 1_000
        return real(self, reason)

    monkeypatch.setattr(Game, "end_game", tied_end)
    rec = asyncio.run(runner.run_game(["bot", "bot", "bot"], 3))
    assert rec.status == "completed"
    ranks = {s["pos"]: s["rank"] for s in rec.standings}
    assert ranks[0] == ranks[1] == 1 and ranks[2] > 1
    assert sorted(rec.winners) == [0, 1]
    games = [[("a", ranks[0]), ("b", ranks[1]), ("bot", ranks[2])]]
    r = bradley_terry(games, prior=0)
    assert r["a"] == pytest.approx(r["b"])
