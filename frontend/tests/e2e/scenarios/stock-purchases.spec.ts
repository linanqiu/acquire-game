import { test, expect } from '@playwright/test'
import { captureStep, resetStepCounter } from './helpers/screenshot'
import {
  createGameViaUI,
  addBotViaUI,
  startGameViaUI,
  assertPlayerInLobby,
} from './helpers/game-setup'
import {
  selectTileFromRack,
  placeTile,
  hasChainSelector,
  selectFirstAvailableChain,
  getPhaseText,
  setupConsoleErrorTracking,
  waitForWebSocketConnected,
  waitForPhase,
  getActiveChains,
  getPortfolioHoldings,
  getAvailableStock,
  waitForMyTurn,
  waitForPhaseChange,
  safeEndTurnInBuyPhase,
} from './helpers/turn-actions'
// Note: Backend with ACQUIRE_GAME_SEED=2 is started by Playwright webServer config.
// We do NOT use useDeterministicBackend here to avoid conflicts with concurrent test runs.

const CATEGORY = 'stock-purchases'

/**
 * Helper to get cash from the UI.
 * Looks in the header (class*="cash") or players panel (the row with "YOU" badge).
 */
async function getCash(page: import('@playwright/test').Page): Promise<number> {
  return await page.evaluate(() => {
    const headerCash = document.querySelector('header [class*="cash"]')
    if (headerCash?.textContent) {
      const match = headerCash.textContent.match(/\$([0-9,]+)/)
      if (match) return parseInt(match[1].replace(/,/g, ''), 10)
    }
    const youBadge = document.querySelector('[class*="youBadge"]')
    if (youBadge) {
      const playerRow = youBadge.closest('[class*="playerRow"]')
      if (playerRow) {
        const cashEl = playerRow.querySelector('[class*="playerCash"]')
        if (cashEl?.textContent) {
          const match = cashEl.textContent.match(/\$([0-9,]+)/)
          if (match) return parseInt(match[1].replace(/,/g, ''), 10)
        }
      }
    }
    return 0
  })
}

/**
 * Helper to get the total shares purchased displayed in the purchase summary.
 */
async function getTotalSharesPurchased(page: import('@playwright/test').Page): Promise<number> {
  return await page.evaluate(() => {
    const summarySpans = document.querySelectorAll('[class*="purchaseSummary"] span')
    for (const span of Array.from(summarySpans)) {
      const match = span.textContent?.match(/\((\d+)\/3/)
      if (match) return parseInt(match[1], 10)
    }
    return 0
  })
}

/**
 * Helper to get total purchase cost from summary.
 */
async function getTotalCost(page: import('@playwright/test').Page): Promise<number> {
  return await page.evaluate(() => {
    const summarySpans = document.querySelectorAll('[class*="purchaseSummary"] span')
    for (const span of Array.from(summarySpans)) {
      const match = span.textContent?.match(/Total:\s*\$([0-9,]+)/)
      if (match) return parseInt(match[1].replace(/,/g, ''), 10)
    }
    return 0
  })
}

/**
 * Helper to check if the "Not enough cash" error is shown.
 */
async function hasInsufficientFundsError(page: import('@playwright/test').Page): Promise<boolean> {
  return await page.evaluate(() => {
    const errorTexts = document.querySelectorAll('[class*="errorText"]')
    for (const el of Array.from(errorTexts)) {
      if (el.textContent?.includes('Not enough cash')) return true
    }
    return false
  })
}

/**
 * Helper to get the stepper value for a specific chain in the purchase form.
 */
async function getStepperValue(
  page: import('@playwright/test').Page,
  chainName: string
): Promise<number> {
  return await page.evaluate((name) => {
    const marker = document.querySelector(
      `[data-testid="chain-marker-${name.toLowerCase()}"]`
    )
    if (!marker) return -1
    const row = marker.closest('[class*="purchaseRow"]')
    if (!row) return -1
    const valueEl = row.querySelector('[data-testid="stepper-value"]')
    return valueEl ? parseInt(valueEl.textContent || '0', 10) : -1
  }, chainName)
}

/**
 * Buy stock by finding the purchase row via chain marker data-testid.
 * Uses retry logic to handle React re-renders between clicks.
 */
async function buyStockViaUI(
  page: import('@playwright/test').Page,
  chainName: string,
  quantity: number
): Promise<void> {
  for (let i = 0; i < quantity; i++) {
    // Re-query each iteration to handle React re-renders
    const row = page.locator('[class*="purchaseRow"]').filter({
      has: page.locator(`[data-testid="chain-marker-${chainName.toLowerCase()}"]`),
    })
    const btn = row.locator('[data-testid="stepper-increment"]')
    await expect(btn).toBeVisible({ timeout: 3000 })
    await btn.click()
  }
}

/**
 * Helper to check if stepper increment is disabled for a chain.
 */
async function isIncrementDisabled(
  page: import('@playwright/test').Page,
  chainName: string
): Promise<boolean> {
  return await page.evaluate((name) => {
    const marker = document.querySelector(
      `[data-testid="chain-marker-${name.toLowerCase()}"]`
    )
    if (!marker) return true
    const row = marker.closest('[class*="purchaseRow"]')
    if (!row) return true
    const incrementBtn = row.querySelector('[data-testid="stepper-increment"]')
    return incrementBtn ? (incrementBtn as HTMLButtonElement).disabled : true
  }, chainName)
}

/**
 * Handle any pending merger/disposition before waiting for our turn.
 * During a merger triggered by a bot, we may need to confirm our stock disposition.
 * Keeps trying until the merger is fully resolved.
 */
async function handlePendingMerger(page: import('@playwright/test').Page): Promise<void> {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const phase = await getPhaseText(page)
    if (!phase.includes('DISPOSE') && !phase.includes('MERGER')) {
      return
    }
    console.log(`  Handling merger: ${phase}`)
    // Try to confirm disposition if the button is visible
    const confirmBtn = page.getByTestId('confirm-disposition')
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click()
      console.log(`  Confirmed disposition (hold all)`)
      await waitForPhaseChange(page, phase, 5000).catch(() => {})
      continue
    }
    // Wait for the phase to change (bot may be resolving merger)
    await waitForPhaseChange(page, phase, 5000).catch(() => {})
  }
}

