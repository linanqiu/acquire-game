import type { Page } from '@playwright/test'
import { test, expect } from './support/test'
import { startFromSnapshot, type RoomContext } from './support/room'
import { dollars } from './support/fixtures'
import { headerCash, phaseBanner, playHumanTurns } from './support/ui'

const ALL_CHAINS = ['sandpiper', 'marlowe', 'halcyon', 'meridian', 'juniper', 'obsidian', 'aurelia']

interface DispositionLegal {
  defunct_chain: string
  surviving_chain: string
  stock_count: number
  max_trade: number
}

const sellSlider = (page: Page) => page.getByTestId('slider-sell-to-bank')
const tradeSlider = (page: Page, survivor: string) =>
  page.getByTestId(`slider-trade-2:1-for-${survivor.toLowerCase()}`)

/** The disposition card shows what the fixture's decision says. */
async function expectDispositionCard(page: Page, room: RoomContext) {
  const { decisions, active_chains, human } = room.fixture.expect
  const d = decisions[0]
  const legal = d.legal as unknown as DispositionLegal
  const defunct = legal.defunct_chain
  const survivor = legal.surviving_chain
  const card = page.getByTestId('merger-disposition')

  await expect(phaseBanner(page)).toHaveText('DISPOSE YOUR SHARES')
  await expect(page.getByText(`DISPOSE OF YOUR ${defunct.toUpperCase()} SHARES`)).toBeVisible()
  await expect(card).toContainText(`You have: ${legal.stock_count}`)
  await expect(card).toContainText(
    `Price at merger: ${dollars(active_chains[defunct].price)}/share`
  )
  await expect(card).toContainText(String(d.context.available_to_trade))
  await expect(headerCash(page)).toHaveText(dollars(human.cash))

  // Controls: sell is bounded by what is held; trade by the engine's max_trade, in steps of 2;
  // everything undecided is held, so sell + trade + hold always equals the holding.
  await expect(sellSlider(page)).toHaveAttribute('max', String(legal.stock_count))
  await expect(tradeSlider(page, survivor)).toHaveAttribute('max', String(legal.max_trade))
  await expect(tradeSlider(page, survivor)).toHaveAttribute('step', '2')
  await expect(page.getByTestId('hold-display')).toContainText(`${legal.stock_count} share`)
  await expect(page.getByTestId('disposition-summary')).toContainText(
    `SELL 0 (+$0) | TRADE 0 (+0 ${survivor.toUpperCase()}) | HOLD ${legal.stock_count}`
  )
  return { legal, defunct, survivor, price: active_chains[defunct].price }
}

/** Move a range slider the way a keyboard user does: Home, then one arrow press per step. */
async function setSlider(page: Page, testId: string, value: number) {
  const slider = page.getByTestId(testId)
  const step = Number(await slider.getAttribute('step'))
  await slider.focus()
  await slider.press('Home')
  for (let i = 0; i < value / step; i++) await slider.press('ArrowRight')
}

test('merger: tie between two equal chains, human picks the survivor', async ({ page, shots }) => {
  const room = await startFromSnapshot(page, 'merger-survivor-tie')
  const { decisions, human } = room.fixture.expect
  const tied = decisions[0].legal.chains as string[]
  await shots.take(page, 'survivor-choice')

  await expect(phaseBanner(page)).toHaveText('CHOOSE THE SURVIVING HOTEL CHAIN')
  await expect(page.getByTestId('chain-selector')).toBeVisible()
  // Exactly the tied chains can be picked; the rest are labelled as not part of the tie.
  for (const chain of ALL_CHAINS) {
    const button = page.getByTestId(`chain-button-${chain.toLowerCase()}`)
    if (tied.includes(chain)) {
      await expect(button).toBeEnabled()
    } else {
      await expect(button).toBeDisabled()
      await expect(button).toContainText('NOT TIED')
    }
  }
  await expect(page.locator('[data-testid^="chain-button-"]:not([disabled])')).toHaveCount(
    tied.length
  )

  // Pick the survivor; the other tied chain is absorbed and the human (who holds it) is asked
  // what to do with that stock.
  const [survivor, defunct] = [tied[1], tied[0]]
  await page.getByTestId(`chain-button-${survivor.toLowerCase()}`).click()
  expect(human.holdings[defunct] ?? 0).toBeGreaterThan(0)
  await expect(phaseBanner(page)).toHaveText('DISPOSE YOUR SHARES')
  await expect(page.getByText(`DISPOSE OF YOUR ${defunct.toUpperCase()} SHARES`)).toBeVisible()
  await expect(page.getByTestId('merger-disposition')).toContainText(
    `You have: ${human.holdings[defunct]}`
  )
  await shots.take(page, 'disposition-after-choice')

  await page.getByTestId('confirm-disposition').click()
  // Merger finishes; carry on with real turns.
  await playHumanTurns(page, room, 3, shots)
})

