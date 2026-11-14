# Epic 10: Engine Seam

## Overview

Owner decision 2026-11-14: **no rebuild**. The rules engine (about 600 backend tests, 2 s) stays.
What gets rebuilt is the seam between the engine and everything that drives it: humans, heuristic
bots, LLM opponents, scripted test players, and tests.

Measured motivation:

- Backend tests: about 2 s.
- Playwright scenario suite: 62 tests, about 9,300 lines, did **not finish in 10 minutes**. Tests
  have to play 20-40 turns through the browser against live heuristic bots just to reach the screen
  under test.

Today the same action can reach the engine by several routes (WebSocket handler, `http_game_action`
with a global send-function monkeypatch, duplicated bot code paths), the engine keeps no history,
and state cannot be saved and restored. That makes agent seats, fast tests, and replay hard.

The target design is [docs/architecture/seat-contract.md](../../architecture/seat-contract.md).
This epic implements it; the contract is authoritative if this text disagrees.

## Goals

- One mutation entry point, `apply_action()`, used by every seat.
- A decisions API that says who must decide what, and what is legal.
- An append-only public/private event log.
- Complete snapshot/restore of a game.
- A calculator pack for exact public figures.
- One server-side driver loop under a per-room lock, replacing duplicated bot paths.
- Test-mode endpoints so tests can load snapshots and add scripted seats.

## Stories

| Story | Title | Status | Depends on |
|-------|-------|--------|------------|
| [ES-001](../stories/10-engine-seam/ES-001.md) | Decisions API and single apply entry point | in-progress | None |
| [ES-002](../stories/10-engine-seam/ES-002.md) | Event log (supersedes BL-004) | in-progress | ES-001 |
| [ES-003](../stories/10-engine-seam/ES-003.md) | Snapshot / restore | in-progress | ES-002 |
| [ES-004](../stories/10-engine-seam/ES-004.md) | Calculator pack | in-progress | ES-001 |
| [ES-005](../stories/10-engine-seam/ES-005.md) | Seat driver loop, per-room lock, remove duplicated bot paths and send-function monkeypatch | in-progress | ES-001, ES-002 |
| [ES-006](../stories/10-engine-seam/ES-006.md) | Test-mode endpoints | in-progress | ES-003, ES-005 |

## Non-goals

- Rewriting game rules.
- Changing the wire format of client messages (the contract documents the existing one).
- Persistence beyond process memory (snapshots make it possible; storing them is a later story).

## Status

- **Created**: 2026-11-14
