/**
 * Tier 3: trading (BL-012 public offers, BL-021 the trade composer).
 *
 * An offer starts in the Trades tab's holdings table (a player, or a number in their row), is
 * composed in place (who with, "You give" | "You get", cash), with what it would do next to the
 * button that sends it, and is answered in place: ACCEPT / REJECT / COUNTER on the offer itself.
 * No dialog opens over the game and no box scrolls inside the page.
 *
 * Setup (tier 3 only): snapshot fixtures; opponents are scripted seats, idle human seats driven
 * through the action route, or the real rules-based bot. The browser player uses the UI only.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect } from './support/test'
import { startFromSnapshot, type RoomContext } from './support/room'
import { dollars, loadFixture } from './support/fixtures'
import { myCash, phaseBanner, playHumanTurns } from './support/ui'
import { clippedBy, expectNoInnerScroll, layoutProblems, pageFrameProblems } from './support/layout'
import { openTab, tab, tabBadge } from '../support/tabs'

/** Latest toast containing `text` (an earlier identical toast may still be fading out). */
const toast = (page: Page, text: string | RegExp) =>
  page.getByRole('alert').filter({ hasText: text }).last()

const composer = (page: Page): Locator => page.getByTestId('trade-builder')
/** The stepper line of a chain that is in the deal. */
const line = (page: Page, side: 'offer' | 'want', chain: string): Locator =>
  composer(page).getByTestId(`${side}-stock-${chain}`)
/** Put `n` more shares of `chain` into one side of the deal: a tap on its chip for each. */
async function add(page: Page, side: 'offer' | 'want', chain: string, n = 1) {
  for (let i = 0; i < n; i++) await composer(page).getByTestId(`${side}-add-${chain}`).click()
}
/** Start an offer to a seat from the holdings table (its name). */
async function startOfferTo(page: Page, room: RoomContext, seat: string) {
  await page.getByTestId(`trade-start-${room.seatMap[seat]}`).click()
  await expect(composer(page)).toBeVisible()
  await expect(composer(page).getByTestId(`player-select-${room.seatMap[seat]}`)).toHaveAttribute(
    'aria-pressed',
    'true'
  )
}

const incomingTrade = (room: RoomContext) => {
  const t = room.fixture.expect.pending_trades[0]
  expect(t.to_player_id).toBe(room.fixture.human_seat)
  return t
}

/** Offer card shows who offers what for what, read from the fixture's trade. */
async function expectIncomingCard(page: Page, room: RoomContext) {
  const trade = incomingTrade(room)
  const card = page.getByTestId(`trade-offer-${trade.trade_id}`)
  await expect(card).toBeVisible()
  // An offer for me is a decision: it shows in the decision tab (BL-011), and the Trades tab
  // carries the count.
  await expect(page.getByTestId('decision-view').getByTestId('trade-incoming')).toContainText(
    room.names[room.seatMap[trade.from_player_id]]
  )
  await expect(tabBadge(page, 'trades')).toHaveText('1')
  // One offer, one card: the card names who offers (no count or title over it, BL-017).
  await expect(page.locator('[data-testid^="trade-offer-"]')).toHaveCount(1)
  await expect(card).toContainText('offers you a trade')
  await expect(card).toContainText(room.names[room.seatMap[trade.from_player_id]])
  for (const [chain, qty] of Object.entries(trade.offering_stocks)) {
    await expect(card.getByTestId(`trade-stock-${chain}`)).toContainText(`×${qty}`)
  }
  if (trade.requesting_money > 0) await expect(card).toContainText(dollars(trade.requesting_money))
  // Everything to answer it is on the card.
  await expect(page.getByTestId(`trade-accept-${trade.trade_id}`)).toBeEnabled()
  await expect(page.getByTestId(`trade-reject-${trade.trade_id}`)).toBeEnabled()
  await expect(page.getByTestId(`trade-counter-${trade.trade_id}`)).toBeEnabled()
  return trade
}

test('incoming offer on my turn: accept it, cash and shares change, turn goes on', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'trade-incoming')
  const { human } = room.fixture.expect
  await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
  const trade = await expectIncomingCard(page, room)
  await shots.take(page, 'incoming-offer')

  await page.getByTestId(`trade-accept-${trade.trade_id}`).click()
  await expect(page.getByTestId(`trade-offer-${trade.trade_id}`)).toHaveCount(0)
  await expect(page.getByTestId('trade-incoming')).toHaveCount(0)
  await expect(tabBadge(page, 'trades')).toHaveCount(0)
  await expect(myCash(page)).toHaveText(dollars(human.cash - trade.requesting_money))
  for (const [chain, qty] of Object.entries(trade.offering_stocks)) {
    await expect(page.getByTestId(`portfolio-row-${chain.toLowerCase()}`)).toContainText(
      String((human.holdings[chain] ?? 0) + qty)
    )
  }
  await expect(toast(page, /completed/)).toBeVisible()
  await shots.take(page, 'accepted')

  // Still my buy phase: finish the turn and play two more.
  await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
  await playHumanTurns(page, room, 3, shots)
})

test('incoming offer on my turn: reject it, nothing changes', async ({ page, shots }) => {
  const room = await startFromSnapshot(page, 'trade-incoming')
  const { human } = room.fixture.expect
  const trade = await expectIncomingCard(page, room)
  await shots.take(page, 'incoming-offer')

  await page.getByTestId(`trade-reject-${trade.trade_id}`).click()
  await expect(page.getByTestId(`trade-offer-${trade.trade_id}`)).toHaveCount(0)
  await expect(page.getByTestId('trade-incoming')).toHaveCount(0)
  await expect(tabBadge(page, 'trades')).toHaveCount(0)
  await expect(toast(page, 'Offer rejected')).toBeVisible()
  await expect(myCash(page)).toHaveText(dollars(human.cash))
  await openTab(page, 'chains')
  await expect(page.getByTestId('portfolio-empty')).toBeVisible()
  await shots.take(page, 'rejected')
  await playHumanTurns(page, room, 3, shots)
})

