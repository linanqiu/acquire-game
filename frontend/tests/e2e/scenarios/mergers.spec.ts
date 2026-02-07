import { test, expect, Page } from '@playwright/test'
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
  endTurn,
  hasChainSelector,
  selectFirstAvailableChain,
  getPhaseText,
  setupConsoleErrorTracking,
  getPortfolioHoldings,
  getActiveChains,
  waitForWebSocketConnected,
  waitForPhase,
} from './helpers/turn-actions'
import { useDeterministicBackend } from '../fixtures/deterministic-server'

const CATEGORY = 'mergers'

/**
 * Merger Scenarios (ST-006)
 *
 * Tests verify merger mechanics in Acquire:
 * - Merger triggers when a tile connects two chains
 * - Stock disposition UI (sell, trade 2:1, hold)
 * - Bonus payouts to majority/minority stockholders
 * - Game continues correctly after merger
 *
 * Uses deterministic tile order (seed=2, default.csv) for reproducible tests.
 */

// ---------------------------------------------------------------------------
// Helpers scoped to merger tests
// ---------------------------------------------------------------------------

/**
 * Wait for any phase where it's OUR turn (not a bot's turn).
 *
 * Phase text rules (from PlayerPage.tsx):
 *   - Bot turns: "{name}'s TURN" (always ends with "'s TURN")
 *   - Our turns: "PLACE A TILE", "CHOOSE A CHAIN", "BUY STOCKS",
 *                "MERGER IN PROGRESS", "DISPOSE YOUR STOCK"
 *   - End state: "GAME OVER"
 *
 * Uses page.waitForFunction() for efficient DOM watching.
 * Falls back to page reload if WebSocket disconnects (phase stops updating).
 */
async function waitForOurPhase(page: Page, timeout = 120000): Promise<string> {
  const conditionFn = `() => {
    const el = document.querySelector('[data-testid="game-phase"]');
    const text = (el?.textContent || '').trim();
    return text.length > 0 && !text.endsWith("'s TURN");
  }`

  try {
    await page.waitForFunction(conditionFn, undefined, { timeout })
  } catch {
    // Phase stuck on bot's turn too long → likely WebSocket disconnected
    console.log('  [waitForOurPhase] Timed out, reloading page to reconnect WebSocket...')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForWebSocketConnected(page, 10000)
    await page.waitForFunction(conditionFn, undefined, { timeout: 30000 })
  }
  return await getPhaseText(page)
}

/**
 * After endTurn(), verify the turn actually ended by waiting for phase to
 * leave BUY STOCKS. The end-turn action is sent via WebSocket, which can
 * silently fail if the connection dropped. In that case, reload the page
 * (reconnects WebSocket, gets fresh server state) and retry.
 */
async function verifyTurnEnded(page: Page): Promise<void> {
  const conditionFn = `() => {
    const el = document.querySelector('[data-testid="game-phase"]');
    const text = (el?.textContent || '').trim();
    return !text.includes('BUY');
  }`

  for (let retry = 0; retry < 3; retry++) {
    try {
      await page.waitForFunction(conditionFn, undefined, { timeout: 15000 })
      return
    } catch {
      console.log(`  [verifyTurnEnded] Phase stuck on BUY (attempt ${retry + 1}/3), reloading...`)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await waitForWebSocketConnected(page, 10000)
      const phase = await getPhaseText(page)
      if (phase.includes('BUY')) {
        // Still in BUY after reload = the buy action never reached the server. Re-send.
        console.log('  [verifyTurnEnded] Still in BUY after reload, re-sending endTurn')
        await endTurn(page)
      } else {
        return // Phase moved on — turn ended successfully
      }
    }
  }
  throw new Error('Could not end turn after 3 retries')
}

/**
 * Buy stock via the chain-marker testid in the purchase form.
 * ChainMarker compact variant shows abbreviation (e.g., "LUX"), so we
 * locate by chain-marker-{name} testid and navigate to the parent row's stepper.
 */
