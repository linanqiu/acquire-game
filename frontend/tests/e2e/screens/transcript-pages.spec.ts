import { test, expect } from './support/test'
import { startFromSnapshot } from './support/room'

// The transcript pages as reached from a finished game. (The long journey through a live game's
// transcript, replay controls and the benchmark pages is tests/e2e/transcripts.)

test('snapshot game: transcript link, the "loaded from a snapshot" notice, and the games list row', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'game-over')
  await expect(page.getByTestId('game-over')).toBeVisible()
  await shots.take(page, 'game-over')

  await page.getByTestId('view-transcript-link').click()
  await page.waitForURL(/\/games\/.+/)
  await expect(page.getByTestId('transcript-viewer')).toBeVisible()
  // A game that started from a saved snapshot says so: it cannot be replayed from the deal.
  await expect(page.getByTestId('snapshot-banner')).toContainText('loaded from a saved snapshot')
  for (const p of room.fixture.expect.players) {
    await expect(page.getByTestId('summary-header')).toContainText(p.name)
  }
  await shots.take(page, 'transcript-snapshot-banner')

  // The same game is in the games list. (Its status is not asserted: the recorder never saw the
  // game being played, so a game loaded already finished is not marked finished: test mode only.)
  const gameId = decodeURIComponent(/\/games\/([^/?#]+)/.exec(page.url())![1])
  await page.goto('/games')
  const row = page.getByTestId(`game-row-${gameId}`)
  await expect(row).toBeVisible()
  await expect(row).toContainText('Room ' + room.code)
  await shots.take(page, 'games-list-row')
})

test('benchmark page: a server error offers TRY AGAIN and the real leaderboard comes back', async ({
  page,
  guard,
  shots,
}) => {
  guard.allow(/Failed to load resource: the server responded with a status of 500/)
  await page.route('**/api/bench/leaderboard*', (route) =>
    route.fulfill({ status: 500, json: { detail: 'boom' } })
  )
  await page.goto('/bench')
  await expect(page.getByTestId('error-server')).toBeVisible()
  await expect(page.getByTestId('error-server')).toContainText('Something went wrong loading')
  await shots.take(page, 'bench-server-error')

  await page.unroute('**/api/bench/leaderboard*')
  await page.getByTestId('retry-button').click()
  await expect(page.getByTestId('error-server')).toHaveCount(0)
  await expect(page.getByTestId('bench-protocol')).toBeVisible()
  await shots.take(page, 'bench-recovered')
})