/**
 * Wait for my turn, handling any merger that might be in progress.
 * Uses HTTP fallback when UI buttons are stuck disabled.
 */
async function waitForMyTurnSafe(page: import('@playwright/test').Page, timeout = 60000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const phase = await getPhaseText(page)
    if (phase.includes('PLACE')) return
    if (phase.includes('DISPOSE') || phase.includes('MERGER')) {
      await handlePendingMerger(page)
      continue
    }
    if (phase.includes('GAME OVER')) throw new Error('Game is over')
    // If stuck in BUY phase (from a previous failed endTurn), use HTTP fallback
    if (phase.includes('BUY')) {
      console.log(`[waitForMyTurnSafe] In BUY phase, attempting to end turn via shared helper`)
      const ended = await safeEndTurnInBuyPhase(page, 'waitForMyTurnSafe')
      if (ended) continue
    }
    // Wait for phase to change
    await waitForPhaseChange(page, phase, 5000).catch(() => {})
  }
  // Final attempt with generous timeout
  await waitForMyTurn(page, 30000)
}

/**
 * Resilient end-turn: tries UI button first, falls back to HTTP.
 * Returns false if the end-turn button isn't found and HTTP also fails.
 */
async function endTurnSafe(page: import('@playwright/test').Page): Promise<boolean> {
  return safeEndTurnInBuyPhase(page, 'endTurnSafe')
}

/**
 * Play one complete turn: wait for my turn, place tile, handle chain founding,
 * and return the phase text (to check if we're in BUY phase).
 */
async function playTurnUntilBuyPhase(
  page: import('@playwright/test').Page,
  turnNum: number
): Promise<{ phase: string; tileCoord: string }> {
  await waitForMyTurnSafe(page, 60000)

  const tileCoord = await selectTileFromRack(page)
  console.log(`  [Turn ${turnNum}] Placing tile: ${tileCoord}`)
  await placeTile(page)

  if (await hasChainSelector(page)) {
    const chainName = await selectFirstAvailableChain(page)
    console.log(`  [Turn ${turnNum}] Founded chain: ${chainName}`)
    await waitForPhase(page, 'BUY', 5000).catch(() => {})
  }

  // Handle merger triggered by our tile placement
  const postPhase = await getPhaseText(page)
  if (postPhase.includes('MERGER') || postPhase.includes('DISPOSE')) {
    console.log(`  [Turn ${turnNum}] Merger triggered after placement`)
    await handlePendingMerger(page)
    // After merger resolves, check if we're in buy phase
    await waitForPhase(page, 'BUY', 10000).catch(() => {})
  }

  const phase = await getPhaseText(page)
  return { phase, tileCoord }
}

/**
 * Wait for cash to change after endTurn (WebSocket state update).
 * Returns the new cash value, even if unchanged after timeout.
 */
async function waitForCashChange(
  page: import('@playwright/test').Page,
  previousCash: number,
  timeout = 10000
): Promise<number> {
  let finalCash = previousCash
  try {
    await expect(async () => {
      finalCash = await getCash(page)
      expect(finalCash).not.toBe(previousCash)
    }).toPass({ timeout })
  } catch {
    // Cash didn't change within timeout - return whatever we have
  }
  return finalCash
}

