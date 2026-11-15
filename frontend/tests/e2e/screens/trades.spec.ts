import type { Page } from '@playwright/test'
import { test, expect } from './support/test'
import { startFromSnapshot, type RoomContext } from './support/room'
import { dollars, loadFixture } from './support/fixtures'
import { headerCash, phaseBanner, playHumanTurns } from './support/ui'

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
  await expect(page.getByText('No pending offers')).toBeVisible()
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
  await expect(page.getByText('No pending offers')).toBeVisible()
  await expect(toast(page, 'Offer rejected')).toBeVisible()
  await expect(headerCash(page)).toHaveText(dollars(human.cash))
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
  await expect(page.getByText('No pending offers')).toBeVisible()
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

test('propose a trade through the builder: validation, then the offer shows as pending', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'trade-outgoing-pending', {
    idle: ['p2', 'p3', 'p4'],
  })
  // Withdraw the fixture's own offer first so the proposal below is the only one.
  const existing = room.fixture.expect.pending_trades[0]
  await page.getByTestId(`trade-cancel-${existing.trade_id}`).click()
  await expect(page.getByText('No pending offers')).toBeVisible()
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
  await builder.getByTestId('stepper-increment').first().click()
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
