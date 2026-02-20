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

## Testing Standards (MANDATORY)

### Scenario Tests Are User Journey Tests

Scenario tests exercise the app **exactly as users would**. They are NOT API tests with a browser wrapper.

**REQUIRED for all scenario tests:**
- Use UI interactions only: `page.click()`, `page.fill()`, `page.getByRole()`, `page.getByTestId()`
- Wait for navigation: `page.waitForURL()`, `page.waitForSelector()`
- Assert visible state: `expect(page.getByText('...')).toBeVisible()`

**PROHIBITED in scenario tests:**
- Direct API calls: `fetch('/api/...')`
- Database seeding or manipulation
- Bypassing UI to set up state
- Mocking WebSocket or HTTP responses

**The test must fail if:**
- A button doesn't exist or isn't clickable
- Navigation doesn't occur after user action
- Expected text/elements don't render
- Console errors occur (filtered for network noise)

### Why This Matters

```
API tests can pass          Scenario tests catch
while UI is broken    →     real integration failures
```

If you call an API directly instead of clicking a button, you're testing the API, not the user journey. A user cannot call `/api/create-game` - they click "CREATE GAME". Test what users do.

### Example: Creating a Game

```typescript
// ❌ WRONG - This is an API test disguised as E2E
const response = await fetch('/api/create-game', {
  method: 'POST',
  body: JSON.stringify({ player_name: 'TestPlayer' })
})
const { room_code } = await response.json()
await page.goto(`/play/${room_code}`)

// ✅ RIGHT - This is a real user journey test
await page.goto('/')
await page.getByTestId('create-name-input').fill('TestPlayer')
await page.getByTestId('create-button').click()
await page.waitForURL(/\/play\/[A-Z]{4}/)
await expect(page.getByText('WAITING FOR PLAYERS')).toBeVisible()
```

### Example: Adding a Bot

```typescript
// ❌ WRONG - API shortcut
await fetch(`/api/room/${roomCode}/add-bot`, { method: 'POST' })

// ✅ RIGHT - User interaction
await page.getByRole('button', { name: '+ ADD BOT' }).click()
await expect(page.getByText('PLAYERS (2/6)')).toBeVisible()
```

### Example: Starting a Game

```typescript
// ❌ WRONG - API shortcut
await fetch(`/api/room/${roomCode}/start`, { method: 'POST' })

// ✅ RIGHT - User interaction
await page.getByRole('button', { name: 'START GAME' }).click()
await expect(page.getByText('PLACE TILE')).toBeVisible({ timeout: 10000 })
```

### WebSocket vs HTTP Pattern

When building test helpers that interact with real-time features:
- **WebSocket**: For receiving state updates (game state, player joins)
- **HTTP**: For sending actions through the UI (which internally may use HTTP or WebSocket)

Tests should not directly send WebSocket messages. Users interact through buttons and forms, not raw WebSocket frames.

### Screenshot Requirements

Every scenario test MUST capture screenshots:
1. **Before each action**: Proves the UI was in expected state
2. **After each action**: Proves the action had visible effect
3. **On failure**: Automatic via Playwright, but also capture intermediate states

Screenshots are saved to: `frontend/test-results/scenarios/<test-suite>/<test-name>/`

Naming convention: `NN-description.png` (e.g., `01-lobby-initial.png`, `02-game-created.png`)

Use the helper: `await captureStep(page, 'description', { category, testName })`

### Test Rigor Standards (MANDATORY)

These standards ensure scenario tests actually test gameplay, not just UI existence.

#### 1. Play Real Turns

Tests must actually play through game scenarios, not just verify buttons exist:

```typescript
// ❌ WRONG - just checks UI exists
await expect(page.getByTestId('tile-rack')).toBeVisible()
// Test passes even if placing tiles is completely broken

// ✅ RIGHT - actually plays the game
for (let turn = 1; turn <= 10; turn++) {
  await waitForMyTurn(page)
  const tile = await selectTileFromRack(page)
  await placeTile(page)
  if (await hasChainSelector(page)) {
    await selectFirstAvailableChain(page)
  }
  await endTurn(page)
}
```

#### 2. Minimum Turn Requirements

| Test Type | Minimum Turns | Rationale |
|-----------|---------------|-----------|
| Basic turn tests | 10+ turns | Ensures turn cycle works repeatedly |
| Multi-feature tests | 20+ turns | Covers chains, expansions, potential mergers |
| Feature-specific | Until feature occurs | Don't assume turn N triggers the feature |

#### 3. Never Terminate Early on Bugs

When a scenario test surfaces a bug, **fix the root cause**:

```typescript
// ❌ WRONG - hides the bug
if (mergerGotStuck) {
  console.log('Merger stuck at turn 11, but 10 turns passed, calling it success')
  return
}

// ✅ RIGHT - surfaces the bug for fixing
if (!mergerCompleted) {
  throw new Error('Merger stuck - bot stock disposition not working')
}
```

Scenario tests exist to find integration bugs. A test that works around bugs is lying about coverage.

#### 4. Screenshots at Every Action

For turn-based tests, capture:
- `turn-N-before-place` - Board state before action
- `turn-N-tile-selected-{coord}` - Tile selection confirmed
- `turn-N-after-place` - Result of placement
- `turn-N-chain-selector` - When founding triggered
- `turn-N-founded-{chain}` - Chain founded
- `turn-N-buy-phase` - Stock purchase phase
- `turn-N-merger-{num}` - Merger in progress
- `turn-N-merger-done` - Merger completed
- `final-state` - End of test

#### 5. Determinism Through Seeding

Use `ACQUIRE_GAME_SEED` environment variable for reproducible tests:

```typescript
// playwright.config.ts
webServer: [{
  command: 'python3 -m uvicorn main:app --host 127.0.0.1 --port 8000',
  env: {
    ACQUIRE_GAME_SEED: '2',  // Same seed = same tile distribution
  },
}]
```

#### 6. Unified Bot/Human Code Paths

Backend must use the same code path for bot and human actions to prevent divergent bugs:

```python
# ❌ WRONG - separate paths that can have different bugs
if player.is_bot:
    handle_bot_disposition(...)  # Broken
else:
    send_websocket_to_human(...)  # Works

# ✅ RIGHT - same execution, different decision source
if player.is_bot:
    decision = bot.choose_stock_disposition(...)
else:
    decision = await get_human_decision_via_websocket(...)
game.handle_stock_disposition(player_id, **decision)  # Same for both
```

#### 7. Detailed Logging

Every test should log actions for debugging:

```typescript
console.log(`[Turn ${turn}] === MY TURN ===`)
console.log(`  Cash: ${info.cash}`)
console.log(`  Placing tile: ${tileCoord}`)
console.log(`  Phase after place: ${phase}`)
console.log(`  Founded chain: ${chainName}`)
```

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
| [ST-002](../stories/07-scenario-tests/ST-002.md) | Turn Flow E2E Tests | M | ST-001 | complete |
| [ST-003](../stories/07-scenario-tests/ST-003.md) | Trading E2E Tests | L | ST-001 | completed |
| [ST-004](../stories/07-scenario-tests/ST-004.md) | Chain Founding E2E Tests | M | ST-001 | completed |
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