test('incoming offer while another player is on turn: accept', async ({ page, shots }) => {
  // p3 (whose turn it is) is an idle seat so the not-my-turn state stays put.
  const room = await startFromSnapshot(page, 'trade-incoming-not-my-turn', { idle: ['p3'] })
  const { human, current_player } = room.fixture.expect
  const trade = await expectIncomingCard(page, room)
  const onTurn = new RegExp(`^${room.names[room.seatMap[current_player]].toUpperCase()} IS `)
  await expect(phaseBanner(page)).toHaveText(onTurn)
  await expect(phaseBanner(page)).toHaveAttribute('data-turn', 'other')
  await expect(page.getByTestId('end-turn-button')).toHaveCount(0) // not my buy phase
  await shots.take(page, 'offer-not-my-turn')

  await page.getByTestId(`trade-accept-${trade.trade_id}`).click()
  await expect(page.getByTestId(`trade-offer-${trade.trade_id}`)).toHaveCount(0)
  await expect(myCash(page)).toHaveText(dollars(human.cash - trade.requesting_money))
  for (const [chain, qty] of Object.entries(trade.offering_stocks)) {
    await expect(page.getByTestId(`portfolio-row-${chain.toLowerCase()}`)).toContainText(
      String((human.holdings[chain] ?? 0) + qty)
    )
  }
  // Accepting did not take anyone's turn: it is still the same player's.
  await expect(phaseBanner(page)).toHaveText(onTurn)
  await shots.take(page, 'accepted-not-my-turn')
  await playHumanTurns(page, room, 2, shots)
})

test('incoming offer while another player is on turn: reject', async ({ page, shots }) => {
  const room = await startFromSnapshot(page, 'trade-incoming-not-my-turn', { idle: ['p3'] })
  const { human } = room.fixture.expect
  const trade = await expectIncomingCard(page, room)
  await page.getByTestId(`trade-reject-${trade.trade_id}`).click()
  await expect(page.getByTestId(`trade-offer-${trade.trade_id}`)).toHaveCount(0)
  await expect(toast(page, 'Offer rejected')).toBeVisible()
  await expect(myCash(page)).toHaveText(dollars(human.cash))
  await shots.take(page, 'rejected-not-my-turn')
  await playHumanTurns(page, room, 2, shots)
})

test('an offer for me says what it does to first and second place, and COUNTER opens my own answer: the same deal reversed', async ({
  page,
  shots,
}) => {
  // Cara offers me 2 Aurelia for $800. She and Dev are idle seats, so nothing is answered
  // until this test says so.
  const room = await startFromSnapshot(page, 'trade-incoming', {
    idle: ['p3', 'p4'],
    viewport: { width: 390, height: 675 },
  })
  const { human, chain_holders } = room.fixture.expect
  const trade = await expectIncomingCard(page, room)
  const cara = room.names[room.seatMap[trade.from_player_id]]
  // Aurelia before: Cara 4 (1st), Dev 2 (2nd), me none. After: all three hold 2.
  expect(chain_holders.aurelia.holders.map((h) => h.shares)).toEqual([4, 2])
  const effects = page.getByTestId(`trade-effects-offer-${trade.trade_id}`)
  await expect(effects).toContainText(
    `Aurelia: You tie for 1st · ${cara} drops to a tie for 1st · Dev ties for 1st`
  )
  // The whole decision is on screen with the board: nothing to scroll to answer.
  for (const id of ['accept', 'counter', 'reject']) {
    await expect(page.getByTestId(`trade-${id}-${trade.trade_id}`)).toBeInViewport({ ratio: 1 })
    expect(
      (await page.getByTestId(`trade-${id}-${trade.trade_id}`).boundingBox())!.height
    ).toBeGreaterThanOrEqual(44)
  }
  await shots.take(page, 'incoming-offer-with-effects', { fullPage: false })

  // COUNTER: my own tap opens the Trades tab on the composer, filled in and reversed.
  await page.getByTestId(`trade-counter-${trade.trade_id}`).click()
  await expect(tab(page, 'trades')).toHaveAttribute('aria-selected', 'true')
  await expect(composer(page)).toBeVisible()
  await expect(composer(page)).toHaveAccessibleName('Counter-offer')
  await expect(page.getByTestId('trade-started-from')).toHaveText(
    `Your answer to ${cara}'s offer. Sending it turns theirs down.`
  )
  await expect(
    composer(page).getByTestId(`player-select-${room.seatMap[trade.from_player_id]}`)
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('offer-cash-input')).toHaveValue(String(trade.requesting_money))
  await expect(line(page, 'want', 'aurelia').getByTestId('stepper-value')).toHaveText('2')
  await expect(page.getByTestId('trade-effect-aurelia')).toContainText('You tie for 1st')
  await shots.take(page, 'counter-offer-prefilled', { fullPage: false })

  // I ask for the same shares for $600.
  await page.getByTestId('offer-cash-less').click()
  await page.getByTestId('offer-cash-less').click()
  await expect(page.getByTestId('offer-cash-input')).toHaveValue('600')
  await expect(page.getByTestId('trade-give-value')).toHaveText('$600')
  await shots.take(page, 'counter-offer-changed', { fullPage: false })
  await page.getByTestId('propose-trade').click()
  await expect(composer(page)).toHaveCount(0)
  await expect(toast(page, `Offer sent to ${cara}`)).toBeVisible()
  // Sending it turned theirs down: nothing waits for my answer; mine waits for hers.
  await expect(page.getByTestId(`trade-table-${trade.trade_id}`)).toHaveCount(0)
  await expect(tabBadge(page, 'trades')).toHaveCount(0)
  const outgoing = page.locator('[data-testid^="trade-outgoing-"]')
  await expect(outgoing).toHaveCount(1)
  await expect(outgoing).toContainText('$600')
  await expect(outgoing.getByTestId('trade-stock-aurelia')).toContainText('×2')
  const live = await room.liveSnapshot()
  expect(live.pending_trades).toHaveLength(1)
  await expect(page.getByTestId('trade-activity')).toContainText(
    `${human.name} rejected ${cara}'s offer: 2 Aurelia for $800.`
  )
  await shots.take(page, 'counter-offer-sent', { fullPage: false })

  // She takes it.
  const mine = live.pending_trades.map((t) => (t.trade ?? t) as Record<string, unknown>)[0]
  expect(mine.from_player_id).toBe(room.humanId)
  const accepted = await room.act(room.seatMap[trade.from_player_id], {
    action: 'accept_trade',
    trade_id: mine.trade_id,
  })
  expect(accepted.status, JSON.stringify(accepted)).not.toBe('error')
  await expect(toast(page, `${cara} accepted your offer`)).toBeVisible()
  await expect(outgoing).toHaveCount(0)
  await openTab(page, 'board')
  await expect(myCash(page)).toHaveText(dollars(human.cash - 600))
  await shots.take(page, 'counter-offer-accepted', { fullPage: false })
})

