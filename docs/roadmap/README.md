# Buyout Product Roadmap

> A structured roadmap enabling parallel development by multiple Claude sessions.

## Direction (owner decisions, 2026-11-14)

1. **No rebuild.** Keep the rules engine (backend suite: 1,090 tests, 12 s without the `slow` ones, about 2 min with them). Rebuild the seam between the engine
   and everything that drives it ([Epic 10](epics/10-engine-seam.md)). Contract:
   [docs/architecture/seat-contract.md](../architecture/seat-contract.md).
2. **A seat is a human, an LLM, a heuristic bot, or a scripted player.** The engine cannot tell
   which. Mechanistic RL is dropped for good; LLM opponents are first-class
   ([Epic 9](epics/09-llm-bot.md)).
3. **Player-to-player trading stays**, including for LLM seats.
4. **Complete game transcripts** for every game, live and benchmark, including what each AI seat
   was shown and what it answered ([Epic 12](epics/12-bench.md)). Users can browse and
   replay finished games.
5. **Buyout Bench is a product**: a versioned, standalone-runnable benchmark of models playing
   each other and the rules-based baseline, with a public leaderboard that links to transcripts
   ([Epic 12](epics/12-bench.md)).
6. **LLM failures are retried, then visible**: an illegal move goes back to the model (default up
   to 4 retries); only timeout, provider error or exhausted retries hand that decision to the
   rules-based player, and everyone at the table is told. LLM opponents can be picked only when
   their API key is configured.
7. **One Railway service**, single replica; transcripts need a persistent volume to survive
   redeploys (open item, AB-008).
8. **Four-tier test pyramid** ([Epic 11](epics/11-test-pyramid.md)). Measured problem: backend tests
   take 2 s; the Playwright scenario suite (62 tests, about 9,300 lines) did not finish in 10
   minutes because tests play 20-40 turns through the browser to reach the screen under test.

## Quick Start for Agents

1. Find a story with `Status: not-started` and no blocking dependencies
2. Update status to `in-progress` in the story file
3. Follow the Implementation Notes and Acceptance Criteria
4. Run verification commands
5. Update status to `complete` and commit

## Current Sprint Status

| Epic | Progress | Available Stories |
|------|----------|-------------------|
| [Real-time Integration](epics/03-realtime-integration.md) | 5/6 | RT-004 (optional) |
| [Security Hardening](epics/06-security-hardening.md) | 0/5 | SH-002..SH-005 (SH-001 after test pyramid) |
| [Backlog](epics/08-backlog.md) | 8/10, BL-004 superseded (BL-008 game-page tabs, BL-009 visual pass, BL-010 seat names and badge done) | BL-005 |
| [LLM Opponents](epics/09-llm-bot.md) | 2/7 (LO-006 harness, LO-008 table chat done; LO-007 superseded) | LO-001..LO-005 partly built; LO-003 needs the 4-retry loop and fallback notice |
| [Engine Seam](epics/10-engine-seam.md) | 6/6 (ES-001..ES-006) | Complete (fuzz volume: 600 games in the slow tier) |
| [Test Pyramid](epics/11-test-pyramid.md) | 5/9 (TP-001, TP-004..TP-007) | TP-002, TP-003 partly built; TP-008 workflow written, needs a green PR run; TP-009 (remaining display-state gaps) |
| [Transcripts & Buyout Bench](epics/12-bench.md) | 0/9 | AB-001..AB-007 in-progress; AB-008 (blocked: volume), AB-009 (blocked: API key) |

Counts checked against the repo on 2026-11-14 (`pytest backend/tests -n auto`: 1,283 passed, 0 xfailed; 1,216 of them in the fast tier).
A story is counted done only when every acceptance criterion is ticked; the status note at the
bottom of each in-progress story says what is open.

## Story Status Key

| Status | Meaning |
|--------|---------|
| `not-started` | Ready for pickup |
| `in-progress` | Being worked on |
| `blocked` | Waiting on dependencies |
| `complete` | Done and verified |
| `superseded` | Scrapped or replaced; kept for history, do not implement |

## Parallelization Guide

```
Track A: ENGINE SEAM            Track B: SEATS / LLM            Track C: TEST PYRAMID
────────────────────            ────────────────────            ─────────────────────
ES-001 decisions + apply        LO-001 providers + catalog      TP-006 coverage map
   ↓                               (interface only: ES-001)        (skeleton; can start now)
ES-002 event log                    ↓                           TP-001 snapshot generator
ES-004 calculator pack          LO-002 prompt builder              (after ES-003)
ES-003 snapshot/restore         LO-003 decision loop            TP-002 scripted seats
   ↓                            LO-004 trade responses             (after ES-005, ES-006)
ES-005 driver + lock            LO-005 lobby UI + thinking      TP-003 protocol suite
ES-006 test-mode endpoints      LO-006 benchmark harness        TP-004 screen tests
                                LO-007 observability            TP-005 journeys
                                                                TP-007 retire old suite
                                                                TP-008 CI wiring

Track F: TRANSCRIPTS & BUYOUT BENCH (Epic 12)
──────────────────────────────────────────────
AB-001 transcript writer  (wants LO-003 attempts data)
   ↓                 ↘
AB-002 HTTP API       AB-005 protocol bench-v1
   ↓                     ↓
AB-003 viewer UI      AB-004 standalone eval + CI    AB-006 ratings + leaderboard
                                                        ↓
                                                     AB-007 leaderboard UI
AB-008 persistence (blocked: Railway volume)    AB-009 first results (blocked: API key)

Track D: SECURITY (SH-002..005 can start any time; SH-001 after the test pyramid)
Track E: DEPLOYMENT (done; production deploy waits for security)
```

