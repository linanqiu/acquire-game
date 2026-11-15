> **Historical.** This catalogue described the retired browser scenario suite. Current coverage is by surface: [surface-coverage.md](../surface-coverage.md); what happened to each old test: [legacy-suite-retirement.md](../legacy-suite-retirement.md).

# E2E-3: Merger Flow Scenarios

Test scenarios for chain mergers, bonuses, and stock disposition.

---

## E2E-3.1: Simple Two-Chain Merger

**Preconditions:**
- Sandpiper chain: 5 tiles
- Marlowe chain: 3 tiles
- Player has tile that connects both chains

**Steps:**
1. Player places connecting tile
2. Merger is triggered (Sandpiper acquires Marlowe)
3. Majority/minority bonuses calculated
4. Stock disposition modal appears for Marlowe holders
5. Each holder decides: sell, trade, or keep
6. Marlowe tiles convert to Sandpiper color

**Expected Outcomes:**
- Larger chain (Sandpiper) survives
- Bonuses paid to majority/minority holders
- Marlowe stock removed, optionally traded 2:1
- All Marlowe tiles become Sandpiper tiles

**Playwright Hints:**
```typescript
await page.click('[data-testid="tile-merge"]')
await page.waitForSelector('[data-testid="merger-modal"]')
await expect(page.locator('[data-testid="survivor-chain"]')).toHaveText('Sandpiper')
await expect(page.locator('[data-testid="defunct-chain"]')).toHaveText('Marlowe')
```

---

## E2E-3.2: Merger Survivor Selection (Tie)

**Preconditions:**
- Sandpiper chain: 4 tiles
- Marlowe chain: 4 tiles (same size)
- Player has connecting tile

**Steps:**
1. Player places connecting tile
2. Survivor selection modal appears
3. Player chooses surviving chain (Sandpiper or Marlowe)
4. Merger proceeds with chosen survivor

**Expected Outcomes:**
- Modal clearly shows both chains are equal
- Player can select either chain
- Non-selected chain becomes defunct
- Normal merger process follows

**Playwright Hints:**
```typescript
await page.click('[data-testid="tile-merge"]')
await page.waitForSelector('[data-testid="survivor-selection-modal"]')
await expect(page.locator('[data-testid="tie-message"]')).toBeVisible()
await page.click('[data-testid="select-sandpiper-survivor"]')
```

---

## E2E-3.3: Stock Disposition - Sell All

**Preconditions:**
- Merger in progress
- Player holds 5 Marlowe (defunct) stocks

**Steps:**
1. Stock disposition modal shows player's holdings
2. Player clicks "Sell All"
3. Player receives cash for stocks at current price
4. Stocks removed from holdings

**Expected Outcomes:**
- Cash increases by (5 * Marlowe price)
- Marlowe stock count goes to 0
- Disposition complete for this player

**Playwright Hints:**
```typescript
await page.click('[data-testid="sell-all-button"]')
await expect(page.locator('[data-testid="player-stocks-marlowe"]')).toHaveText('0')
// Verify cash increased
```

---

## E2E-3.4: Stock Disposition - Trade 2:1

**Preconditions:**
- Merger in progress (Marlowe into Sandpiper)
- Player holds 6 Marlowe stocks
- Sandpiper has available stocks

**Steps:**
1. Player sees trade option (2 Marlowe = 1 Sandpiper)
2. Player selects to trade 4 Marlowe for 2 Sandpiper
3. Player keeps remaining 2 Marlowe stocks
4. Trade executes

**Expected Outcomes:**
- Marlowe stocks: 6 → 2
- Sandpiper stocks: +2
- No cash exchanged for trades
- Remaining Marlowe stocks can be kept or sold

**Playwright Hints:**
```typescript
await page.fill('[data-testid="trade-count-input"]', '4')
await page.click('[data-testid="trade-button"]')
await expect(page.locator('[data-testid="player-stocks-marlowe"]')).toHaveText('2')
await expect(page.locator('[data-testid="player-stocks-sandpiper"]')).toContainText('+2')
```

---

## E2E-3.5: Stock Disposition - Keep All

**Preconditions:**
- Merger in progress
- Player holds defunct chain stocks

