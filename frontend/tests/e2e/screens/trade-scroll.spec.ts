/**
 * Tier 3 (BL-021): "The trading UI keeps scrolling up and down." While I read down the Trades
 * tab or compose an offer, nothing but my own action moves the page or changes the tab: not an
 * offer made to me, not its withdrawal, not the other seats' turns, not the start of my own.
 * What is new is counted on the tabs and the phase bar is the way to it.
 *
 * Measured before the fix (390x675, touch): an offer for me threw the page from the Trades tab,
 * scrolled to 109, to the Board tab at 0; its withdrawal threw a reader at 150 back to 0; the
 * start of my turn switched to the Board; and with the builder open the tab changed under it.
 * The builder itself was a sheet whose rows scrolled inside it (869px of rows in a 523px box
 * with six chains a side): every offer meant scrolling down to "You want" and back. The
 * composer that replaced it (BL-021) is part of the page and fits the screen.
 *
 * Setup (tier 3 only): snapshot fixture, idle human seats driven through the action route. The
 * browser player uses the UI only.
 */
import type { Page } from '@playwright/test'
import { test, expect } from './support/test'
import { startFromSnapshot, type RoomContext } from './support/room'
import { phaseBanner } from './support/ui'
import { openTab, tab, tabBadge } from '../support/tabs'

const PHONE = { width: 390, height: 675 }
const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY))

/** One whole turn of an idle seat through the action route: a tile, a chain if asked, no buy. */
async function playTurn(room: RoomContext, seat: string) {
  const id = room.seatMap[seat]
  const snap = await room.liveSnapshot()
  expect(snap.players[snap.current_player_index].player_id, `${seat} is on turn`).toBe(id)
  const hand = snap.players.find((p) => p.player_id === id)!.hand
  let placed = false
  for (const tile of hand) {
    if ((await room.act(id, { action: 'place_tile', tile })).status === 'ok') {
      placed = true
      break
    }
  }
  expect(placed, `${seat} placed a tile`).toBe(true)
  const pending = (await room.liveSnapshot()).pending_action
  if (pending?.type === 'found_chain') {
    const chain = (pending.available_chains as string[])[0]
    expect((await room.act(id, { action: 'found_chain', chain })).status).toBe('ok')
  }
  expect((await room.act(id, { action: 'end_turn' })).status, `${seat} ends the turn`).toBe('ok')
  console.log(`[${seat}] played a turn`)
}

/** More open offers at the table, so the Trades tab is longer than the screen. */
async function fillTheTable(room: RoomContext) {
  const s = room.seatMap
  const offers = [
    { from: s.p4, to: s.p2, offering_stocks: { sandpiper: 1 }, requesting_money: 300 },
    { from: s.p4, to: s.p3, offering_stocks: { aurelia: 1 }, requesting_money: 500 },
    { from: s.p2, to: s.p4, offering_money: 900, requesting_stocks: { aurelia: 2 } },
    { from: s.p2, to: s.p3, offering_money: 700, requesting_stocks: { aurelia: 1 } },
    { from: room.humanId, to: s.p2, offering_stocks: { sandpiper: 1 }, requesting_money: 500 },
  ]
  for (const { from, to, ...terms } of offers) {
    const res = await room.act(from, { action: 'propose_trade', to_player_id: to, ...terms })
    expect(res.status, JSON.stringify(res)).not.toBe('error')
  }
}

