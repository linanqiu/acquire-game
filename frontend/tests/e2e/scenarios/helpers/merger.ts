import { Page, expect } from '@playwright/test'
import {
  selectTileFromRack,
  placeTile,
  endTurn,
  hasChainSelector,
  selectFirstAvailableChain,
  getPhaseText,
  getPortfolioHoldings,
  getActiveChains,
  waitForWebSocketConnected,
  waitForPhase,
} from './turn-actions'
import {
  createGameViaUI,
  addBotViaUI,
  startGameViaUI,
  assertPlayerInLobby,
} from './game-setup'
import { captureStep } from './screenshot'

/**
 * Shared merger test helpers for E2E scenario testing.
 *
 * These helpers handle the complex merger flow:
 *   - Playing turns until a merger occurs
 *   - Handling stock disposition (sell/trade/hold)
 *   - Verifying post-merger state
 *   - WebSocket reconnection on failure
 */

// ---------------------------------------------------------------------------
// Phase waiting helpers
// ---------------------------------------------------------------------------

/**
 * Wait for any phase where it's OUR turn (not a bot's turn).
 *
 * Phase text rules (from PlayerPage.tsx):
 *   - Bot turns: "{name}'s TURN" (always ends with "'s TURN")
 *   - Our turns: "PLACE A TILE", "CHOOSE A CHAIN", "BUY STOCKS",
 *                "MERGER IN PROGRESS", "DISPOSE YOUR STOCK", "CHOOSE SURVIVOR"
 *   - End state: "GAME OVER"
 *
 * Uses page.waitForFunction() for efficient DOM watching.
 * Falls back to page reload if WebSocket disconnects (phase stops updating).
 */
export async function waitForOurPhase(page: Page, timeout = 120000): Promise<string> {
  const conditionFn = `() => {
    const el = document.querySelector('[data-testid="game-phase"]');
    const text = (el?.textContent || '').trim();
    // Skip bot turns AND "MERGER IN PROGRESS" (someone else is in a merger)
    return text.length > 0 && !text.endsWith("'s TURN") && text !== 'MERGER IN PROGRESS';
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
export async function verifyTurnEnded(page: Page): Promise<void> {
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

// ---------------------------------------------------------------------------
// Stock buying helpers
// ---------------------------------------------------------------------------

/**
 * Buy stock via the chain-marker testid in the purchase form.
 * ChainMarker compact variant shows abbreviation (e.g., "LUX"), so we
 * locate by chain-marker-{name} testid and navigate to the parent row's stepper.
 */
export async function buyStockByChain(
  page: Page,
  chainName: string,
  quantity: number
): Promise<boolean> {
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

// ---------------------------------------------------------------------------
// Cash reading helpers
// ---------------------------------------------------------------------------

/**
 * Get the player's cash from the scoreboard.
 * PlayerPage shows cash in a span with CSS module class "playerCash" (no data-testid).
 */
export async function getPlayerCash(page: Page): Promise<number> {
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

// ---------------------------------------------------------------------------
// Disposition helpers
// ---------------------------------------------------------------------------

/**
 * Execute a stock disposition strategy via the merger disposition sliders.
 *
 * Slider testids (from Slider.tsx dynamic generation):
 *   - sell: "slider-sell-to-bank"
 *   - trade: "slider-trade-2:1-for-{chain}" (matched by prefix)
 */
export async function executeDisposition(
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

    console.log(
      `  [disposition] sell max=${sellMax}, trade max=${tradeMax}, trade disabled=${tradeDisabled}`
    )

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

// ---------------------------------------------------------------------------
// Merger flow helpers
// ---------------------------------------------------------------------------

/**
 * Wait for a merger to fully resolve. If the player's disposition UI appears,
 * execute the given strategy. Returns cash before/after for bonus verification.
 */
export async function waitForMergerComplete(
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
    const phaseText = await getPhaseText(page)
    console.log(`  [waitForMergerComplete] phase="${phaseText}"`)

    // Check if survivor selection is needed (tie-breaker)
    // Check phase first, then wait for chain-selector to appear
    if (phaseText.includes('SURVIVOR')) {
      console.log(`  *** SURVIVOR SELECTION PHASE ***`)
      await captureStep(page, 'survivor-selection', opts)
      const selector = page.getByTestId('chain-selector')
      await selector.waitFor({ state: 'visible', timeout: 10000 })
      await selectFirstAvailableChain(page)
      console.log(`  *** Survivor chosen ***`)
      await captureStep(page, 'survivor-chosen', opts)
      continue
    }

    // Check if disposition UI appeared (our turn to dispose stock)
    const dispVisible = await page
      .getByTestId('merger-disposition')
      .isVisible()
      .catch(() => false)
    if (dispVisible && !hadDisposition) {
      hadDisposition = true
      console.log(`  *** DISPOSITION UI VISIBLE ***`)
      await captureStep(page, 'disposition-ui', opts)
      await executeDisposition(page, strategy, opts)
    }

    // Also check for chain-selector without SURVIVOR phase text (timing race)
    const chainSelectorVisible = await page
      .getByTestId('chain-selector')
      .isVisible()
      .catch(() => false)
    if (
      chainSelectorVisible &&
      !phaseText.includes('BUY') &&
      !phaseText.includes('PLACE') &&
      !phaseText.includes('CHOOSE A CHAIN')
    ) {
      console.log(`  *** CHAIN SELECTOR VISIBLE during merger (phase="${phaseText}") ***`)
      await captureStep(page, 'survivor-selection-fallback', opts)
      await selectFirstAvailableChain(page)
      console.log(`  *** Survivor chosen (fallback) ***`)
      continue
    }

    // Merger is done when phase shows: BUY (our buy), PLACE (our next turn),
    // ends with "'s TURN" (bot turn = merger resolved), or GAME OVER
    if (
      phaseText.includes('BUY') ||
      phaseText.includes('PLACE') ||
      phaseText.endsWith("'s TURN") ||
      phaseText.includes('GAME OVER')
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
export async function playOneTurn(
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
  if (
    phaseAfter.includes('MERGER') ||
    phaseAfter.includes('DISPOSE') ||
    phaseAfter.includes('SURVIVOR')
  ) {
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
export async function playUntilMerger(
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
    if (
      phase.includes('MERGER') ||
      phase.includes('DISPOSE') ||
      phase.includes('SURVIVOR')
    ) {
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
// Post-merger buy phase helper
// ---------------------------------------------------------------------------

/**
 * Try to end the turn if we're in BUY phase with an enabled button.
 * Handles the transient BUY phase that appears after merger resolves.
 */
export async function tryEndTurnIfBuyPhase(page: Page): Promise<void> {
  const phase = await getPhaseText(page)
  if (phase.includes('BUY')) {
    const btn = page.getByTestId('end-turn-button')
    const isEnabled = await btn.isEnabled().catch(() => false)
    if (isEnabled) {
      await btn.click()
      await verifyTurnEnded(page)
    }
  }
}

// ---------------------------------------------------------------------------
// Game setup helper
// ---------------------------------------------------------------------------

/**
 * Setup a game with 1 human + 2 bots and start it.
 */
export async function setupMergerGame(page: Page, playerName: string): Promise<void> {
  await createGameViaUI(page, playerName)
  await assertPlayerInLobby(page, playerName)
  await addBotViaUI(page)
  await addBotViaUI(page)
  await startGameViaUI(page)
  await waitForWebSocketConnected(page)
}