Tracks A, B, C and F run at the same time (F's AB-001 wants the LO-003 retry loop for the
`attempts` data; the rest can start from the contract). Within each, follow the dependency column in the epic
table. B depends on A only through ES-001 (interface), ES-002/004 (prompt inputs), ES-005 (driver).
C depends on A through ES-003, ES-005 and ES-006.

### Critical Path

```
[DONE] Backend Hardening → Frontend Foundation → Game UI → WebSocket core
                                   ↓
             Engine seam (Epic 10)  ← mostly built (3/6 complete; others have a few open criteria)
                                   ↓
        ┌──────────────────────────┴──────────────────────────┐
  Seats / LLM opponents (Epic 9)                 Test pyramid (Epic 11)
  + Transcripts & Buyout Bench (Epic 12)
        └──────────────────────────┬──────────────────────────┘
                                   ↓
                         Security hardening (Epic 6)
                                   ↓
                              Production deploy
                  (AB-008 volume and AB-009 first real benchmark run need the
                   owner: a Railway volume and an API key)
```

## How to Claim a Story

1. Check the story's `Dependencies`; verify no other agent has it `in-progress` (stories of
   Epics 9-12 are `in-progress` as of 2026-11-14 because they are being implemented now; check the
   branch/PR before starting one).
2. Read the story file and the relevant section of the seat contract.
3. **Verify actual codebase APIs match story examples** (they may be outdated).
4. Set status to `in-progress`, commit `claim: <STORY-ID> - <title>`.
5. On completion: tick acceptance criteria, set status `complete`, update the progress table above,
   commit `<STORY-ID>: <what was implemented>`.

### Post-Completion Review

After each story, check: does it meet the spirit of the requirements; will it work with the real
backend/frontend; are there testing gaps (real user scenarios, not just code paths); is a follow-up
story needed? If a gap is found, create the story immediately.

## Story File Structure

```markdown
# [STORY-ID]: [Title]

## Metadata
- **Epic**: [Epic Name]
- **Status**: `not-started` | `in-progress` | `complete` | `superseded`
- **Priority**: `critical` | `high` | `medium` | `low`
- **Effort**: `XS` (<30m) | `S` (30-60m) | `M` (1-2h) | `L` (2-4h)
- **Dependencies**: [List of story IDs or "None"]

## Context
## Requirements
## Acceptance Criteria
- [ ] [Testable criterion]
## Implementation Notes
## Verification
```

## Epic Overview

Finished or scrapped epics have no files any more (their stories were deleted when the docs were
pruned on 2026-11-15; the code is the record): Epic 0 Backend Hardening, Epic 1 Frontend
Foundation, Epic 2 Game UI and Epic 5 Deployment are done. Epic 4 (reinforcement learning / MCTS
training) was scrapped for good in favour of LLM opponents (Epic 9). Epic 7 (the first browser
scenario suite) was replaced by Epic 11; see
[legacy-suite-retirement.md](../tests/legacy-suite-retirement.md).

| Epic | Summary |
|------|---------|
| 3 Real-time Integration | WebSocket client and state sync. RT-004 optional. |
| 6 Security Hardening | CORS, rate limiting, validation, session tokens. Must finish before production deploy. |
| 8 Backlog | Ideas discovered in use (BL-XXX). |
| 9 LLM Opponents | LLM seats: provider adapters, prompt builder, decision loop with validate/retry/fallback (visible), trading, lobby UI, benchmark harness. Observability moved to Epic 12. |
| 10 Engine Seam | Decisions API, single apply entry point, event log, snapshots, calculator pack, seat driver, test-mode endpoints. |
| 11 Test Pyramid | Engine, protocol, screen (snapshots), journey (home page) tiers; surface coverage map. |
| 12 Transcripts & Buyout Bench | Transcript of every game (prompts, answers, retries, fallbacks), redacted HTTP API, replay viewer, standalone versioned benchmark `bench-v1`, ratings, leaderboard page, persistence, first results. |

## Reference Documentation

| Document | Purpose |
|----------|---------|
| [docs/architecture/seat-contract.md](../architecture/seat-contract.md) | Seat/engine contract (authoritative) |
| [docs/ai/benchmarking.md](../ai/benchmarking.md) | Buyout Bench: how to run, read and extend it |
| [docs/tests/surface-coverage.md](../tests/surface-coverage.md) | Which test covers which user-visible surface |
| [docs/rules/](../rules/) | Game rules reference |
