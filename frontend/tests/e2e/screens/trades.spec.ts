import type { Page } from '@playwright/test'
import { test, expect } from './support/test'
import { startFromSnapshot, type RoomContext } from './support/room'
import { dollars, loadFixture } from './support/fixtures'
import { headerCash, phaseBanner, playHumanTurns } from './support/ui'
import { layoutProblems } from './support/layout'
import { openTab, tabBadge } from '../support/tabs'

/** Latest toast containing `text` (an earlier identical toast may still be fading out). */
const toast = (page: Page, text: string | RegExp) =>
  page.getByRole('alert').filter({ hasText: text }).last()

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
  await expect(page.getByTestId('trade-incoming-count')).toHaveText('1 NEW')
  await expect(card).toContainText(room.names[room.seatMap[trade.from_player_id]])
  for (const [chain, qty] of Object.entries(trade.offering_stocks)) {
    await expect(card.getByTestId(`trade-stock-${chain}`)).toContainText(`×${qty}`)
  }
  if (trade.requesting_money > 0) await expect(card).toContainText(dollars(trade.requesting_money))
  await expect(page.getByTestId(`trade-accept-${trade.trade_id}`)).toBeEnabled()
  await expect(page.getByTestId(`trade-reject-${trade.trade_id}`)).toBeEnabled()
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
  await expect(headerCash(page)).toHaveText(dollars(human.cash - trade.requesting_money))
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
  await expect(headerCash(page)).toHaveText(dollars(human.cash))
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
  await expect(phaseBanner(page)).toHaveText(`${room.names[room.seatMap[current_player]]}'s TURN`)
  await expect(page.getByTestId('end-turn-button')).toHaveCount(0) // not my buy phase
  await shots.take(page, 'offer-not-my-turn')

  await page.getByTestId(`trade-accept-${trade.trade_id}`).click()
  await expect(page.getByTestId(`trade-offer-${trade.trade_id}`)).toHaveCount(0)
  await expect(headerCash(page)).toHaveText(dollars(human.cash - trade.requesting_money))
  for (const [chain, qty] of Object.entries(trade.offering_stocks)) {
    await expect(page.getByTestId(`portfolio-row-${chain.toLowerCase()}`)).toContainText(
      String((human.holdings[chain] ?? 0) + qty)
    )
  }
  // Accepting did not take anyone's turn: it is still the same player's.
  await expect(phaseBanner(page)).toHaveText(`${room.names[room.seatMap[current_player]]}'s TURN`)
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
  await expect(headerCash(page)).toHaveText(dollars(human.cash))
  await shots.take(page, 'rejected-not-my-turn')
  await playHumanTurns(page, room, 2, shots)
})

