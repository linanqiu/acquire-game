"""Game transcripts: one JSON Lines file per game (live or benchmark).

See docs/architecture/seat-contract.md, "Game transcripts and Buyout Bench".

* ``TranscriptWriter`` (writer.py) writes a game's transcript.
* ``TranscriptStore``, ``read_transcript``, ``redact`` (store.py) list and
  read them (HTTP: ``api/games.py``).
* ``transcript_dir()`` / ``bench_dir()`` (paths.py): ``GAME_TRANSCRIPT_DIR``
  / ``GAME_BENCH_DIR``.
"""

from transcripts.store import TranscriptStore, read_transcript, redact
from transcripts.writer import TranscriptWriter

__all__ = ["TranscriptStore", "TranscriptWriter", "read_transcript", "redact"]
