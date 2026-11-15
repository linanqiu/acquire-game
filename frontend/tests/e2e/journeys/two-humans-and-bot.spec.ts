/**
 * Journey 2: two humans on two browsers plus a bot.
 *
 * Alice creates from the home page, Bob joins from the home page by typing the room
 * code, Alice adds a bot and starts. Both play at least 10 turns each through the UI.
 * Along the way: Alice -> Bob trade accepted, Bob -> Alice trade rejected, Alice -> Bob
 * trade canceled; cash and holdings are checked on both screens after each, and each
 * player sees the other's tiles appear live.
 */
import type { Page } from '@playwright/test'
import { test, expect } from './support/journey'
import { addBot, createGame, expectInLobby, joinGame, seatName, startGame } from './support/lobby'
import { Seat, installObservers, parseMoney, playTogether } from './support/play'
import { incomingFrom, outgoingTo, proposeTrade, tradePanel } from './support/trade'
import { openTab } from '../support/tabs'

const TURNS_EACH = 11

async function cashOf(page: Page, playerId: string): Promise<number> {
  return parseMoney((await page.getByTestId(`player-cash-${playerId}`).textContent()) ?? '')
}

test('two humans and a bot: join by code, play, trade accept/reject/cancel', async ({
  page: a,
  browser,
  journey: j,
}) => {
  test.setTimeout(300_000)
  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  j.watch(b, 'p2')
  await installObservers(a)
  await installObservers(b)

  // --- Create, join by code, add bot, start -----------------------------------------
  const room = await createGame(a, j, 'Alice')
  await joinGame(b, j, 'Bob', room)
  await expectInLobby(a, ['Alice', 'Bob'])
  await expect(a.getByText('2/6 players')).toBeVisible()
  await j.shot(a, 'alice-lobby-sees-bob')
  await expect(a.getByRole('button', { name: 'START GAME' })).toBeDisabled()
  await addBot(a, j)
  await expectInLobby(b, ['Alice', 'Bob', await seatName(a, 'bot')])
  await j.shot(b, 'bob-lobby-sees-bot')
  await startGame(a, j)
  await expect(b.getByTestId('tile-rack')).toBeVisible()
  await j.shot(b, 'bob-game-started')

  const alice = new Seat(a, j, 'alice', { maxShares: 2, cashReserve: 1500 })
  const bob = new Seat(b, j, 'bob', { maxShares: 2, cashReserve: 1500 })
  const aliceId = await alice.myId()
  const bobId = await bob.myId()

  // Each sees the other's tile land on their own board, live.
  const seesLive = (viewer: Seat, actor: string) => async (coord: string) => {
    const board = viewer.page.getByTestId('board')
    if (!(await board.isVisible())) {
      viewer.log(`(board hidden while ${actor} placed ${coord}; live check skipped this time)`)
      return
    }
    await expect(board.getByTestId(`tile-${coord}`)).not.toHaveAttribute('data-chain', 'empty')
  }
  alice.onPlaced = seesLive(bob, 'alice')
  bob.onPlaced = seesLive(alice, 'bob')

  /** Both screens agree on both players' cash, and return it. */
  async function cashBoth(): Promise<{ alice: number; bob: number }> {
    const ca = await cashOf(a, aliceId)
    const cb = await cashOf(a, bobId)
    await expect(b.getByTestId(`player-cash-${aliceId}`)).toHaveText(
      `$${ca.toLocaleString('en-US')}`
    )
    await expect(b.getByTestId(`player-cash-${bobId}`)).toHaveText(`$${cb.toLocaleString('en-US')}`)
    return { alice: ca, bob: cb }
  }
  async function stocksBoth(pid: string, chain: string): Promise<number> {
    const read = async (p: Page) => {
      const el = p.getByTestId(`player-stock-${pid}-${chain}`)
      return (await el.count()) ? Number(await el.textContent()) : 0
    }
    const onA = await read(a)
    await expect.poll(() => read(b)).toBe(onA)
    return onA
  }
  async function firstHolding(seat: Seat, pid: string): Promise<string> {
    const h = await seat.holdings(pid)
    const chain = Object.keys(h).find((c) => h[c] > 0)
    if (!chain) throw new Error(`${seat.who} holds no stock to trade`)
    return chain
  }

  // --- 4 turns each, then Alice -> Bob, Bob accepts ---------------------------------
  expect(await playTogether([alice, bob], 4)).toBe(true)
  {
    const chain = await firstHolding(alice, aliceId)
    const before = await cashBoth()
    const aliceStock = await stocksBoth(aliceId, chain)
    const bobStock = await stocksBoth(bobId, chain)
    await proposeTrade(
      alice,
      { partner: 'Bob', offerStocks: { [chain]: 1 }, wantCash: 300 },
      'trade1'
    )
    const offer = incomingFrom(b, 'Alice')
    await expect(offer).toBeVisible()
    await expect(offer).toContainText('offers you a trade')
    await expect(offer).toContainText('$300')
    await expect(b.getByText('Alice sent you a trade offer')).toBeVisible()
    await expect(outgoingTo(a, 'Bob')).toBeVisible()
    await bob.shot('trade1-incoming')
    j.log(`(bob) accept Alice's offer: 1 ${chain} for $300`)
    await offer.getByRole('button', { name: 'ACCEPT' }).click()
    await expect(a.getByText('Bob accepted your offer')).toBeVisible()
    await expect(b.getByText('Trade with Alice completed')).toBeVisible()
    await expect(offer).toHaveCount(0)
    await expect(outgoingTo(a, 'Bob')).toHaveCount(0)
    await expect.poll(async () => (await cashBoth()).alice).toBe(before.alice + 300)
    expect((await cashBoth()).bob).toBe(before.bob - 300)
    expect(await stocksBoth(aliceId, chain)).toBe(aliceStock - 1)
    expect(await stocksBoth(bobId, chain)).toBe(bobStock + 1)
    await alice.shot('trade1-accepted')
    await bob.shot('trade1-accepted')
  }

  // --- 3 more turns each, then Bob -> Alice, Alice rejects -------------------------
  expect(await playTogether([alice, bob], 3)).toBe(true)
  {
    const chain = await firstHolding(alice, aliceId)
    const before = await cashBoth()
    const aliceStock = await stocksBoth(aliceId, chain)
    await proposeTrade(
      bob,
      { partner: 'Alice', offerCash: 200, wantStocks: { [chain]: 1 } },
      'trade2'
    )
    const offer = incomingFrom(a, 'Bob')
    await expect(offer).toBeVisible()
    await expect(a.getByTestId('trade-incoming-count')).toHaveText('1 NEW')
    await alice.shot('trade2-incoming')
    j.log(`(alice) reject Bob's offer: $200 for 1 ${chain}`)
    await offer.getByRole('button', { name: 'REJECT' }).click()
    await expect(b.getByText('Alice rejected your offer')).toBeVisible()
    await expect(a.getByText('Offer rejected')).toBeVisible()
    await expect(offer).toHaveCount(0)
    await expect(outgoingTo(b, 'Alice')).toHaveCount(0)
    expect(await cashBoth()).toEqual(before)
    expect(await stocksBoth(aliceId, chain)).toBe(aliceStock)
    await bob.shot('trade2-rejected')
  }

  // --- 2 more turns each, then Alice -> Bob and Alice cancels -----------------------
  expect(await playTogether([alice, bob], 2)).toBe(true)
  {
    const before = await cashBoth()
    const outgoing = await proposeTrade(
      alice,
      { partner: 'Bob', offerCash: 100, wantCash: 50 },
      'trade3'
    )
    const offer = incomingFrom(b, 'Alice')
    await expect(offer).toBeVisible()
    await bob.shot('trade3-incoming')
    await expect(outgoing).toContainText('waiting')
    j.log('(alice) cancel her offer to Bob')
    await outgoing.getByRole('button', { name: 'CANCEL OFFER' }).click()
    await expect(a.getByText('Offer canceled')).toBeVisible()
    await expect(b.getByText('Alice withdrew their offer')).toBeVisible()
    await expect(offer).toHaveCount(0)
    await expect(outgoingTo(a, 'Bob')).toHaveCount(0)
    await expect(b.getByTestId('trade-incoming')).toHaveCount(0)
    await openTab(b, 'trades')
    await expect(tradePanel(b)).toContainText('No offers of yours pending')
    expect(await cashBoth()).toEqual(before)
    await alice.shot('trade3-canceled')
  }

  // --- Play on to at least TURNS_EACH turns each ------------------------------------
  const rest = TURNS_EACH - alice.turnsCompleted
  const stillPlaying = await playTogether([alice, bob], Math.max(rest, 0))
  j.log(
    `turns: alice ${alice.turnsCompleted}, bob ${bob.turnsCompleted}; still playing ${stillPlaying}; ` +
      `alice ${JSON.stringify(alice.stats)}; bob ${JSON.stringify(bob.stats)}`
  )
  // Seeded path: Bob picks a surviving chain in a tie and both dispose of stock.
  expect(
    alice.stats.survivorChoices.length + bob.stats.survivorChoices.length,
    'a survivor choice happened'
  ).toBeGreaterThan(0)
  expect(
    alice.stats.dispositions.length + bob.stats.dispositions.length,
    'humans disposed of stock'
  ).toBeGreaterThan(0)
  expect(alice.turnsCompleted).toBeGreaterThanOrEqual(10)
  expect(bob.turnsCompleted).toBeGreaterThanOrEqual(10)
  await cashBoth()
  await j.shot(a, 'alice-final')
  await j.shot(b, 'bob-final')
  await ctxB.close()
})
