# Epic 00: Backend Hardening

## Overview

Harden the backend before frontend development begins. This epic addresses critical architecture issues, adds missing functionality required by the frontend, and fills test coverage gaps.

**This epic should be completed before starting Frontend Foundation (Epic 01).**

## Why This Epic Exists

Analysis of the backend revealed:

1. **Dual State Management**: `main.py` uses raw dicts while `game.py` defines a proper `Game` class, creating parallel state systems
2. **Code Duplication**: ~150 lines of bot turn logic duplicated between `main.py` and `game.py`
3. **Missing Frontend Features**: Event logging, end-game declaration, merger queue visibility, tile playability details
4. **Test Gaps**: No tests for complex mergers, session manager, action module, reconnection scenarios

## Stories

| ID | Title | Priority | Effort | Dependencies |
|----|-------|----------|--------|--------------|
| [BH-001](../stories/00-backend-hardening/BH-001.md) | Unify State Management | critical | L | None |
| [BH-002](../stories/00-backend-hardening/BH-002.md) | Remove Bot Turn Duplication | high | M | BH-001 |
| [BH-003](../stories/00-backend-hardening/BH-003.md) | Add Event/Activity Logging | high | M | BH-001 |
| [BH-004](../stories/00-backend-hardening/BH-004.md) | Implement End-Game Declaration | high | M | BH-001 |
| [BH-005](../stories/00-backend-hardening/BH-005.md) | Add Merger Queue Visibility | high | S | BH-001 |
| [BH-006](../stories/00-backend-hardening/BH-006.md) | Add Tile Playability Details | medium | S | BH-001 |
| [BH-007](../stories/00-backend-hardening/BH-007.md) | Complex Merger Scenario Tests | high | L | None |
| [BH-008](../stories/00-backend-hardening/BH-008.md) | Full Game Simulation Tests | high | L | BH-001 |
| [BH-009](../stories/00-backend-hardening/BH-009.md) | Session Manager Tests | medium | M | None |
| [BH-010](../stories/00-backend-hardening/BH-010.md) | Action Module Tests | medium | M | None |
| [BH-011](../stories/00-backend-hardening/BH-011.md) | WebSocket Reconnection Tests | medium | M | BH-001 |
| [BH-012](../stories/00-backend-hardening/BH-012.md) | Phase Transition Tests | high | M | BH-001 |
| [BH-013](../stories/00-backend-hardening/BH-013.md) | Add Typed API Response Classes | high | M | BH-001 |

## Parallelization

```
           ┌─────────────────────────────────────────┐
           │           Can Start Immediately          │
           │  BH-007    BH-009    BH-010             │
           │  (merger   (session  (action            │
           │   tests)    tests)    tests)            │
           └─────────────────────────────────────────┘
                              │
                              │ (parallel track)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        BH-001 (Critical)                         │
│                    Unify State Management                        │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ BH-002        │   │ BH-003        │   │ BH-004        │
│ Bot Dedup     │   │ Event Log     │   │ End Game Decl │
└───────────────┘   └───────────────┘   └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ BH-005        │   │ BH-006        │   │ BH-008        │
│ Merger Queue  │   │ Tile Playable │   │ Full Game Sim │
└───────────────┘   └───────────────┘   └───────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
            ┌───────────────┐   ┌───────────────┐
            │ BH-011        │   │ BH-012        │
            │ Reconnection  │   │ Phase Trans   │
            └───────────────┘   └───────────────┘
```

## Success Criteria

- [x] All 365+ existing tests still pass
- [x] ~280 new tests added (actual: 645 total, exceeds 420+ target)
- [x] `main.py` uses `Game` class exclusively (no raw dict state)
- [x] Frontend-required features implemented (events, end-game, etc.)
- [x] Test coverage >80% for `game/`, `session/`

## Completion Notes

**Epic completed January 2026.**

Key metrics:
- Total tests: 645 (target was 420+)
- All 13 stories implemented
- Backend is now ready for Frontend Foundation work

Lessons learned:
- Story implementation notes contained outdated code examples that didn't match actual APIs
- Always verify actual codebase APIs before implementing (e.g., `Rules.get_playable_tiles()` not `game.get_playable_tiles()`)
- Testing effort was underestimated; comprehensive testing required ~5x the projected new tests

## Estimated Effort

| Effort | Count | Hours |
|--------|-------|-------|
| L (2-4h) | 3 | 6-12 |
| M (1-2h) | 8 | 8-16 |
| S (30-60m) | 2 | 1-2 |
| **Total** | **13** | **15-30** |

## Key Files

**To Modify:**
- `backend/main.py` - Unify state, remove duplication, add new handlers
- `backend/session/manager.py` - Store `Game` instance instead of dict
- `backend/game/game.py` - Add event logging, end-game declaration
- `backend/game/rules.py` - Add tile playability details

**To Create:**
- `backend/tests/scenarios/test_complex_mergers.py`
- `backend/tests/test_full_game_simulation.py`
- `backend/tests/test_session_manager.py`
- `backend/tests/test_action.py`
- `backend/tests/test_websocket_reconnection.py`
- `backend/tests/test_phase_transitions.py`