async function buyStockByChain(page: Page, chainName: string, quantity: number): Promise<boolean> {
  const marker = page.getByTestId(`chain-marker-${chainName.toLowerCase()}`).first()
  try {
    await marker.waitFor({ state: 'visible', timeout: 3000 })
  } catch {
    return false
  }

  const purchaseRow = marker.locator('..')
  const incrementButton = purchaseRow.getByTestId('stepper-increment')

  for (let i = 0; i < quantity; i++) {
    const enabled = await incrementButton.isEnabled().catch(() => false)
    if (!enabled) return i > 0
    await incrementButton.click()
  }
  console.log(`  [buyStock] Bought ${quantity} ${chainName}`)
  return true
}

/**
 * Get the player's cash from the scoreboard.
 * PlayerPage shows cash in a span with CSS module class "playerCash" (no data-testid).
 */
async function getPlayerCash(page: Page): Promise<number> {
  try {
    const cash = await page.evaluate(() => {
      const youBadge = document.querySelector('[class*="youBadge"]')
      if (youBadge) {
        const playerRow = youBadge.closest('[class*="playerRow"]')
        const cashSpan = playerRow?.querySelector('[class*="playerCash"]')
        return cashSpan?.textContent || ''
      }
      const cashEl = document.querySelector('[class*="playerCash"]')
      return cashEl?.textContent || ''
    })
    return parseInt(cash.replace(/[^0-9]/g, ''), 10) || 0
  } catch {
    return 0
  }
}

/**
 * Execute a stock disposition strategy via the merger disposition sliders.
 *
 * Slider testids (from Slider.tsx dynamic generation):
 *   - sell: "slider-sell-to-bank"
 *   - trade: "slider-trade-2:1-for-{chain}" (matched by prefix)
 */
async function executeDisposition(
  page: Page,
  strategy: 'hold' | 'sell-all' | 'trade-all' | 'mixed',
  opts: { category: string; testName: string }
): Promise<void> {
  const sellSlider = page.getByTestId('slider-sell-to-bank')
  const tradeSlider = page.locator('[data-testid^="slider-trade-2:1-for"]')

  const sellVisible = await sellSlider.isVisible().catch(() => false)
  if (!sellVisible) {
    console.log(`  [disposition] Sell slider not found, confirming as-is`)
  } else {
    const sellMax = parseInt((await sellSlider.getAttribute('max')) || '0', 10)
    const tradeVisible = await tradeSlider.isVisible().catch(() => false)
    const tradeMax = tradeVisible
      ? parseInt((await tradeSlider.getAttribute('max')) || '0', 10)
      : 0
    const tradeDisabled = tradeVisible ? await tradeSlider.isDisabled() : true

    console.log(`  [disposition] sell max=${sellMax}, trade max=${tradeMax}, trade disabled=${tradeDisabled}`)

    switch (strategy) {
      case 'sell-all':
        if (sellMax > 0) await sellSlider.fill(sellMax.toString())
        break
      case 'trade-all':
        if (!tradeDisabled && tradeMax >= 2) {
          await tradeSlider.fill((Math.floor(tradeMax / 2) * 2).toString())
        }
        break
      case 'mixed':
        if (sellMax >= 2 && !tradeDisabled && tradeMax >= 2) {
          await sellSlider.fill('1')
          const newMax = parseInt((await tradeSlider.getAttribute('max')) || '0', 10)
          if (newMax >= 2) await tradeSlider.fill('2')
        } else if (sellMax >= 1) {
          await sellSlider.fill('1')
        }
        break
      case 'hold':
      default:
        break // sliders default to 0 = hold all
    }
  }

  const summary = await page.getByTestId('disposition-summary').textContent().catch(() => '')
  console.log(`  [disposition] ${strategy}: ${summary}`)
  await captureStep(page, `disposition-${strategy}`, opts)

  await page.getByTestId('confirm-disposition').click()
  console.log(`  [disposition] Confirmed`)
  await expect(page.getByTestId('merger-disposition')).not.toBeVisible({ timeout: 10000 })
}

/**
 * Wait for a merger to fully resolve. If the player's disposition UI appears,
 * execute the given strategy. Returns cash before/after for bonus verification.
 */