test.describe('Stock Purchase Scenarios (6.x)', () => {

  test.beforeEach(() => {
    resetStepCounter()
  })

  test('6.1-6.3: Purchase limits - buy 1, 2, 3 stocks across turns', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '6.1-6.3-purchase-limits'
    const errorTracker = setupConsoleErrorTracking(page)

    await createGameViaUI(page, 'StockBuyer')
    await assertPlayerInLobby(page, 'StockBuyer')
    await addBotViaUI(page)
    await addBotViaUI(page)
    await captureStep(page, 'lobby-with-players', { category: CATEGORY, testName })

    await startGameViaUI(page)
    await captureStep(page, 'game-started', { category: CATEGORY, testName })
    await waitForWebSocketConnected(page)

    const buyTargets = [1, 2, 3]
    let buyTargetIndex = 0
    const purchases: Array<{ turn: number; chain: string; qty: number; cashBefore: number; cashAfter: number }> = []

    console.log('\n' + '='.repeat(60))
    console.log('PURCHASE LIMITS TEST (6.1-6.3) - Buy 1, 2, 3 stocks')
    console.log('='.repeat(60))

    for (let turn = 1; turn <= 30 && buyTargetIndex < buyTargets.length; turn++) {
      const { phase } = await playTurnUntilBuyPhase(page, turn)

      if (phase.includes('BUY')) {
        const activeChains = await getActiveChains(page)
        console.log(`  Buy phase - active chains: [${activeChains.join(', ')}]`)

        if (activeChains.length > 0 && buyTargetIndex < buyTargets.length) {
          const targetQty = buyTargets[buyTargetIndex]
          const chainToBuy = activeChains[0]
          const available = await getAvailableStock(page, chainToBuy)
          const cashBefore = await getCash(page)

          console.log(`  Target: buy ${targetQty} ${chainToBuy} (available: ${available}, cash: $${cashBefore})`)

          if (available >= targetQty) {
            await buyStockViaUI(page, chainToBuy, targetQty)

            const totalShares = await getTotalSharesPurchased(page)
            console.log(`  Total shares selected: ${totalShares}/3`)
            expect(totalShares).toBe(targetQty)

            const totalCost = await getTotalCost(page)
            console.log(`  Total cost: $${totalCost}`)
            expect(totalCost).toBeGreaterThan(0)

            await captureStep(page, `turn-${turn}-stock-selected-${chainToBuy}-x${targetQty}`, {
              category: CATEGORY, testName,
            })

            await endTurnSafe(page)
            const cashAfter = await waitForCashChange(page, cashBefore)
            console.log(`  Cash: $${cashBefore} -> $${cashAfter} (cost: $${cashBefore - cashAfter})`)

            purchases.push({ turn, chain: chainToBuy, qty: targetQty, cashBefore, cashAfter })
            expect(cashAfter).toBeLessThan(cashBefore)

            const holdings = await getPortfolioHoldings(page)
            console.log(`  Holdings for ${chainToBuy}: ${holdings[chainToBuy] || 0}`)

            await captureStep(page, `turn-${turn}-purchase-confirmed-${targetQty}`, {
              category: CATEGORY, testName,
            })

            buyTargetIndex++
            console.log(`  *** Completed buy-${targetQty} test (${buyTargetIndex}/${buyTargets.length}) ***`)
          } else {
            console.log(`  Not enough stock, skipping`)
            await endTurnSafe(page)
          }
        } else {
          console.log(`  No active chains or all targets met, skipping`)
          await endTurnSafe(page)
        }
      }
    }

    await captureStep(page, 'final-state', { category: CATEGORY, testName })

    console.log('\n' + '='.repeat(60))
    console.log(`Buy targets completed: ${buyTargetIndex}/${buyTargets.length}`)
    for (const p of purchases) {
      console.log(`  Buy ${p.qty} ${p.chain}: $${p.cashBefore} -> $${p.cashAfter}`)
    }
    console.log('='.repeat(60) + '\n')

    expect(buyTargetIndex).toBe(buyTargets.length)
    for (const p of purchases) {
      expect(p.cashAfter).toBeLessThan(p.cashBefore)
    }

    const errors = errorTracker.getErrors().filter((e) => !e.includes('WebSocket'))
    expect(errors).toHaveLength(0)
  })

  test('6.4: Buy 0 stocks - skip purchase by ending turn', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '6.4-skip-purchase'
    const errorTracker = setupConsoleErrorTracking(page)

    await createGameViaUI(page, 'Skipper')
    await assertPlayerInLobby(page, 'Skipper')
    await addBotViaUI(page)
    await addBotViaUI(page)
    await captureStep(page, 'lobby', { category: CATEGORY, testName })

    await startGameViaUI(page)
    await waitForWebSocketConnected(page)

    let skippedWithActiveChains = false

    console.log('\n' + '='.repeat(60))
    console.log('SKIP PURCHASE TEST (6.4) - End turn without buying')
    console.log('='.repeat(60))

    for (let turn = 1; turn <= 20 && !skippedWithActiveChains; turn++) {
      const { phase } = await playTurnUntilBuyPhase(page, turn)

      if (phase.includes('BUY')) {
        const activeChains = await getActiveChains(page)
        const cashBefore = await getCash(page)

        if (activeChains.length > 0) {
          console.log(`  Skipping purchase with active chains: [${activeChains.join(', ')}]`)

          const buttonText = await page.getByTestId('end-turn-button').textContent()
          console.log(`  Button text: "${buttonText}"`)
          expect(buttonText).toContain('SKIP')

          await captureStep(page, `turn-${turn}-skip-with-active-chains`, {
            category: CATEGORY, testName,
          })

          await endTurnSafe(page)
          const cashAfter = await getCash(page)
          console.log(`  Cash: $${cashBefore} -> $${cashAfter} (should be same)`)
          expect(cashAfter).toBe(cashBefore)

          await captureStep(page, `turn-${turn}-skipped-cash-unchanged`, {
            category: CATEGORY, testName,
          })

          skippedWithActiveChains = true
          console.log(`  *** VERIFIED: Skip purchase keeps cash at $${cashAfter} ***`)
        } else {
          console.log(`  No active chains yet, ending turn`)
          await endTurnSafe(page)
        }
      }
    }

    await captureStep(page, 'final-state', { category: CATEGORY, testName })
    expect(skippedWithActiveChains).toBe(true)

    const errors = errorTracker.getErrors().filter((e) => !e.includes('WebSocket'))
    expect(errors).toHaveLength(0)
  })

  test('6.5 & 6.6: Cannot buy 4+ and mixed chain purchase', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '6.5-6.6-max-limit-and-mixed'
    const errorTracker = setupConsoleErrorTracking(page)

    await createGameViaUI(page, 'MixBuyer')
    await assertPlayerInLobby(page, 'MixBuyer')
    await addBotViaUI(page)
    await addBotViaUI(page)
    await captureStep(page, 'lobby', { category: CATEGORY, testName })

    await startGameViaUI(page)
    await waitForWebSocketConnected(page)

    let verifiedMaxLimit = false
    let verifiedMixedPurchase = false

    console.log('\n' + '='.repeat(60))
    console.log('MAX LIMIT & MIXED PURCHASE TEST (6.5 & 6.6)')
    console.log('='.repeat(60))

    for (let turn = 1; turn <= 30 && (!verifiedMaxLimit || !verifiedMixedPurchase); turn++) {
      const { phase } = await playTurnUntilBuyPhase(page, turn)

      if (phase.includes('BUY')) {
        const activeChains = await getActiveChains(page)
        console.log(`  Buy phase - active chains: [${activeChains.join(', ')}]`)

        // Test 6.5: Max limit (need at least 1 chain)
        if (!verifiedMaxLimit && activeChains.length >= 1) {
          const chain = activeChains[0]
          const available = await getAvailableStock(page, chain)

          if (available >= 3) {
            await buyStockViaUI(page, chain, 3)
            const totalShares = await getTotalSharesPurchased(page)
            console.log(`  Bought 3 ${chain}, total shares: ${totalShares}`)
            expect(totalShares).toBe(3)

            for (const c of activeChains) {
              const disabled = await isIncrementDisabled(page, c)
              console.log(`  Increment for ${c} disabled: ${disabled}`)
              expect(disabled).toBe(true)
            }

            await captureStep(page, `turn-${turn}-4th-stock-blocked`, {
              category: CATEGORY, testName,
            })

            verifiedMaxLimit = true
            console.log(`  *** VERIFIED: Cannot buy 4th stock ***`)
            await endTurnSafe(page)
          } else {
            console.log(`  Not enough stock (${available})`)
            await endTurnSafe(page)
          }
        }
        // Test 6.6: Mixed chain purchase (need at least 2 chains)
        else if (!verifiedMixedPurchase && activeChains.length >= 2) {
          const chain1 = activeChains[0]
          const chain2 = activeChains[1]
          const avail1 = await getAvailableStock(page, chain1)
          const avail2 = await getAvailableStock(page, chain2)

          if (avail1 >= 2 && avail2 >= 1) {
            const cashBefore = await getCash(page)
            const holdingsBefore = await getPortfolioHoldings(page)

            await buyStockViaUI(page, chain1, 2)
            await buyStockViaUI(page, chain2, 1)

            const totalShares = await getTotalSharesPurchased(page)
            console.log(`  Mixed: 2x ${chain1} + 1x ${chain2}, total: ${totalShares}/3`)
            expect(totalShares).toBe(3)

            await captureStep(page, `turn-${turn}-mixed-purchase-${chain1}-${chain2}`, {
              category: CATEGORY, testName,
            })

            await endTurnSafe(page)
            const cashAfter = await waitForCashChange(page, cashBefore)
            const holdingsAfter = await getPortfolioHoldings(page)

            console.log(`  Cash: $${cashBefore} -> $${cashAfter}`)
            console.log(`  ${chain1}: ${holdingsBefore[chain1] || 0} -> ${holdingsAfter[chain1] || 0}`)
            console.log(`  ${chain2}: ${holdingsBefore[chain2] || 0} -> ${holdingsAfter[chain2] || 0}`)

            expect(cashAfter).toBeLessThan(cashBefore)
            expect((holdingsAfter[chain1] || 0)).toBeGreaterThan((holdingsBefore[chain1] || 0))
            expect((holdingsAfter[chain2] || 0)).toBeGreaterThan((holdingsBefore[chain2] || 0))

            verifiedMixedPurchase = true
            console.log(`  *** VERIFIED: Mixed chain purchase works ***`)
          } else {
            console.log(`  Not enough stock (${chain1}: ${avail1}, ${chain2}: ${avail2})`)
            await endTurnSafe(page)
          }
        } else {
          await endTurnSafe(page)
        }
      }
    }

    await captureStep(page, 'final-state', { category: CATEGORY, testName })

    console.log('\n' + '='.repeat(60))
    console.log(`Max limit verified: ${verifiedMaxLimit}`)
    console.log(`Mixed purchase verified: ${verifiedMixedPurchase}`)
    console.log('='.repeat(60) + '\n')

    expect(verifiedMaxLimit).toBe(true)
    expect(verifiedMixedPurchase).toBe(true)

    const errors = errorTracker.getErrors().filter((e) => !e.includes('WebSocket'))
    expect(errors).toHaveLength(0)
  })

  test('6.8 & 6.12: Insufficient funds and price display', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '6.8-6.12-funds-and-prices'
    const errorTracker = setupConsoleErrorTracking(page)

    await createGameViaUI(page, 'PriceChecker')
    await assertPlayerInLobby(page, 'PriceChecker')
    await addBotViaUI(page)
    await addBotViaUI(page)
    await captureStep(page, 'lobby', { category: CATEGORY, testName })

    await startGameViaUI(page)
    await waitForWebSocketConnected(page)

    let verifiedPriceDisplay = false
    const purchasesMade: Array<{ turn: number; chain: string; qty: number; cost: number }> = []

    console.log('\n' + '='.repeat(60))
    console.log('PRICE DISPLAY & INSUFFICIENT FUNDS TEST (6.8 & 6.12)')
    console.log('='.repeat(60))

    for (let turn = 1; turn <= 30; turn++) {
      const { phase } = await playTurnUntilBuyPhase(page, turn)

      if (phase.includes('BUY')) {
        const activeChains = await getActiveChains(page)
        const cash = await getCash(page)
        console.log(`  Buy phase - chains: [${activeChains.join(', ')}], cash: $${cash}`)

        // 6.12: Verify price/cost display
        if (activeChains.length > 0 && !verifiedPriceDisplay) {
          const chain = activeChains[0]
          const available = await getAvailableStock(page, chain)

          if (available > 0) {
            const costBefore = await getTotalCost(page)
            await buyStockViaUI(page, chain, 1)
            const costAfter = await getTotalCost(page)
            console.log(`  Cost before: $${costBefore}, after selecting 1 ${chain}: $${costAfter}`)
            expect(costAfter).toBeGreaterThan(costBefore)

            const summaryText = await page.evaluate(() => {
              const summary = document.querySelector('[class*="purchaseSummary"]')
              return summary?.textContent || ''
            })
            console.log(`  Purchase summary: "${summaryText}"`)
            expect(summaryText).toContain('$')
            expect(summaryText).toContain('/3 shares')

            // Decrement back
            const row = page.locator('[class*="purchaseRow"]').filter({
              has: page.locator(`[data-testid="chain-marker-${chain.toLowerCase()}"]`),
            })
            await row.locator('[data-testid="stepper-decrement"]').click()

            verifiedPriceDisplay = true
            console.log(`  *** VERIFIED: Price display works ***`)

            await captureStep(page, `turn-${turn}-price-display`, {
              category: CATEGORY, testName,
            })
          }
        }

        // Buy max stocks each turn to drain cash
        if (activeChains.length > 0) {
          const chain = activeChains[0]
          const available = await getAvailableStock(page, chain)
          const qty = Math.min(3, available)

          if (qty > 0) {
            await getCash(page)
            await buyStockViaUI(page, chain, qty)

            const insufficientFunds = await hasInsufficientFundsError(page)
            if (insufficientFunds) {
              console.log(`  *** INSUFFICIENT FUNDS DETECTED ***`)
              const endDisabled = await page.getByTestId('end-turn-button').isDisabled()
              console.log(`  End turn button disabled: ${endDisabled}`)
              expect(endDisabled).toBe(true)

              await captureStep(page, `turn-${turn}-insufficient-funds`, {
                category: CATEGORY, testName,
              })

              // Decrement until affordable
              const row = page.locator('[class*="purchaseRow"]').filter({
                has: page.locator(`[data-testid="chain-marker-${chain.toLowerCase()}"]`),
              })
              const decrementBtn = row.locator('[data-testid="stepper-decrement"]')
              while (await hasInsufficientFundsError(page)) {
                if (await decrementBtn.isEnabled()) {
                  await decrementBtn.click()
                } else {
                  break
                }
              }
            }

            const sharesAfterAdjust = await getTotalSharesPurchased(page)
            if (sharesAfterAdjust > 0) {
              purchasesMade.push({
                turn, chain, qty: sharesAfterAdjust,
                cost: await getTotalCost(page),
              })
            }
          }
        }
        // Only end turn if button is still visible (phase might have changed)
        const endBtn = page.getByTestId('end-turn-button')
        if (await endBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await endTurnSafe(page)
        }
      }
    }

    await captureStep(page, 'final-state', { category: CATEGORY, testName })

    console.log('\n' + '='.repeat(60))
    console.log(`Price display verified: ${verifiedPriceDisplay}`)
    console.log(`Purchases made: ${purchasesMade.length}`)
    console.log('='.repeat(60) + '\n')

    expect(verifiedPriceDisplay).toBe(true)
    expect(purchasesMade.length).toBeGreaterThan(0)

    const errors = errorTracker.getErrors().filter((e) => !e.includes('WebSocket'))
    expect(errors).toHaveLength(0)
  })

  test('6.14: Purchase after founding - buy newly founded chain stock', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '6.14-purchase-after-founding'
    const errorTracker = setupConsoleErrorTracking(page)

    await createGameViaUI(page, 'FounderBuyer')
    await assertPlayerInLobby(page, 'FounderBuyer')
    await addBotViaUI(page)
    await addBotViaUI(page)
    await captureStep(page, 'lobby', { category: CATEGORY, testName })

    await startGameViaUI(page)
    await waitForWebSocketConnected(page)

    let foundedAndBought = false

    console.log('\n' + '='.repeat(60))
    console.log('PURCHASE AFTER FOUNDING TEST (6.14)')
    console.log('='.repeat(60))

    for (let turn = 1; turn <= 30 && !foundedAndBought; turn++) {
      await waitForMyTurnSafe(page, 60000)

      const tileCoord = await selectTileFromRack(page)
      console.log(`  [Turn ${turn}] Placing tile: ${tileCoord}`)
      await placeTile(page)

      if (await hasChainSelector(page)) {
        const holdingsBefore = await getPortfolioHoldings(page)
        const cashBefore = await getCash(page)

        const chainName = await selectFirstAvailableChain(page)
        console.log(`  *** FOUNDED CHAIN: ${chainName} ***`)

        await captureStep(page, `turn-${turn}-founded-${chainName}`, {
          category: CATEGORY, testName,
        })

        await waitForPhase(page, 'BUY', 5000).catch(() => {})
        const phase = await getPhaseText(page)

        if (phase.includes('BUY')) {
          const holdingsAfterFound = await getPortfolioHoldings(page)
          const bonusStock = (holdingsAfterFound[chainName] || 0) - (holdingsBefore[chainName] || 0)
          console.log(`  Founder's bonus: ${bonusStock} ${chainName} stock`)
          expect(bonusStock).toBeGreaterThanOrEqual(1)

          const available = await getAvailableStock(page, chainName)
          console.log(`  ${chainName} available: ${available}`)

          if (available >= 2) {
            await buyStockViaUI(page, chainName, 2)

            await captureStep(page, `turn-${turn}-buying-new-chain-${chainName}`, {
              category: CATEGORY, testName,
            })

            await endTurnSafe(page)
            const cashAfter = await waitForCashChange(page, cashBefore)
            const holdingsAfterBuy = await getPortfolioHoldings(page)
            const totalHeld = holdingsAfterBuy[chainName] || 0

            console.log(`  Cash: $${cashBefore} -> $${cashAfter}`)
            console.log(`  ${chainName} holdings: ${totalHeld} (bonus + bought)`)

            expect(totalHeld).toBeGreaterThanOrEqual(bonusStock + 2)
            expect(cashAfter).toBeLessThan(cashBefore)

            await captureStep(page, `turn-${turn}-post-founding-purchase-confirmed`, {
              category: CATEGORY, testName,
            })

            foundedAndBought = true
            console.log(`  *** VERIFIED: Purchased stock of newly founded chain ***`)
          } else {
            await endTurnSafe(page)
          }
        }
      } else {
        const phase = await getPhaseText(page)
        if (phase.includes('BUY')) {
          await endTurnSafe(page)
        }
      }
    }

    await captureStep(page, 'final-state', { category: CATEGORY, testName })
    expect(foundedAndBought).toBe(true)

    const errors = errorTracker.getErrors().filter((e) => !e.includes('WebSocket'))
    expect(errors).toHaveLength(0)
  })

  test('6.15 & 6.7: No chains available - no stocks to buy', async ({ page }) => {
    test.setTimeout(180000)
    const testName = '6.15-no-chains'
    const errorTracker = setupConsoleErrorTracking(page)

    await createGameViaUI(page, 'NoChains')
    await assertPlayerInLobby(page, 'NoChains')
    await addBotViaUI(page)
    await addBotViaUI(page)
    await captureStep(page, 'lobby', { category: CATEGORY, testName })

    await startGameViaUI(page)
    await waitForWebSocketConnected(page)

    console.log('\n' + '='.repeat(60))
    console.log('NO CHAINS TEST (6.15 & 6.7)')
    console.log('='.repeat(60))

    await waitForMyTurn(page, 60000)

    const activeChainsBefore = await getActiveChains(page)
    console.log(`  Active chains before turn 1: [${activeChainsBefore.join(', ')}]`)

    await captureStep(page, 'turn-1-before-place', { category: CATEGORY, testName })

    const tileCoord = await selectTileFromRack(page)
    console.log(`  Placing tile: ${tileCoord}`)
    await placeTile(page)

    const foundChain = await hasChainSelector(page, 1000)
    if (!foundChain) {
      const phase = await getPhaseText(page)
      if (phase.includes('BUY')) {
        const activeChainsNow = await getActiveChains(page)
        console.log(`  In buy phase, active chains: [${activeChainsNow.join(', ')}]`)

        if (activeChainsNow.length === 0) {
          const noChains = await page.evaluate(() => {
            const el = document.querySelector('[class*="noChains"]')
            return el ? el.textContent : null
          })
          console.log(`  No chains message: "${noChains}"`)

          const buttonText = await page.getByTestId('end-turn-button').textContent()
          console.log(`  Button text: "${buttonText}"`)
          expect(buttonText).toContain('SKIP')

          await captureStep(page, 'no-chains-buy-phase', { category: CATEGORY, testName })
          console.log(`  *** VERIFIED: No chains to buy, skip available ***`)
        }
        await endTurnSafe(page)
      }
    } else {
      const chainName = await selectFirstAvailableChain(page)
      console.log(`  Chain founded on turn 1: ${chainName}`)
      await waitForPhase(page, 'BUY', 5000).catch(() => {})
      const phase = await getPhaseText(page)
      if (phase.includes('BUY')) {
        await endTurnSafe(page)
      }
    }

    await captureStep(page, 'final-state', { category: CATEGORY, testName })

    const errors = errorTracker.getErrors().filter((e) => !e.includes('WebSocket'))
    expect(errors).toHaveLength(0)
  })

  test('6.1-6.6 extended: 10+ turns with real purchases and cash tracking', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '6.x-extended-purchases'
    const errorTracker = setupConsoleErrorTracking(page)

    await createGameViaUI(page, 'ExtendedBuyer')
    await assertPlayerInLobby(page, 'ExtendedBuyer')
    await addBotViaUI(page)
    await addBotViaUI(page)
    await captureStep(page, 'lobby', { category: CATEGORY, testName })

    await startGameViaUI(page)
    await waitForWebSocketConnected(page)

    const MIN_PURCHASE_TURNS = 10
    let purchaseTurns = 0
    const purchases: Array<{
      turn: number; chain: string; qty: number;
      cashBefore: number; cashAfter: number;
      holdingsBefore: number; holdingsAfter: number;
    }> = []

    console.log('\n' + '='.repeat(60))
    console.log('EXTENDED PURCHASE TEST - 10+ turns with actual purchases')
    console.log('='.repeat(60))

    for (let turn = 1; turn <= 30 && purchaseTurns < MIN_PURCHASE_TURNS; turn++) {
      try {
        await waitForMyTurnSafe(page, 60000)
      } catch {
        console.log('  Could not reach my turn (game may be over)')
        break
      }

      const tileCoord = await selectTileFromRack(page)
      console.log(`  [Turn ${turn}] Placing tile: ${tileCoord}`)
      await placeTile(page)

      if (await hasChainSelector(page)) {
        const chainName = await selectFirstAvailableChain(page)
        console.log(`  [Turn ${turn}] Founded chain: ${chainName}`)
        await waitForPhase(page, 'BUY', 5000).catch(() => {})
      }

      // Handle merger triggered by our tile
      const postPhase = await getPhaseText(page)
      if (postPhase.includes('MERGER') || postPhase.includes('DISPOSE')) {
        console.log(`  Merger triggered after placement`)
        await handlePendingMerger(page)
        await waitForPhase(page, 'BUY', 10000).catch(() => {})
      }

      const phase = await getPhaseText(page)
      if (phase.includes('BUY')) {
        const activeChains = await getActiveChains(page)
        const cash = await getCash(page)
        console.log(`  Buy phase - chains: [${activeChains.join(', ')}], cash: $${cash}`)

        if (activeChains.length > 0 && cash > 0) {
          const chain = activeChains[0]
          const available = await getAvailableStock(page, chain)
          const qty = Math.min(3, available)

          if (qty > 0) {
            const cashBefore = await getCash(page)
            const holdingsBefore = await getPortfolioHoldings(page)
            const holdingBefore = holdingsBefore[chain] || 0

            await buyStockViaUI(page, chain, qty)
            console.log(`  After buyStockViaUI: stepper=${await getStepperValue(page, chain)}, phase=${await getPhaseText(page)}`)

            // Check if we can afford it - decrement until affordable or zero
            if (await hasInsufficientFundsError(page)) {
              console.log(`  Insufficient funds detected, decrementing...`)
              const row = page.locator('[class*="purchaseRow"]').filter({
                has: page.locator(`[data-testid="chain-marker-${chain.toLowerCase()}"]`),
              })
              let currentQty = await getStepperValue(page, chain)
              while (await hasInsufficientFundsError(page) && currentQty > 0) {
                await expect(async () => {
                  const btn = row.locator('[data-testid="stepper-decrement"]')
                  await expect(btn).toBeVisible({ timeout: 1000 })
                  await btn.click()
                }).toPass({ timeout: 3000 }).catch(() => {})
                currentQty = await getStepperValue(page, chain)
              }
            }

            const finalQty = await getStepperValue(page, chain)
            const insuffErr = await hasInsufficientFundsError(page)
            console.log(`  finalQty=${finalQty}, insufficientFunds=${insuffErr}, phase=${await getPhaseText(page)}`)
            if (finalQty > 0 && !insuffErr) {
              await endTurnSafe(page)
              const cashAfter = await waitForCashChange(page, cashBefore)
              const holdingsAfter = await getPortfolioHoldings(page)
              const holdingAfter = holdingsAfter[chain] || 0

              purchases.push({
                turn, chain, qty: finalQty,
                cashBefore, cashAfter,
                holdingsBefore: holdingBefore, holdingsAfter: holdingAfter,
              })

              console.log(`  Bought ${finalQty} ${chain}: $${cashBefore} -> $${cashAfter}, holdings: ${holdingBefore} -> ${holdingAfter}`)
              expect(cashAfter).toBeLessThan(cashBefore)
              expect(holdingAfter).toBeGreaterThan(holdingBefore)

              purchaseTurns++
            } else {
              console.log(`  Can't afford anything, skipping`)
              await endTurnSafe(page)
            }
          } else {
            console.log(`  No stock available, skipping`)
            await endTurnSafe(page)
          }
        } else {
          console.log(`  No chains or no cash, skipping`)
          await endTurnSafe(page)
        }
      }
    }

    await captureStep(page, 'final-state', { category: CATEGORY, testName })

    console.log('\n' + '='.repeat(60))
    console.log(`SUMMARY: ${purchaseTurns} purchase turns`)
    for (const p of purchases) {
      console.log(`  Turn ${p.turn}: ${p.qty}x ${p.chain} ($${p.cashBefore} -> $${p.cashAfter})`)
    }
    console.log('='.repeat(60) + '\n')

    expect(purchaseTurns).toBeGreaterThanOrEqual(MIN_PURCHASE_TURNS)
    for (const p of purchases) {
      expect(p.cashAfter).toBeLessThan(p.cashBefore)
      expect(p.holdingsAfter).toBeGreaterThan(p.holdingsBefore)
    }

    const errors = errorTracker.getErrors().filter((e) => !e.includes('WebSocket'))
    expect(errors).toHaveLength(0)
  })
})
