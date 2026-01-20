# E2E-4: Reconnection Flow Scenarios

Test scenarios for disconnect and reconnection handling.

---

## E2E-4.1: Brief Disconnection Recovery

**Preconditions:**
- Player connected to active game
- Game in progress

**Steps:**
1. Player's network briefly disconnects (simulate)
2. WebSocket connection lost
3. UI shows "Reconnecting..." indicator
4. Connection restored within 5 seconds
5. Game state resynced automatically

**Expected Outcomes:**
- Player sees reconnection indicator
- No manual action required
- State matches server state after reconnect
- Game continues normally

**Playwright Hints:**
```typescript
// Simulate network offline
await page.context().setOffline(true)
await expect(page.locator('[data-testid="reconnecting-indicator"]')).toBeVisible()

// Restore network
await page.context().setOffline(false)
await expect(page.locator('[data-testid="reconnecting-indicator"]')).not.toBeVisible()
await expect(page.locator('[data-testid="game-board"]')).toBeVisible()
```

---

## E2E-4.2: Page Refresh During Game

**Preconditions:**
- Player in active game
- It's another player's turn

**Steps:**
1. Player refreshes their browser
2. Page reloads
3. Player automatically rejoins room
4. Current game state displayed
5. Player can continue when their turn

**Expected Outcomes:**
- No "join" flow required
- Token/session persists
- All game state restored
- Other players unaffected

**Playwright Hints:**
```typescript
const roomCode = await page.locator('[data-testid="room-code"]').textContent()
await page.reload()
await page.waitForSelector('[data-testid="game-board"]')
await expect(page.locator('[data-testid="room-code"]')).toHaveText(roomCode)
```

---

## E2E-4.3: Reconnection During Own Turn

**Preconditions:**
- It's the player's turn
- Player is in "Place Tile" phase

**Steps:**
1. Player disconnects
2. Player reconnects
3. Game state shows it's still their turn
4. Player can continue their action
5. No turn skipped or actions lost

**Expected Outcomes:**
- Turn preserved during disconnection
- Player can complete their turn
- No timeout penalty (within reasonable limit)

**Playwright Hints:**
```typescript
await page.context().setOffline(true)
await page.waitForTimeout(2000)
await page.context().setOffline(false)
await expect(page.locator('[data-testid="your-turn-indicator"]')).toBeVisible()
await page.click('[data-testid="tile-3B"]') // Can still place tile
```

---

## E2E-4.4: Host Reconnection

**Preconditions:**
- Game in progress
- Host display showing game board

**Steps:**
1. Host browser disconnects
2. Host reconnects
3. Board state restored
4. Game continues uninterrupted for players

**Expected Outcomes:**
- Host view fully restored
- All player states visible
- Game not paused or affected
- Activity log shows recent events

**Playwright Hints:**
```typescript
await hostPage.reload()
await hostPage.waitForSelector('[data-testid="game-board"]')
await expect(hostPage.locator('[data-testid="player-list"]')).toHaveCount(4)
```

---

## E2E-4.5: Player Disconnects During Merger Disposition

**Preconditions:**
- Merger in progress
- Player's turn to dispose stocks
- Player disconnects

**Steps:**
1. Player disconnects mid-disposition
2. Other players see "Waiting for [name]..."
3. Player reconnects
4. Disposition modal reappears
5. Player completes disposition

**Expected Outcomes:**
- Disposition state preserved
- No automatic decisions made
- Game waits for player (with timeout)
- Player can resume where they left off

**Playwright Hints:**
```typescript
await page.context().setOffline(true)
await expect(otherPage.locator('[data-testid="waiting-for"]')).toContainText('Player2')
await page.context().setOffline(false)
await expect(page.locator('[data-testid="disposition-modal"]')).toBeVisible()
```

---

## E2E-4.6: Extended Disconnection Handling

**Preconditions:**
- Player disconnected for extended period (>30s)
- Game progressed during disconnection

**Steps:**
1. Player reconnects after extended time
2. Game state significantly changed
3. Player receives full state update
4. UI shows what happened while away

**Expected Outcomes:**
- No desync between client and server
- Player sees current board state
- Activity log shows missed events
- Can continue playing from current state

**Playwright Hints:**
```typescript
// Simulate extended disconnect
await page.context().setOffline(true)
// Other players take turns...
await page.context().setOffline(false)
await expect(page.locator('[data-testid="game-board"]')).toMatchSnapshot('current-board')
```

---

## E2E-4.7: Multiple Players Disconnect Simultaneously

**Preconditions:**
- 4-player game
- 2 players disconnect at same time

**Steps:**
1. Players 2 and 3 disconnect
2. Game pauses or continues with remaining
3. Players 2 and 3 reconnect
4. Game state consistent for all

**Expected Outcomes:**
- Game handles gracefully
- Host shows disconnected players
- On reconnect, all synced
- No duplicate state or actions

**Playwright Hints:**
```typescript
await player2Page.context().setOffline(true)
await player3Page.context().setOffline(true)
await expect(hostPage.locator('[data-testid="player-2-status"]')).toHaveClass(/disconnected/)
await expect(hostPage.locator('[data-testid="player-3-status"]')).toHaveClass(/disconnected/)
```

---

## E2E-4.8: Token Expiration and Re-auth

**Preconditions:**
- Player's session token expires
- Player tries to reconnect

**Steps:**
1. Token expires (simulate or wait)
2. Player attempts action
3. Auth error received
4. Player redirected to rejoin flow
5. Player re-enters name and joins

**Expected Outcomes:**
- Clear error message about session
- Smooth rejoin flow
- Same room, same game position
- No data loss

**Playwright Hints:**
```typescript
// Clear session storage to simulate token expiration
await page.evaluate(() => sessionStorage.clear())
await page.reload()
await expect(page.locator('[data-testid="rejoin-prompt"]')).toBeVisible()
```

---

## E2E-4.9: Reconnection with Changed Game State

**Preconditions:**
- Player disconnects during another player's turn
- Multiple turns occur while disconnected

**Steps:**
1. Player disconnects
2. 3 turns pass
3. Board state significantly different
4. Player reconnects
5. Player sees current state, not stale state

**Expected Outcomes:**
- No stale data displayed
- Full state refresh on reconnect
- No flicker or partial updates
- Activity log shows what happened

**Playwright Hints:**
```typescript
const boardBefore = await page.locator('[data-testid="game-board"]').innerHTML()
await page.context().setOffline(true)
// ... other players take turns
await page.context().setOffline(false)
const boardAfter = await page.locator('[data-testid="game-board"]').innerHTML()
expect(boardAfter).not.toBe(boardBefore)
```

---

## E2E-4.10: Graceful Handling of Permanent Disconnect

**Preconditions:**
- Player disconnects and doesn't return
- Game cannot proceed without them (their turn)

**Steps:**
1. Player disconnects
2. Timeout period passes (e.g., 2 minutes)
3. Game handles absent player
4. Either skip turn, kick, or pause game

**Expected Outcomes:**
- Clear indication of timeout
- Game can continue (with bot replacement or skip)
- Other players not stuck indefinitely
- Option to wait or proceed

**Playwright Hints:**
```typescript
await player2Page.close()
await page.waitForSelector('[data-testid="player-timeout-notice"]', { timeout: 120000 })
await expect(page.locator('[data-testid="timeout-options"]')).toBeVisible()
```
