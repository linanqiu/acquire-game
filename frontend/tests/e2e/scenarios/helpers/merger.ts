import { Page, expect } from '@playwright/test'
import {
  waitForMyTurn,
  selectTileFromRack,
  placeTile,
  hasChainSelector,
  selectFirstAvailableChain,
  endTurn,
  waitForPhase,
  isInBuyPhase,
  getPhaseText,
} from './turn-actions'
import { captureStep } from './screenshot'

/**
 * Merger helpers for E2E scenario testing.
 *
 * These helpers focus on merger scenarios and stock disposition.
 */

export interface MergerState {
  defunctChain: string
  survivorChain: string
  stockCount: number
  availableToTrade: number
}

/**
 * Play turns until a merger occurs.
 * This loops through turns, handling chain founding along the way,
 * until the phase becomes 'merger' or 'stock_disposition'.
 *
 * @param page - Playwright Page
 * @param maxTurns - Maximum turns to attempt before giving up
 * @param options - Optional configuration
 * @returns The turn number when merger occurred
 */
export async function playUntilMerger(
  page: Page,
  maxTurns = 50,
  options: {
    category?: string
    testName?: string
    captureScreenshots?: boolean
  } = {}
): Promise<number> {
  const { category = 'merger', testName = 'merger-test', captureScreenshots = true } = options

  for (let turn = 1; turn <= maxTurns; turn++) {
    console.log(`[playUntilMerger] Starting turn ${turn}`)

    // Wait for our turn
    try {
      await waitForMyTurn(page, 60000)
    } catch {
      // Check if we're in merger phase
      const phaseText = await page.getByTestId('game-phase').textContent()
      if (phaseText?.includes('MERGER') || phaseText?.includes('DISPOSE')) {
        console.log(`[playUntilMerger] Merger detected at turn ${turn}`)
        if (captureScreenshots) {
          await captureStep(page, `merger-triggered-turn-${turn}`, { category, testName })
        }
        return turn
      }
      throw new Error(`Failed to get turn at turn ${turn}`)
    }

    // Check if we're already in merger (shouldn't happen, but just in case)
    const phaseText = await page.getByTestId('game-phase').textContent()
    if (phaseText?.includes('MERGER') || phaseText?.includes('DISPOSE')) {
      console.log(`[playUntilMerger] Already in merger at turn ${turn}`)
      if (captureScreenshots) {
        await captureStep(page, `merger-triggered-turn-${turn}`, { category, testName })
      }
      return turn
    }

    // Select and place a tile
    try {
      await selectTileFromRack(page)
      await placeTile(page)
    } catch (error) {
      console.log(`[playUntilMerger] Error placing tile at turn ${turn}:`, error)
      // Try to continue anyway
    }

    // Check if this triggered a merger (placeTile already waits for phase change)
    const newPhaseText = await getPhaseText(page)
    if (newPhaseText?.includes('MERGER') || newPhaseText?.includes('DISPOSE')) {
      console.log(`[playUntilMerger] Merger triggered by tile placement at turn ${turn}`)
      if (captureScreenshots) {
        await captureStep(page, `merger-triggered-turn-${turn}`, { category, testName })
      }
      return turn
    }

    // Handle chain founding if triggered
    if (await hasChainSelector(page)) {
      const chain = await selectFirstAvailableChain(page)
      console.log(`[playUntilMerger] Founded chain ${chain} at turn ${turn}`)
      // Wait for phase to update after founding (condition-based)
      await waitForPhase(page, 'BUY', 5000).catch(() => {})
    }

    // Wait for buy phase and end turn
    try {
      await waitForPhase(page, 'BUY', 10000)
      if (await isInBuyPhase(page)) {
        await endTurn(page)
      }
    } catch {
      // May not have buy phase if game ended or something else happened
    }
  }

  throw new Error(`No merger occurred after ${maxTurns} turns. Try a different seed.`)
}

/**
 * Wait for the merger disposition UI to appear.
 *
 * @param page - Playwright Page
 * @param timeout - Maximum time to wait
 */
