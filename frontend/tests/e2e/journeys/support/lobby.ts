/**
 * Home page and lobby steps, through the UI only.
 */
import { expect, type Page } from '@playwright/test'
import type { Journey } from './journey'

/** Open the home page and check it rendered. */
export async function openHome(page: Page, j: Journey, who = 'p1'): Promise<void> {
  j.log(`(${who}) open home page /`)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'BUYOUT' })).toBeVisible()
  await expect(page.getByTestId('create-button')).toBeVisible()
  await expect(page.getByTestId('join-button')).toBeVisible()
  await expect(page.getByTestId('watch-bots-button')).toBeVisible()
}

/** Room code of the current /play/XXXX or /host/XXXX page. */
export function roomFromUrl(page: Page): string {
  const m = page.url().match(/\/(?:play|host)\/([A-Z]{4})/)
  if (!m) throw new Error(`No room code in URL ${page.url()}`)
  return m[1]
}

/** Home -> CREATE GAME as `name`. Returns the room code. Ends in the player lobby. */
export async function createGame(page: Page, j: Journey, name: string): Promise<string> {
  await openHome(page, j)
  await j.shot(page, 'home')
  await page.getByTestId('create-name-input').fill(name)
  await j.shot(page, 'home-create-name-filled')
  j.log(`create game as "${name}"`)
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z]{4}\?is_host=1$/)
  const room = roomFromUrl(page)
  await expectInLobby(page, [name])
  await expect(page.getByText(`Room Code: ${room}`)).toBeVisible()
  j.log(`room ${room} created; in lobby`)
  await j.shot(page, 'lobby-created')
  return room
}

/** Home -> JOIN GAME as `name` with a typed room code. Ends in the player lobby. */
export async function joinGame(
  page: Page,
  j: Journey,
  name: string,
  room: string,
  who = 'p2'
): Promise<void> {
  await openHome(page, j, who)
  await page.getByTestId('join-name-input').fill(name)
  // Type the code in lower case: the input upper-cases it like a user would see.
  await page.getByTestId('join-room-input').pressSequentially(room.toLowerCase())
  await expect(page.getByTestId('join-room-input')).toHaveValue(room)
  await j.shot(page, `${who}-home-join-filled`)
  j.log(`(${who}) join room ${room} as "${name}"`)
  await page.getByTestId('join-button').click()
  await page.waitForURL(new RegExp(`/play/${room}$`))
  await expectInLobby(page, [name])
  await expect(page.getByText('Waiting for host to start...')).toBeVisible()
  await j.shot(page, `${who}-lobby-joined`)
}

async function lobbyCount(page: Page): Promise<number> {
  const text = (await page.getByText(/^\d\/6 players$/).textContent()) ?? ''
  return Number(text.split('/')[0])
}

export async function expectInLobby(page: Page, names: string[]): Promise<void> {
  await expect(page.getByText('WAITING FOR PLAYERS')).toBeVisible()
  for (const n of names) {
    await expect(page.locator('[data-testid^="lobby-player-"]', { hasText: n })).toBeVisible()
  }
}

/** Host clicks "+ ADD BOT" (rule-based heuristic bot). Returns the new seat count. */
export async function addBot(page: Page, j: Journey): Promise<number> {
  const before = await lobbyCount(page)
  j.log(`add bot (seats ${before} -> ${before + 1})`)
  await page.getByTestId('add-bot-button').click()
  await expect(page.getByText(`${before + 1}/6 players`)).toBeVisible()
  return before + 1
}

/** Host opens "+ ADD AI" and picks catalog entry `agentId`. Returns the new seat count. */
export async function addAi(page: Page, j: Journey, agentId: string): Promise<number> {
  const before = await lobbyCount(page)
  j.log(`add AI "${agentId}" (seats ${before} -> ${before + 1})`)
  await page.getByTestId('add-ai-button').click()
  const menu = page.getByTestId('ai-menu')
  await expect(menu).toBeVisible()
  const option = page.getByTestId(`ai-option-${agentId}`)
  await expect(option).toBeEnabled()
  await j.shot(page, `ai-menu-${agentId.replace(/[^a-z0-9]+/gi, '-')}`)
  await option.click()
  await expect(page.getByText(`${before + 1}/6 players`)).toBeVisible()
  await expect(menu).toBeHidden()
  return before + 1
}

/** Lobby rows whose seat badge has kind `kind` (bot | llm | scripted). */
export function seatBadges(page: Page, kind: string) {
  return page.locator(`[data-testid^="lobby-player-"] [data-kind="${kind}"]`)
}

/** Host clicks START GAME; waits until the game screen replaces the lobby. */
export async function startGame(page: Page, j: Journey): Promise<void> {
  const start = page.getByRole('button', { name: 'START GAME' })
  await expect(start).toBeEnabled()
  j.log('start game')
  await start.click()
  await expect(page.getByText('WAITING FOR PLAYERS')).toBeHidden({ timeout: 15000 })
  await expect(page.getByTestId('tile-rack')).toBeVisible()
  await expect(page.getByTestId('game-phase')).not.toHaveText('WAITING FOR HOST')
}
