import { test, expect } from '@playwright/test'
import { captureStep, resetStepCounter } from './helpers/screenshot'
import { createGame, startGame, getGameState } from './helpers/game-setup'

/**
 * Smoke tests to verify the E2E scenario test infrastructure is working.
 * These tests validate that:
 * - Screenshots can be captured and saved
 * - Console errors are detected
 * - Basic page navigation works
 * - Game seeding API works
 */
test.describe('Scenario Test Infrastructure Smoke Test', () => {
  test.beforeEach(() => {
    resetStepCounter()
  })

  test('should capture screenshots at each step', async ({ page }) => {
    // Navigate to lobby
    await page.goto('/')
    const path1 = await captureStep(page, 'lobby-loaded', {
      category: 'smoke',
      testName: 'screenshot-test',
    })
    expect(path1).toContain('01-lobby-loaded.png')

    // Verify lobby elements
    await expect(page.getByRole('heading', { name: 'ACQUIRE' })).toBeVisible()
    const path2 = await captureStep(page, 'lobby-verified', {
      category: 'smoke',
      testName: 'screenshot-test',
    })
    expect(path2).toContain('02-lobby-verified.png')
  })

  test('should capture console errors', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    await page.goto('/')
    await page.waitForTimeout(1000) // Allow any errors to surface

    // Filter out expected errors (favicon, network errors in test env, etc)
    const criticalErrors = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('404') &&
        !e.includes('net::ERR_NAME_NOT_RESOLVED') &&
        !e.includes('net::ERR_CONNECTION_REFUSED')
    )
    expect(criticalErrors).toHaveLength(0)
  })

  test('should verify lobby page structure', async ({ page }) => {
    await page.goto('/')
    await captureStep(page, 'lobby-initial', {
      category: 'smoke',
      testName: 'lobby-structure',
    })

    // Verify create game section
    const createSection = page.locator('text=CREATE GAME')
    await expect(createSection).toBeVisible()

    // Verify join game section
    const joinSection = page.locator('text=JOIN GAME')
    await expect(joinSection).toBeVisible()

    await captureStep(page, 'lobby-structure-verified', {
      category: 'smoke',
      testName: 'lobby-structure',
    })
  })

  test('should create and start game via API', async ({ request, page }) => {
    // Create game with host and 2 additional players
    const game = await createGame(request, {
      hostName: 'TestHost',
      playerNames: ['Player2', 'Player3'],
    })

    expect(game.roomCode).toBeTruthy()
    expect(game.hostPlayerId).toBeTruthy()
    expect(game.hostSessionToken).toBeTruthy()
    expect(game.players).toHaveLength(2)

    // Start the game
    await startGame(request, game.roomCode, game.hostSessionToken)

    // Verify room state is available
    const state = (await getGameState(request, game.roomCode)) as {
      started: boolean
      players: unknown[]
    }
    expect(state).toBeTruthy()
    expect(state.started).toBe(true)
    expect(state.players).toHaveLength(3)

    // Navigate to game page and capture screenshot
    await page.goto(`/game/${game.roomCode}?playerId=${game.hostPlayerId}`)
    await page.waitForLoadState('networkidle')
    await captureStep(page, 'game-created-and-started', {
      category: 'smoke',
      testName: 'game-seeding-api',
    })
  })
})
