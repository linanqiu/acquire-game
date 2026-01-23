import { Page, expect } from '@playwright/test'

/**
 * Turn action helpers for E2E scenario testing.
 *
 * These helpers interact with the game through the UI,
 * exactly as a real player would.
 */

/**
 * Wait for the WebSocket to be connected.
 * The page shows "Connecting to game..." when WebSocket is connecting.
 * When connected, this text should not be visible.
 *
 * @param page - Playwright Page
 * @param timeout - Maximum time to wait
 */
export async function waitForWebSocketConnected(page: Page, timeout = 10000): Promise<void> {
  // Wait for the "Connecting to game..." text to NOT be visible
  // This indicates the WebSocket is connected and game state is received
  await expect(page.getByText('Connecting to game...')).not.toBeVisible({ timeout })
}

/**
 * Wait until it's the current player's turn (phase shows "PLACE" indicating place_tile phase).
 * This is needed because bots may play before the human player gets their turn.
 *
 * @param page - Playwright Page
 * @param timeout - Maximum time to wait (default 60s for multiple bot turns)
 */
export async function waitForMyTurn(page: Page, timeout = 60000): Promise<void> {
  // Wait for the phase indicator to show "PLACE A TILE" which means it's our turn
  await expect(page.getByTestId('game-phase')).toContainText('PLACE', { timeout })
}

/**
 * Wait for a specific phase text to appear.
 *
 * @param page - Playwright Page
 * @param phaseText - Text to match in the phase indicator (e.g., "PLACE", "CHOOSE A CHAIN", "BUY")
 * @param timeout - Maximum time to wait
 */
export async function waitForPhase(page: Page, phaseText: string, timeout = 30000): Promise<void> {
  await expect(page.getByTestId('game-phase')).toContainText(phaseText, { timeout })
}

/**
 * Wait until it's no longer our turn.
 *
 * @param page - Playwright Page
 * @param timeout - Maximum time to wait
 */
export async function waitForTurnEnd(page: Page, timeout = 30000): Promise<void> {
  // Our turn ends when the phase no longer shows just "PLACE A TILE" or buy-related text,
  // but shows someone else's name in the phase indicator
  await expect(page.getByTestId('game-phase')).toContainText('TURN', { timeout })
}

/**
 * Select the first playable tile from the tile rack.
 * Playable tiles are those without disabled/dead states.
 *
 * @param page - Playwright Page
 * @param timeout - Maximum time to wait for an interactive tile
 * @returns The coordinate of the selected tile
 */
export async function selectTileFromRack(page: Page, timeout = 10000): Promise<string> {
  const rack = page.getByTestId('tile-rack')
  await expect(rack).toBeVisible()

  // Find a clickable tile in the rack (has role="button" when interactive)
  // Wait for at least one interactive tile to appear
  const playableTile = rack.locator('[role="button"]').first()
  await expect(playableTile).toBeVisible({ timeout })

  // Get the coordinate from the test ID
  const testId = await playableTile.getAttribute('data-testid')
  const coordinate = testId?.replace('tile-', '') || ''

  console.log(`[selectTileFromRack] Clicking tile: ${coordinate}`)
  await playableTile.click()

  // Wait for the tile to be selected (place tile button should become enabled)
  console.log(`[selectTileFromRack] Waiting for place-tile-button to be enabled`)
  await expect(page.getByTestId('place-tile-button')).toBeEnabled({ timeout: 5000 })
  console.log(`[selectTileFromRack] Place tile button is enabled`)

  return coordinate
}

/**
 * Select a specific tile from the rack by coordinate.
 *
 * @param page - Playwright Page
 * @param coordinate - Tile coordinate (e.g., "2I", "1A")
 * @param timeout - Maximum time to wait
 * @returns The coordinate of the selected tile
 */
