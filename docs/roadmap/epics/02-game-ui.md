# Epic 2: Game UI

## Overview

Build all game-specific UI components and pages, from the lobby through game over. Components must handle all game phases, states, and edge cases documented in the storyboard.

## Goals

- Implement lobby for game creation/joining
- Build the 12x9 game board with all tile states
- Create player view (mobile-optimized)
- Create host view (TV-optimized)
- Handle all game phases: trading, tile placement, chain founding, mergers, stock buying

## Tech Stack

- **Components**: React + TypeScript
- **State**: Zustand (from RT-002)
- **Testing**: Vitest + Playwright e2e

## Stories

### Phase 1: Entry Point

| ID | Title | Effort | Dependencies | Status |
|----|-------|--------|--------------|--------|
| [GU-001](../stories/02-game-ui/GU-001.md) | Lobby Page | M | FF-005, FF-006, FF-007, FF-010 | complete |

### Phase 2: Board Components

| ID | Title | Effort | Dependencies | Status |
|----|-------|--------|--------------|--------|
| [GU-002](../stories/02-game-ui/GU-002.md) | Board Component | L | FF-002, FF-004 | complete |
| [GU-003](../stories/02-game-ui/GU-003.md) | Tile Component | M | FF-002, FF-004 | complete |
| [GU-005](../stories/02-game-ui/GU-005.md) | Chain Marker | S | FF-004 | complete |

### Phase 3: Player Components

| ID | Title | Effort | Dependencies | Status |
|----|-------|--------|--------------|--------|
| [GU-004](../stories/02-game-ui/GU-004.md) | Tile Rack | M | GU-003 | complete |
| [GU-006](../stories/02-game-ui/GU-006.md) | Player Card | M | FF-005, GU-005 | complete |
| [GU-007](../stories/02-game-ui/GU-007.md) | Portfolio Display | M | GU-005, GU-006 | complete |

### Phase 4: Action Components

| ID | Title | Effort | Dependencies | Status |
|----|-------|--------|--------------|--------|
| [GU-008](../stories/02-game-ui/GU-008.md) | Stock Stepper | S | FF-006 | complete |
| [GU-009](../stories/02-game-ui/GU-009.md) | Chain Selector | M | GU-005, FF-008 | complete |
| [GU-010](../stories/02-game-ui/GU-010.md) | Merger Disposition | L | GU-008, FF-008 | complete |
| [GU-011](../stories/02-game-ui/GU-011.md) | Trade Builder | L | GU-008, GU-009, FF-008 | not-started |

### Phase 5: Page Shells

| ID | Title | Effort | Dependencies | Status |
|----|-------|--------|--------------|--------|
| [GU-012](../stories/02-game-ui/GU-012.md) | Player View Shell | L | GU-004, GU-007, FF-005, RT-002 | not-started |
| [GU-013](../stories/02-game-ui/GU-013.md) | Host View Layout | L | GU-002, GU-006, FF-005, RT-002 | not-started |

### Phase 6: Terminal States

| ID | Title | Effort | Dependencies | Status |
|----|-------|--------|--------------|--------|
| [GU-014](../stories/02-game-ui/GU-014.md) | Game Over Screen | M | GU-006, FF-008 | not-started |
| [GU-015](../stories/02-game-ui/GU-015.md) | Reconnection UI | M | FF-008, FF-009 | not-started |

### Phase 7: Comprehensive Testing

| ID | Title | Effort | Dependencies | Status |
|----|-------|--------|--------------|--------|
| [GU-016](../stories/02-game-ui/GU-016.md) | Comprehensive E2E Test Suite | L | GU-001 through GU-015, FF-011 | not-started |

## Dependency Graph

```
FF-005, FF-006, FF-007, FF-010
   └── GU-001 (Lobby)

FF-002, FF-004
   ├── GU-002 (Board)
   ├── GU-003 (Tile) ──► GU-004 (Tile Rack)
   └── GU-005 (Chain Marker)

GU-005
   ├── GU-006 (Player Card) ──► GU-007 (Portfolio)
   └── GU-009 (Chain Selector)

FF-006
   └── GU-008 (Stock Stepper)

GU-008 + FF-008
   └── GU-010 (Merger Disposition)

GU-008 + GU-009 + FF-008
   └── GU-011 (Trade Builder)

GU-004 + GU-007 + RT-002
   └── GU-012 (Player View)

GU-002 + GU-006 + RT-002
   └── GU-013 (Host View)

GU-001..GU-015 + FF-011
   └── GU-016 (Comprehensive E2E Tests)
```

## Success Criteria

- [ ] All screens from storyboard are implemented
- [ ] Components handle all documented states
- [ ] Mobile view works on 375px+ screens
- [ ] Host view readable from 10ft distance
- [ ] E2E tests cover complete game flows
- [ ] Accessibility: keyboard navigation, screen reader support

## Reference

- [Storyboard](../../ui/storyboard.md) - Complete UI specification
- [Components Spec](../../ui/components.md) - Component props
- [Design System](../../ui/design-system.md) - Visual guidelines
