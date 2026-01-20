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
| [Frontend Foundation](epics/01-frontend-foundation.md) | 0/10 | FF-001 |
| [Game UI](epics/02-game-ui.md) | 0/15 | (blocked by FF) |
| [Real-time Integration](epics/03-realtime-integration.md) | 0/6 | RT-001, RT-002 |
| [AI Training](epics/04-ai-training.md) | 0/9 | AI-001, AI-003 |
| [Deployment](epics/05-deployment.md) | 0/5 | DP-001 |

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
Track 1: FRONTEND          Track 2: AI TRAINING       Track 3: DEPLOYMENT
─────────────────          ─────────────────────      ──────────────────
FF-001 (Project Setup)     AI-001 (MCTS Basic)        DP-001 (Railway)
    ↓                      AI-003 (State Encoder)         ↓
FF-002, FF-003, FF-010         ↓                     DP-002, DP-004
    ↓                      AI-002, AI-004, AI-005        ↓
FF-004, FF-005, FF-006         ↓                     DP-003, DP-005
    ↓                      AI-006, AI-007, AI-008
FF-007, FF-008, FF-009         ↓
    ↓                      AI-009
GU-001, GU-002, GU-003
    ↓
  ...etc
```

### Critical Path

```
FF-001 → FF-002/FF-003 → FF-005/FF-006 → GU-002/GU-003 → GU-012/GU-013 → RT Integration → Deploy
```

## How to Claim a Story

### Before Starting
1. Check the story's `Dependencies` - all must be `complete`
2. Verify no other agent has it `in-progress`
3. Read the full story file including Implementation Notes

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

### Epic 1: Frontend Foundation (10 stories)
Setup React + TypeScript project with design system components.
- **Tech**: Vite, React 18, TypeScript, CSS Variables
- **Start**: FF-001 (no dependencies)

### Epic 2: Game UI (15 stories)
Build all game-specific UI components and pages.
- **Tech**: React components, game state integration
- **Start**: After FF-005, FF-006, FF-007

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

## Reference Documentation

| Document | Purpose |
|----------|---------|
| [docs/ui/storyboard.md](../ui/storyboard.md) | Complete UI specification |
| [docs/ui/design-system.md](../ui/design-system.md) | Colors, typography, spacing |
| [docs/ui/components.md](../ui/components.md) | Component props and structure |
| [docs/ai/ROADMAP.md](../ai/ROADMAP.md) | AI training phases |
| [docs/rules/](../rules/) | Game rules reference |
