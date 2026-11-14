"""Rebuild a game from its transcript: a fresh ``Game`` with the header's seed
(or tile order) and seats, then every recorded ``decision.action`` through
``apply_action``. The strongest check that a transcript is complete."""

from __future__ import annotations

from game.decisions import apply_action
from game.game import Game
from game.ruleset import Ruleset, RulesetError


class ReplayError(ValueError):
    pass


def _ruleset_of(header: dict):
    """The ruleset the game was played under: the header's full ``ruleset``
    (classic for transcripts written before rulesets existed). Verified
    against ``ruleset_fingerprint`` when both are present."""
    data = header.get("ruleset")
    if data is None:
        return None  # classic
    try:
        rs = Ruleset.from_dict(data)
    except RulesetError as e:
        raise ReplayError(f"bad ruleset in the header: {e}") from e
    fp = header.get("ruleset_fingerprint")
    if fp and fp != rs.fingerprint:
        raise ReplayError("ruleset fingerprint does not match the header's ruleset")
    return rs


def replay(transcript: dict) -> Game:
    """Replay a FULL (unredacted) transcript (``read_transcript`` output).
    Raises ``ReplayError`` if the transcript cannot be replayed (redacted,
    loaded from a snapshot, or an action the engine refuses)."""
    h = transcript.get("header") or {}
    if h.get("loaded_from_snapshot"):
        raise ReplayError("a transcript of a loaded snapshot cannot be replayed")
    if "seed" not in h:
        raise ReplayError("no seed in the header (redacted transcript?)")
    ruleset = _ruleset_of(h)
    game = Game(seed=h.get("seed"), tile_order=h.get("tile_order"), ruleset=ruleset)
    for s in h["seats"]:
        game.add_player(s["player_id"], s["name"], is_bot=bool(s.get("is_bot")))
    game.start_game()
    for e in transcript["entries"]:
        if e.get("type") != "decision":
            continue
        result = apply_action(game, e["player_id"], e["action"])
        if not result.get("success"):
            raise ReplayError(
                f"decision {e.get('index')} {e['action']!r} refused: {result.get('error')}"
            )
    return game


def final_scores(game: Game) -> dict[str, int]:
    return {p.player_id: p.money for p in game.players}