test('outgoing offer stays pending until withdrawn', async ({ page, shots }) => {
  // The recipient (p2) is an idle seat: nobody answers, so the offer stays pending.
  const room = await startFromSnapshot(page, 'trade-outgoing-pending', { idle: ['p2'] })
  const { human, pending_trades } = room.fixture.expect
  const trade = pending_trades[0]
  // My own offers are in the Trades tab (no badge: nothing waits for my answer).
  await expect(tabBadge(page, 'trades')).toHaveCount(0)
  await openTab(page, 'trades')
  const card = page.getByTestId(`trade-outgoing-${trade.trade_id}`)
  await expect(card).toBeVisible()
  await expect(card).toContainText('waiting')
  await expect(card).toContainText(room.names[room.seatMap[trade.to_player_id]])
  for (const [chain, qty] of Object.entries(trade.offering_stocks)) {
    await expect(card.getByTestId(`trade-stock-${chain}`)).toContainText(`×${qty}`)
  }
  await expect(card).toContainText(dollars(trade.requesting_money))
  await expect(page.getByTestId('trade-incoming')).toHaveCount(0)
  await shots.take(page, 'pending')

  // Pending means pending: still there, nothing moved.
  await expect(myCash(page)).toHaveText(dollars(human.cash))
  await page.getByTestId(`trade-cancel-${trade.trade_id}`).click()
  await expect(card).toHaveCount(0)
  await expect(toast(page, 'Offer canceled')).toBeVisible()
  // Nothing of mine and nothing at the table: one quiet line.
  await expect(page.locator('[data-testid^="trade-outgoing-"]')).toHaveCount(0)
  await expect(page.getByTestId('trade-table-empty')).toHaveText('No open offers')
  await expect(myCash(page)).toHaveText(dollars(human.cash))
  await shots.take(page, 'withdrawn')
  await playHumanTurns(page, room, 3, shots)
})

test('outgoing offer: a scripted opponent accepts it', async ({ page, shots }) => {
  const trade = loadFixture('trade-outgoing-pending').expect.pending_trades[0]
  const room = await startFromSnapshot(page, 'trade-outgoing-pending', {
    scripts: { [trade.to_player_id]: [{ action: 'accept_trade', trade_id: trade.trade_id }] },
  })
  const { human } = room.fixture.expect
  const peer = room.names[room.seatMap[trade.to_player_id]]
  await expect(toast(page, `${peer} accepted your offer`)).toBeVisible()
  await expect(page.getByTestId(`trade-outgoing-${trade.trade_id}`)).toHaveCount(0)
  // I gave the shares and received the cash.
  await expect(myCash(page)).toHaveText(dollars(human.cash + trade.requesting_money))
  for (const [chain, qty] of Object.entries(trade.offering_stocks)) {
    const left = (human.holdings[chain] ?? 0) - qty
    if (left > 0) {
      await expect(page.getByTestId(`portfolio-row-${chain.toLowerCase()}`)).toContainText(
        String(left)
      )
    } else {
      await expect(page.getByTestId(`portfolio-row-${chain.toLowerCase()}`)).toHaveCount(0)
    }
  }
  await shots.take(page, 'accepted')
  await playHumanTurns(page, room, 3, shots)
})

test('outgoing offer: a scripted opponent rejects it (the default answer)', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'trade-outgoing-pending')
  const { human, pending_trades } = room.fixture.expect
  const trade = pending_trades[0]
  const peer = room.names[room.seatMap[trade.to_player_id]]
  await expect(toast(page, `${peer} rejected your offer`)).toBeVisible()
  await expect(page.getByTestId(`trade-outgoing-${trade.trade_id}`)).toHaveCount(0)
  await expect(myCash(page)).toHaveText(dollars(human.cash))
  await shots.take(page, 'rejected')
  await playHumanTurns(page, room, 3, shots)
})

