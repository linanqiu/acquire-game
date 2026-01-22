# Frontend E2E Test Specifications

This directory contains end-to-end test specifications for the frontend React application. These scenarios test complete user flows with the actual backend.

## Purpose

These specifications serve as:
- **E2E test design documentation**: Clear descriptions of user flows to test
- **Acceptance criteria**: Verifiable success conditions for each scenario
- **Implementation guidance**: Step-by-step actions for Playwright test authors
- **Cross-team communication**: Shared understanding between frontend and backend

## Test Framework

- **Runner**: Playwright
- **Config**: `frontend/playwright.config.ts`
- **Location**: `frontend/tests/e2e/*.spec.ts`

## Running E2E Tests

```bash
cd frontend

# Run all E2E tests
npm run e2e

# Run specific scenario
npm run e2e -- --grep "join room"

# Run in headed mode (see browser)
npm run e2e -- --headed

# Run with UI mode
npm run e2e -- --ui
```

## Prerequisites

E2E tests require the backend to be running:

```bash
# Terminal 1: Start backend
cd backend
uvicorn main:app --reload --port 8000

# Terminal 2: Run E2E tests
cd frontend
npm run e2e
```

## Scenario Format

Each scenario follows this structure:

```markdown
### Scenario X.Y: [Descriptive Name]

**Preconditions:**
- [Required state before test starts]

**Steps:**
1. [User action]
2. [Expected UI response]
3. [Next action...]

**Expected Outcomes:**
- [What the user should see]
- [State changes that should occur]

**Playwright Hints:**
- [Selectors, waits, or assertions to use]
```

## Specifications

| File | Coverage | Priority |
|------|----------|----------|
| [lobby-flow.md](lobby-flow.md) | Room creation, joining, player setup | Critical |
| [gameplay-flow.md](gameplay-flow.md) | Tile placement, stock buying, turn flow | Critical |
| [merger-flow.md](merger-flow.md) | Merger resolution, stock disposition | High |
| [trading-flow.md](trading-flow.md) | Player-to-player stock/money trades | High |
| [reconnection-flow.md](reconnection-flow.md) | Disconnect/reconnect scenarios | High |
| [error-handling.md](error-handling.md) | Error messages, recovery flows | Medium |

## Numbering Convention

Scenarios are numbered by category:

| Prefix | Category |
|--------|----------|
| E2E-1.x | Lobby Flow |
| E2E-2.x | Gameplay Flow |
| E2E-3.x | Merger Flow |
| E2E-4.x | Reconnection Flow |
| E2E-5.x | Error Handling |
| E2E-6.x | Trading Flow |

## CRITICAL: Screenshot Evidence Required

**Tests without screenshots are not proof of anything.** A test can "pass" while the page is completely blank if it only checks for URL changes or element existence without visual verification.

### Required for Every E2E Test

1. **Capture screenshots at key moments:**
   ```typescript
   // After navigation
   await page.screenshot({ path: 'test-results/1-after-navigation.png', fullPage: true })

   // After state changes
   await page.screenshot({ path: 'test-results/2-game-started.png', fullPage: true })

   // Final state
   await page.screenshot({ path: 'test-results/3-final-state.png', fullPage: true })
   ```

2. **Check browser console for errors:**
   ```typescript
   const errors: string[] = []
   page.on('pageerror', err => errors.push(err.message))
   // ... test actions ...
   expect(errors).toHaveLength(0) // Fail if any JS errors
   ```

3. **Verify actual content renders:**
   ```typescript
   // BAD - just checks existence
   await expect(page.locator('.game-board')).toBeVisible()

   // GOOD - verifies actual content
   await expect(page.locator('.game-board')).toContainText('1A')
   const screenshot = await page.screenshot()
   // Visual inspection proves it rendered
   ```

### Why This Matters

In January 2026, we had tests "passing" that:
- Never actually connected to WebSocket (proxy misconfigured)
- Rendered blank pages (React infinite loop)
- Claimed success while the app was completely broken

Screenshots would have caught this immediately.

## Implementation Notes

When implementing tests from these specifications:

1. **Isolation**: Each test should start with a fresh room
2. **Timeouts**: Use appropriate waits for WebSocket messages (up to 5s)
3. **Selectors**: Prefer `data-testid` attributes over CSS selectors
4. **Cleanup**: Tests should not leave orphaned rooms or connections
5. **Parallelization**: Tests can run in parallel (different rooms)
6. **Screenshots**: Capture at every significant step as evidence

## Test Data Conventions

- **Room codes**: Use 4-letter uppercase codes (auto-generated)
- **Player names**: Use `Player1`, `Player2`, etc. for consistency
- **Seeded games**: When determinism needed, backend supports `seed` parameter

## Cross-References

- Backend scenario tests: `/docs/tests/scenario/`
- Backend WebSocket API: `/backend/main.py`
- Frontend components: `/frontend/src/components/`
- Game rules: `/docs/rules/`
