import { Page, expect } from '@playwright/test'

/**
 * P2P Trading helpers for E2E scenario testing.
 *
 * These helpers interact with the trading UI exactly as a real player would.
 */

export interface TradeDetails {
  fromPlayer: string
  offerStocks: { chain: string; quantity: number }[]
  offerMoney: number
  requestStocks: { chain: string; quantity: number }[]
  requestMoney: number
}

/**
 * Open the trade builder modal.
 *
 * @param page - Playwright Page
 */
export async function openTradeBuilder(page: Page): Promise<void> {
  // The trade button is in the buy stocks phase
  const tradeButton = page.getByRole('button', { name: 'PROPOSE TRADE' })
  await expect(tradeButton).toBeVisible()
  await tradeButton.click()

  // Wait for trade builder to appear
  await expect(page.getByTestId('trade-builder')).toBeVisible()
  console.log('[openTradeBuilder] Trade builder opened')
}

/**
 * Select a trade recipient by name.
 *
 * @param page - Playwright Page
 * @param name - Player name to select
 */
export async function selectTradeRecipient(page: Page, name: string): Promise<void> {
  // Find and click the player button with the given name
  const playerButton = page.locator('[class*="playerButton"]').filter({ hasText: name })
  await expect(playerButton).toBeVisible()
  await playerButton.click()
  console.log(`[selectTradeRecipient] Selected recipient: ${name}`)
}

/**
 * Configure stocks to offer in a trade.
 *
 * @param page - Playwright Page
 * @param chain - Chain name (e.g., 'Tower', 'Luxor')
 * @param qty - Quantity to offer
 */
export async function configureTradeOffer(page: Page, chain: string, qty: number): Promise<void> {
  // Find the stock row for the chain in the "YOU OFFER" section
  const offerSection = page.locator('[class*="section"]').filter({ hasText: 'YOU OFFER:' })
  const stockRow = offerSection.locator('[class*="stockRow"]').filter({ hasText: new RegExp(chain, 'i') })

  // Click the increment button the specified number of times
  const incrementButton = stockRow.getByRole('button', { name: '+' })
  for (let i = 0; i < qty; i++) {
    await incrementButton.click()
  }
  console.log(`[configureTradeOffer] Offering ${qty} ${chain}`)
}

/**
 * Configure stocks to request in a trade.
 *
 * @param page - Playwright Page
 * @param chain - Chain name (e.g., 'Tower', 'Luxor')
 * @param qty - Quantity to request
 */
export async function configureTradeRequest(page: Page, chain: string, qty: number): Promise<void> {
  // Find the stock row for the chain in the "YOU WANT" section
  const requestSection = page.locator('[class*="section"]').filter({ hasText: /YOU WANT FROM/ })
  const stockRow = requestSection.locator('[class*="stockRow"]').filter({ hasText: new RegExp(chain, 'i') })

  // Click the increment button the specified number of times
  const incrementButton = stockRow.getByRole('button', { name: '+' })
  for (let i = 0; i < qty; i++) {
    await incrementButton.click()
  }
  console.log(`[configureTradeRequest] Requesting ${qty} ${chain}`)
}

/**
 * Configure cash to offer in a trade.
 *
 * @param page - Playwright Page
 * @param amount - Cash amount to offer
 */
export async function configureOfferCash(page: Page, amount: number): Promise<void> {
  const cashInput = page.getByTestId('offer-cash-input')
  await cashInput.fill(amount.toString())
  console.log(`[configureOfferCash] Offering $${amount}`)
}

/**
 * Configure cash to request in a trade.
 *
 * @param page - Playwright Page
 * @param amount - Cash amount to request
 */
export async function configureRequestCash(page: Page, amount: number): Promise<void> {
  const cashInput = page.getByTestId('want-cash-input')
  await cashInput.fill(amount.toString())
  console.log(`[configureRequestCash] Requesting $${amount}`)
}

/**
 * Submit the trade proposal.
 *
 * @param page - Playwright Page
 */
export async function submitTradeProposal(page: Page): Promise<void> {
  const proposeButton = page.getByTestId('propose-trade')
  await expect(proposeButton).toBeVisible()
  await expect(proposeButton).toBeEnabled()
  await proposeButton.click()

  // Wait for the trade builder to close
  await expect(page.getByTestId('trade-builder')).not.toBeVisible({ timeout: 5000 })
  console.log('[submitTradeProposal] Trade proposal submitted')
}

/**
 * Cancel the trade proposal (close trade builder without submitting).
 *
 * @param page - Playwright Page
 */
export async function cancelTradeProposal(page: Page): Promise<void> {
  const cancelButton = page.getByTestId('cancel-trade')
  await cancelButton.click()

  // Wait for the trade builder to close
  await expect(page.getByTestId('trade-builder')).not.toBeVisible({ timeout: 5000 })
  console.log('[cancelTradeProposal] Trade proposal cancelled')
}

/**
 * Check if there's a validation error in the trade builder.
 *
 * @param page - Playwright Page
 * @returns The error message if present, null otherwise
 */