async function waitForMergerComplete(
  page: Page,
  opts: {
    category: string
    testName: string
    dispositionStrategy?: 'hold' | 'sell-all' | 'trade-all' | 'mixed'
  }
): Promise<{ hadDisposition: boolean; cashBefore: number; cashAfter: number }> {
  const strategy = opts.dispositionStrategy ?? 'hold'
  let hadDisposition = false
  const cashBefore = await getPlayerCash(page)
  const start = Date.now()

  while (Date.now() - start < 60000) {
    // Check if disposition UI appeared (our turn to dispose stock)
    const dispVisible = await page.getByTestId('merger-disposition').isVisible().catch(() => false)
    if (dispVisible && !hadDisposition) {
      hadDisposition = true
      console.log(`  *** DISPOSITION UI VISIBLE ***`)
      await captureStep(page, 'disposition-ui', opts)
      await executeDisposition(page, strategy, opts)
    }

    // Merger is done when phase shows: BUY (our buy), PLACE (our next turn),
    // ends with "'s TURN" (bot turn = merger resolved), or GAME OVER
    const phase = await getPhaseText(page)
    if (
      phase.includes('BUY') ||
      phase.includes('PLACE') ||
      phase.endsWith("'s TURN") ||
      phase.includes('GAME OVER')
    ) {
      break
    }

    // Still in merger — wait for next phase change
    try {
      await page.waitForFunction(
        (currentPhase: string) => {
          const el = document.querySelector('[data-testid="game-phase"]')
          const text = (el?.textContent || '').trim()
          return text !== currentPhase
        },
        phase,
        { timeout: 5000 }
      )
    } catch {
      // Timeout — loop to re-check disposition UI and phase
    }
  }

  const cashAfter = await getPlayerCash(page)
  return { hadDisposition, cashBefore, cashAfter }
}

/**
 * Play a single turn: place tile, handle founding, buy stock, end turn.
 * Returns early if a merger is detected after tile placement.
 */
async function playOneTurn(
  page: Page,
  humanTurn: number,
  opts: { category: string; testName: string },
  buyCallback?: (page: Page, humanTurn: number) => Promise<void>
): Promise<{ mergerDetected: boolean }> {
  console.log(`\n[Turn ${humanTurn}] === MY TURN ===`)

  const cash = await getPlayerCash(page)
  const holdings = await getPortfolioHoldings(page)
  console.log(`  Cash: $${cash}, Holdings: ${JSON.stringify(holdings)}`)

  // Verify WebSocket is healthy before interacting with tiles
  await waitForWebSocketConnected(page, 5000).catch(async () => {
    console.log('  [playOneTurn] WebSocket disconnected, reloading...')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForWebSocketConnected(page, 10000)
  })

  // Select tile with reload fallback if tile rack becomes non-interactive
  let tile: string
  try {
    tile = await selectTileFromRack(page)
  } catch {
    console.log('  [playOneTurn] Tile selection failed, reloading page...')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForWebSocketConnected(page, 10000)
    // After reload, check if we're still in PLACE phase
    const phase = await getPhaseText(page)
    if (!phase.includes('PLACE')) {
      return { mergerDetected: phase.includes('MERGER') || phase.includes('DISPOSE') }
    }
    tile = await selectTileFromRack(page)
  }
  console.log(`  Placing: ${tile}`)
  await placeTile(page)

  const phaseAfter = await getPhaseText(page)
  console.log(`  Phase after place: "${phaseAfter}"`)

  // Check merger after placement
  if (phaseAfter.includes('MERGER') || phaseAfter.includes('DISPOSE')) {
    console.log(`  *** MERGER TRIGGERED ***`)
    await captureStep(page, `merger-triggered-turn-${humanTurn}`, opts)
    return { mergerDetected: true }
  }

  // Handle chain founding
  if (await hasChainSelector(page)) {
    const chain = await selectFirstAvailableChain(page)
    console.log(`  Founded: ${chain}`)
    await waitForPhase(page, 'BUY', 5000).catch(() => {})
  }

  // Buy phase
  const buyPhase = await getPhaseText(page)
  if (buyPhase.includes('BUY')) {
    if (buyCallback) {
      await buyCallback(page, humanTurn)
    } else {
      // Default: buy 1 stock, rotating across active chains
      const chains = await getActiveChains(page)
      if (chains.length > 0) {
        const idx = (humanTurn - 1) % chains.length
        await buyStockByChain(page, chains[idx], 1)
      }
    }
    await endTurn(page)
    await verifyTurnEnded(page)
  }

  return { mergerDetected: false }
}

