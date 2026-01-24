# Flaky E2E Test Diagnosis & Fixes

## Session Summary (2026-01-24)

Fixed 15 of 22 flaky E2E tests by replacing arbitrary `waitForTimeout` calls with condition-based waiting.

## Root Cause Analysis

### Primary Issue: Arbitrary Timeouts in Polling Loops

The flaky tests used patterns like:
```typescript
while (humanTurnCount < MIN_TURNS) {
  const info = await getGameInfo()
  if (info.phase.includes('PLACE')) {
    // handle turn
  } else {
    await page.waitForTimeout(300)  // <-- RACE CONDITION
  }
}
```

**Why this is flaky:**
- 300ms is arbitrary - may be too short on slow CI
- If phase changes during the 300ms wait, it's missed
- Creates cascading timing issues

### Secondary Issues

1. **WebSocket stabilization waits** - Using `waitForTimeout(2000)` instead of `waitForWebSocketConnected()`
2. **Portfolio update race conditions** - Checking holdings immediately after founding instead of waiting
3. **Consecutive wait counters** - `consecutiveWaits > 200` masked underlying issues

## Solution Pattern

Replace arbitrary timeouts with condition-based waiting:

```typescript
// BAD
await page.waitForTimeout(300)

// GOOD - wait for specific condition
await waitForPhaseChange(page, currentPhase, 5000)

// GOOD - wait for specific element state
await expect(page.getByText('PLAYERS (3/6)')).toBeVisible({ timeout: 5000 })

// GOOD - wait for WebSocket connection
await waitForWebSocketConnected(page)
```

## New Helpers Added

In `tests/e2e/scenarios/helpers/turn-actions.ts`:

```typescript
// Wait for phase to change from current value
export async function waitForPhaseChange(
  page: Page,
  currentPhase: string,
  timeout = 5000
): Promise<boolean>

// Wait for any game state update
export async function waitForGameStateUpdate(
  page: Page,
  timeout = 5000
): Promise<boolean>
```

## Remaining 7 Failures (For Next Session)

These tests still fail and need investigation:

### 1. Turn Flow Tests (Extended Gameplay)
- `1.1: Basic complete turns` - Times out at 120s after ~10 turns
- `1.4: Extended gameplay - 20 turns` - Same timeout issue

**Likely cause:** The 5000ms timeout in `waitForPhaseChange` might be too long when waiting for bot turns. Consider:
- Shorter timeout with more retries
- Or investigate if bot turn execution is slow

### 2. Chain Founding Edge Cases
- `3.6: Founder bonus stock depleted` - Stock depletion scenario
- `3.10: Chain founding cancellation on disconnect` - WebSocket disconnect/reconnect

**Likely cause:** These need specific game states that may not be reliably reached.

### 3. Trading Edge Cases
- `2.2: Cancel trade offer` - P2P trading
- `2.14: Odd number of defunct stock` - Merger edge case
- `2.18: 2:1 in multi-chain merger` - Complex merger scenario

**Likely cause:** These tests use `playUntilMerger` which throws "Failed to get turn at turn X". The merger detection or turn waiting may have issues.

## Investigation Approach for Next Session

1. **For timeout issues (1.1, 1.4):**
   - Add more logging to see where time is spent
   - Consider reducing `waitForPhaseChange` timeout from 5000ms to 2000ms
   - Check if bot turns are executing slowly

2. **For "Failed to get turn" errors:**
   - The `playUntilMerger` helper throws this when `waitForMyTurn` times out
   - Check if the phase text matching is correct
   - May need to handle merger phase detection differently

3. **For disconnect tests (3.10):**
   - WebSocket reconnection logic may have race conditions
   - Check `forceCloseWebSocket` helper behavior

## Key Learnings

1. **Never use arbitrary timeouts in loops** - Each iteration compounds the timing uncertainty

2. **Playwright's `expect().toBeVisible()` is condition-based** - Use it instead of manual polling

3. **Phase text matching is fragile** - "PLACE A TILE" vs "PLACE" vs "'s TURN - PLACE TILE" - need robust matching

4. **Bot execution time is variable** - Can't assume bot turns take fixed time

5. **Screenshots are essential for debugging** - The test framework already captures these, use them

## Files Modified

- `tests/e2e/scenarios/helpers/turn-actions.ts` - Added new helpers
- `tests/e2e/scenarios/helpers/game-setup.ts` - Fixed `addBotViaUI`
- `tests/e2e/scenarios/helpers/merger.ts` - Fixed `playUntilMerger`
- `tests/e2e/scenarios/turn-flow.spec.ts` - Replaced all timeouts
- `tests/e2e/scenarios/smoke.spec.ts` - Replaced all timeouts
- `tests/e2e/scenarios/chain-founding.spec.ts` - Replaced all timeouts
- `tests/e2e/scenarios/trading.spec.ts` - Replaced all timeouts
- `tests/e2e/play-tile-test.spec.ts` - Replaced all timeouts
- `tests/e2e/bot-game.spec.ts` - Fixed bot turn waiting