test('disposition (human first): sell/trade/hold limits and a mixed disposition', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'disposition-human-first')
  const { human } = room.fixture.expect
  const { legal, defunct, survivor, price } = await expectDispositionCard(page, room)
  await shots.take(page, 'disposition-initial')

  // Trade at its cap, then selling more shrinks the trade so the total never exceeds the holding.
  const tradeId = `slider-trade-2:1-for-${survivor.toLowerCase()}`
  await setSlider(page, tradeId, legal.max_trade)
  await expect(tradeSlider(page, survivor)).toHaveValue(String(legal.max_trade))
  await setSlider(page, 'slider-sell-to-bank', 5)
  const remaining = legal.stock_count - 5
  const tradeAfter = Number(await tradeSlider(page, survivor).inputValue())
  expect(tradeAfter).toBeLessThanOrEqual(remaining)
  expect(tradeAfter % 2).toBe(0)
  await expect(page.getByTestId('disposition-summary')).toContainText(`SELL 5`)
  await shots.take(page, 'trade-clamped-by-sell')

  // The trade slider only moves in pairs: one arrow press from zero is 2, never 1.
  await tradeSlider(page, survivor).press('Home')
  await tradeSlider(page, survivor).press('ArrowRight')
  await expect(tradeSlider(page, survivor)).toHaveValue('2')

  // Final mixed disposition: sell 3, trade 6 (-> 3 survivor shares), hold the rest.
  const sell = 3
  const trade = 6
  const hold = legal.stock_count - sell - trade
  await setSlider(page, 'slider-sell-to-bank', sell)
  await setSlider(page, tradeId, trade)
  await expect(page.getByTestId('disposition-summary')).toContainText(
    `SELL ${sell} (+${dollars(sell * price)}) | TRADE ${trade} (+${trade / 2} ${survivor.toUpperCase()}) | HOLD ${hold}`
  )
  await expect(page.getByTestId('hold-display')).toContainText(`${hold} share`)
  await shots.take(page, 'mixed-disposition')
  await page.getByTestId('confirm-disposition').click()

  // Cash from the sale, survivor shares from the trade, the rest still held.
  await expect(headerCash(page)).toHaveText(dollars(human.cash + sell * price))
  await expect(page.getByTestId(`portfolio-row-${survivor.toLowerCase()}`)).toContainText(
    String((human.holdings[survivor] ?? 0) + trade / 2)
  )
  await expect(page.getByTestId(`portfolio-row-${defunct.toLowerCase()}`)).toContainText(
    String(hold)
  )
  await shots.take(page, 'after-disposition')
  await playHumanTurns(page, room, 3, shots)
})

test('disposition (trade limited by the bank): trade capped below the holding', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'disposition-trade-limited')
  const { human } = room.fixture.expect
  const { legal, defunct, survivor, price } = await expectDispositionCard(page, room)
  // The fixture's point: the cap is below what the player could otherwise trade.
  expect(legal.max_trade).toBeLessThan(legal.stock_count)
  await shots.take(page, 'disposition-initial')

  const tradeId = `slider-trade-2:1-for-${survivor.toLowerCase()}`
  await page.getByTestId(tradeId).press('End') // push the slider as far as it will go
  await expect(tradeSlider(page, survivor)).toHaveValue(String(legal.max_trade))
  await expect(page.getByTestId('disposition-summary')).toContainText(
    `TRADE ${legal.max_trade} (+${legal.max_trade / 2} ${survivor.toUpperCase()})`
  )
  await shots.take(page, 'trade-at-cap')

  // Trade the cap, sell 2, hold whatever is left.
  const sell = 2
  const trade = legal.max_trade
  const hold = legal.stock_count - sell - trade
  await setSlider(page, 'slider-sell-to-bank', sell)
  await expect(page.getByTestId('disposition-summary')).toContainText(
    `SELL ${sell} (+${dollars(sell * price)}) | TRADE ${trade} (+${trade / 2} ${survivor.toUpperCase()}) | HOLD ${hold}`
  )
  await page.getByTestId('confirm-disposition').click()
  await expect(headerCash(page)).toHaveText(dollars(human.cash + sell * price))
  await expect(page.getByTestId(`portfolio-row-${survivor.toLowerCase()}`)).toContainText(
    String((human.holdings[survivor] ?? 0) + trade / 2)
  )
  if (hold > 0) {
    await expect(page.getByTestId(`portfolio-row-${defunct.toLowerCase()}`)).toContainText(
      String(hold)
    )
  }
  await shots.take(page, 'after-disposition')
  await playHumanTurns(page, room, 3, shots)
})

