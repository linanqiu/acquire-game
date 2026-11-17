import { Page, expect } from '@playwright/test'

/**
 * UI-based lobby helpers shared by the transcripts spec. They interact with the app through the
 * UI exactly as a user would; no API shortcuts. (The journeys have their own, journey-aware
 * versions in journeys/support/lobby.ts.)
 */

export interface GameContext {
  page: Page
  roomCode: string
  playerName: string
}

/** Create a new game from the home page and wait for the lobby. */
export async function createGameViaUI(page: Page, playerName: string): Promise<GameContext> {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'BUYOUT' })).toBeVisible()
  await page.getByTestId('name-input').fill(playerName)
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z]{4}/)

  const roomCodeMatch = page.url().match(/\/play\/([A-Z]{4})/)
  if (!roomCodeMatch) {
    throw new Error(`Could not extract room code from URL: ${page.url()}`)
  }

  await expect(page.getByTestId('lobby')).toBeVisible()
  await expect(page.getByTestId('lobby-room-code')).toHaveText(roomCodeMatch[1])
  return { page, roomCode: roomCodeMatch[1], playerName }
}

/** Add a bot from the host's lobby and wait for the seat count to go up. */
export async function addBotViaUI(page: Page): Promise<void> {
  // The lobby lists every seat: the count is the list (BL-017).
  const seats = page.locator('[data-testid^="lobby-player-"]')
  await expect(seats.first()).toBeVisible({ timeout: 5000 })
  const currentCount = await seats.count()

  await page.getByRole('button', { name: '+ ADD BOT' }).click()
  await expect(seats).toHaveCount(currentCount + 1, { timeout: 10000 })
}

/** Press START GAME and wait for the lobby to give way to the game. */
export async function startGameViaUI(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'START GAME' }).click()
  await expect(page.getByTestId('lobby')).not.toBeVisible({ timeout: 10000 })
}
