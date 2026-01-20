# Epic 1: Frontend Foundation

## Overview

Establish the React + TypeScript project with a complete design system based on the "Bloomberg Terminal meets Modern Pixel Art" aesthetic. This foundation enables all subsequent UI work.

## Goals

- Set up modern React development environment
- Implement design tokens matching `docs/ui/design-system.md`
- Build reusable layout and form components
- Enable consistent styling across all game UI

## Tech Stack

- **Build**: Vite
- **Framework**: React 18 with TypeScript
- **Styling**: CSS Variables + CSS Modules
- **Routing**: React Router v6
- **Testing**: Vitest + Playwright

## Stories

### Phase 1: Project Setup (No Dependencies)

| ID | Title | Effort | Status |
|----|-------|--------|--------|
| [FF-001](../stories/01-frontend-foundation/FF-001.md) | Project Setup | M | complete |
| [FF-010](../stories/01-frontend-foundation/FF-010.md) | Routing Setup | S | not-started |

### Phase 2: Design Tokens (After FF-001)

| ID | Title | Effort | Status |
|----|-------|--------|--------|
| [FF-002](../stories/01-frontend-foundation/FF-002.md) | Design Tokens | S | not-started |
| [FF-003](../stories/01-frontend-foundation/FF-003.md) | Typography System | S | not-started |

### Phase 3: Core Styling (After FF-002)

| ID | Title | Effort | Status |
|----|-------|--------|--------|
| [FF-004](../stories/01-frontend-foundation/FF-004.md) | Color System | S | not-started |

### Phase 4: Layout Components (After FF-002, FF-003)

| ID | Title | Effort | Status |
|----|-------|--------|--------|
| [FF-005](../stories/01-frontend-foundation/FF-005.md) | Layout Components | M | not-started |
| [FF-006](../stories/01-frontend-foundation/FF-006.md) | Button Component | S | not-started |

### Phase 5: Interactive Components (After FF-006)

| ID | Title | Effort | Status |
|----|-------|--------|--------|
| [FF-007](../stories/01-frontend-foundation/FF-007.md) | Input Components | S | not-started |
| [FF-008](../stories/01-frontend-foundation/FF-008.md) | Modal Component | M | not-started |
| [FF-009](../stories/01-frontend-foundation/FF-009.md) | Toast System | S | not-started |

## Dependency Graph

```
FF-001 (Project Setup)
   ├── FF-002 (Design Tokens)
   │      └── FF-004 (Color System)
   ├── FF-003 (Typography)
   └── FF-010 (Routing)

FF-002 + FF-003
   └── FF-005 (Layout Components)

FF-002 + FF-004
   └── FF-006 (Button)
         └── FF-007 (Inputs)

FF-005 + FF-006
   ├── FF-008 (Modal)
   └── FF-009 (Toast)
```

## Success Criteria

### Development Environment
- [ ] `npm run dev` starts development server on port 5173
- [ ] `npm run build` produces production bundle in `dist/`
- [ ] Hot module replacement works correctly
- [ ] TypeScript strict mode enabled with no errors

### Testing Infrastructure
- [ ] `npm run test` runs Vitest unit tests
- [ ] `npm run test -- --coverage` shows >80% coverage for `src/components/`, `src/hooks/`, `src/lib/`
- [ ] `npm run e2e` runs Playwright tests against running backend
- [ ] All component tests pass with documented test cases (see individual story Testing Requirements)
- [ ] WebSocket mock utilities available for unit testing (`tests/mocks/websocket.ts`)
- [ ] Test fixtures provide consistent mock game state (`tests/fixtures/gameState.ts`)

### Code Quality
- [ ] `npm run lint` passes with no ESLint errors
- [ ] `npm run format` enforces Prettier formatting
- [ ] All components use design tokens (no hardcoded colors/spacing)
- [ ] CSS Modules used for component styling

### Component Library
- [ ] All layout components (Header, PageShell, Card, Panel) implemented and tested
- [ ] Button component with all variants (primary, secondary, ghost, danger) and states
- [ ] Input components (TextInput, Select, RadioGroup) implemented and tested
- [ ] Modal component with focus trap and keyboard handling
- [ ] Toast system with auto-dismiss and stacking

### Integration Readiness
- [ ] Vite proxy configured for `/api` and `/ws` routes
- [ ] React Router configured with all placeholder pages
- [ ] Test infrastructure ready for Real-time Integration epic (RT-001+)
- [ ] E2E test scenarios documented in `docs/tests/frontend-e2e/`

## Testing Documentation

All frontend testing follows the standards established in [FF-001](../stories/01-frontend-foundation/FF-001.md#testing-standards):

- **Coverage target**: >80% for components, hooks, and lib
- **Test naming**: Collocated `*.test.tsx` files
- **E2E scenarios**: See [`docs/tests/frontend-e2e/`](../../tests/frontend-e2e/README.md)

## Reference

- [Design System](../../ui/design-system.md) - Colors, typography, spacing
- [Components Spec](../../ui/components.md) - Component props and structure
