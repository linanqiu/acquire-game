import { test, expect } from './support/test'
import { startFromSnapshot } from './support/room'
import { dollars } from './support/fixtures'
import { myCash, phaseBanner, playHumanTurns } from './support/ui'

// A page reload on a restored state must land on the same screen: the browser keeps its
// credentials in sessionStorage, reconnects, and the server re-sends state and the pending prompt.

test('reload while choosing a chain: same selector, same options, still answerable', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'found-chain-choice')
  const offered = room.fixture.expect.decisions[0].legal.chains as string[]
  await expect(page.getByTestId('chain-selector')).toBeVisible()
  await shots.take(page, 'before-reload')

  await page.reload()
  await expect(phaseBanner(page)).toHaveText('CHOOSE A HOTEL CHAIN')
  await expect(page.getByTestId('chain-selector')).toBeVisible()
  await expect(page.locator('[data-testid^="chain-button-"]:not([disabled])')).toHaveCount(
    offered.length
  )
  for (const chain of offered) {
    await expect(page.getByTestId(`chain-button-${chain.toLowerCase()}`)).toBeEnabled()
  }
  await expect(myCash(page)).toHaveText(dollars(room.fixture.expect.human.cash))
  await shots.take(page, 'after-reload')

  await page.getByTestId(`chain-button-${offered[0].toLowerCase()}`).click()
  await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
  await playHumanTurns(page, room, 3, shots)
})

test('reload during a stock disposition: the same card with the same limits comes back', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'disposition-human-first')
  const legal = room.fixture.expect.decisions[0].legal as {
    defunct_chain: string
    surviving_chain: string
    stock_count: number
    max_trade: number
  }
  await expect(page.getByTestId('merger-disposition')).toBeVisible()
  await shots.take(page, 'before-reload')

  await page.reload()
  await expect(phaseBanner(page)).toHaveText('DISPOSE YOUR SHARES')
  await expect(page.getByTestId('merger-disposition')).toHaveAttribute(
    'data-defunct',
    legal.defunct_chain
  )
  await expect(page.getByTestId('disposition-title')).toContainText(`shares: ${legal.stock_count}`)
  await expect(
    page.getByTestId(`slider-trade-2:1-for-${legal.surviving_chain.toLowerCase()}`)
  ).toHaveAttribute('max', String(legal.max_trade))
  await expect(myCash(page)).toHaveText(dollars(room.fixture.expect.human.cash))
  await shots.take(page, 'after-reload')

  // Answer it after the reload: sell everything.
  await page.getByTestId('slider-sell-to-bank').focus()
  await page.getByTestId('slider-sell-to-bank').press('End')
  await page.getByTestId('confirm-disposition').click()
  await expect(page.getByTestId('merger-disposition')).toHaveCount(0)
  await playHumanTurns(page, room, 3, shots)
})

test('reload with a trade offer waiting: the offer is still there and can be answered', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'trade-incoming-not-my-turn', { idle: ['p3'] })
  const trade = room.fixture.expect.pending_trades[0]
  await expect(page.getByTestId(`trade-offer-${trade.trade_id}`)).toBeVisible()

  await page.reload()
  await expect(page.getByTestId(`trade-offer-${trade.trade_id}`)).toBeVisible()
  await expect(page.locator('[data-testid^="trade-offer-"]')).toHaveCount(1)
  await expect(myCash(page)).toHaveText(dollars(room.fixture.expect.human.cash))
  await shots.take(page, 'after-reload')

  await page.getByTestId(`trade-accept-${trade.trade_id}`).click()
  await expect(page.getByTestId(`trade-offer-${trade.trade_id}`)).toHaveCount(0)
  await expect(myCash(page)).toHaveText(
    dollars(room.fixture.expect.human.cash - trade.requesting_money)
  )
  await playHumanTurns(page, room, 2, shots)
})

test('reload on the game-over screen: standings are still shown', async ({ page, shots }) => {
  const room = await startFromSnapshot(page, 'game-over')
  const standings = (
    room.fixture.expect.game_over as { standings: Array<{ name: string; money: number }> }
  ).standings
  await expect(page.getByTestId('game-over')).toBeVisible()

  await page.reload()
  await expect(phaseBanner(page)).toHaveText('GAME OVER')
  await expect(page.getByTestId('winner-announcement')).toContainText(standings[0].name)
  const rows = page.getByTestId('rankings').locator('[data-testid^="rank-"]')
  await expect(rows).toHaveCount(standings.length)
  for (const [i, s] of standings.entries()) {
    await expect(rows.nth(i)).toContainText(s.name)
    await expect(rows.nth(i)).toContainText(dollars(s.money))
  }
  await shots.take(page, 'after-reload')
})