test('an offer between two other players: I see it, read-only, and can make a competing offer', async ({
  page,
  shots,
}) => {
  // Offers are public (BL-012). Both parties are idle seats so the offer stays open.
  const fx = loadFixture('trade-between-others')
  const trade = fx.expect.pending_trades[0]
  expect([trade.from_player_id, trade.to_player_id]).not.toContain(fx.human_seat)
  const room = await startFromSnapshot(page, 'trade-between-others', {
    idle: [trade.from_player_id, trade.to_player_id],
  })
  const { human } = room.fixture.expect
  const proposer = room.names[room.seatMap[trade.from_player_id]]
  const recipient = room.names[room.seatMap[trade.to_player_id]]
  const [chain, qty] = Object.entries(trade.offering_stocks)[0]
  const mine = human.holdings[chain] ?? 0
  expect(mine, 'the human holds some of the offered chain').toBeGreaterThan(0)
  console.log(
    `[offer] ${proposer} offers ${recipient} ${qty} ${chain} for ${dollars(trade.requesting_money)}; I hold ${mine}`
  )

  // Nothing is asked of me: no offer in the decision tab; the Trades tab carries a quiet dot.
  await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
  await expect(page.getByTestId('trade-incoming')).toHaveCount(0)
  await expect(tabBadge(page, 'trades')).toBeVisible()
  await expect(tabBadge(page, 'trades')).toHaveText('')
  await shots.take(page, 'dot-on-trades-tab')

  await openTab(page, 'trades')
  const card = page.getByTestId(`trade-table-${trade.trade_id}`)
  await expect(card).toBeVisible()
  await expect(card).toContainText(`${proposer} gives`)
  await expect(card).toContainText(`${recipient} gives`)
  await expect(card.getByTestId(`trade-stock-${chain}`)).toContainText(`×${qty}`)
  await expect(card).toContainText(dollars(trade.requesting_money))
  await expect(page.getByTestId('trade-start')).toContainText('Offers are public')
  // The card is the count and the title: no "open offers: 1" over it, no "none" for mine.
  await expect(page.getByTestId('trade-table-empty')).toHaveCount(0)
  await expect(page.getByTestId('trade-offers')).not.toContainText(/pending|open offers/i)
  // Read-only for me: it is not mine to answer or withdraw.
  for (const id of ['trade-accept', 'trade-table-accept', 'trade-table-reject', 'trade-cancel']) {
    await expect(page.getByTestId(`${id}-${trade.trade_id}`)).toHaveCount(0)
  }
  await expect(tabBadge(page, 'trades')).toHaveCount(0) // looked at
  // While the offer is open it is said once, by its card; the activity log takes it over
  // (in words, with the terms) once it is answered. See the end of this test.
  const inWords = `${proposer} offers ${recipient} ${qty} ${chain[0].toUpperCase()}${chain.slice(1)} for ${dollars(trade.requesting_money)}.`
  await expect(page.getByText(inWords)).toHaveCount(0)
  await shots.take(page, 'offer-between-others')

  // A competing offer to the recipient: the composer opens on them with the terms filled in
  // (as many shares as I hold, the same price).
  await page.getByTestId(`trade-compete-recipient-${trade.trade_id}`).click()
  await expect(composer(page)).toBeVisible()
  await expect(composer(page)).toHaveAccessibleName('Competing offer')
  await expect(page.getByTestId('trade-started-from')).toHaveText(
    `Started from ${proposer}'s offer to ${recipient}.`
  )
  await expect(
    composer(page).getByTestId(`player-select-${room.seatMap[trade.to_player_id]}`)
  ).toHaveAttribute('aria-pressed', 'true')
  const give = Math.min(qty, mine)
  await expect(line(page, 'offer', chain).getByTestId('stepper-value')).toHaveText(String(give))
  await expect(page.getByTestId('want-cash-input')).toHaveValue(String(trade.requesting_money))
  await shots.take(page, 'competing-offer-prefilled')

  // Undercut: the same shares for $100 less, then send it.
  const price = trade.requesting_money - 100
  await page.getByTestId('want-cash-less').click()
  await expect(page.getByTestId('want-cash-input')).toHaveValue(String(price))
  await page.getByTestId('propose-trade').click()
  await expect(composer(page)).toHaveCount(0)
  await expect(toast(page, `Offer sent to ${recipient}`)).toBeVisible()
  const outgoing = page.locator('[data-testid^="trade-outgoing-"]')
  await expect(outgoing).toHaveCount(1)
  await expect(outgoing).toContainText(recipient)
  await expect(outgoing).toContainText(dollars(price))
  // Both offers are open at the table; the other one is still there, untouched.
  await expect(card).toBeVisible()
  const live = await room.liveSnapshot()
  expect(live.pending_trades).toHaveLength(2)
  await shots.take(page, 'competing-offer-sent')

  // The recipient takes mine: everyone hears; then the first offer is withdrawn.
  const myOffer = live.pending_trades
    .map((t) => (t.trade ?? t) as Record<string, unknown>)
    .find((t) => t.from_player_id === room.humanId)!
  const accepted = await room.act(room.seatMap[trade.to_player_id], {
    action: 'accept_trade',
    trade_id: myOffer.trade_id,
  })
  expect(accepted.status, JSON.stringify(accepted)).not.toBe('error')
  await expect(toast(page, `${recipient} accepted your offer`)).toBeVisible()
  await expect(outgoing).toHaveCount(0)
  const withdrawn = await room.act(room.seatMap[trade.from_player_id], {
    action: 'cancel_trade',
    trade_id: trade.trade_id,
  })
  expect(withdrawn.status, JSON.stringify(withdrawn)).not.toBe('error')
  await expect(card).toHaveCount(0)
  await expect(page.getByTestId('trade-table-empty')).toBeVisible()
  const activity = page.getByTestId('trade-activity')
  await expect(activity).toContainText(`${proposer} withdrew the offer to ${recipient}`)
  await expect(activity).toContainText(inWords)
  await expect(activity).toContainText(`${recipient} accepted ${human.name}'s offer`)
  await shots.take(page, 'activity-after-answers')
  await openTab(page, 'table')
  await expect(myCash(page)).toHaveText(dollars(human.cash + price))
  await playHumanTurns(page, room, 2, shots)
})

