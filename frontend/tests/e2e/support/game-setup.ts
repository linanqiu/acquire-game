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
  await expect(page.getByRole('heading', { name: 'ACQUIRE' })).toBeVisible()
  await page.getByTestId('create-name-input').fill(playerName)
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z]{4}/)

  const roomCodeMatch = page.url().match(/\/play\/([A-Z]{4})/)
  if (!roomCodeMatch) {
    throw new Error(`Could not extract room code from URL: ${page.url()}`)
  }

  await expect(page.getByText('WAITING FOR PLAYERS')).toBeVisible()
  await expect(page.getByText(`Room Code:`)).toBeVisible()
  return { page, roomCode: roomCodeMatch[1], playerName }
}

/** Add a bot from the host's lobby and wait for the seat count to go up. */
export async function addBotViaUI(page: Page): Promise<void> {
  const playerCountLocator = page.locator('text=/\\d+\\/6 players/')
  await expect(playerCountLocator).toBeVisible({ timeout: 5000 })
  const playerCountText = await playerCountLocator.textContent()
  const currentCount = parseInt(playerCountText?.match(/(\d+)\/6/)?.[1] || '0', 10)

  await page.getByRole('button', { name: '+ ADD BOT' }).click()
  await expect(page.locator(`text=${currentCount + 1}/6 players`)).toBeVisible({ timeout: 10000 })
}

/** Press START GAME and wait for the lobby to give way to the game. */
export async function startGameViaUI(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'START GAME' }).click()
  await expect(page.getByText('WAITING FOR PLAYERS')).not.toBeVisible({ timeout: 10000 })
}
