# Epic 7: Scenario Test Automation

## Overview

Full E2E scenario testing using Playwright with screenshots as test artifacts. These tests exercise the complete stack: Browser → Frontend → WebSocket → Backend → Game Engine.

**Philosophy:** "If there's no screenshot, it didn't happen."

## Goals

- Validate end-to-end integration across all system layers
- Provide visual proof via screenshots at every significant step
- Establish patterns for proper E2E testing practices
- Cover all 124 documented game scenarios

## Tech Stack

- **Testing**: Playwright
- **Artifacts**: Screenshots saved to `test-results/scenarios/`
- **Servers**: Real backend + frontend (no mocks)

## Dependencies

**Required before starting:**
- RT-001 (WebSocket Server Integration)
- RT-002 (WebSocket Client Integration)

WebSocket integration must be complete for E2E gameplay tests.

## Stories

### Phase 1: Infrastructure

| ID | Title | Effort | Dependencies | Status |
|----|-------|--------|--------------|--------|
| [ST-001](../stories/07-scenario-tests/ST-001.md) | E2E Scenario Test Infrastructure | M | None | complete |

### Phase 2: Core Scenarios (Parallel)

| ID | Title | Effort | Dependencies | Status |
|----|-------|--------|--------------|--------|
| [ST-002](../stories/07-scenario-tests/ST-002.md) | Turn Flow E2E Tests | M | ST-001 | not-started |
| [ST-003](../stories/07-scenario-tests/ST-003.md) | Trading E2E Tests | L | ST-001 | not-started |
| [ST-004](../stories/07-scenario-tests/ST-004.md) | Chain Founding E2E Tests | M | ST-001 | not-started |
| [ST-005](../stories/07-scenario-tests/ST-005.md) | Chain Expansion E2E Tests | M | ST-001 | not-started |
| [ST-006](../stories/07-scenario-tests/ST-006.md) | Merger E2E Tests | L | ST-001 | not-started |
| [ST-007](../stories/07-scenario-tests/ST-007.md) | Stock Purchase E2E Tests | M | ST-001 | not-started |
| [ST-008](../stories/07-scenario-tests/ST-008.md) | End Game E2E Tests | M | ST-001 | not-started |

### Phase 3: Edge Cases & Reporting

| ID | Title | Effort | Dependencies | Status |
|----|-------|--------|--------------|--------|
| [ST-009](../stories/07-scenario-tests/ST-009.md) | Edge Case E2E Tests | L | ST-001 | not-started |
| [ST-010](../stories/07-scenario-tests/ST-010.md) | Scenario Coverage Report | S | ST-002 through ST-009 | not-started |

## Parallelization

```
                    ST-001 (Infrastructure)
                           │
   ┌───────┬───────┬───────┼───────┬───────┬───────┐
   ▼       ▼       ▼       ▼       ▼       ▼       ▼
ST-002  ST-003  ST-004  ST-005  ST-006  ST-007  ST-008
   │       │       │       │       │       │       │
   └───────┴───────┴───────┼───────┴───────┴───────┘
                           ▼
                        ST-009
                           │
                           ▼
                        ST-010
```

After ST-001, stories ST-002 through ST-008 can run in parallel.

## Replaces Game UI E2E Stories

This epic replaces the following Game UI E2E stories:
- GU-017 (Lobby E2E) → Covered by ST-001 infrastructure + lobby scenarios
- GU-018 (Gameplay E2E) → Covered by ST-002, ST-004, ST-005, ST-007
- GU-019 (Merger E2E) → Covered by ST-006
- GU-020 (Reconnection E2E) → Covered by ST-009 edge cases
- GU-021 (Error Handling E2E) → Covered by ST-009 edge cases
- GU-022 (Trading E2E) → Covered by ST-003

## Screenshot Artifact Pattern

Each test captures screenshots like:
```
test-results/scenarios/
├── turn-flow/
│   ├── scenario-1.1-basic-turn/
│   │   ├── 01-initial-state.png
│   │   ├── 02-tile-placed.png
│   │   ├── 03-stock-purchased.png
│   │   └── 04-turn-complete.png
│   └── scenario-1.5-merger-during-turn/
│       └── ...
├── trading/
│   └── ...
└── ...
```

## Success Criteria

- [ ] All 124 documented scenarios have E2E tests
- [ ] Every test captures screenshots at key steps
- [ ] Screenshots saved to `test-results/scenarios/`
- [ ] Tests run against real servers (not mocked)
- [ ] Console errors captured and fail tests if present
- [ ] All E2E scenario tests pass

## Reference

- [Scenario Documentation](../../tests/scenario-docs.md)
- [Frontend E2E README](../../tests/frontend-e2e/README.md)
- [Storyboard](../../ui/storyboard.md)
