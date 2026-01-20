# E2E-2: Gameplay Flow Scenarios

Test scenarios for core gameplay: tile placement, stock purchases, and turn flow.

---

## E2E-2.1: Place Tile on Empty Board

**Preconditions:**
- Game started with 3 players
- Current player has tiles in hand
- Board is empty (beginning of game)

**Steps:**
1. Current player sees their tiles highlighted
2. Player clicks on tile "3B" in their hand
3. Tile is placed on board at position 3B
4. Board updates to show tile
5. If no chain founded, proceed to buy stocks phase

**Expected Outcomes:**
- Tile appears on board at correct position
- Tile removed from player's hand
- Phase advances (to founding if adjacent, else buy stocks)
- Host view shows tile placement

**Playwright Hints:**
```typescript
await page.click('[data-testid="tile-3B"]')
await expect(page.locator('[data-testid="board-cell-3B"]')).toHaveClass(/placed/)
await expect(page.locator('[data-testid="player-tiles"]')).not.toContainText('3B')
```

---

## E2E-2.2: Found New Chain

**Preconditions:**
- Board has tile at 3B
- Current player has tile 3C or 4B (adjacent)

**Steps:**
1. Player places adjacent tile
2. Chain founding modal appears
3. Modal shows available chain names
4. Player selects "Luxor"
5. Chain is created with both tiles
6. Player receives founder bonus stock
7. Tiles change color to Luxor color

**Expected Outcomes:**
- Both tiles show Luxor color
- Player receives 1 Luxor stock
- Chain info panel shows Luxor: 2 tiles
- Phase advances to buy stocks

**Playwright Hints:**
```typescript
await page.click('[data-testid="tile-3C"]')
await page.waitForSelector('[data-testid="chain-selection-modal"]')
await page.click('[data-testid="chain-luxor"]')
await expect(page.locator('[data-testid="board-cell-3B"]')).toHaveClass(/luxor/)
await expect(page.locator('[data-testid="board-cell-3C"]')).toHaveClass(/luxor/)
await expect(page.locator('[data-testid="player-stocks-luxor"]')).toHaveText('1')
```

---

## E2E-2.3: Buy Stocks

**Preconditions:**
- Game in "Buy Stocks" phase
- At least one chain exists on board
- Current player has sufficient cash

**Steps:**
1. Player sees available chains with prices
2. Player clicks "+1" on Luxor (price $200)
3. Purchase counter shows 1
4. Player clicks "+1" on Tower (price $200)
5. Player clicks "Confirm Purchase"
6. Cash decreases by $400
7. Stock counts increase

**Expected Outcomes:**
- Player's cash reduced by total purchase amount
- Stock holdings updated
- Maximum 3 stocks per turn enforced
- Phase advances to end turn

**Playwright Hints:**
```typescript
await page.click('[data-testid="buy-luxor-plus"]')
await page.click('[data-testid="buy-tower-plus"]')
await expect(page.locator('[data-testid="purchase-total"]')).toHaveText('$400')
await page.click('[data-testid="confirm-purchase"]')
await expect(page.locator('[data-testid="player-cash"]')).toContainText('$5,600')
```

---

## E2E-2.4: End Turn and Draw Tile

**Preconditions:**
- Current player has completed all actions
- In "End Turn" phase

**Steps:**
1. Player clicks "End Turn" button
2. New tile is drawn from pool
3. Tile appears in player's hand
4. Turn passes to next player
5. Next player's view shows it's their turn

**Expected Outcomes:**
- Current player indicator moves to next player
- Previous player's view shows "Waiting..."
- Next player sees "Your Turn" indicator
- Tile count decremented in pool display

**Playwright Hints:**
```typescript
await page.click('[data-testid="end-turn-button"]')
await expect(page.locator('[data-testid="your-turn-indicator"]')).not.toBeVisible()
await expect(page.locator('[data-testid="waiting-message"]')).toBeVisible()
// On next player's page:
await expect(nextPlayerPage.locator('[data-testid="your-turn-indicator"]')).toBeVisible()
```

---

## E2E-2.5: Cannot Afford Stock Purchase

**Preconditions:**
- Player has $200 cash
- Cheapest available stock costs $300

**Steps:**
1. Player in buy stocks phase
2. All purchase buttons are disabled
3. Player can only click "Skip" or "Done"