test('a new offer between two other players: one toast, a dot on the tab, the offer listed', async ({
  page,
  shots,
}) => {
  // Start with no open offer between others, then have one made while I watch.
  const fx = loadFixture('trade-between-others')
  const trade = fx.expect.pending_trades[0]
  const room = await startFromSnapshot(page, 'trade-between-others', {
    idle: [trade.from_player_id, trade.to_player_id],
    viewport: { width: 390, height: 844 },
  })
  const from = room.seatMap[trade.from_player_id]
  const to = room.seatMap[trade.to_player_id]
  // The first offer was there when I arrived: a dot, but no toast about it.
  await expect(tabBadge(page, 'trades')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await openTab(page, 'trades', { tap: false })
  await expect(page.getByTestId(`trade-table-${trade.trade_id}`)).toBeVisible()
  await shots.take(page, 'phone-offer-between-others')
  await openTab(page, 'table')
  await expect(tabBadge(page, 'trades')).toHaveCount(0)

  // The recipient says no (no toast for me: it is their business), then a new offer comes.
  expect(
    (await room.act(to, { action: 'reject_trade', trade_id: trade.trade_id })).status
  ).not.toBe('error')
  const again = await room.act(from, {
    action: 'propose_trade',
    to_player_id: to,
    offering_stocks: trade.offering_stocks,
    requesting_money: trade.requesting_money - 200,
    trade_id: 'trade-2',
  })
  expect(again.status, JSON.stringify(again)).not.toBe('error')
  await expect(toast(page, `${room.names[from]} offers ${room.names[to]} a trade`)).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(tabBadge(page, 'trades')).toBeVisible()
  await shots.take(page, 'phone-toast-and-dot')
  await openTab(page, 'trades')
  await expect(page.getByTestId('trade-table-trade-2')).toContainText(
    dollars(trade.requesting_money - 200)
  )
  await expect(page.getByTestId('trade-activity')).toContainText(
    `${room.names[to]} rejected ${room.names[from]}'s offer`
  )
  await shots.take(page, 'phone-new-offer-listed')
})

test("an offer starts in the holdings table: a tap on a rival's shares, the deal and what it does, then it waits", async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'trade-outgoing-pending', {
    idle: ['p2', 'p3', 'p4'],
    viewport: { width: 390, height: 675 },
  })
  // Withdraw the fixture's own offer first so the proposal below is the only one.
  const existing = room.fixture.expect.pending_trades[0]
  await openTab(page, 'trades')
  await page.getByTestId(`trade-cancel-${existing.trade_id}`).click()
  await expect(page.locator('[data-testid^="trade-outgoing-"]')).toHaveCount(0)
  await expect(page.getByTestId('trade-table-empty')).toBeVisible()
  const { human, players, active_chains } = room.fixture.expect
  const dev = players.find((p) => p.player_id === 'p4')!
  // Sandpiper: Dev and I hold 2 each (tied for 1st).
  expect([human.holdings.sandpiper, dev.holdings.sandpiper]).toEqual([2, 2])

  // The table: one row per opponent and mine, the numbers of the players table.
  const start = page.getByTestId('trade-start')
  for (const p of players) {
    const id = room.seatMap[p.player_id]
    for (const [chain, n] of Object.entries(p.holdings)) {
      if (n > 0)
        await expect(start.getByTestId(`trade-start-${id}-${chain}`)).toHaveText(
          new RegExp(`^=?${n}$`)
        )
    }
  }
  expect(await pageFrameProblems(page, ['game-phase', 'dock', 'tab-bar'], ['trade-start'])).toEqual(
    []
  )
  await shots.take(page, 'holdings-table', { fullPage: false })

  // "I want Dev's Sandpiper": one tap on that number.
  await start.getByTestId(`trade-start-${room.seatMap.p4}-sandpiper`).click()
  await expect(composer(page)).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0) // in the page, nothing to close
  await expect(composer(page).getByTestId(`player-select-${room.seatMap.p4}`)).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(line(page, 'want', 'sandpiper').getByTestId('stepper-value')).toHaveText('1')
  // Composing takes the tab: the table and the lists are away until it is sent or put away.
  await expect(start).toHaveCount(0)
  await expect(page.getByTestId('trade-offers')).toHaveCount(0)
  // What it does, next to the button: the value at list prices and the places.
  const price = active_chains.sandpiper.price
  await expect(page.getByTestId('trade-get-value')).toHaveText(dollars(price))
  await expect(page.getByTestId('trade-effect-sandpiper')).toContainText(
    `Sandpiper: You take 1st · ${dev.name} drops to 2nd`
  )
  // A human on the other side: no verdict is guessed for them.
  await expect(page.getByTestId('trade-bot-verdict')).toHaveCount(0)
  await expect(page.getByTestId('trade-bot-match')).toHaveCount(0)
  // Where the send button is: what follows changes the deal, never the button's place.
  const send = page.getByTestId('propose-trade')
  const sendAt = (await send.boundingBox())!.y
  await shots.take(page, 'composer-from-a-share', { fullPage: false })

  // Pay for it: even at list is one tap; then a little more by the + button.
  await expect(page.getByTestId('trade-even')).toHaveText(`EVEN AT LIST: YOU PAY ${dollars(price)}`)
  await page.getByTestId('trade-even').click()
  await expect(page.getByTestId('offer-cash-input')).toHaveValue(String(price))
  await expect(page.getByTestId('trade-even')).toBeDisabled()
  await page.getByTestId('offer-cash-more').click()
  await expect(page.getByTestId('offer-cash-input')).toHaveValue(String(price + 100))
  await expect(page.getByTestId('trade-give-value')).toHaveText(dollars(price + 100))
  expect((await send.boundingBox())!.y, 'the send button has not moved').toBe(sendAt)
  await shots.take(page, 'composer-filled', { fullPage: false })

  // Nothing in the deal cannot be sent, and says what is missing.
  await line(page, 'want', 'sandpiper').getByTestId('stepper-decrement').click()
  await page.getByTestId('offer-cash-input').fill('')
  await expect(page.getByTestId('trade-hint')).toHaveText('Add what you give or what you get')
  await expect(page.getByTestId('propose-trade')).toBeDisabled()
  await shots.take(page, 'composer-nothing-to-send', { fullPage: false })
  // (One line of the deal less: the button is one line higher, by my own tap.)
  expect((await send.boundingBox())!.y).toBeLessThan(sendAt)
  await add(page, 'want', 'sandpiper')
  await page.getByTestId('offer-cash-input').fill(String(price + 100))
  await expect(page.getByTestId('trade-hint')).toHaveCount(0)

  await page.getByTestId('propose-trade').click()
  await expect(composer(page)).toHaveCount(0)
  await expect(toast(page, `Offer sent to ${dev.name}`)).toBeVisible()
  const outgoing = page.locator('[data-testid^="trade-outgoing-"]')
  await expect(outgoing).toHaveCount(1)
  await expect(outgoing).toContainText(dev.name)
  await expect(outgoing).toContainText('waiting')
  await expect(outgoing).toContainText(dollars(price + 100))
  await expect(outgoing.getByTestId('trade-stock-sandpiper')).toContainText('×1')
  await shots.take(page, 'pending-offer', { fullPage: false })

  // Withdraw it again.
  await outgoing.getByRole('button', { name: 'WITHDRAW' }).click()
  await expect(outgoing).toHaveCount(0)
  await expect(toast(page, 'Offer canceled')).toBeVisible()
  await playHumanTurns(page, room, 3, shots)
})