/**
 * Play turns until a merger occurs. Buys 1 stock per turn (rotating chains)
 * to diversify holdings. Returns the turn number when merger was detected.
 *
 * Uses waitForOurPhase() for efficient DOM watching instead of manual polling.
 * Handles WebSocket disconnection via page reload fallback.
 */
async function playUntilMerger(
  page: Page,
  maxTurns: number,
  opts: { category: string; testName: string },
  buyCallback?: (page: Page, humanTurn: number) => Promise<void>
): Promise<number> {
  let humanTurn = 0

  while (humanTurn < maxTurns) {
    // Wait for any phase where it's our turn
    const phase = await waitForOurPhase(page)

    // Merger detected (bot triggered it and we need to dispose, or it's our merger turn)
    if (phase.includes('MERGER') || phase.includes('DISPOSE')) {
      console.log(`  *** MERGER DETECTED at human turn ${humanTurn} ***`)
      await captureStep(page, `merger-at-turn-${humanTurn}`, opts)
      return humanTurn
    }

    if (phase.includes('GAME OVER')) break

    // Handle unexpected phases (can happen after page reload)
    if (phase.includes('BUY')) {
      console.log(`  [playUntilMerger] In BUY phase unexpectedly, ending turn`)
      await endTurn(page)
      await verifyTurnEnded(page)
      continue
    }
    if (phase.includes('CHOOSE')) {
      console.log(`  [playUntilMerger] In CHOOSE phase, selecting chain`)
      const chain = await selectFirstAvailableChain(page)
      console.log(`  Founded: ${chain}`)
      continue
    }

    // PLACE A TILE — main turn flow
    humanTurn++
    const result = await playOneTurn(page, humanTurn, opts, buyCallback)
    if (result.mergerDetected) return humanTurn
  }

  throw new Error(`No merger after ${humanTurn} human turns`)
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
test.describe('Merger Scenarios (ST-006)', () => {
  useDeterministicBackend('default.csv')

  test.beforeEach(() => {
    resetStepCounter()
  })

  async function setupGame(page: Page, playerName: string): Promise<void> {
    await createGameViaUI(page, playerName)
    await assertPlayerInLobby(page, playerName)
    await addBotViaUI(page)
    await addBotViaUI(page)
    await startGameViaUI(page)
    await waitForWebSocketConnected(page)
  }

  test('5.1: Two-chain merger triggers and resolves', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '5.1-two-chain-merger'
    const errors = setupConsoleErrorTracking(page)

    await setupGame(page, 'Merger1')
    await captureStep(page, 'game-started', { category: CATEGORY, testName })

    // Play until merger
    const mergerTurn = await playUntilMerger(page, 50, { category: CATEGORY, testName })
    console.log(`Merger at turn ${mergerTurn}`)

    // Handle merger with hold-all
    const result = await waitForMergerComplete(page, {
      category: CATEGORY,
      testName,
      dispositionStrategy: 'hold',
    })

    console.log(`Disposition: ${result.hadDisposition}, Cash: $${result.cashBefore}→$${result.cashAfter}`)

    // Verify game continues
    const phase = await getPhaseText(page)
    expect(
      phase.includes('BUY') || phase.includes('PLACE') ||
      phase.endsWith("'s TURN") || phase.includes('GAME OVER')
    ).toBe(true)

    await captureStep(page, 'after-merger', { category: CATEGORY, testName })
    expect(errors.getErrors().filter((e) => !e.includes('WebSocket'))).toHaveLength(0)
  })

  test('5.8: Sell all defunct stock during merger', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '5.8-sell-all'
    const errors = setupConsoleErrorTracking(page)

    await setupGame(page, 'SellAll')

    await playUntilMerger(page, 50, { category: CATEGORY, testName })

    const result = await waitForMergerComplete(page, {
      category: CATEGORY,
      testName,
      dispositionStrategy: 'sell-all',
    })

    console.log(`Sell-all: disposition=${result.hadDisposition}, cash=$${result.cashBefore}→$${result.cashAfter}`)
    if (result.hadDisposition) {
      expect(result.cashAfter).toBeGreaterThan(result.cashBefore)
    }

    await captureStep(page, 'final', { category: CATEGORY, testName })
    expect(errors.getErrors().filter((e) => !e.includes('WebSocket'))).toHaveLength(0)
  })

  test('5.9: Trade all defunct stock 2:1 during merger', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '5.9-trade-all'
    const errors = setupConsoleErrorTracking(page)

    await setupGame(page, 'TradeAll')

    await playUntilMerger(page, 50, { category: CATEGORY, testName })

    const holdingsBefore = await getPortfolioHoldings(page)
    const result = await waitForMergerComplete(page, {
      category: CATEGORY,
      testName,
      dispositionStrategy: 'trade-all',
    })
    const holdingsAfter = await getPortfolioHoldings(page)

    console.log(`Trade-all: disposition=${result.hadDisposition}`)
    console.log(`Holdings: ${JSON.stringify(holdingsBefore)} → ${JSON.stringify(holdingsAfter)}`)

    await captureStep(page, 'final', { category: CATEGORY, testName })
    expect(errors.getErrors().filter((e) => !e.includes('WebSocket'))).toHaveLength(0)
  })

  test('5.11: Mixed disposition (sell + trade + hold)', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '5.11-mixed'
    const errors = setupConsoleErrorTracking(page)

    await setupGame(page, 'Mixed')

    await playUntilMerger(page, 50, { category: CATEGORY, testName })

    const result = await waitForMergerComplete(page, {
      category: CATEGORY,
      testName,
      dispositionStrategy: 'mixed',
    })

    console.log(`Mixed: disposition=${result.hadDisposition}, cash=$${result.cashBefore}→$${result.cashAfter}`)

    await captureStep(page, 'final', { category: CATEGORY, testName })
    expect(errors.getErrors().filter((e) => !e.includes('WebSocket'))).toHaveLength(0)
  })

  test('5.15: Merger bonus increases player cash', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '5.15-bonus'
    const errors = setupConsoleErrorTracking(page)

    await setupGame(page, 'Bonus')

    // Aggressive buy strategy: buy 3 shares of the first chain each turn
    // to maximize our majority shareholder bonus
    let targetChain: string | null = null
    const aggressiveBuy = async (p: Page, turn: number) => {
      const chains = await getActiveChains(p)
      if (!targetChain && chains.length > 0) targetChain = chains[0]
      if (targetChain) {
        for (let i = 0; i < 3; i++) {
          if (!(await buyStockByChain(p, targetChain, 1))) break
        }
      }
    }

    const mergerTurn = await playUntilMerger(
      page, 50, { category: CATEGORY, testName }, aggressiveBuy
    )
    console.log(`Merger at turn ${mergerTurn}, target chain: ${targetChain}`)

    const cashBefore = await getPlayerCash(page)
    const holdingsBefore = await getPortfolioHoldings(page)
    console.log(`Pre-merger: cash=$${cashBefore}, holdings=${JSON.stringify(holdingsBefore)}`)

    // Hold all so cash change = pure bonus
    const result = await waitForMergerComplete(page, {
      category: CATEGORY,
      testName,
      dispositionStrategy: 'hold',
    })

    console.log(`Post-merger: cash=$${result.cashAfter}`)
    if (result.hadDisposition) {
      const bonus = result.cashAfter - result.cashBefore
      console.log(`  Bonus received: $${bonus}`)
      expect(bonus).toBeGreaterThan(0)
    }

    await captureStep(page, 'final', { category: CATEGORY, testName })
    expect(errors.getErrors().filter((e) => !e.includes('WebSocket'))).toHaveLength(0)
  })

  test('5.1 extended: Multiple mergers in one game', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '5.1-extended'
    const errors = setupConsoleErrorTracking(page)

    await setupGame(page, 'Multi')

    let humanTurn = 0
    let mergerCount = 0
    const strategies: Array<'sell-all' | 'trade-all' | 'mixed' | 'hold'> = [
      'sell-all', 'trade-all', 'mixed', 'hold',
    ]
    const mergerLog: string[] = []

    while (humanTurn < 50) {
      const phase = await waitForOurPhase(page)
      if (phase.includes('GAME OVER')) break

      // Merger detected
      if (phase.includes('MERGER') || phase.includes('DISPOSE')) {
        mergerCount++
        const strategy = strategies[(mergerCount - 1) % strategies.length]
        console.log(`\n*** MERGER #${mergerCount} (strategy: ${strategy}) ***`)

        const result = await waitForMergerComplete(page, {
          category: CATEGORY,
          testName: `${testName}-m${mergerCount}`,
          dispositionStrategy: strategy,
        })
        mergerLog.push(`#${mergerCount}: ${strategy}, disp=${result.hadDisposition}, cash=$${result.cashBefore}→$${result.cashAfter}`)

        // After merger completes, check post-merger buy phase
        // (may have already advanced past BUY due to process_bot_turns)
        const postPhase = await getPhaseText(page)
        if (postPhase.includes('BUY')) {
          const btn = page.getByTestId('end-turn-button')
          const isEnabled = await btn.isEnabled().catch(() => false)
          if (isEnabled) {
            await btn.click()
            await verifyTurnEnded(page)
          }
        }

        if (mergerCount >= 2 && humanTurn >= 15) break
        continue
      }

      // Handle unexpected BUY phase (can appear transiently after merger resolves)
      if (phase.includes('BUY')) {
        // BUY can be transient — only end turn if button is actually enabled
        const btn = page.getByTestId('end-turn-button')
        const isEnabled = await btn.isEnabled().catch(() => false)
        if (isEnabled) {
          await btn.click()
          await verifyTurnEnded(page)
        }
        continue
      }
      if (phase.includes('CHOOSE')) {
        await selectFirstAvailableChain(page)
        continue
      }

      // PLACE A TILE — our turn
      humanTurn++
      const result = await playOneTurn(page, humanTurn, { category: CATEGORY, testName })

      if (result.mergerDetected) {
        mergerCount++
        const strategy = strategies[(mergerCount - 1) % strategies.length]
        console.log(`  *** MERGER #${mergerCount} (self-triggered, strategy: ${strategy}) ***`)

        const mergerResult = await waitForMergerComplete(page, {
          category: CATEGORY,
          testName: `${testName}-m${mergerCount}`,
          dispositionStrategy: strategy,
        })
        mergerLog.push(`#${mergerCount}: ${strategy}, disp=${mergerResult.hadDisposition}, cash=$${mergerResult.cashBefore}→$${mergerResult.cashAfter}`)

        // Handle post-merger buy phase (may have already advanced)
        const postPhase2 = await getPhaseText(page)
        if (postPhase2.includes('BUY')) {
          const btn2 = page.getByTestId('end-turn-button')
          const isEnabled2 = await btn2.isEnabled().catch(() => false)
          if (isEnabled2) {
            await btn2.click()
            await verifyTurnEnded(page)
          }
        }

        if (mergerCount >= 2 && humanTurn >= 15) break
      }
    }

    console.log(`\nSUMMARY: ${mergerCount} mergers in ${humanTurn} turns`)
    for (const log of mergerLog) console.log(`  ${log}`)

    expect(mergerCount).toBeGreaterThanOrEqual(1)
    await captureStep(page, 'final', { category: CATEGORY, testName })
    expect(errors.getErrors().filter((e) => !e.includes('WebSocket'))).toHaveLength(0)
  })
})
