import type { Page } from '@playwright/test'
import { test, expect } from './support/test'
import { startFromSnapshot, type RoomContext } from './support/room'
import { dollars } from './support/fixtures'
import { myCash, phaseBanner, playHumanTurns } from './support/ui'

interface Standing {
  name: string
  money: number
  rank: number
}

/** The final standings the engine reports in the fixture, in table order. */
function fixtureStandings(room: RoomContext): Standing[] {
  const over = room.fixture.expect.game_over as { standings: Standing[] }
  return over.standings
}

/** Game-over screen lists every player, best first, with their final cash. */
async function expectStandings(page: Page, standings: Standing[]) {
  await expect(page.getByTestId('game-over')).toBeVisible()
  await expect(page.getByTestId('rankings').locator('[data-testid^="rank-"]')).toHaveCount(
    standings.length
  )
  const rows = page.getByTestId('rankings').locator('[data-testid^="rank-"]')
  for (const [i, s] of standings.entries()) {
    await expect(rows.nth(i)).toContainText(s.name)
    await expect(rows.nth(i)).toContainText(dollars(s.money))
  }
}

test('end game available: END GAME is offered while placing a tile, declaring it ends the game', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'end-game-available')
  const { decisions } = room.fixture.expect
  expect(decisions[0].legal.action_types).toContain('declare_end_game')
  await expect(phaseBanner(page)).toHaveText('PLACE A TILE')
  await expect(page.getByTestId('end-game-button')).toBeVisible()
  await shots.take(page, 'end-game-offered')

  await page.getByTestId('end-game-button').click()
  await expect(phaseBanner(page)).toHaveText('GAME OVER')
  await expect(page.getByTestId('game-over')).toBeVisible()
  await expect(page.getByTestId('winner-announcement')).toContainText('WINNER')
  await expect(page.getByTestId('tile-rack')).toHaveCount(0)
  await shots.take(page, 'game-over')

  // The standings on screen are the live game's final cash, best first.
  const live = await room.liveSnapshot()
  const byMoney = [...live.players].sort((a, b) => b.money - a.money)
  const rows = page.getByTestId('rankings').locator('[data-testid^="rank-"]')
  await expect(rows).toHaveCount(live.players.length)
  for (const [i, p] of byMoney.entries()) {
    await expect(rows.nth(i)).toContainText(room.names[p.player_id])
    await expect(rows.nth(i)).toContainText(dollars(p.money))
  }
})

test('end game available: not declaring keeps the game going, END GAME also shows in the buy phase', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'end-game-available')
  await expect(page.getByTestId('end-game-button')).toBeVisible()

  // Ignore END GAME and place a tile: the buy phase offers it again.
  await page.locator('[data-testid="tile-rack"] [role="button"]').first().click()
  await page.getByTestId('place-tile-button').click()
  await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
  await expect(page.getByTestId('end-game-button')).toBeVisible()
  await shots.take(page, 'buy-phase-end-game')

  // Skip buying and play two more full turns: the game is live.
  await playHumanTurns(page, room, 3, shots)
  await expect(page.getByTestId('game-over')).toHaveCount(0)
})

test('last turn before game over: declare from the buy phase', async ({ page, shots }) => {
  const room = await startFromSnapshot(page, 'last-turn-before-game-over')
  const { human } = room.fixture.expect
  await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
  await expect(myCash(page)).toHaveText(dollars(human.cash))
  await expect(page.getByTestId('end-game-button')).toBeVisible()
  await shots.take(page, 'buy-phase-end-game')

  await page.getByTestId('end-game-button').click()
  await expect(page.getByTestId('game-over')).toBeVisible()
  await expect(phaseBanner(page)).toHaveText('GAME OVER')
  await expect(page.getByTestId('winner-announcement')).toContainText('WINNER')
  await shots.take(page, 'game-over')
  // The declared end paid out: the human's final cash is at least what they had.
  const live = await room.liveSnapshot()
  expect(live.phase).toBe('game_over')
  const me = live.players.find((p) => p.player_id === room.humanId)!
  expect(me.money).toBeGreaterThanOrEqual(human.cash)
  await expect(page.getByTestId('breakdown')).toContainText(dollars(me.money))
})

test('game over: standings, single winner, play again returns to the home page', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'game-over')
  const standings = fixtureStandings(room)
  await shots.take(page, 'game-over')

  await expect(phaseBanner(page)).toHaveText('GAME OVER')
  await expect(page.getByTestId('winner-announcement')).toContainText('WINNER')
  await expect(page.getByTestId('winner-announcement')).toContainText(standings[0].name)
  await expect(page.getByTestId('winner-announcement')).not.toContainText('TIE')
  await expectStandings(page, standings)
  // The winner's total is said once on the screen: in the standings (the human is Alice, the
  // winner here). Not again under the name, in a one-line "breakdown", or in the header.
  await expect(page.getByText(dollars(standings[0].money), { exact: true })).toHaveCount(1)
  await expect(page.getByTestId('rankings').getByText(dollars(standings[0].money))).toBeVisible()
  await expect(page.getByTestId('header-cash')).toHaveCount(0)
  // A snapshot carries no breakdown of the final payouts: the page says what the totals are.
  await expect(page.getByTestId('breakdown')).toHaveCount(0)
  await expect(page.getByTestId('totals-note')).toHaveText(
    'Totals are final cash: bonuses and share sales are included.'
  )
  // The phase bar says GAME OVER; the card does not repeat it as its title.
  await expect(page.getByText('GAME OVER', { exact: true })).toHaveCount(1)
  // Nothing from the in-game screen is left over.
  await expect(page.getByTestId('tile-rack')).toHaveCount(0)
  await expect(page.getByTestId('end-turn-button')).toHaveCount(0)

  await page.getByTestId('play-again').click()
  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.getByTestId('create-button')).toBeVisible()
  await shots.take(page, 'home-after-play-again')
})

test('game over with a tie: both leaders announced, ranked equally', async ({ page, shots }) => {
  const room = await startFromSnapshot(page, 'game-over-tie')
  const standings = fixtureStandings(room)
  const [first, second] = standings
  expect(first.money).toBe(second.money)
  await shots.take(page, 'game-over-tie')

  const announcement = page.getByTestId('winner-announcement')
  await expect(announcement).toContainText('TIE GAME')
  await expect(announcement).toContainText(first.name)
  await expect(announcement).toContainText(second.name)
  // What each of them ends with is in their rows of the standings.
  await expect(announcement).not.toContainText('$')
  await expectStandings(page, standings)
  // Both tied players show rank 1.
  const rows = page.getByTestId('rankings').locator('[data-testid^="rank-"]')
  await expect(rows.nth(0)).toContainText('1.')
  await expect(rows.nth(1)).toContainText('1.')
  await expect(rows.nth(2)).toContainText('3.')

  // One way out: PLAY AGAIN goes home (a second button to the same place is gone, BL-015).
  await expect(page.getByTestId('back-to-lobby')).toHaveCount(0)
  await page.getByTestId('play-again').click()
  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.getByTestId('create-button')).toBeVisible()
})
