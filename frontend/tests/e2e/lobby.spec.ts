import { test, expect } from '@playwright/test'
import { createRoom } from './helpers/api'

test.describe('Lobby Page', () => {
  test.describe('UI Elements', () => {
    test('displays the title and subtitle', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'ACQUIRE' })).toBeVisible()
      await expect(page.getByText('A classic board game of hotel chains and mergers')).toBeVisible()
    })

    test('displays game metadata', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByText(/3-6 players/)).toBeVisible()
      await expect(page.getByText(/~60 min/)).toBeVisible()
    })

    test('displays Create Game form', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByText('CREATE GAME')).toBeVisible()
      await expect(page.getByTestId('create-name-input')).toBeVisible()
      await expect(page.getByTestId('create-button')).toBeVisible()
    })

    test('displays Join Game form', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByText('JOIN GAME')).toBeVisible()
      await expect(page.getByTestId('join-name-input')).toBeVisible()
      await expect(page.getByTestId('join-room-input')).toBeVisible()
      await expect(page.getByTestId('join-button')).toBeVisible()
    })
  })

  test.describe('Create Game', () => {
    test('shows validation error when name is empty', async ({ page }) => {
      await page.goto('/')
      await page.getByTestId('create-button').click()
      await expect(page.getByText('Name is required')).toBeVisible()
    })

    test('creates game and redirects to player view with is_host flag', async ({ page }) => {
      await page.goto('/')

      await page.getByTestId('create-name-input').fill('TestHost')
      await page.getByTestId('create-button').click()

      // Should redirect to /play/:room?is_host=1
      await page.waitForURL(/\/play\/[A-Z]{4}\?is_host=1/)

      // Should store session data
      const playerId = await page.evaluate(() => sessionStorage.getItem('player_id'))
      const sessionToken = await page.evaluate(() => sessionStorage.getItem('session_token'))
      expect(playerId).toBeTruthy()
      expect(sessionToken).toBeTruthy()
    })

    test('trims whitespace from name', async ({ page }) => {
      await page.goto('/')

      await page.getByTestId('create-name-input').fill('  TestHost  ')
      await page.getByTestId('create-button').click()

      // Should redirect successfully
      await page.waitForURL(/\/play\/[A-Z]{4}\?is_host=1/)

      // Check stored name is trimmed
      const playerName = await page.evaluate(() => sessionStorage.getItem('player_name'))
      expect(playerName).toBe('TestHost')
    })
  })

  test.describe('Join Game', () => {
    test('shows validation error when name is empty', async ({ page }) => {
      await page.goto('/')
      await page.getByTestId('join-room-input').fill('ABCD')
      await page.getByTestId('join-button').click()
      await expect(page.getByText('Name is required')).toBeVisible()
    })

    test('shows validation error when room code is too short', async ({ page }) => {
      await page.goto('/')
      await page.getByTestId('join-name-input').fill('TestPlayer')
      await page.getByTestId('join-room-input').fill('AB')
      await page.getByTestId('join-button').click()
      await expect(page.getByText('Room code must be 4 characters')).toBeVisible()
    })

    test('auto-capitalizes room code', async ({ page }) => {
      await page.goto('/')
      const roomInput = page.getByTestId('join-room-input')
      await roomInput.fill('abcd')
      await expect(roomInput).toHaveValue('ABCD')
    })

    test('shows error for non-existent room', async ({ page }) => {
      await page.goto('/')
      await page.getByTestId('join-name-input').fill('TestPlayer')
      await page.getByTestId('join-room-input').fill('ZZZZ')
      await page.getByTestId('join-button').click()

      // Should show error message - use first() to handle multiple matching elements
      await expect(page.getByText(/not found|Room not found/i).first()).toBeVisible({
        timeout: 5000,
      })
    })

    test('joins existing room and redirects', async ({ page, request }) => {
      // First, create a room via API
      const hostResult = await createRoom(request, 'TestHost')
      const roomCode = hostResult.room_code

      // Now join via the UI
      await page.goto('/')
      await page.getByTestId('join-name-input').fill('TestPlayer')
      await page.getByTestId('join-room-input').fill(roomCode)
      await page.getByTestId('join-button').click()

      // Should redirect to /play/:room (without is_host flag)
      await page.waitForURL(new RegExp(`/play/${roomCode}$`))

      // Should store session data
      const playerId = await page.evaluate(() => sessionStorage.getItem('player_id'))
      const sessionToken = await page.evaluate(() => sessionStorage.getItem('session_token'))
      expect(playerId).toBeTruthy()
      expect(sessionToken).toBeTruthy()
    })
  })

  test.describe('Complete Flow', () => {
    test('host creates game and player joins', { tag: '@ci' }, async ({ page, browser }) => {
      // Host creates game via UI
      await page.goto('/')
      await page.getByTestId('create-name-input').fill('HostPlayer')
      await page.getByTestId('create-button').click()

      // Wait for redirect and extract room code
      await page.waitForURL(/\/play\/([A-Z]{4})\?is_host=1/)
      const url = page.url()
      const roomCode = url.match(/\/play\/([A-Z]{4})/)?.[1]
      expect(roomCode).toBeTruthy()

      // Player joins via UI in new context
      const playerContext = await browser.newContext()
      const playerPage = await playerContext.newPage()

      await playerPage.goto('/')
      await playerPage.getByTestId('join-name-input').fill('JoiningPlayer')
      await playerPage.getByTestId('join-room-input').fill(roomCode!)
      await playerPage.getByTestId('join-button').click()

      // Player should be redirected
      await playerPage.waitForURL(new RegExp(`/play/${roomCode}$`))

      // Clean up
      await playerContext.close()
    })
  })
})
