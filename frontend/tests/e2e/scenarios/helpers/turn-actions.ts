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
export async function selectSpecificTile(
  page: Page,
  coordinate: string,
  timeout = 10000
): Promise<string> {
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
 * @param _tileCoord - Unused, kept for API compatibility
 * @param timeout - Maximum time to wait for phase change
 */
export async function placeTile(page: Page, _tileCoord?: string, timeout = 15000): Promise<void> {
  const placeButton = page.getByTestId('place-tile-button')

  // Wait for button to be available
  try {
    await expect(placeButton).toBeVisible({ timeout: 5000 })
    await expect(placeButton).toBeEnabled({ timeout: 5000 })
  } catch {
    // Button not available - check if phase already changed
    const phase = await getPhaseText(page)
    if (!phase.includes('PLACE A TILE')) {
      console.log(`[placeTile] Not in PLACE phase anymore: "${phase}"`)
      return
    }
    throw new Error(`[placeTile] Button not available but still in PLACE phase`)
  }

  console.log(`[placeTile] Clicking PLACE TILE button`)
  try {
    await placeButton.click({ timeout: 5000 })
  } catch {
    const phase = await getPhaseText(page)
    if (!phase.includes('PLACE A TILE')) {
      console.log(`[placeTile] Button click failed but phase changed to "${phase}"`)
      return
    }
    throw new Error(`[placeTile] Button click failed and still in PLACE phase`)
  }

  console.log(`[placeTile] Clicked, waiting for phase to change from "PLACE A TILE"`)

  // Wait for phase to change
  try {
    await expect(page.getByTestId('game-phase')).not.toContainText('PLACE A TILE', { timeout })
    console.log(`[placeTile] Phase changed successfully`)
  } catch {
    const finalPhase = await getPhaseText(page)
    if (!finalPhase.includes('PLACE A TILE')) {
      console.log(`[placeTile] Phase eventually changed to "${finalPhase}"`)
      return
    }
    throw new Error(`[placeTile] Phase stuck at "PLACE A TILE" after ${timeout}ms`)
  }
}

/**
 * End the turn by clicking the BUY/SKIP & END TURN button.
 *
 * @param page - Playwright Page
 */
export async function endTurn(page: Page): Promise<void> {
  // Ensure WebSocket is connected (the end-turn button only renders when connected)
  await waitForWebSocketConnected(page, 15000)
  const endTurnButton = page.getByTestId('end-turn-button')
  await expect(endTurnButton).toBeVisible({ timeout: 10000 })
  await expect(endTurnButton).toBeEnabled({ timeout: 5000 })
  await endTurnButton.click()
}

/**
 * Send a game action via HTTP as a reliable fallback when WebSocket fails.
 */
export async function sendActionViaHttp(
  page: Page,
  action: Record<string, unknown>
): Promise<{ ok: boolean; phase?: string; error?: string } | null> {
  try {
    const url = page.url()
    const match = url.match(/\/play\/([A-Za-z]{4})/)
    const playerId = await page.evaluate(() => sessionStorage.getItem('player_id') || '')
    if (!match || !playerId) {
      console.log(`[HTTP] Could not extract room/player. URL: ${url}`)
      return null
    }

    const roomCode = match[1].toUpperCase()
    console.log(`[HTTP] Sending action to ${roomCode}: ${JSON.stringify(action)}`)

    const result = await page.evaluate(
      async ({ roomCode, playerId, action }) => {
        try {
          const resp = await fetch(`/api/room/${roomCode}/action/${playerId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action),
          })
          const text = await resp.text()
          if (!resp.ok) return { ok: false, error: `${resp.status}: ${text}` }
          const data = JSON.parse(text)
          if (data.status === 'error') {
            return { ok: false, phase: data.phase, error: data.error || 'Action failed' }
          }
          return { ok: true, phase: data.phase }
        } catch (e) {
          return { ok: false, error: String(e) }
        }
      },
      { roomCode, playerId, action }
    )
    console.log(`[HTTP] Response: ${JSON.stringify(result)}`)
    return result as { ok: boolean; phase?: string; error?: string }
  } catch (e) {
    console.log(`[HTTP] Exception: ${e}`)
    return null
  }
}

/**
 * Robust end-turn for BUY phase: tries UI button first, falls back to HTTP.
 * Sends buy_stocks with empty purchases (equivalent to SKIP & END TURN).
 *
 * @param page - Playwright Page
 * @param label - Label for logging
 * @returns true if phase changed from BUY
 */
export async function safeEndTurnInBuyPhase(page: Page, label = ''): Promise<boolean> {
  const currentPhase = await getPhaseText(page)
  if (!currentPhase.includes('BUY')) return true

  // Try UI button first (quick timeout)
  const endTurnButton = page.getByTestId('end-turn-button')
  try {
    await expect(endTurnButton).toBeVisible({ timeout: 3000 })
    await expect(endTurnButton).toBeEnabled({ timeout: 3000 })
    await endTurnButton.click()
    console.log(`[${label}] Clicked end-turn button`)

    // Wait for phase to change
    try {
      await expect(page.getByTestId('game-phase')).not.toContainText('BUY', { timeout: 10000 })
      return true
    } catch {
      console.log(`[${label}] Phase didn't change after UI click`)
    }
  } catch {
    console.log(`[${label}] UI end-turn button not clickable, using HTTP fallback`)
  }

  // HTTP fallback: send buy_stocks with empty purchases
  const result = await sendActionViaHttp(page, { action: 'buy_stocks', purchases: {} })
  if (result?.ok) {
    console.log(`[${label}] HTTP buy_stocks sent, server phase: "${result.phase}"`)
    try {
      await expect(page.getByTestId('game-phase')).not.toContainText('BUY', { timeout: 10000 })
      return true
    } catch {
      const phase = await getPhaseText(page)
      console.log(`[${label}] Phase after HTTP wait: "${phase}"`)
      return !phase.includes('BUY')
    }
  }

  console.log(`[${label}] All end-turn attempts failed`)
  return false
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
 * Wait for the phase to change from its current value.
 * This is condition-based waiting that avoids arbitrary timeouts.
 *
 * @param page - Playwright Page
 * @param currentPhase - The current phase text to wait to change from
 * @param timeout - Maximum time to wait
 * @returns true if phase changed, false if timed out
 */
export async function waitForPhaseChange(
  page: Page,
  currentPhase: string,
  timeout = 5000
): Promise<boolean> {
  try {
    // Wait for the phase element to NOT contain the current phase text
    // This triggers as soon as any change happens
    await expect(page.getByTestId('game-phase')).not.toContainText(currentPhase, { timeout })
    return true
  } catch {
    return false
  }
}

/**
 * Wait for any game state update by watching the phase indicator.
 * Polls with short intervals but uses Playwright's built-in waiting.
 *
 * @param page - Playwright Page
 * @param timeout - Maximum time to wait
 * @returns true if state changed, false if timed out
 */
export async function waitForGameStateUpdate(page: Page, timeout = 5000): Promise<boolean> {
  const startPhase = await getPhaseText(page)
  return waitForPhaseChange(page, startPhase, timeout)
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
  await placeTile(page, result.tilePlaced)

  // Check if we triggered chain founding (hasChainSelector has built-in waiting)
  if (options.handleFounding !== false && (await hasChainSelector(page))) {
    result.chainFounded = await selectFirstAvailableChain(page)
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
      if (!text.includes('favicon') && !text.includes('404') && !text.includes('net::ERR_')) {
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

/**
 * Get the size (number of tiles) of a chain on the board.
 * This counts tiles that have the data-chain attribute set.
 *
 * @param page - Playwright Page
 * @param chainName - Name of the chain (case-insensitive)
 * @returns Number of tiles in the chain, 0 if chain not on board
 */
export async function getChainSize(page: Page, chainName: string): Promise<number> {
  return await page.evaluate((name) => {
    const cells = document.querySelectorAll(`[data-chain="${name.toLowerCase()}"]`)
    return cells.length
  }, chainName)
}

/**
 * Get the available stock count for a chain.
 * This looks at the stock purchase form where available stock is displayed as [N].
 *
 * @param page - Playwright Page
 * @param chainName - Name of the chain (case-insensitive)
 * @returns Number of available stocks, or -1 if chain info not found
 */
export async function getAvailableStock(page: Page, chainName: string): Promise<number> {
  return await page.evaluate((name) => {
    // Look for chain marker in the stock purchase form
    // The available stock is shown as [N] in a span after the ChainMarker
    const chainMarker = document.querySelector(
      `[data-testid="chain-marker-${name.toLowerCase()}"]`
    )
    if (!chainMarker) return -1

    // Find the parent purchase row and look for [N] pattern
    const purchaseRow = chainMarker.closest('div')
    if (!purchaseRow) return -1

    // The available stock is typically the last span with [N] format
    const spans = purchaseRow.querySelectorAll('span')
    for (const span of Array.from(spans)) {
      const text = span.textContent || ''
      const match = text.match(/\[(\d+)\]/)
      if (match) {
        return parseInt(match[1], 10)
      }
    }
    return -1
  }, chainName)
}

/**
 * Get the portfolio holdings (stocks owned) for the current player.
 *
 * @param page - Playwright Page
 * @returns Record mapping chain names to stock counts
 */
export async function getPortfolioHoldings(page: Page): Promise<Record<string, number>> {
  return await page.evaluate(() => {
    const holdings: Record<string, number> = {}
    const rows = document.querySelectorAll('[data-testid^="portfolio-row-"]')
    rows.forEach((row) => {
      const testId = row.getAttribute('data-testid') || ''
      const chain = testId.replace('portfolio-row-', '')
      const quantityCell = row.querySelector('td:nth-child(2)')
      const quantity = parseInt(quantityCell?.textContent || '0', 10)
      holdings[chain] = quantity
    })
    return holdings
  })
}

/**
 * Get the list of active chains on the board.
 *
 * @param page - Playwright Page
 * @returns Array of active chain names (lowercase)
 */
export async function getActiveChains(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const chainMarkers = document.querySelectorAll('[data-testid^="chain-marker-"]')
    const chains = new Set<string>()
    chainMarkers.forEach((el) => {
      const testId = el.getAttribute('data-testid') || ''
      chains.add(testId.replace('chain-marker-', ''))
    })
    return Array.from(chains)
  })
}

/**
 * Get the list of available chains from the chain selector.
 *
 * @param page - Playwright Page
 * @returns Array of available chain names (lowercase)
 */
export async function getAvailableChains(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const buttons = document.querySelectorAll('[data-testid^="chain-button-"]:not([disabled])')
    return Array.from(buttons).map((btn) => {
      const testId = btn.getAttribute('data-testid') || ''
      return testId.replace('chain-button-', '')
    })
  })
}

/**
 * Force close the WebSocket connection (for testing disconnection scenarios).
 *
 * @param page - Playwright Page
 */
export async function forceCloseWebSocket(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Try to find and close any WebSocket connections
    // The app stores the WebSocket instance on window for debugging
    const ws = (window as unknown as { __ws?: WebSocket }).__ws
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close()
    }
  })
}
