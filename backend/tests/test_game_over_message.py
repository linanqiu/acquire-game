"""The ``game_over`` message carries each player's final breakdown.

Found by the tier-4 journey: the game-over screen showed "Final bonuses +$0" and
"Stock liquidation +$0" for every player because the message only had final money.
"""

import json

from broadcast import final_game_over, game_over_message
from fixtures_gen.generate import DEFAULT_OUT_DIR
from game.snapshot import from_snapshot


def _ended_game():
    data = json.loads((DEFAULT_OUT_DIR / "game-over.json").read_text())
    game = from_snapshot(data["snapshot"])
    ended = next(e for e in game.events if e["type"] == "game_ended")
    return game, ended


def test_scores_include_bonuses_and_stock_sales():
    game, ended = _ended_game()
    msg = game_over_message(game, ended, declared_by="p1")

    assert msg["type"] == "game_over"
    assert msg["winner"] == ended["winner"]
    assert msg["declared_by"] == "p1"
    assert set(msg["scores"]) == {p.player_id for p in game.players}

    final_bonuses = [
        e for e in game.events if e["type"] == "bonuses_paid" and e.get("final")
    ]
    assert final_bonuses, "fixture should pay final bonuses"
    total_bonuses = sum(
        b["majority"] + b["minority"]
        for e in final_bonuses
        for b in e["bonuses"].values()
    )
    assert sum(s["bonuses"] for s in msg["scores"].values()) == total_bonuses
    for pid, s in msg["scores"].items():
        assert s["money"] == game.get_player(pid).money
        assert s["stock_sales"] == ended["final_sales"].get(pid, 0)
        # Cash before the end-of-game payouts is never negative.
        assert s["money"] - s["bonuses"] - s["stock_sales"] >= 0
    # Someone was paid something at the end.
    assert any(s["bonuses"] + s["stock_sales"] > 0 for s in msg["scores"].values())


def test_declared_by_omitted_when_not_declared():
    game, ended = _ended_game()
    assert "declared_by" not in game_over_message(game, ended, declared_by=None)


def test_final_game_over_rebuilds_the_message_for_reconnects():
    game, ended = _ended_game()
    declared = next(e for e in game.events if e["type"] == "end_game_declared")
    msg = final_game_over(game)
    assert msg == game_over_message(game, ended, declared["player_id"])


def test_final_game_over_is_none_while_playing():
    from game.game import Game

    game = Game(seed=1)
    for pid in ("a", "b", "c"):
        game.add_player(pid, pid.upper())
    game.start_game()
    assert final_game_over(game) is None
