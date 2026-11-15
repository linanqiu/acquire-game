import type { BrowserContext, Page } from '@playwright/test'
import { test as base, expect } from './support/test'
import { startFromSnapshot, type RoomContext } from './support/room'
import { dollars, loadFixture } from './support/fixtures'
import { playHumanTurns } from './support/ui'

/** The seat the 'disposition-waiting-on-other' fixture is waiting on (read from the fixture). */
const WAITING_ON = loadFixture('disposition-waiting-on-other').expect.decisions[0]
  .player_id as string

/**
 * Open the host/spectator page for the same room in its own browser context (a second tab in
 * the same window would put the player page in the background and slow it down).
 */
const test = base.extend<{ openHost: (room: RoomContext) => Promise<Page> }>({
  openHost: async ({ browser, guard }, provide) => {
    const contexts: BrowserContext[] = []
    await provide(async (room) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      contexts.push(ctx)
      const host = await ctx.newPage()
      guard.watch(host, 'host')
      await host.goto(`/host/${room.code}`)
      return host
    })
    await Promise.all(contexts.map((c) => c.close()))
  },
})

const hostPhase = (host: Page) => host.getByTestId('game-phase')
const cards = (host: Page) => host.getByTestId('player-card')

/** The host sees the board, every active chain with size/price/stock left, every player's cash. */
async function expectHostMatchesFixture(host: Page, room: RoomContext) {
  const { active_chains, players } = room.fixture.expect
  await expect(host.getByTestId('board')).toBeVisible()
  for (const [chain, c] of Object.entries(active_chains)) {
    const marker = host.getByTestId('chain-list').getByTestId(`chain-marker-${chain.toLowerCase()}`)
    await expect(marker).toContainText(`${c.size} tiles`)
    await expect(marker).toContainText(dollars(c.price))
    await expect(marker).toContainText(`[${c.available}]`)
  }
  await expect(cards(host)).toHaveCount(players.length)
  for (const p of players) {
    const card = cards(host).filter({ hasText: p.name })
    await expect(card).toBeVisible()
    await expect(card.getByTestId('player-cash')).toHaveText(dollars(p.cash))
    for (const qty of Object.values(p.holdings)) {
      if (qty > 0) await expect(card.getByTestId('player-stocks')).toContainText(String(qty))
    }
  }
}

