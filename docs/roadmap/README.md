# Acquire Product Roadmap

> A structured roadmap enabling parallel development by multiple Claude sessions.

## Quick Start for Agents

1. Find a story with `Status: not-started` and no blocking dependencies
2. Update status to `in-progress` in the story file
3. Follow the Implementation Notes and Acceptance Criteria
4. Run verification commands
5. Update status to `complete` and commit

## Current Sprint Status

| Epic | Progress | Available Stories |
|------|----------|-------------------|
| [Backend Hardening](epics/00-backend-hardening.md) | 13/13 ✅ | Complete |
| [Frontend Foundation](epics/01-frontend-foundation.md) | 11/11 ✅ | Complete |
| [Game UI](epics/02-game-ui.md) | 16/16 ✅ | Complete |
| [Real-time Integration](epics/03-realtime-integration.md) | 5/6 | RT-004 (optional enhancement) |
| [AI Training](epics/04-ai-training.md) | 0/9 | AI-001, AI-003 |
| [Deployment](epics/05-deployment.md) | 0/5 | DP-001 |
| [Security Hardening](epics/06-security-hardening.md) | 0/5 | SH-002, SH-003, SH-004, SH-005 (after E2E: SH-001) |
| [Scenario Tests](epics/07-scenario-tests.md) | 1/10 | ST-002 through ST-008 (parallel) |

## Story Status Key

| Status | Meaning |
|--------|---------|
| `not-started` | Ready for pickup |
| `in-progress` | Being worked on |
| `blocked` | Waiting on dependencies |
| `complete` | Done and verified |

## Parallelization Guide

### Independent Tracks (Run Simultaneously)

```
Track 1: BACKEND → FRONTEND    Track 2: AI TRAINING       Track 3: DEPLOYMENT
───────────────────────────    ─────────────────────      ──────────────────
BH-001 (Unify State)           AI-001 (MCTS Basic)        DP-001 (Railway)
BH-007,009,010 (Tests)         AI-003 (State Encoder)         ↓
    ↓                              ↓                     DP-002, DP-004
BH-002,003,004,005,006         AI-002, AI-004, AI-005        ↓
BH-008,011,012 (Tests)             ↓                     DP-003, DP-005
    ↓                          AI-006, AI-007, AI-008
FF-001 (Project Setup) ✓           ↓
FF-002 (Design Tokens) ✓       AI-009
FF-003 (Typography) ✓
FF-004 (Colors) ✓
FF-005 (Layout) ✓
FF-006 (Button) ✓
FF-010 (Routing) ✓
FF-011 (E2E Infrastructure) ✓
FF-007 (Inputs) ✓
FF-008 (Modal) ✓
FF-009 (Toast) ✓
    ↓
GU-001, GU-002, GU-003 ✓
    ↓
GU-004, GU-005 ✓
    ↓
GU-006, GU-008 ✓
    ↓
GU-007, GU-009, GU-010 ✓
    ↓
GU-011, GU-014, GU-015 ✓
    ↓
GU-012, GU-013 ✓ (with placeholder handlers)
    ↓
GU-016 (E2E Infrastructure Validation) ✓
    ↓
RT-001, RT-002, RT-003, RT-005 (WebSocket core) ✓
    ↓
ST-001 (Scenario Test Infrastructure) ✓
    ↓
ST-002 to ST-008 (Core Scenario Tests - parallel) ← NEXT
    ↓
ST-009 (Edge Cases) → ST-010 (Coverage Report)
    ↓
SH-001 ──────────────────────  Track 4: SECURITY (after E2E)
SH-002, SH-003, SH-004, SH-005 ← can start anytime
    ↓
Production Deploy
```

### Critical Path

```
[DONE] Backend Hardening → [DONE] Frontend Foundation → [DONE] Game UI (GU-001 to GU-016)
                                                                    ↓
                                                  [DONE] RT-001/RT-002/RT-003/RT-005 (WebSocket core)
                                                                    ↓
                                                  [DONE] ST-001 (Scenario Test Infrastructure)
                                                                    ↓
                                                  ST-002 to ST-010 (Scenario Tests) ← YOU ARE HERE
                                                                    ↓
                                                  Security → Deploy
```

> **Note**: GU-012/GU-013 are complete but use placeholder action handlers. They become fully functional after RT-002 integration.
>
> **E2E Testing Strategy**: Epic 07 (Scenario Tests) provides comprehensive E2E testing after WebSocket integration. ST-001 sets up infrastructure, ST-002-008 test core gameplay scenarios in parallel, ST-009 covers edge cases, and ST-010 generates coverage reports.

## How to Claim a Story

### Before Starting
1. Check the story's `Dependencies` - all must be `complete`
2. Verify no other agent has it `in-progress`
3. Read the full story file including Implementation Notes
4. **Important**: Verify actual codebase APIs match story examples (they may be outdated)

### Claiming Process
```bash
# 1. Update story status
# Edit the story file: change Status from `not-started` to `in-progress`

# 2. Commit to claim
git add docs/roadmap/stories/<epic>/<story>.md
git commit -m "claim: <STORY-ID> - <title>"
git push
```

