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
| [FF-001](../stories/01-frontend-foundation/FF-001.md) | Project Setup | M | not-started |
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

- [ ] `npm run dev` starts development server
- [ ] `npm run build` produces production bundle
- [ ] `npm run test` runs component tests
- [ ] `npm run e2e` runs Playwright tests
- [ ] All components render correctly with design tokens
- [ ] Storybook (optional) shows component library

## Reference

- [Design System](../../ui/design-system.md) - Colors, typography, spacing
- [Components Spec](../../ui/components.md) - Component props and structure
