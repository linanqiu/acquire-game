import { Page, expect } from '@playwright/test'

/**
 * Assert that the game board is visible on the page.
 */
export async function assertBoardVisible(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="game-board"]')).toBeVisible()
}

/**
 * Assert that the player's money display shows the expected amount.
 *
 * @param page - Playwright Page object
 * @param expectedAmount - Expected money amount (without $ sign)
 */
export async function assertPlayerMoney(
  page: Page,
  expectedAmount: number
): Promise<void> {
  const moneyDisplay = page.locator('[data-testid="player-money"]')
  await expect(moneyDisplay).toContainText(
    `$${expectedAmount.toLocaleString()}`
  )
}

/**
 * Assert that a specific chain is visible on the board.
 *
 * @param page - Playwright Page object
 * @param chainName - Name of the chain (e.g., "tower", "american")
 */
export async function assertChainOnBoard(
  page: Page,
  chainName: string
): Promise<void> {
  const chainTiles = page.locator(`[data-chain="${chainName.toLowerCase()}"]`)
  await expect(chainTiles.first()).toBeVisible()
}

/**
 * Assert that a chain has a specific size.
 *
 * @param page - Playwright Page object
 * @param chainName - Name of the chain
 * @param expectedSize - Expected number of tiles in the chain
 */
export async function assertChainSize(
  page: Page,
  chainName: string,
  expectedSize: number
): Promise<void> {
  const chainInfo = page.locator(
    `[data-testid="chain-info-${chainName.toLowerCase()}"]`
  )
  const sizeDisplay = chainInfo.locator('[data-testid="chain-size"]')
  await expect(sizeDisplay).toContainText(String(expectedSize))
}

/**
 * Assert that there are no critical console errors.
 * Filters out expected errors like favicon 404s.
 *
 * @param errors - Array of console error messages
 */
export function assertNoConsoleErrors(errors: string[]): void {
  const criticalErrors = errors.filter(
    (e) => !e.includes('favicon') && !e.includes('404')
  )
  expect(criticalErrors).toHaveLength(0)
}

/**
 * Assert that a player has a specific stock holding.
 *
 * @param page - Playwright Page object
 * @param chainName - Name of the chain
 * @param expectedCount - Expected number of shares
 */
export async function assertStockHolding(
  page: Page,
  chainName: string,
  expectedCount: number
): Promise<void> {
  const holding = page.locator(
    `[data-testid="stock-holding-${chainName.toLowerCase()}"]`
  )
  await expect(holding).toContainText(String(expectedCount))
}

/**
 * Assert that a tile is in the player's hand.
 *
 * @param page - Playwright Page object
 * @param tileCoord - Tile coordinate (e.g., "1A", "5D")
 */
export async function assertTileInHand(
  page: Page,
  tileCoord: string
): Promise<void> {
  const tile = page.locator(`[data-testid="hand-tile-${tileCoord}"]`)
  await expect(tile).toBeVisible()
}

/**
 * Assert that the game is in a specific phase.
 *
 * @param page - Playwright Page object
 * @param phase - Expected phase name
 */
export async function assertGamePhase(
  page: Page,
  phase: string
): Promise<void> {
  const phaseIndicator = page.locator('[data-testid="game-phase"]')
  await expect(phaseIndicator).toContainText(phase)
}