export async function waitForMergerDisposition(page: Page, timeout = 30000): Promise<void> {
  await expect(page.getByTestId('merger-disposition')).toBeVisible({ timeout })
  console.log('[waitForMergerDisposition] Merger disposition UI visible')
}

/**
 * Get the current merger state from the disposition UI.
 *
 * @param page - Playwright Page
 * @returns MergerState object
 */
export async function getMergerState(page: Page): Promise<MergerState> {
  const disposition = page.getByTestId('merger-disposition')
  await expect(disposition).toBeVisible()

  // Extract chain names - these might be from data attributes or text
  const defunctChainEl = disposition.locator('[data-testid="defunct-chain"]')
  const survivorChainEl = disposition.locator('[data-testid="survivor-chain"]')

  const defunctChain = await defunctChainEl.getAttribute('data-chain') ||
    await defunctChainEl.textContent() || ''
  const survivorChain = await survivorChainEl.getAttribute('data-chain') ||
    await survivorChainEl.textContent() || ''

  // Extract stock count
  const stockCountEl = disposition.locator('[data-testid="stock-count"]')
  const stockCountText = await stockCountEl.textContent() || '0'
  const stockCount = parseInt(stockCountText.replace(/[^0-9]/g, ''), 10) || 0

  // Extract available to trade
  const availableEl = disposition.locator('[data-testid="available-to-trade"]')
  const availableText = await availableEl.textContent() || '0'
  const availableToTrade = parseInt(availableText.replace(/[^0-9]/g, ''), 10) || 0

  return {
    defunctChain,
    survivorChain,
    stockCount,
    availableToTrade,
  }
}

/**
 * Get the count of defunct stock from the disposition UI.
 *
 * @param page - Playwright Page
 * @returns Number of defunct stocks owned
 */
export async function getDefunctStockCount(page: Page): Promise<number> {
  const disposition = page.getByTestId('merger-disposition')
  await expect(disposition).toBeVisible()

  // The stock count should be displayed in the UI
  const stockCountEl = disposition.locator('[data-testid="stock-count"], [class*="stockCount"]')
  if (await stockCountEl.isVisible()) {
    const text = await stockCountEl.textContent() || '0'
    return parseInt(text.replace(/[^0-9]/g, ''), 10) || 0
  }

  // Fallback: look for text containing the count
  const text = await disposition.textContent() || ''
  const match = text.match(/(\d+)\s*shares?/i)
  return match ? parseInt(match[1], 10) : 0
}

/**
 * Get available pool stock for the survivor chain.
 *
 * @param page - Playwright Page
 * @returns Number of available stocks
 */
export async function getAvailablePoolStock(page: Page): Promise<number> {
  const disposition = page.getByTestId('merger-disposition')
  await expect(disposition).toBeVisible()

  const availableEl = disposition.locator('[data-testid="available-to-trade"], [class*="available"]')
  if (await availableEl.isVisible()) {
    const text = await availableEl.textContent() || '0'
    return parseInt(text.replace(/[^0-9]/g, ''), 10) || 0
  }

  return 0
}

/**
 * Set the sell amount in the disposition UI.
 *
 * @param page - Playwright Page
 * @param amount - Number of shares to sell
 */
export async function setSellAmount(page: Page, amount: number): Promise<void> {
  const sellSlider = page.getByTestId('sell-slider')
  if (await sellSlider.isVisible()) {
    await sellSlider.fill(amount.toString())
  } else {
    // Try using stepper buttons
    const sellStepper = page.locator('[class*="sell"]').getByRole('spinbutton')
    await sellStepper.fill(amount.toString())
  }
  console.log(`[setSellAmount] Set sell to ${amount}`)
}

/**
 * Set the trade amount in the disposition UI.
 *
 * @param page - Playwright Page
 * @param amount - Number of shares to trade (must be even)
 */
export async function setTradeAmount(page: Page, amount: number): Promise<void> {
  if (amount % 2 !== 0) {
    console.warn(`[setTradeAmount] Trade amount ${amount} is odd, will be adjusted`)
  }

  const tradeSlider = page.getByTestId('trade-slider')
  if (await tradeSlider.isVisible()) {
    await tradeSlider.fill(amount.toString())
  } else {
    // Try using stepper buttons
    const tradeStepper = page.locator('[class*="trade"]').getByRole('spinbutton')
    await tradeStepper.fill(amount.toString())
  }
  console.log(`[setTradeAmount] Set trade to ${amount}`)
}