test('a rules bot on the other side: the composer says what it would answer, one tap adds the cash it needs, and it answers that way', async ({
  page,
  shots,
}) => {
  // Dev (p4) is the real rules-based bot; its answer is the rule in docs/ai/bot-trading.md.
  const room = await startFromSnapshot(page, 'trade-outgoing-pending', {
    idle: ['p2', 'p3'],
    bots: ['p4'],
    viewport: { width: 390, height: 675 },
  })
  const { human, players } = room.fixture.expect
  const dev = players.find((p) => p.player_id === 'p4')!
  await openTab(page, 'trades')
  await page.getByTestId(`trade-start-${room.seatMap.p4}-sandpiper`).click()
  await expect(composer(page)).toBeVisible()
  const verdict = page.getByTestId('trade-bot-verdict')

  // One Sandpiper for nothing: it would refuse, and says about how much is missing.
  await expect(verdict).toHaveAttribute('data-acceptable', 'false')
  await expect(verdict).toHaveText(
    new RegExp(`^${dev.name} \\(bot\\) would refuse: about \\$[\\d,]+ short$`)
  )
  const short = Number((await verdict.innerText()).replace(/\D/g, ''))
  expect(short).toBeGreaterThan(0)
  expect(short % 100).toBe(0)
  console.log(`[bot] one Sandpiper for nothing: about ${dollars(short)} short`)
  await shots.take(page, 'bot-would-refuse', { fullPage: false })
  // The verdict and its button have their room: the send button stays where it is as the
  // bot's answer changes.
  const send = page.getByTestId('propose-trade')
  const sendAt = (await send.boundingBox())!.y

  // One step less than it needs is still refused; exactly that much is accepted.
  await page.getByTestId('offer-cash-input').fill(String(short - 100))
  await expect(verdict).toHaveText(`${dev.name} (bot) would refuse: about $100 short`)
  await expect(page.getByTestId('trade-bot-match')).toHaveText('ADD $100')
  await page.getByTestId('trade-bot-match').click()
  await expect(page.getByTestId('offer-cash-input')).toHaveValue(String(short))
  await expect(verdict).toHaveText(`${dev.name} (bot) would accept`)
  await expect(verdict).toHaveAttribute('data-acceptable', 'true')
  await expect(page.getByTestId('trade-bot-match')).toBeDisabled()
  expect((await send.boundingBox())!.y, 'the send button has not moved').toBe(sendAt)
  await shots.take(page, 'bot-would-accept', { fullPage: false })

  // Sent: the bot answers as the composer said.
  await page.getByTestId('propose-trade').click()
  await expect(composer(page)).toHaveCount(0)
  await expect(toast(page, `${dev.name} accepted your offer`)).toBeVisible()
  await expect(page.getByTestId('trade-activity')).toContainText(
    `${dev.name} accepted ${human.name}'s offer`
  )
  await openTab(page, 'table')
  await expect(myCash(page)).toHaveText(dollars(human.cash - short))
  await shots.take(page, 'bot-accepted', { fullPage: false })

  // And a refusal is a refusal: the same share again for $100 less than it now needs.
  await openTab(page, 'trades')
  await page.getByTestId(`trade-start-${room.seatMap.p4}-sandpiper`).click()
  await expect(verdict).toContainText('would refuse')
  await page.getByTestId('propose-trade').click()
  await expect(toast(page, `${dev.name} rejected your offer`)).toBeVisible()
  await shots.take(page, 'bot-rejected', { fullPage: false })
})

