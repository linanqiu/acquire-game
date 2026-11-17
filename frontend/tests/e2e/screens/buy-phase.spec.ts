import { test, expect } from './support/test'
import { startFromSnapshot } from './support/room'
import { dollars } from './support/fixtures'
import { myCash, phaseBanner, playHumanTurns } from './support/ui'

const buyRow = (page: import('@playwright/test').Page, chain: string) =>
  page.getByTestId(`buy-row-${chain.toLowerCase()}`)
const plus = (page: import('@playwright/test').Page, chain: string) =>
  buyRow(page, chain).getByTestId('stepper-increment')
const minus = (page: import('@playwright/test').Page, chain: string) =>
  buyRow(page, chain).getByTestId('stepper-decrement')

test('buy phase: prices and availability shown, 3-share cap, buy a mix', async ({
  page,
  shots,
}) => {
  // p2 (next to play) is idle, so no other turn changes the human's cash before it is read.
  const room = await startFromSnapshot(page, 'buy-phase-multi-chain', { idle: ['p2'] })
  const { human, active_chains } = room.fixture.expect
  const chains = Object.keys(active_chains)
  await shots.take(page, 'buy-phase')

  await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
  await expect(myCash(page)).toHaveText(dollars(human.cash))
  await expect(page.getByTestId('end-turn-button')).toHaveText('SKIP & END TURN')
  await expect(page.getByTestId('purchase-shares')).toHaveText('(0/3 shares)')

  // One row per active chain, with its price, size and shares left in the bank.
  await expect(page.locator('[data-testid^="buy-row-"]')).toHaveCount(chains.length)
  for (const chain of chains) {
    const c = active_chains[chain]
    await expect(buyRow(page, chain).getByTestId('buy-price')).toHaveText(dollars(c.price))
    await expect(buyRow(page, chain).getByTestId('buy-size')).toHaveText(`${c.size} tiles`)
    await expect(buyRow(page, chain).getByTestId('buy-available')).toHaveText(`${c.available} left`)
  }

  // A chain the bank has sold out of cannot be bought at all.
  for (const chain of chains.filter((c) => active_chains[c].available === 0)) {
    await expect(plus(page, chain)).toBeDisabled()
  }

  // Buy 2 of one chain and 1 of another: after the 3rd share every + is disabled.
  const [first, second] = chains.filter((c) => active_chains[c].available >= 2)
  await plus(page, first).click()
  await plus(page, first).click()
  await plus(page, second).click()
  await expect(page.getByTestId('purchase-shares')).toHaveText('(3/3 shares)')
  for (const chain of chains) await expect(plus(page, chain)).toBeDisabled()
  await expect(page.getByTestId('buy-error-cash')).toHaveCount(0)
  const cost = 2 * active_chains[first].price + active_chains[second].price
  await expect(page.getByTestId('purchase-total')).toHaveText(`Total: ${dollars(cost)}`)
  await expect(page.getByTestId('end-turn-button')).toHaveText('BUY & END TURN')
  await shots.take(page, 'three-shares-selected')

  // Stepping one down re-enables the others; step back up to 3 and buy.
  await minus(page, second).click()
  await expect(plus(page, second)).toBeEnabled()
  await plus(page, second).click()

  await page.getByTestId('end-turn-button').click()
  await expect(phaseBanner(page)).not.toHaveText('BUY STOCKS')
  // Cash and holdings reflect the purchase; the numbers come from the fixture.
  await expect(myCash(page)).toHaveText(dollars(human.cash - cost))
  await expect(page.getByTestId(`portfolio-row-${first.toLowerCase()}`)).toContainText(
    String((human.holdings[first] ?? 0) + 2)
  )
  await expect(page.getByTestId(`portfolio-row-${second.toLowerCase()}`)).toContainText(
    String((human.holdings[second] ?? 0) + 1)
  )
  await shots.take(page, 'bought')

  // Two more complete turns.
  await playHumanTurns(page, room, 2, shots)
})

test('buy phase: skip buying keeps cash and ends the turn', async ({ page, shots }) => {
  // The next seat (p2) is idle, so no other turn (e.g. a merger paying the human a bonus) can
  // change the human's cash before it is read.
  const room = await startFromSnapshot(page, 'buy-phase-multi-chain', { idle: ['p2'] })
  const { human } = room.fixture.expect
  await shots.take(page, 'buy-phase')
  await page.getByTestId('end-turn-button').click()
  await expect(phaseBanner(page)).not.toHaveText('BUY STOCKS')
  await expect(myCash(page)).toHaveText(dollars(human.cash))
  await shots.take(page, 'skipped')
  await playHumanTurns(page, room, 2, shots)
})

test('low cash: cannot afford any stock, steppers locked, skipping still works', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'low-cash')
  const { human, active_chains } = room.fixture.expect
  const chains = Object.keys(active_chains)
  await shots.take(page, 'low-cash')

  await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
  await expect(myCash(page)).toHaveText(dollars(human.cash))
  // Every chain is shown with its price, but none can be increased.
  for (const chain of chains) {
    await expect(buyRow(page, chain).getByTestId('buy-price')).toHaveText(
      dollars(active_chains[chain].price)
    )
    await expect(plus(page, chain)).toBeDisabled()
    await expect(minus(page, chain)).toBeDisabled()
  }
  await expect(page.getByTestId('buy-note-no-cash')).toBeVisible()
  await expect(page.getByTestId('purchase-total')).toHaveText('Total: $0')
  await expect(page.getByTestId('end-turn-button')).toBeEnabled()

  await page.getByTestId('end-turn-button').click()
  await expect(phaseBanner(page)).not.toHaveText('BUY STOCKS')
  await playHumanTurns(page, room, 2, shots)
})
