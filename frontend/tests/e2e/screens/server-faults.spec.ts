import { test, expect } from './support/test'

// Server faults simulated at the network edge (Playwright routing). The game state itself is
// never faked: the faults only refuse or alter what the browser would have fetched.

test('player page: a refused socket with no state shows the connection error, REFRESH recovers', async ({
  page,
  shots,
}) => {
  await page.goto('/')
  await page.getByTestId('name-input').fill('Alice')
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z0-9]{4}/)
  await expect(page.locator('[data-testid^="lobby-player-"]')).toHaveCount(1)

  // The server refuses the socket with a reason the page does not recognise (it is neither
  // "room not found" nor "player not found"), before any state arrives.
  let refuse = true
  await page.routeWebSocket(/\/ws\/player\//, (ws) => {
    if (refuse) ws.close({ code: 4004, reason: 'Backend unavailable' })
    else ws.connectToServer()
  })
  await page.reload()
  await expect(page.getByText('Connection error. Please refresh the page.')).toBeVisible()
  await expect(page.getByTestId('room-unavailable')).toHaveCount(0)
  await shots.take(page, 'connection-error')

  // Once the server is reachable again, REFRESH brings the lobby back.
  refuse = false
  await page.getByRole('button', { name: 'REFRESH' }).click()
  await expect(page.locator('[data-testid^="lobby-player-"]')).toHaveCount(1)
  await expect(page.getByText('Connection error. Please refresh the page.')).toHaveCount(0)
  await shots.take(page, 'recovered')
})

test('host page: a refused socket with no state shows the connection error, REFRESH recovers', async ({
  page,
  shots,
}) => {
  // The host lobby of an empty watch room (what "Choose the players of a new game" opens;
  // "Watch bots play" starts a show since LO-014).
  const created = await page.request.post('/api/create-spectator')
  expect(created.ok()).toBeTruthy()
  const { room_code: watchRoom } = (await created.json()) as { room_code: string }
  await page.goto(`/host/${watchRoom}`)
  await page.waitForURL(/\/host\/[A-Z0-9]{4}/)
  await expect(page.getByText('PLAYERS (0/6)')).toBeVisible()

  let refuse = true
  await page.routeWebSocket(/\/ws\/host\//, (ws) => {
    if (refuse) ws.close({ code: 4004, reason: 'Backend unavailable' })
    else ws.connectToServer()
  })
  await page.reload()
  await expect(page.getByText('Connection error. Please refresh the page.')).toBeVisible()
  await shots.take(page, 'host-connection-error')

  refuse = false
  await page.getByRole('button', { name: 'REFRESH' }).click()
  await expect(page.getByText('PLAYERS (0/6)')).toBeVisible()
  await shots.take(page, 'host-recovered')
})

test('AI menu: unavailable entries are disabled with a reason; a failed catalog leaves only ADD BOT', async ({
  page,
  guard,
  shots,
}) => {
  guard.allow(/Failed to load resource: the server responded with a status of 500/)
  const catalog = [
    {
      id: 'heuristic',
      kind: 'heuristic',
      label: 'Heuristic bot',
      description: 'Plays by rules of thumb.',
      available: true,
    },
    {
      id: 'llm:sonnet',
      kind: 'llm',
      label: 'Claude Sonnet',
      description: 'Needs an API key.',
      available: false,
    },
  ]
  await page.route('**/api/agents/catalog', (route) => route.fulfill({ json: catalog }))
  await page.goto('/')
  await page.getByTestId('name-input').fill('Alice')
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z0-9]{4}/)

  await page.getByTestId('add-ai-button').click()
  await expect(page.getByTestId('ai-menu')).toBeVisible()
  await expect(page.getByTestId('ai-option-heuristic')).toBeEnabled()
  const blocked = page.getByTestId('ai-option-llm:sonnet')
  await expect(blocked).toBeDisabled()
  await expect(blocked).toContainText('not configured on this server')
  await shots.take(page, 'catalog-with-unavailable-entry')
  // Clicking a disabled entry does nothing.
  await blocked.click({ force: true })
  await expect(page.locator('[data-testid^="lobby-player-"]')).toHaveCount(1)

  // Catalog request fails (older or unhealthy backend): no AI menu, the plain bot button works.
  await page.unroute('**/api/agents/catalog')
  await page.route('**/api/agents/catalog', (route) => route.fulfill({ status: 500, json: {} }))
  await page.reload()
  await expect(page.getByTestId('add-bot-button')).toBeVisible()
  await expect(page.getByTestId('add-ai-button')).toHaveCount(0)
  await page.getByTestId('add-bot-button').click()
  await expect(page.locator('[data-testid^="lobby-player-"]')).toHaveCount(2)
  await shots.take(page, 'catalog-failed')
})