test('outgoing offer stays pending until cancelled', async ({ page, shots }) => {
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
  await expect(page.getByTestId('trade-incoming-count')).toHaveCount(0)
  await shots.take(page, 'pending')

  // Pending means pending: still there, nothing moved.
  await expect(headerCash(page)).toHaveText(dollars(human.cash))
  await page.getByTestId(`trade-cancel-${trade.trade_id}`).click()
  await expect(card).toHaveCount(0)
  await expect(toast(page, 'Offer canceled')).toBeVisible()
  await expect(page.getByText('No offers of yours pending')).toBeVisible()
  await expect(headerCash(page)).toHaveText(dollars(human.cash))
  await shots.take(page, 'cancelled')
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
  await expect(headerCash(page)).toHaveText(dollars(human.cash + trade.requesting_money))
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
  await expect(headerCash(page)).toHaveText(dollars(human.cash))
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
  await expect(card).toContainText(proposer)
  await expect(card).toContainText(recipient)
  await expect(card.getByTestId(`trade-stock-${chain}`)).toContainText(`×${qty}`)
  await expect(card).toContainText(dollars(trade.requesting_money))
  await expect(page.getByTestId('trade-table')).toContainText('Offers are public')
  // Read-only for me: it is not mine to answer or withdraw.
  await expect(page.getByTestId(`trade-accept-${trade.trade_id}`)).toHaveCount(0)
  await expect(page.getByTestId(`trade-reject-${trade.trade_id}`)).toHaveCount(0)
  await expect(page.getByTestId(`trade-cancel-${trade.trade_id}`)).toHaveCount(0)
  await expect(tabBadge(page, 'trades')).toHaveCount(0) // looked at
  // The public activity says it in words, with the terms.
  await expect(page.getByTestId('trade-activity')).toContainText(
    `${proposer} offers ${recipient} ${qty} ${chain[0].toUpperCase()}${chain.slice(1)} for ${dollars(trade.requesting_money)}.`
  )
  await shots.take(page, 'offer-between-others')

  // A competing offer to the recipient: the builder opens on them with the terms filled in
  // (as many shares as I hold, the same price).
  await page.getByTestId(`trade-compete-recipient-${trade.trade_id}`).click()
  const builder = page.getByTestId('trade-builder')
  await expect(builder).toBeVisible()
  await expect(page.getByTestId('trade-started-from')).toContainText(
    `Started from ${proposer}'s offer to ${recipient}`
  )
  await expect(
    builder.getByTestId(`player-select-${room.seatMap[trade.to_player_id]}`)
  ).toHaveAttribute('aria-pressed', 'true')
  const give = Math.min(qty, mine)
  await expect(builder.getByTestId(`offer-stock-${chain}`).getByTestId('stepper-value')).toHaveText(
    String(give)
  )
  await expect(page.getByTestId('want-cash-input')).toHaveValue(String(trade.requesting_money))
  await shots.take(page, 'competing-builder-prefilled')

  // Undercut: the same shares for $100 less, then send it.
  const price = trade.requesting_money - 100
  await page.getByTestId('want-cash-input').fill(String(price))
  await page.getByTestId('propose-trade').click()
  await expect(builder).toHaveCount(0)
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
  await expect(headerCash(page)).toHaveText(dollars(human.cash + price))
  const withdrawn = await room.act(room.seatMap[trade.from_player_id], {
    action: 'cancel_trade',
    trade_id: trade.trade_id,
  })
  expect(withdrawn.status, JSON.stringify(withdrawn)).not.toBe('error')
  await expect(card).toHaveCount(0)
  await expect(page.getByTestId('trade-table-empty')).toBeVisible()
  const activity = page.getByTestId('trade-activity')
  await expect(activity).toContainText(`${proposer} withdrew the offer to ${recipient}`)
  await expect(activity).toContainText(`${recipient} accepted ${human.name}'s offer`)
  await shots.take(page, 'activity-after-answers')
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

test('propose a trade through the builder: validation, then the offer shows as pending', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'trade-outgoing-pending', {
    idle: ['p2', 'p3', 'p4'],
  })
  // Withdraw the fixture's own offer first so the proposal below is the only one.
  const existing = room.fixture.expect.pending_trades[0]
  await openTab(page, 'trades')
  await page.getByTestId(`trade-cancel-${existing.trade_id}`).click()
  await expect(page.getByText('No offers of yours pending')).toBeVisible()
  const { human, players } = room.fixture.expect
  const partnerSeat = 'p3'
  const partner = players.find((p) => p.player_id === partnerSeat)!
  const [chain] = Object.keys(human.holdings).filter((c) => human.holdings[c] > 0)

  await page.getByRole('button', { name: 'PROPOSE TRADE' }).click()
  const builder = page.getByTestId('trade-builder')
  await expect(builder).toBeVisible()
  await shots.take(page, 'builder-open')

  // Validation messages, in the order a user hits them.
  await page.getByTestId('propose-trade').click()
  await expect(page.getByTestId('trade-error')).toHaveText('Select a trade partner')
  await page.getByTestId(`player-select-${room.seatMap[partnerSeat]}`).click()
  await page.getByTestId('propose-trade').click()
  await expect(page.getByTestId('trade-error')).toHaveText('You must offer something')
  await builder.getByTestId(`offer-stock-${chain}`).getByTestId('stepper-increment').click()
  await page.getByTestId('propose-trade').click()
  await expect(page.getByTestId('trade-error')).toHaveText('You must request something')
  await shots.take(page, 'builder-validation')

  // A valid proposal: one share of mine for $100 of theirs.
  await page.getByTestId('want-cash-input').fill('100')
  await page.getByTestId('propose-trade').click()
  await expect(builder).toHaveCount(0)
  await expect(toast(page, `Offer sent to ${partner.name}`)).toBeVisible()
  const outgoing = page.locator('[data-testid^="trade-outgoing-"]')
  await expect(outgoing).toHaveCount(1)
  await expect(outgoing).toContainText(partner.name)
  await expect(outgoing).toContainText('$100')
  await expect(outgoing.locator(`[data-testid="trade-stock-${chain}"]`)).toContainText('×1')
  await shots.take(page, 'pending-offer')

  // Withdraw it again.
  await outgoing.getByRole('button', { name: 'CANCEL OFFER' }).click()
  await expect(outgoing).toHaveCount(0)
  await expect(toast(page, 'Offer canceled')).toBeVisible()
  await playHumanTurns(page, room, 3, shots)
})