export async function selectSpecificTile(page: Page, coordinate: string, timeout = 10000): Promise<string> {
  const rack = page.getByTestId('tile-rack')
  await expect(rack).toBeVisible()

  const tile = rack.getByTestId(`tile-${coordinate}`)
  await expect(tile).toBeVisible({ timeout })

  console.log(`[selectSpecificTile] Clicking tile: ${coordinate}`)
  await tile.click()

  // Wait for the tile to be selected (place tile button should become enabled)
  await expect(page.getByTestId('place-tile-button')).toBeEnabled({ timeout: 5000 })
  console.log(`[selectSpecificTile] Tile ${coordinate} selected`)

  return coordinate
}

/**
 * Click the "PLACE TILE" button to place the selected tile.
 * Waits for the phase to change from "PLACE A TILE" to something else.
 *
 * @param page - Playwright Page
 * @param timeout - Maximum time to wait for phase change
 */
export async function placeTile(page: Page, timeout = 15000): Promise<void> {
  const placeButton = page.getByTestId('place-tile-button')
  await expect(placeButton).toBeVisible()
  await expect(placeButton).toBeEnabled()

  // Ensure WebSocket is connected before trying to place
  await waitForWebSocketConnected(page, 5000)

  console.log(`[placeTile] Clicking PLACE TILE button`)
  await placeButton.click()
  console.log(`[placeTile] Clicked, waiting for phase to change from "PLACE A TILE"`)

  // Wait for phase to change from "PLACE A TILE"
  // After placing, game should go to found_chain, merger, or buy_stocks
  // If action fails due to WebSocket issue, phase won't change
  try {
    await expect(page.getByTestId('game-phase')).not.toContainText('PLACE A TILE', { timeout })
    console.log(`[placeTile] Phase changed successfully`)
  } catch (error) {
    // Check if there was a WebSocket error and retry
    const consoleText = await page.evaluate(() => {
      // Check if the place-tile-button is still visible (action might have failed)
      return document.querySelector('[data-testid="place-tile-button"]') !== null
    })

    if (consoleText) {
      console.log(`[placeTile] Phase didn't change, button still visible - retrying`)
      // Wait for WebSocket to reconnect
      await waitForWebSocketConnected(page, 5000)
      // Re-select tile and try again
      await page.getByTestId('tile-rack').locator('[role="button"]').first().click()
      await expect(placeButton).toBeEnabled({ timeout: 5000 })
      await placeButton.click()
      await expect(page.getByTestId('game-phase')).not.toContainText('PLACE A TILE', { timeout })
      console.log(`[placeTile] Retry succeeded`)
    } else {
      throw error
    }
  }
}

/**
 * End the turn by clicking the BUY/SKIP & END TURN button.
 *
 * @param page - Playwright Page
 */
export async function endTurn(page: Page): Promise<void> {
  const endTurnButton = page.getByTestId('end-turn-button')
  await expect(endTurnButton).toBeVisible()
  await expect(endTurnButton).toBeEnabled()
  await endTurnButton.click()
}

/**
 * Select a chain during the founding phase.
 *
 * @param page - Playwright Page
 * @param chainName - Name of the chain to select (case-sensitive, e.g., "Tower", "Luxor")
 */
export async function selectChain(page: Page, chainName: string): Promise<void> {
  const chainSelector = page.getByTestId('chain-selector')
  await expect(chainSelector).toBeVisible()

  const chainButton = page.getByTestId(`chain-button-${chainName.toLowerCase()}`)
  await expect(chainButton).toBeVisible()
  await expect(chainButton).toBeEnabled()
  await chainButton.click()
}

/**
 * Select the first available chain during the founding phase.
 *
 * @param page - Playwright Page
 * @returns The name of the selected chain
 */
export async function selectFirstAvailableChain(page: Page): Promise<string> {
  const chainSelector = page.getByTestId('chain-selector')
  await expect(chainSelector).toBeVisible()

  // Find the first enabled chain button
  const availableChain = chainSelector.locator('button:not([disabled])').first()
  await expect(availableChain).toBeVisible()

  // Get chain name from data-testid
  const testId = await availableChain.getAttribute('data-testid')
  const chainName = testId?.replace('chain-button-', '') || ''

  await availableChain.click()
  return chainName
}

/**
 * Buy stock in a specific chain using the stepper.
 *
 * @param page - Playwright Page
 * @param chainName - Name of the chain to buy
 * @param quantity - Number of shares to buy (1-3)
 */