### Completing a Story
```bash
# 1. Verify acceptance criteria are met
# 2. Run verification commands in story file

# 3. Update story status to complete
# Edit the story file: change Status to `complete`

# 4. Commit your work
git add .
git commit -m "<STORY-ID>: <description of what was implemented>"
git push
```

### Post-Completion Review (IMPORTANT)

After completing each story, perform a brief review to identify gaps:

1. **Code Review**: Does the implementation actually meet the spirit of the requirements, not just the letter?
2. **Integration Gaps**: Will this work with the real backend/frontend? Are types aligned?
3. **Testing Gaps**: Are there realistic E2E scenarios that weren't covered? Can we test with bots?
4. **Future Work**: Should a follow-up story be created to address identified gaps?

**Example**: FF-001 set up Playwright but didn't configure it to start the backend, making real E2E tests impossible. This led to creating FF-011 (E2E Testing Infrastructure) to address the gap.

> **Rule**: If a gap is found, create a new story immediately rather than letting technical debt accumulate.

## Story File Structure

Each story follows this template:

```markdown
# [STORY-ID]: [Title]

## Metadata
- **Epic**: [Epic Name]
- **Status**: `not-started` | `in-progress` | `complete`
- **Priority**: `critical` | `high` | `medium` | `low`
- **Effort**: `XS` (<30m) | `S` (30-60m) | `M` (1-2h) | `L` (2-4h)
- **Dependencies**: [List of story IDs or "None"]

## Context
[Why this story exists and how it fits]

## Requirements
[What must be built]

## Acceptance Criteria
- [ ] [Testable criterion]

## Implementation Notes
[Suggested approach, files to create/modify]

## Verification
[Commands to verify completion]
```

## Effort Estimates

| Effort | Time | Typical Scope |
|--------|------|---------------|
| XS | <30 min | Single file change, config update |
| S | 30-60 min | Single component, simple feature |
| M | 1-2 hours | Multi-file feature, moderate complexity |
| L | 2-4 hours | Complex feature, multiple components |

## Epic Overview

### Epic 0: Backend Hardening (13 stories) ✅ COMPLETE
Fixed critical architecture issues and added comprehensive tests.
- **Tech**: Python, pytest, FastAPI
- **Result**: 645 tests (up from 365), unified state management, frontend-ready APIs
- **Next**: Frontend Foundation is now unblocked

### Epic 1: Frontend Foundation (11 stories) ✅ COMPLETE
Setup React + TypeScript project with design system components.
- **Tech**: Vite, React 18, TypeScript, CSS Variables
- **Result**: Complete design system with typography, colors, layout components, forms, modals, toasts
- **Next**: Game UI is now unblocked

### Epic 2: Game UI (16 stories) ✅ COMPLETE
Build all game-specific UI components and pages.
- **Tech**: React components, game state integration, Playwright E2E tests
- **Complete**: GU-001 (Lobby Page), GU-002 (Board), GU-003 (Tile), GU-004 (Tile Rack), GU-005 (Chain Marker), GU-006 (Player Card), GU-007 (Portfolio Display), GU-008 (Stock Stepper), GU-009 (Chain Selector), GU-010 (Merger Disposition), GU-011 (Trade Builder), GU-012 (Player View Shell), GU-013 (Host View Layout), GU-014 (Game Over Screen), GU-015 (Reconnection UI), GU-016 (E2E Infrastructure Validation)
- **Next**: Epic 7 (Scenario Tests) provides comprehensive E2E testing

### Epic 3: Real-time Integration (6 stories)
WebSocket client and state synchronization.
- **Tech**: WebSocket, Zustand, message handlers
- **Start**: RT-001, RT-002 (after FF-001)

### Epic 4: AI Training (9 stories)
Neural network bots and training pipeline.
- **Tech**: Python, PyTorch, MCTS
- **Start**: AI-001, AI-003 (fully independent)

### Epic 5: Deployment (5 stories)
Production deployment and monitoring.
- **Tech**: Railway, Docker, logging
- **Start**: DP-001 (fully independent)

### Epic 6: Security Hardening (5 stories)
Harden API security before production.
- **Tech**: CORS, rate limiting, input validation, session tokens
- **Start**: SH-002, SH-003, SH-004, SH-005 (independent); SH-001 after E2E
- **Note**: Must complete before production deployment

### Epic 7: Scenario Test Automation (10 stories)
Full E2E scenario testing with screenshots as proof.
- **Tech**: Playwright, screenshot capture, real server testing
- **Philosophy**: "If there's no screenshot, it didn't happen."
- **Start**: ST-001 after RT-001/RT-002 (WebSocket integration required)
- **Parallel**: ST-002 to ST-008 can run simultaneously after ST-001
- **Coverage**: All 124 documented game scenarios

## Reference Documentation

| Document | Purpose |
|----------|---------|
| [docs/ui/storyboard.md](../ui/storyboard.md) | Complete UI specification |
| [docs/ui/design-system.md](../ui/design-system.md) | Colors, typography, spacing |
| [docs/ui/components.md](../ui/components.md) | Component props and structure |
| [docs/ai/ROADMAP.md](../ai/ROADMAP.md) | AI training phases |
| [docs/rules/](../rules/) | Game rules reference |
