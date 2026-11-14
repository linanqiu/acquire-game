/**
 * Journey 7: the player page on a phone (390x844, touch).
 *
 * The same opening as journey 1 (bot + Fake LLM, same seed, same choices) for 8 turns,
 * tapping instead of clicking. On every screen: no horizontal scrolling, and every
 * control needed for the turn (rack tiles, PLACE TILE, chain selector, disposition
 * sliders and CONFIRM, buy steppers and END TURN, the TRADES panel and the Propose
 * Trade modal) is inside the viewport's width and can be scrolled to and tapped.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect } from './support/journey'
import { addAi, addBot, createGame, startGame } from './support/lobby'
import { Seat, installObservers } from './support/play'
import { outgoingTo, proposeTrade } from './support/trade'

const WIDTH = 390
const LLM = 'Fake LLM (test)'

test.use({
  viewport: { width: WIDTH, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
})

async function noHorizontalScroll(page: Page, where: string) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(scrollWidth, `horizontal scroll on ${where}`).toBeLessThanOrEqual(innerWidth)
}

async function reachable(loc: Locator, what: string) {
  await loc.scrollIntoViewIfNeeded()
  await expect(loc, `${what} visible`).toBeVisible()
  const box = await loc.boundingBox()
  if (!box) throw new Error(`${what} has no box`)
  expect(box.x, `${what} starts inside the screen`).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width, `${what} ends inside the screen`).toBeLessThanOrEqual(WIDTH + 0.5)
  expect(Math.min(box.width, box.height), `${what} is big enough to tap`).toBeGreaterThanOrEqual(24)
}

test('mobile player: 8 turns at phone size with trade panel and disposition', async ({
  page,
  journey: j,
}) => {
  test.setTimeout(180_000)
  await installObservers(page)

  await createGame(page, j, 'Alice')
  await noHorizontalScroll(page, 'lobby')
  await reachable(page.getByTestId('add-bot-button'), '+ ADD BOT')
  await reachable(page.getByTestId('add-ai-button'), '+ ADD AI')
  await addBot(page, j)
  await addAi(page, j, 'llm:fake')
  await reachable(page.getByRole('button', { name: 'START GAME' }), 'START GAME')
  await j.shot(page, 'mobile-lobby')
  await startGame(page, j)
  await noHorizontalScroll(page, 'game start')
  await reachable(page.getByTestId('tile-rack'), 'tile rack')
  await j.shot(page, 'mobile-game-started')

  const seat = new Seat(page, j, 'alice', { maxShares: 2, cashReserve: 1200, touch: true })
  const myId = await seat.myId()
  const seen = new Set<string>()
  let traded = false

  while (seat.turnsCompleted < 8) {
    const phase = await seat.waitActionable()
    if (phase === 'GAME OVER') throw new Error('game ended before 8 turns on mobile')
    await noHorizontalScroll(page, phase)
    seen.add(phase)
    switch (phase) {
      case 'PLACE A TILE': {
        const tile = page.getByTestId('tile-rack').locator('[role="button"]').first()
        await reachable(tile, 'first playable rack tile')
        await reachable(
          page.getByTestId('trade-offers').getByRole('button', { name: 'PROPOSE TRADE' }),
          'PROPOSE TRADE'
        )
        break
      }
      case 'CHOOSE A HOTEL CHAIN':
      case 'CHOOSE THE SURVIVING HOTEL CHAIN':
        for (const b of await page.getByTestId('chain-selector').locator('button:enabled').all()) {
          await reachable(b, 'chain button')
        }
        break
      case 'DISPOSE YOUR SHARES': {
        const form = page.getByTestId('merger-disposition')
        await reachable(form.getByTestId('slider-sell-to-bank'), 'sell slider')
        await reachable(form.locator('[data-testid^="slider-trade"]'), 'trade slider')
        await reachable(form.getByTestId('confirm-disposition'), 'CONFIRM DISPOSITION')
        await j.shot(page, 'mobile-disposition')
        break
      }
      case 'BUY STOCKS': {
        for (const row of await page.locator('[data-testid^="buy-row-"]').all()) {
          await reachable(row.getByTestId('stepper-increment'), 'buy + stepper')
        }
        await reachable(page.getByTestId('end-turn-button'), 'END TURN')
        // Same trade as journey 1, through the modal at phone size.
        const holdings = await seat.holdings(myId)
        const chain = Object.keys(holdings).find((c) => holdings[c] > 0)
        if (!traded && chain && seat.turnsCompleted >= 4) {
          await page
            .getByTestId('trade-offers')
            .getByRole('button', { name: 'PROPOSE TRADE' })
            .tap()
          const builder = page.getByTestId('trade-builder')
          await expect(builder).toBeVisible()
          await noHorizontalScroll(page, 'trade modal')
          for (const b of await builder.locator('[data-testid^="player-select-"]').all()) {
            await reachable(b, 'trade partner button')
          }
          await reachable(builder.getByTestId('offer-cash-input'), 'offer cash input')
          await reachable(builder.getByTestId('propose-trade'), 'PROPOSE (modal)')
          await reachable(builder.getByTestId('cancel-trade'), 'CANCEL (modal)')
          await j.shot(page, 'mobile-trade-modal')
          await builder.getByTestId('cancel-trade').tap()
          await expect(builder).toBeHidden()
          await proposeTrade(
            seat,
            { partner: LLM, offerStocks: { [chain]: 1 }, wantCash: 100 },
            'mobile-trade'
          )
          await expect(page.getByText(`${LLM} accepted your offer`)).toBeVisible({
            timeout: 20_000,
          })
          await expect(outgoingTo(page, LLM)).toHaveCount(0)
          traded = true
          await noHorizontalScroll(page, 'after trade')
        }
        break
      }
    }
    await seat.act()
  }

  j.log(
    `mobile: ${seat.turnsCompleted} turns; screens seen ${[...seen].join(', ')}; ${JSON.stringify(seat.stats)}`
  )
  expect(traded, 'trade panel used on mobile').toBe(true)
  expect(seen.has('DISPOSE YOUR SHARES'), 'disposition UI reached on mobile').toBe(true)
  await j.shot(page, 'mobile-after-8-turns')
})