export async function buyStock(page: Page, chainName: string, quantity: number): Promise<void> {
  // Stock steppers are in purchase rows with chain markers
  // Find the row containing the chain name and increment the stepper
  const stockForm = page.locator('[class*="stockPurchaseForm"]')
  await expect(stockForm).toBeVisible()

  // Find the row with the matching chain (by looking for the chain marker)
  const row = stockForm.locator('[class*="purchaseRow"]').filter({
    hasText: new RegExp(chainName, 'i'),
  })

  // Click the increment button the specified number of times
  const incrementButton = row.getByRole('button', { name: '+' })
  for (let i = 0; i < quantity; i++) {
    await incrementButton.click()
  }
}

/**
 * Check if we're currently in the buy stocks phase.
 *
 * @param page - Playwright Page
 * @returns true if in buy stocks phase
 */
export async function isInBuyPhase(page: Page): Promise<boolean> {
  const phase = await page.getByTestId('game-phase').textContent()
  return phase?.includes('BUY') || false
}

/**
 * Check if we're currently in the chain founding phase.
 *
 * @param page - Playwright Page
 * @returns true if in founding phase
 */
export async function isInFoundingPhase(page: Page): Promise<boolean> {
  const phase = await page.getByTestId('game-phase').textContent()
  return phase?.includes('CHOOSE A CHAIN') || false
}

/**
 * Check if a chain selector is visible (indicating founding phase).
 *
 * @param page - Playwright Page
 * @returns true if chain selector is visible
 */
export async function hasChainSelector(page: Page, waitMs = 2000): Promise<boolean> {
  try {
    // Wait briefly for chain selector to appear (it may take a moment after tile placement)
    await page.getByTestId('chain-selector').waitFor({ state: 'visible', timeout: waitMs })
    return true
  } catch {
    return false
  }
}

/**
 * Get the current game phase text.
 *
 * @param page - Playwright Page
 * @returns The phase text
 */
export async function getPhaseText(page: Page): Promise<string> {
  return (await page.getByTestId('game-phase').textContent()) || ''
}

/**
 * Complete a full basic turn: select tile, place it, optionally handle founding, end turn.
 * This helper handles the common case of placing a tile and ending the turn.
 *
 * @param page - Playwright Page
 * @param options - Options for the turn
 * @returns Object with details about what happened during the turn
 */
export async function completeBasicTurn(
  page: Page,
  options: {
    skipBuy?: boolean
    handleFounding?: boolean
  } = {}
): Promise<{
  tilePlaced: string
  chainFounded?: string
}> {
  const result: { tilePlaced: string; chainFounded?: string } = { tilePlaced: '' }

  // Select and place a tile
  result.tilePlaced = await selectTileFromRack(page)
  await placeTile(page)

  // Wait a moment for phase transition
  await page.waitForTimeout(500)

  // Check if we triggered chain founding
  if (options.handleFounding !== false && (await hasChainSelector(page))) {
    result.chainFounded = await selectFirstAvailableChain(page)
    // Wait for founding to complete
    await page.waitForTimeout(500)
  }

  // Wait for buy phase (if not skipped entirely)
  await waitForPhase(page, 'BUY', 10000).catch(() => {
    // May not have buy phase if game progresses differently
  })

  // End turn if we're in buy phase
  if (await isInBuyPhase(page)) {
    await endTurn(page)
  }

  return result
}

/**
 * Set up console error tracking for a page.
 * Returns a function to get the collected errors.
 *
 * @param page - Playwright Page
 * @returns Object with getErrors function and clear function
 */
export function setupConsoleErrorTracking(page: Page): {
  getErrors: () => string[]
  clear: () => void
} {
  const errors: string[] = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text()
      // Filter out expected errors
      if (
        !text.includes('favicon') &&
        !text.includes('404') &&
        !text.includes('net::ERR_')
      ) {
        errors.push(text)
      }
    }
  })

  page.on('pageerror', (err) => {
    errors.push(`Page error: ${err.message}`)
  })

  return {
    getErrors: () => [...errors],
    clear: () => {
      errors.length = 0
    },
  }
}
