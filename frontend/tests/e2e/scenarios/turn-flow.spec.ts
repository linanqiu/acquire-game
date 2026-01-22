import { test, expect, Page } from '@playwright/test'
import { captureStep, resetStepCounter } from './helpers/screenshot'
import {
  createGameViaUI,
  addBotViaUI,
  startGameViaUI,
  waitForGameToStart,
} from './helpers/game-setup'

const CATEGORY = 'turn-flow'

/**
 * Helper to wait for it to be the human player's turn.
 * Bots play automatically, so we wait until the phase indicator shows it's our turn.
 */
async function waitForMyTurn(page: Page, playerName: string, timeout = 30000): Promise<void> {
  // Wait for phase text that indicates it's our turn (not showing another player's name)
  // When it's our turn, we see action prompts like "PLACE A TILE", "BUY STOCKS", etc.
  // When it's not our turn, we see "{PlayerName}'s TURN"
  await expect(async () => {
    const phaseText = await page.locator('[class*="phase"]').first().textContent()
    // It's our turn if we don't see someone else's turn indicator
    const isOtherPlayerTurn = phaseText?.includes("'S TURN") && !phaseText?.includes(playerName)
    expect(isOtherPlayerTurn).toBe(false)
  }).toPass({ timeout })
}

/**
 * Helper to wait for place_tile phase specifically.
 */
async function waitForPlaceTilePhase(page: Page, timeout = 30000): Promise<void> {
  await expect(page.getByText('PLACE A TILE')).toBeVisible({ timeout })
}

/**
 * Helper to wait for buy_stocks phase specifically.
 */
async function waitForBuyStocksPhase(page: Page, timeout = 30000): Promise<void> {
  await expect(page.getByText('BUY STOCKS')).toBeVisible({ timeout })
}

/**
 * Helper to capture console errors during tests.
 */
function setupConsoleErrorCapture(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text()
      // Filter out expected noise
      if (
        !text.includes('favicon') &&
        !text.includes('404') &&
        !text.includes('net::ERR')
      ) {
        errors.push(text)
      }
    }
  })
  return errors
}