test('server refuses a trade mid-merger: reason shown in the builder and as a toast', async ({
  page,
  guard,
  shots,
}) => {
  guard.allow(/\[Game Error\].*merger/) // the app logs the refusal it is about to show
  const room = await startFromSnapshot(page, 'disposition-waiting-on-other', {
    idle: [loadFixture('disposition-waiting-on-other').expect.decisions[0].player_id],
  })
  const { human, players } = room.fixture.expect
  const merging = (room.fixture.snapshot.merger as { chains: string[] }).chains
  const chain = merging.find((c) => (human.holdings[c] ?? 0) > 0)!
  // A partner who can pay the $100 asked for (the fixture decides who has cash).
  const partner = players.find((p) => p.player_id !== room.fixture.human_seat && p.cash >= 100)!

  await openTab(page, 'trades')
  await page.getByRole('button', { name: 'PROPOSE TRADE' }).click()
  // The builder warns up front that merging chains cannot be traded.
  await expect(page.getByTestId('trade-builder')).toContainText('A merger is in progress')
  await page.getByTestId(`player-select-${room.seatMap[partner.player_id]}`).click()
  // Offer one share of a merging chain I hold.
  const offerRow = page
    .getByTestId('trade-builder')
    .getByTestId(`chain-marker-${chain.toLowerCase()}`)
    .first()
    .locator('xpath=..')
  await offerRow.getByTestId('stepper-increment').click()
  await page.getByTestId('want-cash-input').fill('100')
  await page.getByTestId('propose-trade').click()

  // The engine says no; the builder stays open with the reason, and a toast repeats it.
  await expect(page.getByTestId('trade-error')).toContainText(/merger/i)
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /merger/i })
      .last()
  ).toBeVisible()
  await expect(page.getByTestId('trade-builder')).toBeVisible()
  await shots.take(page, 'refused')
  expect(chain).toBeTruthy()
  expect(partner.name).toBeTruthy()

  await page.getByTestId('cancel-trade').click()
  await expect(page.getByTestId('trade-builder')).toHaveCount(0)
  await expect(page.locator('[data-testid^="trade-outgoing-"]')).toHaveCount(0)
  await expect(headerCash(page)).toHaveText(dollars(human.cash))

  // The merger carries on once the idle seat answers.
  expect(await room.driveIdle()).toBe(true)
  await expect(page.getByTestId('merger-disposition')).toBeVisible()
  await page.getByTestId('confirm-disposition').click()
  await playHumanTurns(page, room, 2, shots)
})