**Expected Outcomes:**
- Purchase buttons disabled for unaffordable stocks
- Player can still end turn without buying
- No error, graceful handling

**Playwright Hints:**
```typescript
await expect(page.locator('[data-testid="buy-continental-plus"]')).toBeDisabled()
await page.click('[data-testid="skip-purchase"]')
```

---

## E2E-2.6: Stock Limit Enforcement (3 per turn)

**Preconditions:**
- Player has plenty of cash
- Multiple chains available

**Steps:**
1. Player buys 3 stocks total
2. All "+1" buttons become disabled
3. Player must confirm or adjust

**Expected Outcomes:**
- Cannot exceed 3 stocks per turn
- Can adjust down and choose different stocks
- Clear indication of limit reached

**Playwright Hints:**
```typescript
await page.click('[data-testid="buy-luxor-plus"]')
await page.click('[data-testid="buy-luxor-plus"]')
await page.click('[data-testid="buy-luxor-plus"]')
await expect(page.locator('[data-testid="buy-tower-plus"]')).toBeDisabled()
await expect(page.locator('[data-testid="stock-limit-message"]')).toBeVisible()
```

---

## E2E-2.7: Chain Expansion

**Preconditions:**
- Luxor chain exists with 3 tiles
- Player has tile adjacent to Luxor

**Steps:**
1. Player places tile adjacent to Luxor
2. Tile automatically joins Luxor chain
3. Tile shows Luxor color
4. Chain size increases to 4

**Expected Outcomes:**
- No chain selection modal (auto-join)
- Chain info shows updated size
- Stock prices may increase based on size

**Playwright Hints:**
```typescript
await page.click('[data-testid="tile-5D"]')
await expect(page.locator('[data-testid="board-cell-5D"]')).toHaveClass(/luxor/)
await expect(page.locator('[data-testid="chain-luxor-size"]')).toHaveText('4')
```

---

## E2E-2.8: Full Turn Cycle (3 Players)

**Preconditions:**
- Game with 3 human players
- Beginning of game

**Steps:**
1. Player 1 places tile, buys stocks, ends turn
2. Player 2 places tile, buys stocks, ends turn
3. Player 3 places tile, buys stocks, ends turn
4. Turn returns to Player 1

**Expected Outcomes:**
- Each player gets their turn in order
- All state changes visible on host view
- Turn indicator cycles correctly
- No desync between views

**Playwright Hints:**
```typescript
// Verify turn order across all player contexts
for (const [index, playerPage] of playerPages.entries()) {
  await expect(playerPage.locator('[data-testid="your-turn-indicator"]')).toBeVisible()
  await playerPage.click(`[data-testid="tile-${tiles[index]}"]`)
  await playerPage.click('[data-testid="skip-purchase"]')
  await playerPage.click('[data-testid="end-turn-button"]')
}
// Back to player 1
await expect(playerPages[0].locator('[data-testid="your-turn-indicator"]')).toBeVisible()
```

---

## E2E-2.9: Bot Takes Turn

**Preconditions:**
- Game with 2 humans and 1 bot
- Bot's turn

**Steps:**
1. Bot automatically places tile
2. Bot automatically makes stock purchases
3. Bot automatically ends turn
4. Turn passes to next human

**Expected Outcomes:**
- Bot actions happen within timeout (5s)
- All players see bot's actions
- Host view updates in real-time
- No manual intervention required

**Playwright Hints:**
```typescript
// Wait for bot turn to complete
await expect(page.locator('[data-testid="current-player"]')).not.toHaveText('Bot')
// Bot turn should complete within reasonable time
// Verify board state changed
```

---

## E2E-2.10: Unplayable Tile Replacement

**Preconditions:**
- Player has a tile that would create illegal merger
- All of player's tiles are unplayable

**Steps:**
1. System detects unplayable tiles
2. Player receives notification
3. Tiles are replaced from pool
4. Player can now take their turn

**Expected Outcomes:**
- Toast message explains replacement
- New tiles appear in hand
- Turn proceeds normally

**Playwright Hints:**
```typescript
await expect(page.locator('[data-testid="tiles-replaced-toast"]')).toBeVisible()
await expect(page.locator('[data-testid="player-tiles"]')).toHaveCount(6)
```
