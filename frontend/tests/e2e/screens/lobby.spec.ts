import type { Page } from '@playwright/test'
import { test, expect } from './support/test'
import { playHumanTurns } from './support/ui'

// Lobby-phase screens (no snapshot: there is no game yet). Created from the home page; AI seats
// are added through the lobby's own ADD AI control (the test-mode catalog offers "Scripted").

const toast = (page: Page, text: string | RegExp) =>
  page.getByRole('alert').filter({ hasText: text }).last()

async function createGame(page: Page, name: string): Promise<string> {
  await page.goto('/')
  await page.getByTestId('create-name-input').fill(name)
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z0-9]{4}/)
  return /\/play\/([A-Z0-9]{4})/.exec(page.url())![1]
}

async function addScripted(page: Page) {
  await page.getByTestId('add-ai-button').click()
  await page.getByTestId('ai-option-scripted').click()
}

test('lobby: AI menu, START GAME needs three seats, removing a seat, then a real game starts', async ({
  page,
  shots,
}) => {
  const code = await createGame(page, 'Alice')
  await expect(page.getByText(code, { exact: true })).toBeVisible()
  await expect(page.getByText('1/6 players')).toBeVisible()
  await expect(page.getByRole('button', { name: 'START GAME' })).toBeDisabled()
  await shots.take(page, 'lobby-alone')

  // The AI menu lists the server's catalog; entries the server cannot run are shown disabled.
  const catalog = (await (await page.request.get('/api/agents/catalog')).json()) as Array<{
    id: string
    available: boolean
  }>
  await page.getByTestId('add-ai-button').click()
  await expect(page.getByTestId('ai-menu')).toBeVisible()
  for (const entry of catalog) {
    const option = page.getByTestId(`ai-option-${entry.id}`)
    await expect(option).toBeVisible()
    if (entry.available) {
      await expect(option).toBeEnabled()
    } else {
      await expect(option).toBeDisabled()
      await expect(option).toContainText('not configured on this server')
    }
  }
  expect(catalog.some((e) => !e.available)).toBe(true) // the disabled state really was exercised
  await shots.take(page, 'ai-menu')

  // Two seats are not enough; the third enables START.
  await page.getByTestId('ai-option-scripted').click()
  await expect(page.getByText('2/6 players')).toBeVisible()
  await expect(page.getByRole('button', { name: 'START GAME' })).toBeDisabled()
  await addScripted(page)
  await expect(page.getByText('3/6 players')).toBeVisible()
  await expect(page.getByRole('button', { name: 'START GAME' })).toBeEnabled()
  // Two scripted seats: each with its icon badge, whose accessible name says what it is.
  await expect(page.getByRole('button', { name: /^Scripted test seat/ })).toHaveCount(2)
  await expect(
    page.locator('[data-testid^="lobby-player-"]', { hasText: 'Scripted 1' })
  ).toHaveCount(1)
  await expect(
    page.locator('[data-testid^="lobby-player-"]', { hasText: 'Scripted 2' })
  ).toHaveCount(1)
  await shots.take(page, 'lobby-three-seats')

  // Remove a seat: back to two, START disabled again.
  await page.locator('[data-testid^="remove-seat-"]').first().click()
  await expect(page.getByText('2/6 players')).toBeVisible()
  await expect(page.getByRole('button', { name: 'START GAME' })).toBeDisabled()
  await addScripted(page)
  await expect(page.getByRole('button', { name: 'START GAME' })).toBeEnabled()

  await page.getByRole('button', { name: 'START GAME' }).click()
  await expect(page.getByTestId('game-phase')).toBeVisible()
  await expect(page.getByTestId('tile-rack')).toBeVisible()
  await shots.take(page, 'game-started')
  await playHumanTurns(page, null, 2, shots)
})

test('unknown URL shows the not-found page with a way back', async ({ page, shots }) => {
  await page.goto('/this/page/does/not/exist')
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
  await expect(page.getByText('Page not found')).toBeVisible()
  await shots.take(page, 'not-found')
  await page.getByRole('button', { name: 'Back to Lobby' }).click()
  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.getByTestId('create-button')).toBeVisible()
})

test('failures show a toast: create game, add bot, start game', async ({ page, guard, shots }) => {
  guard.allow(/Failed to load resource/, /Failed to add bot/, /Failed to start game/)

  // Create fails with a server error.
  await page.route('**/api/create', (route) =>
    route.fulfill({ status: 500, json: { detail: 'Server exploded' } })
  )
  await page.goto('/')
  await page.getByTestId('create-name-input').fill('Alice')
  await page.getByTestId('create-button').click()
  await expect(toast(page, 'Server exploded')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  await shots.take(page, 'create-failed')
  await page.unroute('**/api/create')

  // In the lobby: adding a bot and starting the game fail.
  await createGame(page, 'Alice')
  await page.route('**/api/room/*/add-bot', (route) => route.fulfill({ status: 500, json: {} }))
  await page.getByTestId('add-bot-button').click()
  await expect(toast(page, 'Failed to add bot')).toBeVisible()

  await page.unroute('**/api/room/*/add-bot')
  await page.getByTestId('add-bot-button').click()
  await page.getByTestId('add-bot-button').click()
  await expect(page.getByText('3/6 players')).toBeVisible()
  await page.route('**/api/room/*/start', (route) => route.fulfill({ status: 500, json: {} }))
  await page.getByRole('button', { name: 'START GAME' }).click()
  await expect(toast(page, 'Failed to start game')).toBeVisible()
  await expect(page.getByRole('button', { name: 'START GAME' })).toBeEnabled() // can try again
  await shots.take(page, 'start-failed')
})

test('host/spectator lobby: add AI and start failures show a toast', async ({
  page,
  guard,
  shots,
}) => {
  guard.allow(/Failed to load resource/, /Failed to add bot/, /Failed to start game/)
  await page.goto('/')
  await page.getByTestId('watch-bots-button').click()
  await page.waitForURL(/\/host\/[A-Z0-9]{4}/)
  await expect(page.getByText('WAITING', { exact: false }).first()).toBeVisible()
  await shots.take(page, 'host-lobby')

  await page.route('**/api/room/*/add-bot', (route) => route.fulfill({ status: 500, json: {} }))
  await page.getByTestId('add-bot-button').click()
  await expect(toast(page, 'Failed to add bot')).toBeVisible()
  await page.unroute('**/api/room/*/add-bot')

  for (let i = 1; i <= 3; i++) {
    await page.getByTestId('add-bot-button').click()
    await expect(page.getByText(`PLAYERS (${i}/6)`)).toBeVisible()
  }
  await page.route('**/api/room/*/start', (route) => route.fulfill({ status: 500, json: {} }))
  await page.getByRole('button', { name: 'START GAME' }).click()
  await expect(toast(page, 'Failed to start game')).toBeVisible()
  await shots.take(page, 'host-start-failed')
})
