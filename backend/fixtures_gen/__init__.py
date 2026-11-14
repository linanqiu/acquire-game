"""Generate snapshot fixtures for tier-3 screen tests by real play.

Every fixture is a recipe (seed + players + ordered action list) replayed
through ``game.decisions.apply_action`` from a fresh game, plus the resulting
snapshot. Nothing is hand-built. See ``python -m fixtures_gen`` and
``frontend/tests/e2e/fixtures/snapshots/README.md``.
"""
