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
| [Game UI](epics/02-game-ui.md) | 7/16 | GU-007, GU-009, GU-010 (unblocked) |
| [Real-time Integration](epics/03-realtime-integration.md) | 0/6 | RT-001, RT-002 (unblocked) |
| [AI Training](epics/04-ai-training.md) | 0/9 | AI-001, AI-003 |
| [Deployment](epics/05-deployment.md) | 0/5 | DP-001 |
| [Security Hardening](epics/06-security-hardening.md) | 0/5 | SH-002, SH-003, SH-004, SH-005 (after E2E: SH-001) |

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
GU-007, GU-009, GU-010 (now unblocked)
    ↓
  ...etc
    ↓
GU-016 (E2E Tests)
    ↓
SH-001 ──────────────────────  Track 4: SECURITY (after E2E)
SH-002, SH-003, SH-004, SH-005 ← can start anytime
    ↓
Production Deploy
```

### Critical Path

```
[DONE] BH-001 → BH-002/003/004 → [DONE] FF-001 → [DONE] FF-002 through FF-011 → [DONE] GU-001/GU-002/GU-003 → [DONE] GU-004/GU-005 → [DONE] GU-006/GU-008 → GU-007 through GU-015 → RT Integration → GU-016 (E2E) → Security Hardening → Deploy
                                                                                                                                        ↑
                                                                                                                                  YOU ARE HERE
```

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

### Epic 2: Game UI (16 stories) - 7 COMPLETE
Build all game-specific UI components and pages.
- **Tech**: React components, game state integration
- **Complete**: GU-001 (Lobby Page), GU-002 (Board), GU-003 (Tile), GU-004 (Tile Rack), GU-005 (Chain Marker), GU-006 (Player Card), GU-008 (Stock Stepper)
- **Available**: GU-007 (Portfolio Display), GU-009 (Chain Selector), GU-010 (Merger Disposition)
- **Final**: GU-016 (Comprehensive E2E Tests) - implements all test scenarios from `docs/tests/frontend-e2e/`

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
- **Start**: SH-002, SH-003, SH-004, SH-005 (independent); SH-001 after GU-016
- **Note**: Must complete before production deployment

## Reference Documentation

| Document | Purpose |
|----------|---------|
| [docs/ui/storyboard.md](../ui/storyboard.md) | Complete UI specification |
| [docs/ui/design-system.md](../ui/design-system.md) | Colors, typography, spacing |
| [docs/ui/components.md](../ui/components.md) | Component props and structure |
| [docs/ai/ROADMAP.md](../ai/ROADMAP.md) | AI training phases |
| [docs/rules/](../rules/) | Game rules reference |