export async function getTradeError(page: Page): Promise<string | null> {
  const errorElement = page.getByTestId('trade-error')
  if (await errorElement.isVisible()) {
    return await errorElement.textContent()
  }
  return null
}

// =========================================================================
// Trade Notification Helpers (Recipient Side)
// =========================================================================

/**
 * Wait for a trade notification to appear.
 *
 * @param page - Playwright Page
 * @param timeout - Maximum time to wait
 */
export async function waitForTradeNotification(page: Page, timeout = 30000): Promise<void> {
  await expect(page.getByTestId('trade-notification')).toBeVisible({ timeout })
  console.log('[waitForTradeNotification] Trade notification visible')
}

/**
 * Accept the current trade offer.
 *
 * @param page - Playwright Page
 */
export async function acceptTrade(page: Page): Promise<void> {
  const acceptButton = page.getByTestId('accept-trade')
  await expect(acceptButton).toBeVisible()
  await acceptButton.click()

  // Wait for the notification to disappear
  await expect(page.getByTestId('trade-notification')).not.toBeVisible({ timeout: 5000 })
  console.log('[acceptTrade] Trade accepted')
}

/**
 * Reject the current trade offer.
 *
 * @param page - Playwright Page
 */
export async function rejectTrade(page: Page): Promise<void> {
  const rejectButton = page.getByTestId('reject-trade')
  await expect(rejectButton).toBeVisible()
  await rejectButton.click()

  // Wait for the notification to disappear
  await expect(page.getByTestId('trade-notification')).not.toBeVisible({ timeout: 5000 })
  console.log('[rejectTrade] Trade rejected')
}

/**
 * Click counter on the current trade offer (opens trade builder).
 *
 * @param page - Playwright Page
 */
export async function counterTrade(page: Page): Promise<void> {
  const counterButton = page.getByTestId('counter-trade')
  await expect(counterButton).toBeVisible()
  await counterButton.click()

  // Wait for trade builder to appear
  await expect(page.getByTestId('trade-builder')).toBeVisible({ timeout: 5000 })
  console.log('[counterTrade] Counter trade initiated')
}

/**
 * Get details of the current trade notification.
 *
 * @param page - Playwright Page
 * @returns Trade details
 */
export async function getTradeDetails(page: Page): Promise<TradeDetails> {
  const notification = page.getByTestId('trade-notification')
  await expect(notification).toBeVisible()

  const fromPlayer = await page.getByTestId('trade-from-player').textContent() || ''

  // Parse offer stocks
  const offerStocksEl = page.getByTestId('trade-offer-stocks')
  const offerStocks: { chain: string; quantity: number }[] = []
  const offerStockItems = offerStocksEl.locator('[class*="stockItem"]')
  const offerCount = await offerStockItems.count()
  for (let i = 0; i < offerCount; i++) {
    const item = offerStockItems.nth(i)
    const chain = await item.locator('[class*="chainMarker"]').getAttribute('data-chain') || ''
    const qtyText = await item.locator('[class*="quantity"]').textContent() || ''
    const quantity = parseInt(qtyText.replace('×', '').trim(), 10) || 0
    offerStocks.push({ chain, quantity })
  }

  // Parse offer money
  let offerMoney = 0
  const offerMoneyEl = page.getByTestId('trade-offer-money')
  if (await offerMoneyEl.isVisible()) {
    const moneyText = await offerMoneyEl.textContent() || ''
    offerMoney = parseInt(moneyText.replace(/[$,]/g, '').trim(), 10) || 0
  }

  // Parse request stocks
  const requestStocksEl = page.getByTestId('trade-request-stocks')
  const requestStocks: { chain: string; quantity: number }[] = []
  const requestStockItems = requestStocksEl.locator('[class*="stockItem"]')
  const requestCount = await requestStockItems.count()
  for (let i = 0; i < requestCount; i++) {
    const item = requestStockItems.nth(i)
    const chain = await item.locator('[class*="chainMarker"]').getAttribute('data-chain') || ''
    const qtyText = await item.locator('[class*="quantity"]').textContent() || ''
    const quantity = parseInt(qtyText.replace('×', '').trim(), 10) || 0
    requestStocks.push({ chain, quantity })
  }

  // Parse request money
  let requestMoney = 0
  const requestMoneyEl = page.getByTestId('trade-request-money')
  if (await requestMoneyEl.isVisible()) {
    const moneyText = await requestMoneyEl.textContent() || ''
    requestMoney = parseInt(moneyText.replace(/[$,]/g, '').trim(), 10) || 0
  }

  return {
    fromPlayer,
    offerStocks,
    offerMoney,
    requestStocks,
    requestMoney,
  }
}

/**
 * Check if a trade notification is currently visible.
 *
 * @param page - Playwright Page
 * @returns true if a trade notification is visible
 */
export async function hasTradeNotification(page: Page): Promise<boolean> {
  return await page.getByTestId('trade-notification').isVisible()
}