test('a trade the server would refuse mid-merger says why in the composer and cannot be sent', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'disposition-waiting-on-other', {
    idle: [loadFixture('disposition-waiting-on-other').expect.decisions[0].player_id],
  })
  const { human, players } = room.fixture.expect
  const merging = (room.fixture.snapshot.merger as { chains: string[] }).chains
  const chain = merging.find((c) => (human.holdings[c] ?? 0) > 0)!
  expect(chain, 'the human holds a chain of the merger').toBeTruthy()
  // A partner who can pay the $100 asked for (the fixture decides who has cash).
  const partner = players.find((p) => p.player_id !== room.fixture.human_seat && p.cash >= 100)!

  await openTab(page, 'trades')
  await startOfferTo(page, room, partner.player_id)
  // The composer warns up front that merging chains cannot be traded.
  await expect(composer(page)).toContainText('A merger is in progress')
  // Offer one share of a merging chain I hold, for $100.
  await add(page, 'offer', chain)
  await page.getByTestId('want-cash-more').click()
  await expect(page.getByTestId('want-cash-input')).toHaveValue('100')

  // The engine would say no: its reason is in the composer, and the offer cannot be sent.
  await expect(page.getByTestId('trade-error')).toContainText(/merger/i)
  await expect(page.getByTestId('propose-trade')).toBeDisabled()
  await shots.take(page, 'refused')
  // Without the frozen shares it is an ordinary offer again.
  await line(page, 'offer', chain).getByTestId('stepper-decrement').click()
  await page.getByTestId('offer-cash-more').click()
  await expect(page.getByTestId('trade-error')).toHaveCount(0)
  await expect(page.getByTestId('propose-trade')).toBeEnabled()

  await page.getByTestId('cancel-trade').click()
  await expect(composer(page)).toHaveCount(0)
  await expect(page.locator('[data-testid^="trade-outgoing-"]')).toHaveCount(0)
  await openTab(page, 'table')
  await expect(myCash(page)).toHaveText(dollars(human.cash))

  // The merger carries on once the idle seat answers.
  expect(await room.driveIdle()).toBe(true)
  await expect(page.getByTestId('merger-disposition')).toBeVisible()
  await page.getByTestId('confirm-disposition').click()
  await playHumanTurns(page, room, 2, shots)
})

test('the server refuses a trade the composer could not check first: reason in the composer and as a toast', async ({
  page,
  guard,
  shots,
}) => {
  guard.allow(/\[Game Error\].*merger/) // the app logs the refusal it is about to show
  guard.allow(/503/) // the preview route, made to fail below
  const room = await startFromSnapshot(page, 'disposition-waiting-on-other', {
    idle: [loadFixture('disposition-waiting-on-other').expect.decisions[0].player_id],
  })
  const { human, players } = room.fixture.expect
  const merging = (room.fixture.snapshot.merger as { chains: string[] }).chains
  const chain = merging.find((c) => (human.holdings[c] ?? 0) > 0)!
  const partner = players.find((p) => p.player_id !== room.fixture.human_seat && p.cash >= 100)!
  // The preview cannot be had (a bad connection): the composer shows no effects and lets the
  // offer go; the engine's answer is then the first word on it.
  let asked = 0
  await page.route('**/trade-preview/**', (route) => {
    asked += 1
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
  })

  await openTab(page, 'trades')
  await startOfferTo(page, room, partner.player_id)
  await add(page, 'offer', chain)
  await page.getByTestId('want-cash-more').click()
  await expect.poll(() => asked).toBeGreaterThan(0)
  await expect(page.getByTestId('trade-error')).toHaveCount(0)
  await expect(page.locator('[data-testid^="trade-effect-"]')).toHaveCount(0)
  await page.getByTestId('propose-trade').click()

  // The engine says no; the composer stays open with the reason, and a toast repeats it.
  await expect(page.getByTestId('trade-error')).toContainText(/merger/i)
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /merger/i })
      .last()
  ).toBeVisible()
  await expect(composer(page)).toBeVisible()
  await expect(line(page, 'offer', chain).getByTestId('stepper-value')).toHaveText('1')
  await expect(page.getByTestId('propose-trade')).toBeEnabled()
  await shots.take(page, 'refused-by-the-server')

  await page.getByTestId('cancel-trade').click()
  await expect(composer(page)).toHaveCount(0)
  await expect(page.locator('[data-testid^="trade-outgoing-"]')).toHaveCount(0)
  expect((await room.liveSnapshot()).pending_trades).toHaveLength(0)
})