async function expectNoHorizontalScroll(host: Page) {
  const overflow = await host.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

test('host view of a busy mid-game board follows the players turn by turn', async ({
  page,
  openHost,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'three-player-midgame')
  const host = await openHost(room)
  const { current_player } = room.fixture.expect
  const currentName = room.names[room.seatMap[current_player]]

  await expect(hostPhase(host)).toHaveText(`${currentName}'s TURN - PLACE TILE`)
  await expectHostMatchesFixture(host, room)
  // The player whose turn it is carries the marker.
  await expect(
    cards(host).filter({ hasText: currentName }).getByTestId('turn-marker')
  ).toBeVisible()
  await expect(host.getByTestId('turn-marker')).toHaveCount(1)
  await expectNoHorizontalScroll(host)
  await shots.take(host, 'host-midgame')

  // The human places a tile on the player page; the host view moves on to the buy phase.
  const tiles = room.fixture.expect.decisions[0].legal.tiles as Array<{
    tile: string
    outcome: string
  }>
  // A tile that neither founds nor merges, so the turn goes straight to the buy phase.
  const simple = tiles.find((t) => t.outcome === 'nothing' || t.outcome === 'expand')
  if (!simple) throw new Error('three-player-midgame: the human holds no plain or expanding tile')
  await page.getByTestId('tile-rack').getByTestId(`tile-${simple.tile}`).click()
  await page.getByTestId('place-tile-button').click()
  await expect(hostPhase(host)).toHaveText(`${currentName}'s TURN - BUY STOCKS`)
  await expect(host.getByTestId('turn-marker')).toHaveCount(1)
  await shots.take(host, 'host-after-placing')
  await playHumanTurns(page, room, 3, shots)
})

test('host view of a merger in progress shows the merging state and who the table waits on', async ({
  page,
  openHost,
  shots,
}) => {
  // The seat the merger waits on is idle, so the merger stays in progress while the host looks.
  const room = await startFromSnapshot(page, 'disposition-waiting-on-other', { idle: [WAITING_ON] })
  const host = await openHost(room)
  const decider = room.names[room.seatMap[room.fixture.expect.decisions[0].player_id]]

  await expect(hostPhase(host)).toHaveText(`${decider}'s TURN - MERGER`)
  await expectHostMatchesFixture(host, room)
  await expect(cards(host).filter({ hasText: decider }).getByTestId('turn-marker')).toBeVisible()
  await shots.take(host, 'host-merger')

  // The merger finishes once the idle seat answers and the human disposes; the host follows.
  expect(await room.driveIdle()).toBe(true)
  await expect(page.getByTestId('merger-disposition')).toBeVisible()
  await page.getByTestId('confirm-disposition').click()
  await expect(hostPhase(host)).not.toHaveText(`${decider}'s TURN - MERGER`)
  await shots.take(host, 'host-after-merger')
  await playHumanTurns(page, room, 2, shots)
})

test('host view lists a pending trade between two players', async ({ page, openHost, shots }) => {
  const room = await startFromSnapshot(page, 'trade-outgoing-pending', { idle: ['p2'] })
  const host = await openHost(room)
  const trade = room.fixture.expect.pending_trades[0]
  const from = room.names[room.seatMap[trade.from_player_id]]
  const to = room.names[room.seatMap[trade.to_player_id]]

  const line = host.getByTestId(`pending-trade-${trade.trade_id}`)
  await expect(line).toBeVisible()
  await expect(line).toContainText(from)
  await expect(line).toContainText(to)
  await expect(line).toContainText('2 Sandpiper')
  await expect(line).toContainText(dollars(trade.requesting_money))
  await shots.take(host, 'host-pending-trade')

  // Cancelling on the player page empties the host's list.
  await page.getByTestId(`trade-cancel-${trade.trade_id}`).click()
  await expect(host.getByTestId('pending-trades')).toHaveCount(0)
  await playHumanTurns(page, room, 2, shots)
})

test('host view of a finished game shows the full results table', async ({
  page,
  openHost,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'game-over')
  const host = await openHost(room)
  const standings = (
    room.fixture.expect.game_over as { standings: Array<{ name: string; money: number }> }
  ).standings

  await expect(hostPhase(host)).toHaveText('GAME OVER')
  await expect(host.getByTestId('game-over')).toBeVisible()
  await expect(host.getByTestId('winner-announcement')).toContainText(standings[0].name)
  const table = host.getByTestId('full-breakdown')
  await expect(table).toBeVisible()
  const rows = table.locator('tbody tr')
  await expect(rows).toHaveCount(standings.length)
  for (const [i, s] of standings.entries()) {
    await expect(rows.nth(i)).toContainText(s.name)
    await expect(rows.nth(i)).toContainText(dollars(s.money))
  }
  // The server's game_over now carries the real end-of-game payouts (re-sent on connect),
  // so the breakdown columns are shown and each row adds up to the final total.
  await expect(table.locator('thead')).toContainText('Bonuses')
  await expect(table.locator('thead')).toContainText('Stocks sold')
  const money = (t: string) => Number(t.replace(/[^0-9]/g, ''))
  for (const [i, s] of standings.entries()) {
    const cells = (await rows.nth(i).locator('td').allTextContents()).map((t) => t.trim())
    const [, cash, bonuses, sales, total] = cells
    expect(money(total)).toBe(s.money)
    expect(money(cash) + money(bonuses) + money(sales)).toBe(s.money)
  }
  await shots.take(host, 'host-game-over')
})