**Steps:**
1. Player chooses to keep all stocks
2. Stocks remain in holdings (defunct chain)
3. Player can sell later if chain is re-founded

**Expected Outcomes:**
- Stock count unchanged
- No cash change
- Disposition marked complete

**Playwright Hints:**
```typescript
await page.click('[data-testid="keep-all-button"]')
await expect(page.locator('[data-testid="player-stocks-marlowe"]')).toHaveText('5')
```

---

## E2E-3.6: Stock Disposition - Mixed Strategy

**Preconditions:**
- Player holds 8 defunct chain stocks
- Survivor chain has limited stocks available

**Steps:**
1. Player trades 4 for 2 survivor stocks
2. Player sells 2 for cash
3. Player keeps 2
4. Confirm disposition

**Expected Outcomes:**
- Correct stock movements
- Correct cash adjustment
- All 8 stocks accounted for

**Playwright Hints:**
```typescript
await page.fill('[data-testid="trade-count"]', '4')
await page.fill('[data-testid="sell-count"]', '2')
await page.fill('[data-testid="keep-count"]', '2')
await page.click('[data-testid="confirm-disposition"]')
```

---

## E2E-3.7: Multiple Players Disposition Queue

**Preconditions:**
- Merger in progress
- 3 players hold defunct chain stocks

**Steps:**
1. First player (largest holder) makes disposition
2. Second player's modal appears
3. Second player makes disposition
4. Third player's modal appears
5. Third player completes disposition
6. Merger completes

**Expected Outcomes:**
- Players handled in majority-to-minority order
- Each player sees when it's their turn
- Other players see "Waiting for [name]..."
- Merger completes after all dispositions

**Playwright Hints:**
```typescript
// Player with most stock goes first
await expect(player1Page.locator('[data-testid="disposition-modal"]')).toBeVisible()
await expect(player2Page.locator('[data-testid="waiting-for-disposition"]')).toBeVisible()
```

---

## E2E-3.8: Majority/Minority Bonus Display

**Preconditions:**
- Merger triggered
- Clear majority and minority shareholders

**Steps:**
1. Merger modal shows bonus breakdown
2. Majority holder(s) see their bonus amount
3. Minority holder(s) see their bonus amount
4. Bonuses paid before disposition

**Expected Outcomes:**
- Bonus amounts calculated correctly
- Tied bonuses split evenly
- Cash updates immediately
- Clear display of who gets what

**Playwright Hints:**
```typescript
await expect(page.locator('[data-testid="majority-bonus"]')).toContainText('$3,000')
await expect(page.locator('[data-testid="minority-bonus"]')).toContainText('$1,500')
await expect(page.locator('[data-testid="player-cash"]')).toHaveText('$9,000')
```

---

## E2E-3.9: Multi-Way Merger

**Preconditions:**
- 3 separate chains can be connected by one tile
- One chain is clearly largest

**Steps:**
1. Player places tile connecting 3 chains
2. Largest chain survives
3. Two merger resolutions occur (sequentially)
4. Both defunct chains' holders do disposition
5. Final board shows only survivor chain

**Expected Outcomes:**
- Mergers resolved largest-to-smallest
- Each defunct chain handled separately
- All bonuses paid correctly
- No stocks lost or duplicated

**Playwright Hints:**
```typescript
// Verify merger order
await expect(page.locator('[data-testid="merger-1-defunct"]')).toHaveText('Marlowe')
// After first merger resolves
await expect(page.locator('[data-testid="merger-2-defunct"]')).toHaveText('Halcyon')
```

---

## E2E-3.10: Safe Chain Cannot Be Acquired

**Preconditions:**
- One chain has 11+ tiles (safe)
- Another chain is smaller

**Steps:**
1. Player attempts to place merger tile
2. If safe chain would be acquired, tile is unplayable
3. Error or tile remains disabled

**Expected Outcomes:**
- Safe chains cannot be defunct in merger
- Clear indication tile cannot be played
- Player must choose different tile

**Playwright Hints:**
```typescript
await expect(page.locator('[data-testid="tile-illegal"]')).toHaveClass(/disabled/)
await page.hover('[data-testid="tile-illegal"]')
await expect(page.locator('[data-testid="tile-tooltip"]')).toContainText('Cannot merge safe chain')
```
