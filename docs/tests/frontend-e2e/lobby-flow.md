# E2E-1: Lobby Flow Scenarios

Test scenarios for room creation, joining, and pre-game setup.

---

## E2E-1.1: Create New Room

**Preconditions:**
- User is on the home page (/)
- No active room session

**Steps:**
1. User clicks "Create Room" button
2. System generates 4-letter room code
3. User is redirected to `/host/{code}`
4. Host view shows room code prominently
5. Host view shows "Waiting for players..." message
6. Player list shows host as first player

**Expected Outcomes:**
- Room code is 4 uppercase letters
- URL matches `/host/[A-Z]{4}` pattern
- WebSocket connection established
- Host can see share instructions

**Playwright Hints:**
```typescript
await page.click('[data-testid="create-room-button"]')
await page.waitForURL(/\/host\/[A-Z]{4}/)
const roomCode = await page.locator('[data-testid="room-code"]').textContent()
expect(roomCode).toMatch(/^[A-Z]{4}$/)
```

---

## E2E-1.2: Join Existing Room

**Preconditions:**
- A room exists with code "ABCD"
- Room is in lobby state (not started)

**Steps:**
1. User navigates to home page
2. User enters room code "ABCD" in input field
3. User enters their name "Player2"
4. User clicks "Join" button
5. User is redirected to `/play/ABCD`
6. Player view shows their name and room code
7. Host view updates to show new player

**Expected Outcomes:**
- Player successfully joins room
- Player count increments on host view
- Player can see "Waiting for game to start" message
- WebSocket connection established

**Playwright Hints:**
```typescript
await page.fill('[data-testid="room-code-input"]', 'ABCD')
await page.fill('[data-testid="player-name-input"]', 'Player2')
await page.click('[data-testid="join-button"]')
await page.waitForURL('/play/ABCD')
await expect(page.locator('[data-testid="player-name"]')).toHaveText('Player2')
```

---

## E2E-1.3: Join with Invalid Room Code

**Preconditions:**
- No room exists with code "ZZZZ"

**Steps:**
1. User enters room code "ZZZZ"
2. User enters name "Player1"
3. User clicks "Join" button
4. Error message appears

**Expected Outcomes:**
- User remains on home page
- Error toast/message: "Room not found"
- Input fields retain their values

**Playwright Hints:**
```typescript
await page.fill('[data-testid="room-code-input"]', 'ZZZZ')
await page.click('[data-testid="join-button"]')
await expect(page.locator('[data-testid="error-message"]')).toContainText('Room not found')
await expect(page).toHaveURL('/')
```

---

## E2E-1.4: Host Adds Bot Player

**Preconditions:**
- Host has created a room
- Room has at least 1 human player

**Steps:**
1. Host clicks "Add Bot" button
2. Host selects bot difficulty (Easy/Medium/Hard)
3. Bot appears in player list
4. Bot shows AI indicator icon

**Expected Outcomes:**
- Player count increases
- Bot name shows difficulty level (e.g., "Bot (Medium)")
- All players see the new bot

**Playwright Hints:**
```typescript
await page.click('[data-testid="add-bot-button"]')
await page.click('[data-testid="bot-difficulty-medium"]')
await expect(page.locator('[data-testid="player-list"]')).toContainText('Bot (Medium)')
```

---

## E2E-1.5: Host Starts Game

**Preconditions:**
- Room has 3-6 players (human or bot)
- All players connected

**Steps:**
1. Host clicks "Start Game" button
2. Game initializes
3. All players receive initial tiles
4. Board appears on host view
5. First player is prompted to place tile
6. All player views update to show game started

**Expected Outcomes:**
- Game phase shows "Place Tile"
- Current player is highlighted
- Each player has 6 tiles (on their private view)
- Host view shows empty board with grid

**Playwright Hints:**
```typescript
await page.click('[data-testid="start-game-button"]')
await page.waitForSelector('[data-testid="game-board"]')
await expect(page.locator('[data-testid="game-phase"]')).toHaveText('Place Tile')
await expect(page.locator('[data-testid="player-tiles"]')).toHaveCount(6)
```

---

## E2E-1.6: Cannot Start with Insufficient Players

**Preconditions:**
- Room has only 1 or 2 players

**Steps:**
1. Host attempts to click "Start Game"
2. Button is disabled or shows error

**Expected Outcomes:**
- Game does not start
- Error message: "Need at least 3 players"
- Start button disabled until 3+ players

**Playwright Hints:**
```typescript
await expect(page.locator('[data-testid="start-game-button"]')).toBeDisabled()
// Or if button is clickable but shows error:
await page.click('[data-testid="start-game-button"]')
await expect(page.locator('[data-testid="error-toast"]')).toContainText('at least 3 players')
```

---

## E2E-1.7: Player Leaves Before Game Starts

**Preconditions:**
- Room has 4 players
- Game not started

**Steps:**
1. Player3 closes their browser/tab
2. Host view updates player list
3. Remaining players see updated count

**Expected Outcomes:**
- Player count decreases to 3
- Disconnected player removed from list
- Other players can still join
- Game can still start with 3+ players

**Playwright Hints:**
```typescript
// In player3 context
await player3Page.close()

// In host context
await hostPage.waitForSelector('[data-testid="player-count"]:has-text("3")')
```

---

## E2E-1.8: Room Code Case Insensitivity

**Preconditions:**
- Room exists with code "ABCD"

**Steps:**
1. User enters "abcd" (lowercase)
2. User enters name and joins
3. Successfully joins room

**Expected Outcomes:**
- Room code is normalized to uppercase
- Player joins successfully
- URL shows uppercase code

**Playwright Hints:**
```typescript
await page.fill('[data-testid="room-code-input"]', 'abcd')
await page.click('[data-testid="join-button"]')
await page.waitForURL('/play/ABCD')
```