test.describe('phone (touch, mobile viewport)', () => {
  test.use({ hasTouch: true, isMobile: true })

  test('reading down the Trades tab: offers, withdrawals and turns at the table leave the page and the tab where they are', async ({
    page,
    shots,
  }) => {
    const room = await startFromSnapshot(page, 'trade-between-others', {
      idle: ['p2', 'p3', 'p4'],
      viewport: PHONE,
    })
    const s = room.seatMap
    await fillTheTable(room)
    // My turn first (my own action may move the page): buy nothing, end the turn.
    await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
    await page.getByTestId('end-turn-button').click()
    await expect(phaseBanner(page)).not.toHaveText('BUY STOCKS')

    await openTab(page, 'trades', { tap: true })
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    expect(height, 'the Trades tab is longer than the screen').toBeGreaterThan(PHONE.height + 60)
    await page.evaluate(() => window.scrollTo(0, 60))
    expect(await scrollY(page)).toBe(60)
    await shots.take(page, 'reading-scrolled', { fullPage: false })
    // What I am reading: the first offer of the list, and where it is on the screen.
    const reading = page.locator('[data-testid="trade-offers"] [data-testid^="trade-"]').first()
    const top = async () => Math.round((await reading.boundingBox())!.y)
    const readingAt = await top()
    const stays = async (what: string) => {
      await expect(tab(page, 'trades'), `${what}: still on Trades`).toHaveAttribute(
        'aria-selected',
        'true'
      )
      expect(await scrollY(page), `${what}: the page has not moved`).toBe(60)
      expect(await top(), `${what}: what I read is where it was`).toBe(readingAt)
      console.log(`[stays] ${what}: Trades tab, scrollY 60, the offer I read at y=${readingAt}`)
    }

    // An offer for me arrives: counted on the tab, the page stays.
    const offer = await room.act(s.p3, {
      action: 'propose_trade',
      to_player_id: room.humanId,
      offering_stocks: { aurelia: 1 },
      requesting_money: 300,
      trade_id: 'for-me',
    })
    expect(offer.status, JSON.stringify(offer)).not.toBe('error')
    await expect(tabBadge(page, 'trades')).toHaveText('1')
    // It is listed at the foot of the offers, with its answers, under what I was reading.
    await expect(
      page.locator('[data-testid="trade-offers"] > [data-testid^="trade-"]').last()
    ).toHaveAttribute('data-testid', 'trade-table-for-me')
    await expect(page.getByTestId('trade-table-accept-for-me')).toBeEnabled()
    await stays('an offer for me')
    await shots.take(page, 'offer-for-me-arrived', { fullPage: false })

    // It is withdrawn again.
    const gone = await room.act(s.p3, { action: 'cancel_trade', trade_id: 'for-me' })
    expect(gone.status, JSON.stringify(gone)).not.toBe('error')
    await expect(tabBadge(page, 'trades')).toHaveCount(0)
    await stays('the offer withdrawn')

    // The others play their turns; then mine starts: the phase bar says so and is the way
    // to the board, which carries a marker. The page does not go there by itself.
    for (const seat of ['p2', 'p3', 'p4']) {
      await playTurn(room, seat)
      await stays(`${seat}'s turn`)
    }
    await expect(phaseBanner(page)).toHaveText('PLACE A TILE')
    await expect(tabBadge(page, 'board')).toBeVisible()
    await stays('my turn started')
    await shots.take(page, 'my-turn-started-still-reading', { fullPage: false })

    // My own tap takes me there, at the top.
    await page.getByTestId('phase-link').tap()
    await expect(tab(page, 'board')).toHaveAttribute('aria-selected', 'true')
    expect(await scrollY(page)).toBe(0)
    await shots.take(page, 'board-by-my-own-tap', { fullPage: false })
  })

  test('composing an offer: turns and offers at the table leave the composer, its contents and the tab untouched', async ({
    page,
    shots,
  }) => {
    const room = await startFromSnapshot(page, 'trade-between-others', {
      idle: ['p2', 'p3', 'p4'],
      viewport: PHONE,
    })
    const s = room.seatMap
    await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
    await page.getByTestId('end-turn-button').click()
    await expect(phaseBanner(page)).not.toHaveText('BUY STOCKS')

    await openTab(page, 'trades', { tap: true })
    // An offer to Dev (a tap on the name in the holdings table): one of my Sandpiper for $700.
    await page.getByTestId(`trade-start-${s.p4}`).tap()
    const builder = page.getByTestId('trade-builder')
    await expect(builder).toBeVisible()
    await builder.getByTestId('offer-add-sandpiper').tap()
    const give = builder.getByTestId('offer-stock-sandpiper')
    await page.getByTestId('want-cash-input').fill('700')
    await expect(page.getByTestId('trade-effect-sandpiper')).toBeVisible()
    await page.getByTestId('want-cash-input').blur()
    await shots.take(page, 'composing', { fullPage: false })
    // Where the send button is on the screen: it must not move under the thumb.
    const send = page.getByTestId('propose-trade')
    const sendAt = (await send.boundingBox())!.y

    const untouched = async (what: string) => {
      await expect(builder, `${what}: the composer is still open`).toBeVisible()
      await expect(
        builder.getByTestId(`player-select-${s.p4}`),
        `${what}: the partner`
      ).toHaveAttribute('aria-pressed', 'true')
      await expect(give.getByTestId('stepper-value'), `${what}: the shares`).toHaveText('1')
      await expect(page.getByTestId('want-cash-input'), `${what}: the cash`).toHaveValue('700')
      await expect(tab(page, 'trades'), `${what}: still on Trades`).toHaveAttribute(
        'aria-selected',
        'true'
      )
      expect(await scrollY(page), `${what}: the page has not moved`).toBe(0)
      expect((await send.boundingBox())!.y, `${what}: the send button is where it was`).toBe(sendAt)
      console.log(`[untouched] ${what}`)
    }

    // The others play; an offer for me arrives; my own turn starts.
    await playTurn(room, 'p2')
    await untouched("p2's turn")
    const offer = await room.act(s.p3, {
      action: 'propose_trade',
      to_player_id: room.humanId,
      offering_stocks: { aurelia: 1 },
      requesting_money: 300,
      trade_id: 'for-me',
    })
    expect(offer.status, JSON.stringify(offer)).not.toBe('error')
    await expect(tabBadge(page, 'trades')).toHaveText('1')
    await untouched('an offer for me')
    await playTurn(room, 'p3')
    await playTurn(room, 'p4')
    await expect(phaseBanner(page)).toHaveText('PLACE A TILE')
    await untouched('my turn started')
    await shots.take(page, 'my-turn-started-still-composing', { fullPage: false })

    // Putting the offer away leaves me where I was: on the Trades tab, where the offer made
    // to me meanwhile is listed with its answers.
    await page.getByTestId('cancel-trade').tap()
    await expect(builder).toHaveCount(0)
    await expect(tab(page, 'trades')).toHaveAttribute('aria-selected', 'true')
    await expect(tabBadge(page, 'board')).toBeVisible()
    await expect(page.getByTestId('trade-table-accept-for-me')).toBeEnabled()
    await shots.take(page, 'composer-closed-still-on-trades', { fullPage: false })
  })
})