for (const vp of [
  { label: '390x844', width: 390, height: 844 },
  { label: '360x640', width: 360, height: 640 },
]) {
  test(`trade builder at ${vp.label}: a full-screen sheet, one line per row, the deal and the buttons always in view`, async ({
    page,
    shots,
  }) => {
    const room = await startFromSnapshot(page, 'trade-outgoing-pending', {
      idle: ['p2', 'p3', 'p4'],
      viewport: vp,
    })
    const { human, players, active_chains } = room.fixture.expect
    const partner = players.find((p) => p.player_id === 'p3')!
    await openTab(page, 'trades')
    await page.getByRole('button', { name: 'PROPOSE TRADE' }).click()
    const builder = page.getByTestId('trade-builder')
    await expect(builder).toBeVisible()
    // The sheet is the screen: nothing of the game shows around it, and it does not scroll
    // as a whole (the rows scroll inside it).
    const dialog = page.getByRole('dialog', { name: 'Propose a trade' })
    // (Once the short slide-in has settled.)
    await expect
      .poll(async () => {
        const b = (await dialog.boundingBox())!
        return [b.x, b.y, b.width, b.height].map(Math.round)
      })
      .toEqual([0, 0, vp.width, vp.height])
    expect(await layoutProblems(page, ['trade-builder'])).toEqual([])
    expect(await layoutProblems(page, ['propose-trade', 'cancel-trade'])).toEqual([])
    // The buttons are thumb-sized and on screen before anything is filled in.
    for (const id of ['propose-trade', 'cancel-trade']) {
      await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 })
      expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    await expect(page.getByTestId('trade-give')).toContainText('nothing yet')
    await shots.take(page, 'builder-open', { fullPage: false })

    await page.getByTestId(`player-select-${room.seatMap.p3}`).click()
    // Every partner on one line; every stock row on one line (chain, "of N", stepper).
    const tops = await builder
      .locator('[data-testid^="player-select-"]')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
    expect(new Set(tops).size, 'partner buttons on one line').toBe(1)
    const rows = builder.locator('[data-testid^="offer-stock-"], [data-testid^="want-stock-"]')
    expect(await rows.count()).toBeGreaterThan(0)
    for (const h of await rows.evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().height)
    )) {
      expect(h, 'a stock row is one line').toBeLessThanOrEqual(52)
    }
    // Chains are listed in the ruleset's order on both sides.
    const res = await page.request.get('/api/config/game')
    const order = ((await res.json()) as { chains: Array<{ id: string }> }).chains.map((c) => c.id)
    for (const prefix of ['offer-stock-', 'want-stock-']) {
      const listed = await builder
        .locator(`[data-testid^="${prefix}"]`)
        .evaluateAll(
          (els, n) => els.map((e) => e.getAttribute('data-testid')!.slice(n)),
          prefix.length
        )
      expect(listed).toEqual(order.filter((c) => listed.includes(c)))
    }

    // Two of my shares for cash: the deal in words, both sides valued at current prices.
    const [chain] = order.filter((c) => (human.holdings[c] ?? 0) >= 2)
    expect(chain, 'the human holds two shares of some chain').toBeTruthy()
    const row = builder.getByTestId(`offer-stock-${chain}`)
    await expect(row).toContainText(`of ${human.holdings[chain]}`)
    await row.getByTestId('stepper-increment').click()
    await row.getByTestId('stepper-increment').click()
    await page.getByTestId('want-cash-input').fill('1200')
    const price = active_chains[chain]?.price ?? 0
    const give = page.getByTestId('trade-give')
    await expect(give).toContainText(new RegExp(`2 ${chain}`, 'i'))
    await expect(give).toContainText(dollars(2 * price))
    await expect(page.getByTestId('trade-get')).toContainText('$1,200')
    await expect(page.getByTestId('propose-trade')).toBeInViewport({ ratio: 1 })
    await expect(page.getByTestId('trade-summary')).toBeInViewport({ ratio: 1 })
    expect(await layoutProblems(page, ['trade-summary', 'propose-trade'])).toEqual([])
    await shots.take(page, 'builder-filled', { fullPage: false })

    await page.getByTestId('propose-trade').click()
    await expect(builder).toHaveCount(0)
    await expect(toast(page, `Offer sent to ${partner.name}`)).toBeVisible()
    await expect(page.locator('[data-testid^="trade-outgoing-"]')).toHaveCount(2)
    await shots.take(page, 'offer-sent', { fullPage: false })
  })
}

test('a hint is read once: after I have proposed a trade it is a "?" that brings the words back', async ({
  page,
  shots,
}) => {
  await startFromSnapshot(page, 'trade-outgoing-pending', { idle: ['p2', 'p3', 'p4'] })
  await openTab(page, 'trades')
  const table = page.getByTestId('trade-table')
  await expect(table.getByTestId('hint-trades')).toContainText('Offers are public')
  await shots.take(page, 'hint-first-time')
  // Doing the thing retires the hint (remembered in this browser).
  await page.getByRole('button', { name: 'PROPOSE TRADE' }).click()
  await page.getByTestId('cancel-trade').click()
  await page.reload()
  await expect(page.getByTestId('game-phase')).toBeVisible()
  await openTab(page, 'trades')
  await expect(table.getByTestId('hint-trades')).toHaveCount(0)
  const more = table.getByTestId('hint-button-trades')
  await expect(more).toHaveAccessibleName('How this works')
  await shots.take(page, 'hint-retired')
  await more.click()
  await expect(table.getByTestId('hint-trades')).toContainText('Offers are public')
})
