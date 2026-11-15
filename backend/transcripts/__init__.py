"""Game transcripts: one JSON Lines file per game (live or benchmark).

See docs/architecture/seat-contract.md, "Game transcripts and Buyout Bench".

* ``TranscriptWriter`` (writer.py) writes a game's transcript.
* ``TranscriptStore``, ``read_transcript``, ``redact`` (store.py) list and
  read them (HTTP: ``api/games.py``).
* ``transcript_dir()`` / ``bench_dir()`` (paths.py): ``GAME_TRANSCRIPT_DIR``
  / ``GAME_BENCH_DIR``.
"""

from transcripts.paths import (
    bench_dir,
    new_game_id,
    transcript_dir,
    valid_game_id,
)
from transcripts.store import TranscriptStore, read_transcript, redact, summarize
from transcripts.writer import (
    TRANSCRIPT_VERSION,
    TranscriptWriter,
    competition_ranks,
    standings_from_game,
)

__all__ = [
    "TRANSCRIPT_VERSION",
    "TranscriptStore",
    "TranscriptWriter",
    "bench_dir",
    "competition_ranks",
    "new_game_id",
    "read_transcript",
    "redact",
    "standings_from_game",
    "summarize",
    "transcript_dir",
    "valid_game_id",
]
