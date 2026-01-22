import { test, expect } from '@playwright/test'
import { captureStep, resetStepCounter } from './helpers/screenshot'
import {
  createGameViaUI,
  addBotViaUI,
  startGameViaUI,
  assertPlayerInLobby,
  assertBotInLobby,
  getPlayerCountFromUI,
} from './helpers/game-setup'

/**
 * Smoke tests to verify the E2E scenario test infrastructure is working.
 * These tests validate that:
 * - Screenshots can be captured and saved
 * - Console errors are detected
 * - Basic page navigation works
 * - Full user journey: create game, add bots, start game via UI
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

  test('should create game, add bots, and start via UI', async ({ page }) => {
    // Step 1: Create game via UI
    await captureStep(page, 'lobby-before-create', {
      category: 'smoke',
      testName: 'full-user-journey',
    })

    const gameContext = await createGameViaUI(page, 'TestHost')
    await captureStep(page, 'game-created-waiting-room', {
      category: 'smoke',
      testName: 'full-user-journey',
    })

    // Verify host is in the lobby
    await assertPlayerInLobby(page, 'TestHost')
    expect(gameContext.roomCode).toMatch(/^[A-Z]{4}$/)

    // Step 2: Add bots via UI (need at least 3 players to start)
    let playerCount = await getPlayerCountFromUI(page)
    expect(playerCount).toBe(1) // Just the host

    await addBotViaUI(page)
    await captureStep(page, 'first-bot-added', {
      category: 'smoke',
      testName: 'full-user-journey',
    })
    await assertBotInLobby(page)

    await addBotViaUI(page)
    await captureStep(page, 'second-bot-added', {
      category: 'smoke',
      testName: 'full-user-journey',
    })

    playerCount = await getPlayerCountFromUI(page)
    expect(playerCount).toBe(3) // Host + 2 bots

    // Step 3: Start game via UI
    await startGameViaUI(page)
    await captureStep(page, 'game-started', {
      category: 'smoke',
      testName: 'full-user-journey',
    })

    // Verify game has started - should see phase indicator (not lobby)
    // After game starts, we should not see "WAITING FOR PLAYERS"
    await expect(page.getByText('WAITING FOR PLAYERS')).not.toBeVisible()

    await captureStep(page, 'game-in-progress', {
      category: 'smoke',
      testName: 'full-user-journey',
    })
  })
})