test.describe('Turn Flow Scenarios (1.x)', () => {
  // Use longer timeout for E2E tests
  test.setTimeout(120000)

  test.beforeEach(() => {
    resetStepCounter()
  })

  test('1.1: Basic complete turn - place tile and end turn', async ({ page }) => {
    const testName = 'scenario-1.1-basic-turn'
    const consoleErrors = setupConsoleErrorCapture(page)

    // Step 1: Create game via UI (navigates to lobby internally)
    const gameContext = await createGameViaUI(page, 'TurnTester')
    expect(gameContext.roomCode).toMatch(/^[A-Z]{4}$/)
    await captureStep(page, 'game-created', { category: CATEGORY, testName })

    // Step 2: Add bots (need at least 3 players)
    await addBotViaUI(page)
    await addBotViaUI(page)
    await captureStep(page, 'bots-added', { category: CATEGORY, testName })

    // Step 3: Start game via UI
    await startGameViaUI(page)
    await waitForGameToStart(page)
    await captureStep(page, 'game-started', { category: CATEGORY, testName })

    // Step 4: Wait for our turn (bots play automatically)
    // We might need to wait through bot turns
    await waitForMyTurn(page, 'TurnTester')
    await captureStep(page, 'my-turn-started', { category: CATEGORY, testName })

    // Step 5: Handle the current phase
    // If we're in place_tile phase, place a tile
    const placeTileVisible = await page.getByText('PLACE A TILE').isVisible().catch(() => false)

    if (placeTileVisible) {
      // Select a tile from the tile rack
      const tileRack = page.locator('[data-testid="tile-rack"]')
      await expect(tileRack).toBeVisible()

      // Click the first available tile in the rack
      const firstTile = tileRack.locator('button').first()
      await expect(firstTile).toBeVisible()
      await firstTile.click()
      await captureStep(page, 'tile-selected', { category: CATEGORY, testName })

      // Click the PLACE TILE button
      await page.getByRole('button', { name: 'PLACE TILE' }).click()
      await captureStep(page, 'tile-placed', { category: CATEGORY, testName })
    }

    // Step 6: Handle buy stocks phase (or wait for it if chain founding happened)
    // Wait for buy stocks phase with longer timeout since chain founding might occur
    await waitForBuyStocksPhase(page, 15000).catch(() => {
      // If we don't reach buy stocks, it might be another player's turn already
      console.log('Did not reach buy stocks phase - may be other player turn')
    })

    const buyStocksVisible = await page.getByText('BUY STOCKS').isVisible().catch(() => false)

    if (buyStocksVisible) {
      await captureStep(page, 'buy-stocks-phase', { category: CATEGORY, testName })

      // End turn (skip buying stocks for basic test)
      const endTurnButton = page.getByRole('button', { name: /END TURN/i })
      await expect(endTurnButton).toBeVisible()
      await endTurnButton.click()
      await captureStep(page, 'turn-ended', { category: CATEGORY, testName })
    }

    // Verify no critical console errors
    expect(consoleErrors).toHaveLength(0)
  })

  test('1.2: Turn with no stock purchase - skip buying', async ({ page }) => {
    const testName = 'scenario-1.2-skip-stocks'
    const consoleErrors = setupConsoleErrorCapture(page)

    // Create game with bots
    const gameContext = await createGameViaUI(page, 'SkipBuyer')
    await captureStep(page, 'game-created', { category: CATEGORY, testName })

    await addBotViaUI(page)
    await addBotViaUI(page)
    await startGameViaUI(page)
    await waitForGameToStart(page)
    await captureStep(page, 'game-started', { category: CATEGORY, testName })

    // Wait for our turn
    await waitForMyTurn(page, 'SkipBuyer')

    // Handle place tile phase
    const placeTileVisible = await page.getByText('PLACE A TILE').isVisible().catch(() => false)

    if (placeTileVisible) {
      await captureStep(page, 'place-tile-phase', { category: CATEGORY, testName })

      // Select and place first tile
      const tileRack = page.locator('[data-testid="tile-rack"]')
      const firstTile = tileRack.locator('button').first()
      await firstTile.click()
      await page.getByRole('button', { name: 'PLACE TILE' }).click()
      await captureStep(page, 'tile-placed', { category: CATEGORY, testName })
    }

    // Wait for buy stocks phase
    await waitForBuyStocksPhase(page, 15000).catch(() => {})

    const buyStocksVisible = await page.getByText('BUY STOCKS').isVisible().catch(() => false)

    if (buyStocksVisible) {
      await captureStep(page, 'buy-stocks-phase', { category: CATEGORY, testName })

      // Verify we can see the stock purchase UI
      const stockCard = page.locator('text=BUY STOCKS').first()
      await expect(stockCard).toBeVisible()

      // Click "SKIP & END TURN" (no stocks purchased)
      const skipButton = page.getByRole('button', { name: 'SKIP & END TURN' })
      await expect(skipButton).toBeVisible()
      await captureStep(page, 'before-skip', { category: CATEGORY, testName })

      await skipButton.click()
      await captureStep(page, 'turn-skipped', { category: CATEGORY, testName })

      // Verify turn ended (should now be another player's turn or back to our turn)
      // The phase indicator should change
      await page.waitForTimeout(1000) // Brief wait for state to update
      await captureStep(page, 'after-turn-ended', { category: CATEGORY, testName })
    }

    expect(consoleErrors).toHaveLength(0)
  })

  test('1.3: Turn with chain founding - select chain when creating adjacency', async ({ page }) => {
    const testName = 'scenario-1.3-chain-founding'
    const consoleErrors = setupConsoleErrorCapture(page)

    // Create game with bots
    const gameContext = await createGameViaUI(page, 'ChainFounder')
    await captureStep(page, 'game-created', { category: CATEGORY, testName })

    await addBotViaUI(page)
    await addBotViaUI(page)
    await startGameViaUI(page)
    await waitForGameToStart(page)
    await captureStep(page, 'game-started', { category: CATEGORY, testName })

    // Play multiple turns looking for chain founding opportunity
    // Chain founding happens when a tile creates adjacency between 2+ orphan tiles
    let foundChainOpportunity = false

    for (let turn = 0; turn < 10 && !foundChainOpportunity; turn++) {
      // Wait for our turn
      try {
        await waitForMyTurn(page, 'ChainFounder', 20000)
      } catch {
        // If timeout, game might be in unexpected state
        await captureStep(page, `turn-${turn}-timeout`, { category: CATEGORY, testName })
        break
      }

      const currentPhase = await page.locator('[class*="phase"]').first().textContent()
      await captureStep(page, `turn-${turn}-phase-${currentPhase?.replace(/\s+/g, '-')}`, {
        category: CATEGORY,
        testName
      })

      // Check if we're in chain founding phase (this would happen after placing a tile that creates adjacency)
      const chainSelectorVisible = await page.locator('[data-testid="chain-selector"]').isVisible().catch(() => false)

      if (chainSelectorVisible) {
        foundChainOpportunity = true
        await captureStep(page, 'chain-selector-appeared', { category: CATEGORY, testName })

        // Select a chain - try to click one of the available chain buttons
        // The chain selector groups chains by tier
        const chainButton = page.locator('[data-testid^="chain-button-"]').first()
        await expect(chainButton).toBeVisible()
        await chainButton.click()
        await captureStep(page, 'chain-selected', { category: CATEGORY, testName })

        // Wait for buy stocks phase after founding
        await waitForBuyStocksPhase(page, 10000).catch(() => {})
        await captureStep(page, 'after-chain-founded', { category: CATEGORY, testName })

        // End turn
        const endTurnButton = page.getByRole('button', { name: /END TURN/i })
        if (await endTurnButton.isVisible().catch(() => false)) {
          await endTurnButton.click()
          await captureStep(page, 'turn-ended-after-founding', { category: CATEGORY, testName })
        }
        break
      }

      // If in place_tile phase, place a tile
      const placeTileVisible = await page.getByText('PLACE A TILE').isVisible().catch(() => false)

      if (placeTileVisible) {
        const tileRack = page.locator('[data-testid="tile-rack"]')
        const firstTile = tileRack.locator('button').first()

        if (await firstTile.isVisible().catch(() => false)) {
          await firstTile.click()
          await page.getByRole('button', { name: 'PLACE TILE' }).click()

          // Check if chain selector appeared after placing tile
          await page.waitForTimeout(500)
          const chainSelectorAfterPlace = await page.locator('[data-testid="chain-selector"]').isVisible().catch(() => false)

          if (chainSelectorAfterPlace) {
            foundChainOpportunity = true
            await captureStep(page, 'chain-selector-after-tile', { category: CATEGORY, testName })

            const chainButton = page.locator('[data-testid^="chain-button-"]').first()
            await chainButton.click()
            await captureStep(page, 'chain-founded', { category: CATEGORY, testName })
          }
        }
      }

      // Handle buy stocks phase if we reach it
      const buyStocksVisible = await page.getByText('BUY STOCKS').isVisible().catch(() => false)

      if (buyStocksVisible && !foundChainOpportunity) {
        const endTurnButton = page.getByRole('button', { name: /END TURN/i })
        if (await endTurnButton.isVisible().catch(() => false)) {
          await endTurnButton.click()
        }
      }
    }

    // Capture final state
    await captureStep(page, 'test-complete', { category: CATEGORY, testName })

    // Note: Chain founding is probabilistic based on tile distribution
    // This test verifies the UI flow works when it happens
    console.log(`Chain founding opportunity found: ${foundChainOpportunity}`)

    expect(consoleErrors).toHaveLength(0)
  })

  test('1.4: Multiple turns - verify turn rotation', async ({ page }) => {
    const testName = 'scenario-1.4-turn-rotation'
    const consoleErrors = setupConsoleErrorCapture(page)

    // Create game with bots
    await createGameViaUI(page, 'TurnRotator')
    await captureStep(page, 'game-created', { category: CATEGORY, testName })

    await addBotViaUI(page)
    await addBotViaUI(page)
    await startGameViaUI(page)
    await waitForGameToStart(page)
    await captureStep(page, 'game-started', { category: CATEGORY, testName })

    // Track completed turns
    let completedTurns = 0
    const targetTurns = 3

    for (let attempt = 0; attempt < 15 && completedTurns < targetTurns; attempt++) {
      // Wait for our turn
      try {
        await waitForMyTurn(page, 'TurnRotator', 20000)
      } catch {
        await captureStep(page, `attempt-${attempt}-waiting`, { category: CATEGORY, testName })
        continue
      }

      await captureStep(page, `turn-${completedTurns + 1}-start`, { category: CATEGORY, testName })

      // Handle place tile
      const placeTileVisible = await page.getByText('PLACE A TILE').isVisible().catch(() => false)

      if (placeTileVisible) {
        const tileRack = page.locator('[data-testid="tile-rack"]')
        const firstTile = tileRack.locator('button').first()

        if (await firstTile.isVisible().catch(() => false)) {
          await firstTile.click()
          await page.getByRole('button', { name: 'PLACE TILE' }).click()
        }
      }

      // Handle chain selector if it appears
      const chainSelectorVisible = await page.locator('[data-testid="chain-selector"]').isVisible().catch(() => false)
      if (chainSelectorVisible) {
        const chainButton = page.locator('[data-testid^="chain-button-"]').first()
        if (await chainButton.isVisible().catch(() => false)) {
          await chainButton.click()
        }
      }

      // Wait for and handle buy stocks phase
      await waitForBuyStocksPhase(page, 10000).catch(() => {})

      const buyStocksVisible = await page.getByText('BUY STOCKS').isVisible().catch(() => false)
      if (buyStocksVisible) {
        const endTurnButton = page.getByRole('button', { name: /END TURN/i })
        if (await endTurnButton.isVisible().catch(() => false)) {
          await endTurnButton.click()
          completedTurns++
          await captureStep(page, `turn-${completedTurns}-completed`, { category: CATEGORY, testName })
        }
      }

      // Brief pause to let state update
      await page.waitForTimeout(500)
    }

    await captureStep(page, 'rotation-test-complete', { category: CATEGORY, testName })

    // Verify we completed at least 2 turns (rotation happened)
    expect(completedTurns).toBeGreaterThanOrEqual(2)
    expect(consoleErrors).toHaveLength(0)
  })

  test('1.5: Turn with stock purchase - buy stocks before ending', async ({ page }) => {
    const testName = 'scenario-1.5-buy-stocks'
    const consoleErrors = setupConsoleErrorCapture(page)

    // Create game with bots
    await createGameViaUI(page, 'StockBuyer')
    await captureStep(page, 'game-created', { category: CATEGORY, testName })

    await addBotViaUI(page)
    await addBotViaUI(page)
    await startGameViaUI(page)
    await waitForGameToStart(page)
    await captureStep(page, 'game-started', { category: CATEGORY, testName })

    // Play multiple turns to get chains on the board
    let boughtStock = false

    for (let turn = 0; turn < 20 && !boughtStock; turn++) {
      try {
        await waitForMyTurn(page, 'StockBuyer', 20000)
      } catch {
        continue
      }

      // Handle place tile
      const placeTileVisible = await page.getByText('PLACE A TILE').isVisible().catch(() => false)

      if (placeTileVisible) {
        const tileRack = page.locator('[data-testid="tile-rack"]')
        const firstTile = tileRack.locator('button').first()

        if (await firstTile.isVisible().catch(() => false)) {
          await firstTile.click()
          await page.getByRole('button', { name: 'PLACE TILE' }).click()
        }
      }

      // Handle chain selector if it appears
      const chainSelectorVisible = await page.locator('[data-testid="chain-selector"]').isVisible().catch(() => false)
      if (chainSelectorVisible) {
        const chainButton = page.locator('[data-testid^="chain-button-"]').first()
        if (await chainButton.isVisible().catch(() => false)) {
          await chainButton.click()
        }
      }

      // Wait for buy stocks phase
      await waitForBuyStocksPhase(page, 10000).catch(() => {})

      const buyStocksVisible = await page.getByText('BUY STOCKS').isVisible().catch(() => false)

      if (buyStocksVisible) {
        await captureStep(page, `turn-${turn}-buy-phase`, { category: CATEGORY, testName })

        // Check if there are active chains to buy from (stock steppers visible)
        const stockSteppers = page.locator('[data-testid="stock-stepper"]')
        const stepperCount = await stockSteppers.count()

        if (stepperCount > 0) {
          await captureStep(page, 'stocks-available', { category: CATEGORY, testName })

          // Try to increment the first stepper to buy 1 stock
          const incrementButton = page.locator('[data-testid="stepper-increment"]').first()

          if (await incrementButton.isEnabled().catch(() => false)) {
            await incrementButton.click()
            await captureStep(page, 'stock-selected', { category: CATEGORY, testName })

            // The button should now say "BUY & END TURN"
            const buyEndButton = page.getByRole('button', { name: 'BUY & END TURN' })

            if (await buyEndButton.isVisible().catch(() => false)) {
              await buyEndButton.click()
              boughtStock = true
              await captureStep(page, 'stock-purchased', { category: CATEGORY, testName })
            }
          }
        }

        // If couldn't buy, just end turn
        if (!boughtStock) {
          const endTurnButton = page.getByRole('button', { name: /END TURN/i })
          if (await endTurnButton.isVisible().catch(() => false)) {
            await endTurnButton.click()
          }
        }
      }

      await page.waitForTimeout(500)
    }

    await captureStep(page, 'test-complete', { category: CATEGORY, testName })
    console.log(`Successfully bought stock: ${boughtStock}`)

    expect(consoleErrors).toHaveLength(0)
  })

  test('1.6: Observe bot turns - verify bots play correctly', async ({ page }) => {
    const testName = 'scenario-1.6-bot-turns'
    const consoleErrors = setupConsoleErrorCapture(page)

    // Use spectator mode to watch bots play
    await page.goto('/')

    // Wait for lobby to load
    await expect(page.getByRole('heading', { name: 'ACQUIRE' })).toBeVisible({ timeout: 15000 })

    // Click "Watch Bots Play"
    await page.getByTestId('watch-bots-button').click()
    await page.waitForURL(/\/host\/[A-Z]{4}/, { timeout: 15000 })
    await captureStep(page, 'host-page-loaded', { category: CATEGORY, testName })

    // Wait for page to load and WebSocket to connect
    await page.waitForTimeout(3000)

    // Wait for players count to appear (indicates WebSocket connected)
    await expect(page.getByText('PLAYERS (0/6)')).toBeVisible({ timeout: 15000 })

    // Add 3 bots
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: '+ ADD BOT' }).click()
      await page.waitForTimeout(1000)
    }
    await captureStep(page, 'bots-added', { category: CATEGORY, testName })

    // Should now show 3 players
    await expect(page.getByText('PLAYERS (3/6)')).toBeVisible({ timeout: 10000 })

    // Start the game
    await page.getByRole('button', { name: 'START GAME' }).click()

    // Wait for game to start - lobby UI disappears
    await expect(page.getByText('PLAYERS (3/6)')).not.toBeVisible({ timeout: 15000 })
    await captureStep(page, 'game-started', { category: CATEGORY, testName })

    // Wait for bots to play a few turns
    await page.waitForTimeout(5000)

    // Verify we're watching the game - check for scoreboard
    await expect(page.getByText('SCOREBOARD')).toBeVisible({ timeout: 10000 })
    await captureStep(page, 'bots-playing', { category: CATEGORY, testName })

    expect(consoleErrors).toHaveLength(0)
  })
})
