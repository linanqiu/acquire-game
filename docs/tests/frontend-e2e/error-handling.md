# E2E-5: Error Handling Scenarios

Test scenarios for error messages, recovery flows, and edge cases.

---

## E2E-5.1: Invalid Room Code Format

**Preconditions:**
- User on home page

**Steps:**
1. User enters invalid room code format (e.g., "123", "ABCDE", "AB")
2. User attempts to join
3. Validation error displayed

**Expected Outcomes:**
- Error message: "Room code must be 4 letters"
- Join button disabled or shows error on click
- User can correct and retry

**Playwright Hints:**
```typescript
await page.fill('[data-testid="room-code-input"]', '123')
await page.click('[data-testid="join-button"]')
await expect(page.locator('[data-testid="validation-error"]')).toContainText('4 letters')
```

---

## E2E-5.2: Game Full Error

**Preconditions:**
- Room has 6 players (maximum)
- 7th player tries to join

**Steps:**
1. Player enters valid room code
2. Player enters name
3. Player clicks join
4. Error: "Room is full"

**Expected Outcomes:**
- Clear error message
- Player remains on home page
- Can try different room

**Playwright Hints:**
```typescript
await page.fill('[data-testid="room-code-input"]', 'FULL')
await page.click('[data-testid="join-button"]')
await expect(page.locator('[data-testid="error-toast"]')).toContainText('Room is full')
```

---

## E2E-5.3: Game Already Started

**Preconditions:**
- Room exists
- Game already started

**Steps:**
1. New player tries to join
2. Error: "Game already in progress"

**Expected Outcomes:**
- Cannot join mid-game
- Error message explains situation
- Option to watch (if spectator mode exists) or find another room

**Playwright Hints:**
```typescript
await page.click('[data-testid="join-button"]')
await expect(page.locator('[data-testid="error-toast"]')).toContainText('already in progress')
```

---

## E2E-5.4: Duplicate Player Name

**Preconditions:**
- Room has player named "Alice"
- New player tries to join as "Alice"

**Steps:**
1. Player enters "Alice" as name
2. Player clicks join
3. Error or name auto-adjusted

**Expected Outcomes:**
- Either error: "Name already taken"
- Or auto-suffix: "Alice (2)"
- Clear feedback to user

**Playwright Hints:**
```typescript
await page.fill('[data-testid="player-name-input"]', 'Alice')
await page.click('[data-testid="join-button"]')
// Either error or modified name
await expect(page.locator('[data-testid="error-toast"], [data-testid="player-name"]')).toBeVisible()
```

---

## E2E-5.5: WebSocket Connection Failed

**Preconditions:**
- Backend is down or unreachable

**Steps:**
1. User tries to create/join room
2. WebSocket connection fails
3. Error displayed

**Expected Outcomes:**
- User-friendly error: "Unable to connect to server"
- Retry button available
- Technical details hidden (but in console)

**Playwright Hints:**
```typescript
// Stop backend or block WebSocket
await page.route('**/ws/**', route => route.abort())
await page.click('[data-testid="create-room-button"]')
await expect(page.locator('[data-testid="connection-error"]')).toBeVisible()
```

---

## E2E-5.6: Invalid Action Attempt

**Preconditions:**
- Not player's turn
- Player tries to perform action

**Steps:**
1. Player clicks on tile (not their turn)
2. Error or no response

**Expected Outcomes:**
- Action blocked
- Subtle feedback: "Wait for your turn"
- No server error

**Playwright Hints:**
```typescript
// When it's not this player's turn
await page.click('[data-testid="tile-3B"]')
await expect(page.locator('[data-testid="not-your-turn-message"]')).toBeVisible()
```

---

## E2E-5.7: Insufficient Funds Error

**Preconditions:**
- Player has $100 cash
- Tries to buy $200 stock

**Steps:**
1. Player attempts purchase
2. Server rejects (if client allows)
3. Error: "Insufficient funds"

**Expected Outcomes:**
- Purchase not completed
- Clear error message
- Player can adjust selection

**Playwright Hints:**
```typescript
// If UI doesn't prevent it:
await page.click('[data-testid="buy-expensive-stock"]')
await expect(page.locator('[data-testid="error-toast"]')).toContainText('Insufficient funds')
```

---

## E2E-5.8: Network Error During Action

**Preconditions:**
- Player submitting an action
- Network fails mid-request

**Steps:**
1. Player clicks "Place Tile"
2. Network fails before response
3. Error displayed
4. Retry option available

**Expected Outcomes:**
- Clear error: "Action failed, please retry"
- State not corrupted
- Can retry the action

**Playwright Hints:**
```typescript
await page.route('**/ws/**', route => route.abort())
await page.click('[data-testid="place-tile-confirm"]')
await expect(page.locator('[data-testid="action-failed"]')).toBeVisible()
await page.click('[data-testid="retry-action"]')
```

---

## E2E-5.9: Toast Notification Stacking

**Preconditions:**
- Multiple errors/events occur rapidly

**Steps:**
1. Trigger multiple toast notifications
2. Verify they stack properly
3. Verify they auto-dismiss
4. Verify manual dismiss works

**Expected Outcomes:**
- Toasts stack vertically
- Don't overflow screen
- Can be dismissed
- Don't block gameplay

**Playwright Hints:**
```typescript
// Trigger multiple toasts
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Error 1', type: 'error' }}))
  window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Error 2', type: 'error' }}))
  window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Error 3', type: 'error' }}))
})
await expect(page.locator('[data-testid="toast"]')).toHaveCount(3)
```

---

## E2E-5.10: Session Recovery After Error

**Preconditions:**
- Error occurred during gameplay
- Player needs to recover

**Steps:**
1. Error occurs
2. Player refreshes page
3. Session restored
4. Game continues

**Expected Outcomes:**
- No data loss
- Smooth recovery
- Other players unaffected
- Error logged for debugging

**Playwright Hints:**
```typescript
// After an error
await page.reload()
await page.waitForSelector('[data-testid="game-board"]')
// Verify state is correct
```

---

## E2E-5.11: Graceful Degradation

**Preconditions:**
- Some feature unavailable (e.g., activity log)

**Steps:**
1. Core game works
2. Secondary features gracefully fail
3. User informed of limited functionality

**Expected Outcomes:**
- Core gameplay unaffected
- Missing features show placeholder
- No JavaScript errors
- Can still complete game

**Playwright Hints:**
```typescript
await page.route('**/api/activity-log**', route => route.abort())
await expect(page.locator('[data-testid="activity-log-unavailable"]')).toBeVisible()
// But game still works
await page.click('[data-testid="tile-3B"]')
await expect(page.locator('[data-testid="board-cell-3B"]')).toHaveClass(/placed/)
```

---

## E2E-5.12: Browser Back Button Handling

**Preconditions:**
- Player in active game

**Steps:**
1. Player clicks browser back button
2. Confirmation dialog or handling

**Expected Outcomes:**
- Warn user before leaving game
- Option to stay or leave
- If leave, proper cleanup

**Playwright Hints:**
```typescript
page.on('dialog', dialog => {
  expect(dialog.message()).toContain('leave the game')
  dialog.dismiss() // Stay in game
})
await page.goBack()
await expect(page.locator('[data-testid="game-board"]')).toBeVisible()
```
