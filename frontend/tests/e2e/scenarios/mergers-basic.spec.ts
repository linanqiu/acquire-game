import { test, expect } from '@playwright/test'
import { resetStepCounter, captureStep } from './helpers/screenshot'
import { setupConsoleErrorTracking, getPortfolioHoldings } from './helpers/turn-actions'
import { useDeterministicBackend } from '../fixtures/deterministic-server'
import {
  setupMergerGame,
  playUntilMerger,
  waitForMergerComplete,
  getPlayerCash,
} from './helpers/merger'

const CATEGORY = 'mergers'

/**
 * Basic Merger Scenarios — seed 2, default tile order.
 *
 * Tests 5.1, 5.8, 5.9, 5.10, 5.11:
 *   - Two-chain merger triggers and resolves
 *   - Sell all, trade all, hold all, mixed disposition strategies
 */
test.describe('Basic Merger Scenarios', () => {
  useDeterministicBackend('default.csv')

  test.beforeEach(() => {
    resetStepCounter()
  })

  test('5.1: Two-chain merger triggers and resolves', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '5.1-two-chain-merger'
    const errors = setupConsoleErrorTracking(page)

    await setupMergerGame(page, 'Merger1')
    await captureStep(page, 'game-started', { category: CATEGORY, testName })

    const mergerTurn = await playUntilMerger(page, 50, { category: CATEGORY, testName })
    console.log(`Merger at turn ${mergerTurn}`)

    const result = await waitForMergerComplete(page, {
      category: CATEGORY,
      testName,
      dispositionStrategy: 'hold',
    })

    console.log(
      `Disposition: ${result.hadDisposition}, Cash: $${result.cashBefore}→$${result.cashAfter}`
    )

    // Verify game continues after merger
    const { getPhaseText } = await import('./helpers/turn-actions')
    const phase = await getPhaseText(page)
    expect(
      phase.includes('BUY') ||
        phase.includes('PLACE') ||
        phase.endsWith("'s TURN") ||
        phase.includes('GAME OVER')
    ).toBe(true)

    await captureStep(page, 'after-merger', { category: CATEGORY, testName })
    expect(errors.getErrors().filter((e) => !e.includes('WebSocket'))).toHaveLength(0)
  })

  test('5.8: Sell all defunct stock during merger', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '5.8-sell-all'
    const errors = setupConsoleErrorTracking(page)

    await setupMergerGame(page, 'SellAll')

    await playUntilMerger(page, 50, { category: CATEGORY, testName })

    const result = await waitForMergerComplete(page, {
      category: CATEGORY,
      testName,
      dispositionStrategy: 'sell-all',
    })

    console.log(
      `Sell-all: disposition=${result.hadDisposition}, cash=$${result.cashBefore}→$${result.cashAfter}`
    )
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

    await setupMergerGame(page, 'TradeAll')

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

  test('5.10: Hold all defunct stock during merger', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '5.10-hold-all'
    const errors = setupConsoleErrorTracking(page)

    await setupMergerGame(page, 'HoldAll')

    await playUntilMerger(page, 50, { category: CATEGORY, testName })

    const holdingsBefore = await getPortfolioHoldings(page)
    const cashBefore = await getPlayerCash(page)

    const result = await waitForMergerComplete(page, {
      category: CATEGORY,
      testName,
      dispositionStrategy: 'hold',
    })
    const holdingsAfter = await getPortfolioHoldings(page)

    console.log(
      `Hold-all: disposition=${result.hadDisposition}, cash=$${result.cashBefore}→$${result.cashAfter}`
    )
    console.log(`Holdings: ${JSON.stringify(holdingsBefore)} → ${JSON.stringify(holdingsAfter)}`)

    if (result.hadDisposition) {
      // When holding all stock: cash change = bonus only (no sell revenue)
      // Stock counts for defunct chain should remain the same
      expect(result.cashAfter).toBeGreaterThanOrEqual(cashBefore)
    }

    await captureStep(page, 'final', { category: CATEGORY, testName })
    expect(errors.getErrors().filter((e) => !e.includes('WebSocket'))).toHaveLength(0)
  })

  test('5.11: Mixed disposition (sell + trade + hold)', async ({ page }) => {
    test.setTimeout(300000)
    const testName = '5.11-mixed'
    const errors = setupConsoleErrorTracking(page)

    await setupMergerGame(page, 'Mixed')

    await playUntilMerger(page, 50, { category: CATEGORY, testName })

    const result = await waitForMergerComplete(page, {
      category: CATEGORY,
      testName,
      dispositionStrategy: 'mixed',
    })

    console.log(
      `Mixed: disposition=${result.hadDisposition}, cash=$${result.cashBefore}→$${result.cashAfter}`
    )

    await captureStep(page, 'final', { category: CATEGORY, testName })
    expect(errors.getErrors().filter((e) => !e.includes('WebSocket'))).toHaveLength(0)
  })
})
