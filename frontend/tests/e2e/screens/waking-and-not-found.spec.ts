import { test, expect } from './support/test'

// States of a sleeping or unhealthy host, and ids the server does not know. Server faults are
// simulated by routing one API call (never the game state); "not found" pages hit the real server.

test('home page: waking the server note while the health check is retried, then it goes away', async ({
  page,
  guard,
  shots,
}) => {
  guard.allow(/Failed to load resource: the server responded with a status of 503/)
  let calls = 0
  await page.route('**/api/health', (route) => {
    calls += 1
    if (calls <= 2) return route.fulfill({ status: 503, body: 'starting' })
    return route.continue()
  })
  await page.goto('/')
  await expect(page.getByTestId('waking-server')).toBeVisible()
  await expect(page.getByTestId('waking-server')).toContainText('Waking the server')
  await shots.take(page, 'waking')
  // The forms are usable meanwhile, and once the server answers the note is gone.
  await expect(page.getByTestId('create-button')).toBeEnabled()
  await expect(page.getByTestId('waking-server')).toHaveCount(0)
  await expect(page.getByTestId('server-down')).toHaveCount(0)
  expect(calls).toBeGreaterThanOrEqual(3)
})

test('home page: server not answering shows a notice with TRY AGAIN that recovers', async ({
  page,
  guard,
  shots,
}) => {
  guard.allow(/Failed to load resource: the server responded with a status of 500/)
  await page.route('**/api/health', (route) => route.fulfill({ status: 500, body: 'down' }))
  await page.goto('/')
  await expect(page.getByTestId('server-down')).toContainText('The server is not answering yet.')
  await shots.take(page, 'server-down')

  await page.unroute('**/api/health')
  await page.getByTestId('server-retry').click()
  await expect(page.getByTestId('server-down')).toHaveCount(0)
  await shots.take(page, 'recovered')
})

test('games list: empty, server error with TRY AGAIN, and unreachable server', async ({
  page,
  guard,
  shots,
}) => {
  guard.allow(/Failed to load resource/)
  // No games recorded yet.
  await page.route('**/api/games?*', (route) => route.fulfill({ json: { games: [], next: null } }))
  await page.goto('/games')
  await expect(page.getByTestId('games-empty')).toBeVisible()
  await shots.take(page, 'games-empty')

  // The server errors: the error view offers TRY AGAIN; the real list comes back once it is healthy.
  await page.unroute('**/api/games?*')
  await page.route('**/api/games?*', (route) =>
    route.fulfill({ status: 500, json: { detail: 'boom' } })
  )
  await page.getByTestId('refresh-games').click()
  await expect(page.getByTestId('error-server')).toBeVisible()
  await shots.take(page, 'games-server-error')
  await page.unroute('**/api/games?*')
  await page.getByTestId('retry-button').click()
  await expect(page.getByTestId('error-server')).toHaveCount(0)
  await expect(page.getByTestId('filter-all')).toBeVisible()

  // The request never reaches the server: it is retried (with the waking note) before giving up.
  test.setTimeout(60_000)
  await page.route('**/api/games?*', (route) => route.abort('connectionfailed'))
  await page.goto('/games')
  await expect(page.getByTestId('waking-server')).toBeVisible()
  await expect(page.getByTestId('error-network')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('waking-server')).toHaveCount(0)
  await expect(page.getByTestId('error-network')).toContainText("Can't reach the server")
  await shots.take(page, 'games-unreachable')
})

test('unknown transcript and unknown benchmark series show a not-found page with a way back', async ({
  page,
  guard,
  shots,
}) => {
  guard.allow(/Failed to load resource: the server responded with a status of 404/)
  await page.goto('/games/no-such-game')
  await expect(page.getByTestId('error-not-found')).toContainText("We couldn't find that game")
  await shots.take(page, 'transcript-not-found')
  await page.getByRole('link', { name: 'Games & transcripts' }).last().click()
  await page.waitForURL(/\/games$/)

  await page.goto('/bench/series/no-such-series')
  await expect(page.getByTestId('error-not-found')).toContainText("We couldn't find that series")
  await shots.take(page, 'series-not-found')
  await page.getByRole('link', { name: 'Home' }).last().click()
  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.getByTestId('create-button')).toBeVisible()
})
