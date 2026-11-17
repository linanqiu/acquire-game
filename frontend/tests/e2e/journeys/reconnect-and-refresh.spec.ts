/**
 * Journey 5: refresh and reconnect mid-game.
 *
 * Alice and Bob (two browsers) and a bot. Alice reloads the page (a) at the start of
 * her turn, (b) mid-turn after placing a tile and before buying, (c) while Bob's trade
 * offer to her is pending (Bob reloads too, with his offer outgoing). Each time her
 * hand, phase, cash, holdings and the offer must be back. Then Alice's browser goes
 * offline: the reconnection overlay appears; back online, the game resumes and both
 * keep playing.
 */
import type { Page } from '@playwright/test'
import { test, expect } from './support/journey'
import { addBot, createGame, joinGame, seatName, startGame } from './support/lobby'
import { Seat, installObservers, myCash, playTogether } from './support/play'
import { incomingFrom, outgoingTo, proposeTrade } from './support/trade'

interface Snapshot {
  phase: string
  rack: string[]
  cash: number
  holdings: Record<string, number>
}

async function rackTiles(page: Page): Promise<string[]> {
  const ids = await page
    .getByTestId('tile-rack')
    .locator('[data-testid^="tile-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''))
  return ids.map((id) => id.replace('tile-', '')).sort()
}

async function snapshot(seat: Seat, myId: string): Promise<Snapshot> {
  return {
    phase: await seat.phaseText(),
    rack: await rackTiles(seat.page),
    cash: await seat.cash(),
    holdings: await seat.holdings(myId),
  }
}

async function reloadAndCompare(seat: Seat, myId: string, label: string): Promise<Snapshot> {
  const before = await snapshot(seat, myId)
  seat.log(`reload (${label}); before: ${JSON.stringify(before)}`)
  await seat.shot(`${label}-before-reload`)
  await seat.page.reload()
  await expect(seat.phase()).toHaveText(before.phase)
  await expect.poll(() => rackTiles(seat.page)).toEqual(before.rack)
  await expect(myCash(seat.page)).toHaveText(`$${before.cash.toLocaleString('en-US')}`)
  expect(await seat.holdings(myId)).toEqual(before.holdings)
  await seat.shot(`${label}-after-reload`)
  return before
}

test('reconnect and refresh: reloads mid-turn and with a pending offer, offline/online', async ({
  page: a,
  browser,
  journey: j,
}) => {
  test.setTimeout(240_000)
  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  j.watch(b, 'p2')
  await installObservers(a)
  await installObservers(b)

  const room = await createGame(a, j, 'Alice')
  await joinGame(b, j, 'Bob', room)
  await addBot(a, j)
  const botName = await seatName(a, 'bot')
  await startGame(a, j)
  const alice = new Seat(a, j, 'alice', { maxShares: 2, cashReserve: 1500 })
  const bob = new Seat(b, j, 'bob', { maxShares: 2, cashReserve: 1500 })
  const aliceId = await alice.myId()

  expect(await playTogether([alice, bob], 2)).toBe(true)

  // (a) Start of Alice's turn.
  await expect(alice.phase()).toHaveText('PLACE A TILE')
  const startSnap = await reloadAndCompare(alice, aliceId, 'reload-start-of-turn')
  expect(startSnap.rack).toHaveLength(6)
  await expect(a.getByTestId('tile-rack').locator('[role="button"]').first()).toBeVisible()

  // (b) Mid-turn: placed, not yet bought.
  await alice.placeTile()
  while ((await alice.phaseText()) !== 'BUY STOCKS') await alice.act()
  const midSnap = await reloadAndCompare(alice, aliceId, 'reload-mid-turn')
  expect(midSnap.rack, 'placed tile gone, no new tile drawn before the turn ends').toHaveLength(5)
  await expect(a.getByTestId('end-turn-button')).toBeEnabled()
  await alice.buyAndEnd()

  // (c) A pending offer survives reloads on both sides.
  await expect
    .poll(() => bob.phaseText())
    .toMatch(new RegExp(`PLACE A TILE|Alice's TURN|${botName}'s TURN`))
  await proposeTrade(bob, { partner: 'Alice', offerCash: 200, wantCash: 100 }, 'offer-to-alice')
  await expect(incomingFrom(a, 'Bob')).toBeVisible()
  await alice.shot('offer-pending')
  await reloadAndCompare(alice, aliceId, 'reload-offer-pending')
  await expect(incomingFrom(a, 'Bob'), 'incoming offer restored after reload').toBeVisible()
  await expect(incomingFrom(a, 'Bob')).toContainText('$200')
  await b.reload()
  await expect(outgoingTo(b, 'Alice'), 'outgoing offer restored after reload').toBeVisible()
  await bob.shot('offer-outgoing-after-reload')
  const cashBefore = await alice.cash()
  await incomingFrom(a, 'Bob').getByRole('button', { name: 'ACCEPT' }).click()
  await expect(b.getByText('Alice accepted your offer')).toBeVisible()
  await expect(myCash(a)).toHaveText(`$${(cashBefore + 100).toLocaleString('en-US')}`)
  await expect(outgoingTo(b, 'Alice')).toHaveCount(0)
  await alice.shot('offer-accepted-after-reload')

  // Keep playing after the reloads.
  expect(await playTogether([alice, bob], 2)).toBe(true)

  // (d) Offline -> overlay -> online -> resumes.
  j.allow(/WebSocket connection to .* failed/)
  j.allow(/ERR_INTERNET_DISCONNECTED/)
  j.log('(alice) go offline')
  await a.context().setOffline(true)
  const overlay = a.getByRole('dialog')
  await expect(overlay).toBeVisible({ timeout: 20_000 })
  await expect(overlay).toContainText(/RECONNECTING|CONNECTION LOST/)
  await alice.shot('offline-overlay')
  j.log('(alice) back online')
  await a.context().setOffline(false)
  await expect(overlay).toBeHidden({ timeout: 40_000 })
  const toast = a.getByTestId('reconnected-toast')
  await expect(toast).toBeVisible()
  await expect(toast).toContainText('Welcome back, Alice!')
  await alice.shot('reconnected')
  await a.getByTestId('continue-playing').click()
  await expect(toast).toBeHidden()

  expect(await playTogether([alice, bob], 2)).toBe(true)
  j.log(`turns: alice ${alice.turnsCompleted}, bob ${bob.turnsCompleted}`)
  await alice.shot('after-reconnect-played')
  await ctxB.close()
})
