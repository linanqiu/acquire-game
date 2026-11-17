import type { Page } from '@playwright/test'
import { test, expect } from './support/test'
import { startFromSnapshot } from './support/room'
import { dollars } from './support/fixtures'
import {
  clickableRackTiles,
  myCash,
  phaseBanner,
  playHumanTurns,
  playerRows,
  rack,
} from './support/ui'
import { openTab, showBoard } from '../support/tabs'

const VIEWPORTS = [
  { label: 'desktop', width: 1280, height: 800 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'phone', width: 390, height: 844 },
]

/** Nothing sticks out sideways: the page does not scroll horizontally. */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.documentElement.clientWidth,
  }))
  expect(overflow.doc, 'document scrolls horizontally').toBeLessThanOrEqual(0)
  expect(overflow.body, 'body is wider than the viewport').toBeLessThanOrEqual(0)
}

/** Every element of the locator lies fully inside the viewport horizontally. */
async function expectWithinViewportWidth(page: Page, selector: string, what: string) {
  const bad = await page.evaluate((sel) => {
    const w = document.documentElement.clientWidth
    return Array.from(document.querySelectorAll(sel))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && (r.left < -0.5 || r.right > w + 0.5))
      .map((r) => `${Math.round(r.left)}..${Math.round(r.right)} of ${w}`)
  }, selector)
  expect(bad, `${what} outside the viewport width`).toEqual([])
}

for (const fixtureName of ['three-player-midgame', 'six-player-midgame']) {
  for (const vp of VIEWPORTS) {
    test(`busy ${fixtureName} board on ${vp.label}: all players visible, no sideways scroll, turns play`, async ({
      page,
      shots,
    }) => {
      const room = await startFromSnapshot(page, fixtureName, {
        viewport: { width: vp.width, height: vp.height },
      })
      const { human, players } = room.fixture.expect
      await shots.take(page, `${vp.label}-loaded`)

      await expect(phaseBanner(page)).toHaveText('PLACE A TILE')
      await expect(myCash(page)).toHaveText(dollars(human.cash))

      // Every seat has its card with the right cash; the human's is marked YOU.
      await openTab(page, 'table')
      await expect(playerRows(page)).toHaveCount(players.length)
      for (const p of players) {
        const row = playerRows(page).filter({ hasText: p.name })
        await expect(row).toBeVisible()
        await expect(row).toContainText(dollars(p.cash))
        for (const [, qty] of Object.entries(p.holdings)) {
          if (qty > 0) await expect(row).toContainText(String(qty))
        }
      }
      await expect(playerRows(page).filter({ hasText: 'YOU' })).toHaveCount(1)
      await expect(playerRows(page).filter({ hasText: human.name })).toContainText('YOU')

      // Board and rack are fully on screen horizontally and the rack is usable.
      await showBoard(page)
      await expect(rack(page).locator('[data-testid^="tile-"]')).toHaveCount(human.hand.length)
      await expect(clickableRackTiles(page)).toHaveCount(
        human.hand.length - Object.keys(human.unplayable_tiles).length
      )
      await expectNoHorizontalScroll(page)
      await expectWithinViewportWidth(page, '[data-testid="board"]', 'board')
      await expectWithinViewportWidth(
        page,
        '[data-testid="board"] [data-testid^="tile-"]',
        'board squares (every column)'
      )
      // Corner squares of the 12x9 grid are really visible, not clipped by a scroll container.
      for (const corner of ['1A', '12A', '1I', '12I']) {
        await expect(page.getByTestId('board').getByTestId(`tile-${corner}`)).toBeInViewport({
          ratio: 1,
        })
      }
      await expectWithinViewportWidth(page, '[data-testid="tile-rack"] > *', 'rack tiles')
      await openTab(page, 'table')
      await expectWithinViewportWidth(page, '[data-testid="player-row"]', 'player cards')
      await openTab(page, 'trades')
      await expectWithinViewportWidth(page, '[data-testid="trade-offers"]', 'trade panel')
      await shots.take(page, `${vp.label}-checked`)

      // The layout holds up through real turns too (buy phase, other seats' moves).
      await playHumanTurns(page, room, 3, shots)
      await expectNoHorizontalScroll(page)
      await openTab(page, 'table')
      await expectWithinViewportWidth(page, '[data-testid="player-row"]', 'player cards')
      await shots.take(page, `${vp.label}-after-turns`)
    })
  }
}

/** Font size of every visible text field, with a label for the failure message. */
async function textFieldFontSizes(page: Page) {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        'input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select'
      )
    )
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({
        field: el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName,
        px: parseFloat(getComputedStyle(el).fontSize),
      }))
  )
}

test('phone: no text field is under 16px, so the browser does not zoom in on focus', async ({
  page,
  shots,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByTestId('name-input')).toBeVisible()
  const home = await textFieldFontSizes(page)
  expect(home.length, 'home page text fields found').toBeGreaterThan(0)
  expect(home.filter((f) => f.px < 16)).toEqual([])
  await shots.take(page, 'phone-home-fields')

  await startFromSnapshot(page, 'three-player-midgame', { viewport: { width: 390, height: 844 } })
  await openTab(page, 'chat')
  await expect(page.getByTestId('chat-input')).toBeVisible()
  const chat = await textFieldFontSizes(page)
  expect(chat.length, 'chat text fields found').toBeGreaterThan(0)
  expect(chat.filter((f) => f.px < 16)).toEqual([])
  await shots.take(page, 'phone-chat-field')
})