test('multi-chain merger: nothing to trade for, sell it all, then the next defunct chain resolves', async ({
  page,
  shots,
}) => {
  // p2 is an idle human seat so the second round of the merger (the next defunct chain) stays
  // visible on screen until the test lets p2 answer.
  const room = await startFromSnapshot(page, 'multi-chain-merger', { idle: ['p2'] })
  const { human } = room.fixture.expect
  const { legal, defunct, survivor, price } = await expectDispositionCard(page, room)
  await shots.take(page, 'first-defunct-chain')

  // The survivor is sold out in the bank, so trading is not possible.
  expect(legal.max_trade).toBe(0)
  await expect(tradeSlider(page, survivor)).toBeDisabled()
  const merger = room.fixture.snapshot.merger as { defunct_queue: string[] }
  expect(merger.defunct_queue.length).toBeGreaterThan(0) // a second defunct chain is queued

  await setSlider(page, 'slider-sell-to-bank', legal.stock_count)
  await expect(page.getByTestId('disposition-summary')).toContainText(
    `SELL ${legal.stock_count} (+${dollars(legal.stock_count * price)}) | TRADE 0 (+0 ${survivor.toUpperCase()}) | HOLD 0`
  )
  await shots.take(page, 'sell-everything')
  await page.getByTestId('confirm-disposition').click()
  await expect(headerCash(page)).toHaveText(dollars(human.cash + legal.stock_count * price))
  // Nothing of the defunct chain is left.
  await expect(page.getByTestId(`portfolio-row-${defunct.toLowerCase()}`)).toHaveCount(0)

  // Now the human has nothing more to decide; the merger waits on the idle seat and the page says so.
  await expect(page.getByTestId('merger-disposition')).toHaveCount(0)
  await expect(page.getByTestId('waiting-message')).toContainText(/Waiting for .+ to /)
  await shots.take(page, 'waiting-for-others')

  // Let p2 answer (and everything after) so the game moves on: the human must get a real turn.
  await playHumanTurns(page, room, 3, shots)
})

test('disposition (waiting): another stockholder decides first; the page names them, then it is my turn to dispose', async ({
  page,
  shots,
}) => {
  // p3 (the player the engine is waiting on) is an idle human seat, so the waiting state is stable.
  const room = await startFromSnapshot(page, 'disposition-waiting-on-other', { idle: ['p3'] })
  const { decisions, human } = room.fixture.expect
  const waitingOn = room.names[room.seatMap[decisions[0].player_id]]
  await shots.take(page, 'waiting')

  // No decision for me yet: no disposition card; the page says who the game is waiting for.
  await expect(page.getByTestId('merger-disposition')).toHaveCount(0)
  await expect(page.getByTestId('waiting-message')).toHaveText(
    `Waiting for ${waitingOn} to dispose of their shares...`
  )
  await expect(phaseBanner(page)).not.toHaveText('DISPOSE YOUR SHARES')
  await expect(headerCash(page)).toHaveText(dollars(human.cash))

  // p3 answers (what an opponent does outside the browser); then it is my turn to dispose.
  expect(await room.driveIdle()).toBe(true)
  await expect(phaseBanner(page)).toHaveText('DISPOSE YOUR SHARES')
  await expect(page.getByTestId('merger-disposition')).toBeVisible()
  await expect(page.getByTestId('waiting-message')).toHaveCount(0)
  await shots.take(page, 'my-disposition')
  await page.getByTestId('confirm-disposition').click()
  await playHumanTurns(page, room, 3, shots)
})
