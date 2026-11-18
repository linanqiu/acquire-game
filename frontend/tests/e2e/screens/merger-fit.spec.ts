/**
 * Tier 3 (BL-019): every merger decision fits an iPhone's real screen (390x675, toolbars
 * showing) with the board, without scrolling anything: the survivor choice, the merger-order
 * choice and the sell / trade / keep decision. The page is the only scroller (no box scrolls
 * inside it); what follows a decision (who holds what, the players table) is under it, a page
 * scroll away. Checked in the dark and the light scheme.
 *
 * Setup (tier 3 only): the game is created from the home page; opponents are idle seats, a
 * generated snapshot is loaded. The browser player uses the UI only.
 */
import type { Page } from '@playwright/test'
import { test, expect } from './support/test'
import { startFromSnapshot } from './support/room'
import { loadFixture } from './support/fixtures'
import {
  clippedBy,
  expectFullBoard,
  expectNoInnerScroll,
  layoutProblems,
  pageFrameProblems,
} from './support/layout'
import { phaseBanner } from './support/ui'

const IPHONE = { width: 390, height: 675 }

/** Every control is whole on screen (no box and not the viewport cuts it), clear of the tab bar. */
async function expectOnScreen(page: Page, ids: string[]) {
  for (const id of ids) {
    const el = page.getByTestId(id).first()
    await expect(el, id).toBeVisible()
    expect(await clippedBy(page, `[data-testid="${id}"]`), `${id} is cut`).toEqual([])
    expect(
      await layoutProblems(page, [id, 'tab-bar', 'game-phase'], { noPageScroll: false }),
      `${id} is clear of the tab bar and the phase bar`
    ).toEqual([])
  }
}

async function expectBoardAndDecision(page: Page, controls: string[]) {
  await expect(page.locator('html')).toHaveJSProperty('scrollTop', 0)
  await expectFullBoard(page)
  await expectNoInnerScroll(page)
  expect(
    await pageFrameProblems(page, ['game-phase', 'board', 'tab-bar'], ['table-panel'])
  ).toEqual([])
  await expectOnScreen(page, controls)
}

for (const scheme of ['dark', 'light'] as const) {
  test.describe(`${scheme} scheme`, () => {
    test.use({ colorScheme: scheme })

    test(`sell / trade / keep at 390x675 (${scheme}): board and the whole decision on screen, each number once`, async ({
      page,
      shots,
    }) => {
      const fx = loadFixture('disposition-human-first')
      await startFromSnapshot(page, 'disposition-human-first', {
        viewport: IPHONE,
        idle: ['p2', 'p3', 'p4'],
      })
      await expect(phaseBanner(page)).toHaveText('DISPOSE YOUR SHARES')
      const legal = fx.expect.decisions[0].legal as unknown as {
        stock_count: number
        max_trade: number
      }
      await expectBoardAndDecision(page, [
        'merger-result-title',
        'disposition-title',
        'disposition-sell-all',
        'disposition-trade-max',
        'disposition-keep-all',
        'slider-sell-to-bank',
        'hold-display',
        'disposition-cash-after',
        'disposition-survivor-after',
        'confirm-disposition',
      ])
      await shots.take(page, 'disposition', { fullPage: false })

      // The quick choices set the controls; the consequence is next to them.
      await page.getByTestId('disposition-trade-max').click()
      await expect(page.locator('[data-testid^="slider-trade-"]')).toHaveValue(
        String(legal.max_trade)
      )
      await expect(page.getByTestId('hold-display')).toHaveText(
        String(legal.stock_count - legal.max_trade)
      )
      await expect(page.getByTestId('disposition-survivor-after')).toContainText('→')
      await expectOnScreen(page, ['disposition-survivor-after', 'confirm-disposition'])
      await shots.take(page, 'disposition-trade-max', { fullPage: false })
      await page.getByTestId('disposition-sell-all').click()
      await expect(page.getByTestId('disposition-sell')).toContainText(`${legal.stock_count} → `)
      await expect(page.getByTestId('hold-display')).toHaveText('0')
      await shots.take(page, 'disposition-sell-all', { fullPage: false })

      // Who holds what is under the decision: the page scrolls to it, not a panel.
      await page.getByTestId('merger-survivor-after').scrollIntoViewIfNeeded()
      await expect(page.getByTestId('merger-survivor-after')).toBeInViewport()
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
      await expectNoInnerScroll(page)
      await shots.take(page, 'disposition-scrolled-to-holders', { fullPage: false })
    })

    test(`survivor choice at 390x675 (${scheme}): only the tied chains, each row whole, with the board`, async ({
      page,
      shots,
    }) => {
      const room = await startFromSnapshot(page, 'merger-survivor-tie', { viewport: IPHONE })
      await expect(phaseBanner(page)).toHaveText('CHOOSE THE SURVIVING HOTEL CHAIN')
      const tied = room.fixture.expect.decisions[0].legal.chains as string[]
      await expect(page.locator('[data-testid^="chain-button-"]')).toHaveCount(tied.length)
      await expectBoardAndDecision(
        page,
        tied.map((c) => `chain-button-${c.toLowerCase()}`)
      )
      await shots.take(page, 'survivor-choice', { fullPage: false })
    })

    test(`merger order at 390x675 (${scheme}): every option whole, with the board`, async ({
      page,
      shots,
    }) => {
      const room = await startFromSnapshot(page, 'merger-order-tie', { viewport: IPHONE })
      await expect(phaseBanner(page)).toHaveText('CHOOSE THE MERGER ORDER')
      const tied = room.fixture.expect.decisions[0].legal.chains as string[]
      await expectBoardAndDecision(page, [
        'merger-order-title',
        ...tied.map((c) => `merger-order-${c.toLowerCase()}`),
      ])
      await shots.take(page, 'merger-order', { fullPage: false })
    })
  })
}
