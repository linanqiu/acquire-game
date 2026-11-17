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
  await page.getByTestId('name-input').fill(name)
  await j.shot(page, 'home-create-name-filled')
  j.log(`create game as "${name}"`)
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z]{4}\?is_host=1$/)
  const room = roomFromUrl(page)
  await expectInLobby(page, [name])
  await expect(page.getByTestId('lobby-room-code')).toHaveText(room)
  await expect(page.getByTestId('lobby-room-code')).toBeVisible()
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
  await page.getByTestId('name-input').fill(name)
  // Type the code in lower case: the input upper-cases it like a user would see.
  await page.getByTestId('join-room-input').pressSequentially(room.toLowerCase())
  await expect(page.getByTestId('join-room-input')).toHaveValue(room)
  await j.shot(page, `${who}-home-join-filled`)
  j.log(`(${who}) join room ${room} as "${name}"`)
  await page.getByTestId('join-button').click()
  await page.waitForURL(new RegExp(`/play/${room}$`))
  await expectInLobby(page, [name])
  // A guest reads what the room waits for in the phase bar (said once, BL-015).
  await expect(page.getByTestId('game-phase')).toHaveText('WAITING FOR THE HOST TO START')
  await expect(page.getByRole('button', { name: 'START GAME' })).toHaveCount(0)
  await j.shot(page, `${who}-lobby-joined`)
}

async function lobbyCount(page: Page): Promise<number> {
  // The lobby lists every seat; the list is the count.
  return page.locator('[data-testid^="lobby-player-"]').count()
}

export async function expectInLobby(page: Page, names: string[]): Promise<void> {
  await expect(page.getByTestId('lobby')).toBeVisible()
  for (const n of names) {
    await expect(page.locator('[data-testid^="lobby-player-"]', { hasText: n })).toBeVisible()
  }
}

/** Host clicks "+ ADD BOT" (rule-based heuristic bot). Returns the new seat count. */
export async function addBot(page: Page, j: Journey): Promise<number> {
  const before = await lobbyCount(page)
  j.log(`add bot (seats ${before} -> ${before + 1})`)
  await page.getByTestId('add-bot-button').click()
  await expect(page.locator('[data-testid^="lobby-player-"]')).toHaveCount(before + 1)
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
  await expect(page.locator('[data-testid^="lobby-player-"]')).toHaveCount(before + 1)
  await expect(menu).toBeHidden()
  return before + 1
}

/** Lobby rows whose seat badge has kind `kind` (bot | llm | scripted). */
export function seatBadges(page: Page, kind: string) {
  return page.locator(`[data-testid^="lobby-player-"] [data-kind="${kind}"]`)
}

/**
 * The name the server gave the lobby seat of kind `kind` (the `n`-th one): AI seats get a
 * random character name (BL-010), so tests read it from the page instead of hard-coding it.
 */
export async function seatName(page: Page, kind: string, n = 0): Promise<string> {
  const row = page
    .locator('[data-testid^="lobby-player-"]')
    .filter({ has: page.locator(`[data-kind="${kind}"]`) })
    .nth(n)
  await expect(row).toBeVisible()
  const name = ((await row.locator('span').first().textContent()) ?? '').trim()
  expect(name, `lobby seat ${kind} #${n} has a name`).not.toBe('')
  return name
}

/** The first lobby seat badge of `kind`: its accessible name (kind and model) matches `label`. */
export async function expectSeatBadge(
  page: Page,
  kind: string,
  label: string | RegExp
): Promise<void> {
  const badge = seatBadges(page, kind).first()
  await expect(badge).toHaveAccessibleName(label)
}

/** Host clicks START GAME; waits until the game screen replaces the lobby. */
export async function startGame(page: Page, j: Journey): Promise<void> {
  const start = page.getByRole('button', { name: 'START GAME' })
  await expect(start).toBeEnabled()
  j.log('start game')
  await start.click()
  await expect(page.getByTestId('lobby')).toBeHidden({ timeout: 15000 })
  await expect(page.getByTestId('tile-rack')).toBeVisible()
  await expect(page.getByTestId('game-phase')).not.toHaveText(/START|WAITING FOR THE HOST/)
}
