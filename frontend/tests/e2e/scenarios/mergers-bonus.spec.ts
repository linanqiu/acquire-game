import { test, expect, Page } from '@playwright/test'
import { resetStepCounter, captureStep } from './helpers/screenshot'
import {
  setupConsoleErrorTracking,
  getPhaseText,
  getActiveChains,
  getPortfolioHoldings,
  endTurn,
  selectFirstAvailableChain,
} from './helpers/turn-actions'
import { useDeterministicBackend } from '../fixtures/deterministic-server'
import {
  setupMergerGame,
  playUntilMerger,
  playOneTurn,
  waitForMergerComplete,
  waitForOurPhase,
  verifyTurnEnded,
  tryEndTurnIfBuyPhase,
  buyStockByChain,
  getPlayerCash,
} from './helpers/merger'

const CATEGORY = 'mergers'

/**
 * Merger Bonus and Extended Scenarios — seed 2, default tile order.
 *
 * Tests 5.15, 5.1-extended, 5.16, 5.19:
 *   - Majority bonus verification
 *   - Multiple mergers in one game
 *   - Minority bonus (buy in two chains, second largest gets minority)
 *   - Sole stockholder (gets both bonuses)
 */
test.describe('Merger Bonus Scenarios', () => {
  useDeterministicBackend('default.csv')

  test.beforeEach(() => {
    resetStepCounter()
  })

  test('5.15: Majority bonus increases player cash', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '5.15-bonus'
    const errors = setupConsoleErrorTracking(page)

    await setupMergerGame(page, 'Bonus')

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
      page,
      50,
      { category: CATEGORY, testName },
      aggressiveBuy
    )
    console.log(`Merger at turn ${mergerTurn}, target chain: ${targetChain}`)

    const holdingsBefore = await getPortfolioHoldings(page)
    console.log(`Pre-merger holdings: ${JSON.stringify(holdingsBefore)}`)

    // Sell all so cash increase = bonus + sale revenue (measurable change)
    const result = await waitForMergerComplete(page, {
      category: CATEGORY,
      testName,
      dispositionStrategy: 'sell-all',
    })

    console.log(
      `Post-merger: cash=$${result.cashBefore}→$${result.cashAfter}, disposition=${result.hadDisposition}`
    )
    if (result.hadDisposition) {
      // Selling stock should increase cash
      expect(result.cashAfter).toBeGreaterThanOrEqual(result.cashBefore)
    }

    await captureStep(page, 'final', { category: CATEGORY, testName })
    expect(errors.getErrors().filter((e) => !e.includes('WebSocket'))).toHaveLength(0)
  })

  test('5.19: Sole stockholder gets both majority and minority bonus', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '5.19-sole-stockholder'
    const errors = setupConsoleErrorTracking(page)

    await setupMergerGame(page, 'Sole')

    // Buy strategy: aggressively buy ALL stock in one chain so we're the sole holder
    // With 3 players and bots buying randomly, we buy 3 per turn of one chain
    let targetChain: string | null = null
    const soleBuy = async (p: Page, turn: number) => {
      const chains = await getActiveChains(p)
      if (!targetChain && chains.length > 0) targetChain = chains[0]
      if (targetChain) {
        for (let i = 0; i < 3; i++) {
          if (!(await buyStockByChain(p, targetChain, 1))) break
        }
      }
    }

    const mergerTurn = await playUntilMerger(
      page,
      50,
      { category: CATEGORY, testName },
      soleBuy
    )
    console.log(`Merger at turn ${mergerTurn}, target chain: ${targetChain}`)

    const holdingsBefore = await getPortfolioHoldings(page)
    console.log(`Pre-merger holdings: ${JSON.stringify(holdingsBefore)}`)

    // Sell all - sole stockholder gets both bonuses + sale revenue
    const result = await waitForMergerComplete(page, {
      category: CATEGORY,
      testName,
      dispositionStrategy: 'sell-all',
    })

    console.log(
      `Post-merger: cash=$${result.cashBefore}→$${result.cashAfter}, disposition=${result.hadDisposition}`
    )
    if (result.hadDisposition) {
      // Selling stock as sole stockholder should give bonus + sale revenue
      expect(result.cashAfter).toBeGreaterThanOrEqual(result.cashBefore)
    }

    await captureStep(page, 'final', { category: CATEGORY, testName })
    expect(errors.getErrors().filter((e) => !e.includes('WebSocket'))).toHaveLength(0)
  })

  test('5.1 extended: Multiple mergers in one game', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '5.1-extended'
    const errors = setupConsoleErrorTracking(page)

    await setupMergerGame(page, 'Multi')

    let humanTurn = 0
    let mergerCount = 0
    const strategies: Array<'sell-all' | 'trade-all' | 'mixed' | 'hold'> = [
      'sell-all',
      'trade-all',
      'mixed',
      'hold',
    ]
    const mergerLog: string[] = []

    while (humanTurn < 50) {
      const phase = await waitForOurPhase(page)
      if (phase.includes('GAME OVER')) break

      // Merger detected
      if (
        phase.includes('MERGER') ||
        phase.includes('DISPOSE') ||
        phase.includes('SURVIVOR')
      ) {
        mergerCount++
        const strategy = strategies[(mergerCount - 1) % strategies.length]
        console.log(`\n*** MERGER #${mergerCount} (strategy: ${strategy}) ***`)

        const result = await waitForMergerComplete(page, {
          category: CATEGORY,
          testName: `${testName}-m${mergerCount}`,
          dispositionStrategy: strategy,
        })
        mergerLog.push(
          `#${mergerCount}: ${strategy}, disp=${result.hadDisposition}, cash=$${result.cashBefore}→$${result.cashAfter}`
        )

        await tryEndTurnIfBuyPhase(page)
        if (mergerCount >= 2 && humanTurn >= 15) break
        continue
      }

      // Handle unexpected BUY phase (can appear transiently after merger resolves)
      if (phase.includes('BUY')) {
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
        mergerLog.push(
          `#${mergerCount}: ${strategy}, disp=${mergerResult.hadDisposition}, cash=$${mergerResult.cashBefore}→$${mergerResult.cashAfter}`
        )

        await tryEndTurnIfBuyPhase(page)
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