/**
 * Confirm the disposition (legacy naming).
 *
 * @param page - Playwright Page
 */
export async function confirmDisposition(page: Page): Promise<void> {
  await submitDispositionUI(page)
}

/**
 * Submit the disposition with specific amounts.
 * The keep amount is calculated automatically.
 *
 * @param page - Playwright Page
 * @param sell - Number of shares to sell
 * @param trade - Number of shares to trade (must be even)
 * @param keep - Number of shares to keep (for validation only)
 */
export async function submitDisposition(
  page: Page,
  sell: number,
  trade: number,
  keep: number
): Promise<void> {
  console.log(`[submitDisposition] Submitting: sell=${sell}, trade=${trade}, keep=${keep}`)

  // Set the values using the UI
  if (sell > 0) {
    await setSellAmount(page, sell)
  }
  if (trade > 0) {
    await setTradeAmount(page, trade)
  }

  // Submit
  await submitDispositionUI(page)
}

/**
 * Click the submit/confirm button for disposition.
 *
 * @param page - Playwright Page
 */
async function submitDispositionUI(page: Page): Promise<void> {
  // Look for the confirm button
  const confirmButton = page.getByRole('button', { name: /confirm/i })
    .or(page.getByTestId('confirm-disposition'))
    .or(page.getByRole('button', { name: /submit/i }))

  await expect(confirmButton).toBeVisible()
  await expect(confirmButton).toBeEnabled()
  await confirmButton.click()

  // Wait for disposition UI to close
  await expect(page.getByTestId('merger-disposition')).not.toBeVisible({ timeout: 10000 })
  console.log('[submitDispositionUI] Disposition submitted')
}

/**
 * Check if we're in the stock disposition phase.
 *
 * @param page - Playwright Page
 * @returns true if in stock disposition phase
 */
export async function isInDispositionPhase(page: Page): Promise<boolean> {
  const phaseText = await page.getByTestId('game-phase').textContent()
  return phaseText?.includes('DISPOSE') || false
}

/**
 * Check if the merger disposition UI is visible.
 *
 * @param page - Playwright Page
 * @returns true if disposition UI is visible
 */
export async function hasDispositionUI(page: Page): Promise<boolean> {
  return await page.getByTestId('merger-disposition').isVisible()
}

/**
 * Wait for the disposition phase to complete (either our disposition or others').
 *
 * @param page - Playwright Page
 * @param timeout - Maximum time to wait
 */
export async function waitForDispositionComplete(page: Page, timeout = 60000): Promise<void> {
  // Wait for phase to change from disposition
  await expect(page.getByTestId('game-phase')).not.toContainText('DISPOSE', { timeout })
  console.log('[waitForDispositionComplete] Disposition phase complete')
}

/**
 * Get the sell slider maximum value.
 *
 * @param page - Playwright Page
 * @returns Maximum sell amount
 */
export async function getSellMax(page: Page): Promise<number> {
  const sellSlider = page.getByTestId('sell-slider')
  if (await sellSlider.isVisible()) {
    const max = await sellSlider.getAttribute('max')
    return parseInt(max || '0', 10)
  }
  return 0
}

/**
 * Get the trade slider maximum value.
 *
 * @param page - Playwright Page
 * @returns Maximum trade amount (should be even)
 */
export async function getTradeMax(page: Page): Promise<number> {
  const tradeSlider = page.getByTestId('trade-slider')
  if (await tradeSlider.isVisible()) {
    const max = await tradeSlider.getAttribute('max')
    return parseInt(max || '0', 10)
  }
  return 0
}

/**
 * Check if trading is disabled (no survivor stock available).
 *
 * @param page - Playwright Page
 * @returns true if trade slider is disabled
 */
export async function isTradeDisabled(page: Page): Promise<boolean> {
  const tradeSlider = page.getByTestId('trade-slider')
  if (await tradeSlider.isVisible()) {
    return await tradeSlider.isDisabled()
  }
  return true
}
