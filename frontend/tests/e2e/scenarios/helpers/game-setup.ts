import { Page, expect } from '@playwright/test'

/**
 * UI-based game setup helpers for E2E scenario testing.
 *
 * These helpers interact with the application through the UI,
 * exactly as a real user would. No API shortcuts.
 */

export interface GameContext {
  page: Page
  roomCode: string
  playerName: string
}

/**
 * Create a new game via the UI.
 * Navigates to lobby, enters name, clicks CREATE, waits for redirect to game page.
 *
 * @param page - Playwright Page
 * @param playerName - Name to enter for the host player
 * @returns GameContext with room code extracted from URL
 */
export async function createGameViaUI(page: Page, playerName: string): Promise<GameContext> {
  // Navigate to lobby
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'ACQUIRE' })).toBeVisible()

  // Enter player name
  await page.getByTestId('create-name-input').fill(playerName)

  // Click CREATE button and wait for navigation
  await page.getByTestId('create-button').click()

  // Wait for redirect to player page (URL pattern: /play/XXXX)
  await page.waitForURL(/\/play\/[A-Z]{4}/)

  // Extract room code from URL
  const url = page.url()
  const roomCodeMatch = url.match(/\/play\/([A-Z]{4})/)
  if (!roomCodeMatch) {
    throw new Error(`Could not extract room code from URL: ${url}`)
  }

  const roomCode = roomCodeMatch[1]

  // Verify we're in the waiting room
  await expect(page.getByText('WAITING FOR PLAYERS')).toBeVisible()
  await expect(page.getByText(`Room Code:`)).toBeVisible()

  return { page, roomCode, playerName }
}

/**
 * Join an existing game via the UI.
 * Navigates to lobby, enters name and room code, clicks JOIN, waits for redirect.
 *
 * @param page - Playwright Page
 * @param playerName - Name to enter
 * @param roomCode - Room code to join
 * @returns GameContext
 */
export async function joinGameViaUI(
  page: Page,
  playerName: string,
  roomCode: string
): Promise<GameContext> {
  // Navigate to lobby
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'ACQUIRE' })).toBeVisible()

  // Enter player name
  await page.getByTestId('join-name-input').fill(playerName)

  // Enter room code
  await page.getByTestId('join-room-input').fill(roomCode)

  // Click JOIN button and wait for navigation
  await page.getByTestId('join-button').click()

  // Wait for redirect to player page
  await page.waitForURL(`/play/${roomCode}`)

  // Verify we're in the waiting room
  await expect(page.getByText('WAITING FOR PLAYERS')).toBeVisible()

  return { page, roomCode, playerName }
}

/**
 * Add a bot via the UI (host only).
 * Clicks the "ADD BOT" button and waits for the bot to appear in the player list.
 *
 * @param page - Playwright Page (must be on the player page as host)
 */
export async function addBotViaUI(page: Page): Promise<void> {
  // Get current player count before adding bot
  const playerCountText = await page.locator('text=/\\d+\\/6 players/').textContent()
  const currentCount = parseInt(playerCountText?.match(/(\d+)\/6/)?.[1] || '0', 10)

  // Click the Add Bot button
  await page.getByRole('button', { name: '+ ADD BOT' }).click()

  // Wait for player count to increase
  const expectedCount = currentCount + 1
  await expect(page.locator(`text=${expectedCount}/6 players`)).toBeVisible({ timeout: 5000 })
}

/**
 * Start the game via the UI (host only).
 * Clicks the "START GAME" button and waits for the game to begin.
 *
 * @param page - Playwright Page (must be on the player page as host with enough players)
 */
export async function startGameViaUI(page: Page): Promise<void> {
  // Click the Start Game button
  await page.getByRole('button', { name: 'START GAME' }).click()

  // Wait for the game to start (lobby view disappears, game view appears)
  // The "WAITING FOR PLAYERS" text should disappear
  await expect(page.getByText('WAITING FOR PLAYERS')).not.toBeVisible({ timeout: 10000 })
}

/**
 * Wait for the game board to be visible, indicating the game has started.
 *
 * @param page - Playwright Page
 */
export async function waitForGameToStart(page: Page): Promise<void> {
  // Wait for the board to appear (indicates game has started)
  await expect(page.locator('[data-testid="game-board"]')).toBeVisible({ timeout: 15000 })
}

/**
 * Get the room code displayed on the player page.
 *
 * @param page - Playwright Page (must be on the player page)
 * @returns The room code
 */
export async function getRoomCodeFromUI(page: Page): Promise<string> {
  const roomInfo = page.locator('text=/Room Code:/')
  await expect(roomInfo).toBeVisible()
  const text = await roomInfo.locator('..').textContent()
  const match = text?.match(/Room Code:\s*([A-Z]{4})/)
  if (!match) {
    throw new Error(`Could not extract room code from: ${text}`)
  }
  return match[1]
}

/**
 * Get the count of players currently in the lobby.
 *
 * @param page - Playwright Page (must be on the player page in lobby phase)
 * @returns Number of players
 */
export async function getPlayerCountFromUI(page: Page): Promise<number> {
  const countText = await page.locator('text=/\\d+\\/6 players/').textContent()
  const match = countText?.match(/(\d+)\/6/)
  return parseInt(match?.[1] || '0', 10)
}

/**
 * Verify that a player with the given name is visible in the lobby player list.
 *
 * @param page - Playwright Page
 * @param playerName - Name to look for
 */
export async function assertPlayerInLobby(page: Page, playerName: string): Promise<void> {
  // Look specifically in the main content area (player list), not the header
  await expect(page.getByRole('main').locator(`text=${playerName}`)).toBeVisible()
}

/**
 * Verify that a bot is visible in the lobby (player with BOT badge).
 *
 * @param page - Playwright Page
 */
export async function assertBotInLobby(page: Page): Promise<void> {
  // Look specifically for the BOT badge element (exact match)
  await expect(page.getByText('BOT', { exact: true })).toBeVisible()
}