for (const vp of [
  { label: '390x675 phone', width: 390, height: 675, scheme: 'dark' as const },
  { label: '360x600 phone, light', width: 360, height: 600, scheme: 'light' as const },
  { label: '1366x768 laptop', width: 1366, height: 768, scheme: 'dark' as const },
]) {
  test(`trade composer at ${vp.label}: part of the page, nothing scrolls inside it, the deal and the send button on screen`, async ({
    page,
    shots,
  }) => {
    await page.emulateMedia({ colorScheme: vp.scheme })
    // Six players, up to six chains a side: the widest and longest the composer gets.
    const room = await startFromSnapshot(page, 'six-player-midgame', {
      idle: ['p2', 'p3', 'p4', 'p5', 'p6'],
      viewport: vp,
    })
    const { human, players, active_chains } = room.fixture.expect
    const partner = players.find((p) => p.player_id === 'p2')!
    const phone = vp.width < 768
    await openTab(page, 'trades')
    // The holdings table: seven chains and six players inside the width.
    await expect(page.getByTestId('trade-start')).toBeVisible()
    expect(
      await layoutProblems(page, ['trade-start'], { vertical: false, noPageScroll: false })
    ).toEqual([])
    await shots.take(page, 'holdings-table', { fullPage: false })

    await startOfferTo(page, room, 'p2')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('trade-hint')).toHaveText('Add what you give or what you get')
    // Every player on one line.
    const tops = await composer(page)
      .locator('[data-testid^="player-select-"]')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
    expect(new Set(tops).size, 'player buttons on one line').toBe(1)
    // Each side lists only the chains it holds, in the ruleset's order.
    const res = await page.request.get('/api/config/game')
    const order = ((await res.json()) as { chains: Array<{ id: string }> }).chains.map((c) => c.id)
    for (const [prefix, holdings] of [
      ['offer-add-', human.holdings],
      ['want-add-', partner.holdings],
    ] as const) {
      const listed = await composer(page)
        .locator(`[data-testid^="${prefix}"]`)
        .evaluateAll(
          (els, n) => els.map((e) => e.getAttribute('data-testid')!.slice(n)),
          prefix.length
        )
      expect(listed).toEqual(order.filter((c) => (holdings[c] ?? 0) > 0))
    }
    await shots.take(page, 'composer-open', { fullPage: false })

    // Two of my shares for one of theirs and cash.
    const [mine] = order.filter((c) => (human.holdings[c] ?? 0) >= 2 && active_chains[c])
    const [theirs] = order.filter((c) => (partner.holdings[c] ?? 0) >= 1 && active_chains[c])
    expect(mine && theirs, 'both sides hold shares of a chain on the board').toBeTruthy()
    await add(page, 'offer', mine, 2)
    await add(page, 'want', theirs)
    await page.getByTestId('want-cash-more').click()
    await page.getByTestId('want-cash-more').click()
    await expect(line(page, 'offer', mine).getByTestId('stepper-value')).toHaveText('2')
    await expect(page.getByTestId('trade-give-value')).toHaveText(
      dollars(2 * active_chains[mine].price)
    )
    await expect(page.getByTestId('trade-get-value')).toHaveText(
      dollars(active_chains[theirs].price + 200)
    )
    // The server's answer about the places is in (a line per chain, or that nothing changes).
    await expect(page.locator('[data-testid^="trade-effect-"]').first()).toBeVisible()

    // Nothing scrolls inside the page or sideways; a line of the deal is one row.
    await expectNoInnerScroll(page)
    for (const h of await composer(page)
      .locator('[data-testid^="offer-stock-"], [data-testid^="want-stock-"]')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(h, 'a line of the deal is one row').toBeLessThanOrEqual(52)
    }
    // The buttons are thumb-sized, whole, and over the rack and the tab bar.
    for (const id of ['propose-trade', 'cancel-trade']) {
      await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 })
      expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44)
      expect(await clippedBy(page, `[data-testid="${id}"]`), id).toEqual([])
    }
    for (const id of await composer(page)
      .locator(
        '[data-testid$="-more"], [data-testid^="offer-add-"], [data-testid="stepper-increment"]'
      )
      .evaluateAll((els) =>
        els
          .map((e) => ({ id: e.getAttribute('data-testid'), r: e.getBoundingClientRect() }))
          .filter(({ r }) => r.height < 44 || r.width < 36)
          .map(({ id, r }) => `${id} ${Math.round(r.width)}x${Math.round(r.height)}`)
      )) {
      throw new Error(`control smaller than a thumb: ${id}`)
    }
    if (phone) {
      expect(
        await pageFrameProblems(
          page,
          ['game-phase', 'propose-trade', 'dock', 'tab-bar'],
          ['trade-builder']
        )
      ).toEqual([])
      expect(
        await layoutProblems(page, ['propose-trade', 'cancel-trade'], { noPageScroll: false })
      ).toEqual([])
    } else {
      expect(
        await layoutProblems(page, ['trade-builder', 'board'], { noPageScroll: false })
      ).toEqual([])
    }
    // At the owner's phone the whole composer is on screen: nothing to scroll at all.
    if (vp.width === 390) {
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
        'the composer fits 390x675 without scrolling the page'
      ).toBeLessThanOrEqual(1)
    }
    await shots.take(page, 'composer-filled', { fullPage: false })

    await page.getByTestId('propose-trade').click()
    await expect(composer(page)).toHaveCount(0)
    await expect(toast(page, `Offer sent to ${partner.name}`)).toBeVisible()
    await expect(page.locator('[data-testid^="trade-outgoing-"]')).toHaveCount(1)
    await expectNoInnerScroll(page)
    await shots.take(page, 'offer-sent', { fullPage: false })
  })
}

test('a hint is read once: after I have started an offer it is a "?" that brings the words back', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'trade-outgoing-pending', {
    idle: ['p2', 'p3', 'p4'],
  })
  await openTab(page, 'trades')
  // The hint sits where an offer starts, over the holdings table.
  const start = page.getByTestId('trade-start')
  await expect(start.getByTestId('hint-trades')).toContainText('Tap a player')
  await expect(start.getByTestId('hint-trades')).toContainText('Offers are public')
  await shots.take(page, 'hint-first-time')
  // Doing the thing retires the hint (remembered in this browser).
  await startOfferTo(page, room, 'p3')
  await page.getByTestId('cancel-trade').click()
  await page.reload()
  await expect(page.getByTestId('game-phase')).toBeVisible()
  await openTab(page, 'trades')
  await expect(start.getByTestId('hint-trades')).toHaveCount(0)
  const more = start.getByTestId('hint-button-trades')
  await expect(more).toHaveAccessibleName('How this works')
  await shots.take(page, 'hint-retired')
  await more.click()
  await expect(start.getByTestId('hint-trades')).toContainText('Offers are public')
})
