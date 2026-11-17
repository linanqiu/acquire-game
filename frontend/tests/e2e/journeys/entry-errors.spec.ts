/**
 * Journey 6: every entry-point error a user can hit, from the home page.
 *
 * Name validation (empty, blank, over-long), bad room codes, duplicate name, full room,
 * removing an AI seat to make room, starting with too few seats, joining a started
 * game, an unknown URL, and opening /play/XXXX for a room that does not exist or that
 * you never joined.
 */
import type { Page } from '@playwright/test'
import { test, expect } from './support/journey'
import {
  addAi,
  addBot,
  createGame,
  expectInLobby,
  openHome,
  seatName,
  startGame,
} from './support/lobby'

/**
 * From either home step: back to the name step, the name, JOIN GAME, then the code. Four
 * letters join on their own (BL-018); a shorter code needs the JOIN button.
 */
async function joinAttempt(page: Page, name: string, code: string) {
  const back = page.getByTestId('join-back')
  if (await back.isVisible()) {
    await back.click()
    await expect(page.getByTestId('create-button')).toBeVisible()
  }
  await page.getByTestId('name-input').fill(name)
  await page.getByTestId('join-button').click()
  if (!name.trim()) return
  const input = page.getByTestId('join-room-input')
  await expect(input).toBeFocused()
  await input.fill('')
  await input.fill(code)
  if (code.length < 4) await page.getByTestId('join-submit-button').click()
}

function joinError(page: Page) {
  // The inline error under the room-code field.
  return page.locator('#join-room-error')
}

function nameError(page: Page) {
  // The name is asked first (BL-018); its error sits under the name field.
  return page.locator('#player-name-error')
}

test('@ci entry errors: validation, bad codes, duplicate name, full room, started game, bad URLs', async ({
  page: host,
  browser,
  journey: j,
}) => {
  test.setTimeout(120_000)
  // The browser logs every refused HTTP request as a console error; those are the
  // point of this journey. Anything else still fails it.
  j.allow(/Failed to load resource: the server responded with a status of (400|404)/)

  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  j.watch(b, 'p2')

  // --- Create-game validation --------------------------------------------------------
  await openHome(b, j, 'p2')
  await b.getByTestId('create-button').click()
  await expect(nameError(b)).toHaveText('Name is required')
  await j.shot(b, 'create-empty-name')
  await b.getByTestId('name-input').fill('   ')
  await b.getByTestId('create-button').click()
  await expect(b.getByText('Name is required')).toBeVisible()
  expect(b.url()).toMatch(/\/$/)
  await b.getByTestId('name-input').fill('')
  await b.getByTestId('name-input').pressSequentially('ABCDEFGHIJKLMNOPQRSTUVWXY')
  await expect(b.getByTestId('name-input')).toHaveValue('ABCDEFGHIJKLMNOPQRST')
  await j.shot(b, 'create-long-name-truncated')
  j.log('create: empty and blank names refused; long name capped at 20 characters')

  // --- Join validation and bad codes ------------------------------------------------
  await joinAttempt(b, '', 'ABCD')
  await expect(nameError(b)).toHaveText('Name is required')
  await expect(b.getByTestId('join-room-input')).toHaveCount(0)
  await joinAttempt(b, 'Bob', 'AB')
  await expect(joinError(b)).toHaveText('Room code must be 4 letters')
  await j.shot(b, 'join-short-code')
  await joinAttempt(b, 'Bob', 'qzqz')
  await expect(joinError(b)).toHaveText('Room not found')
  // Said once, at the code field (no toast repeating it).
  await expect(b.getByText('Room not found')).toHaveCount(1)
  expect(b.url()).toMatch(/\/\?join/)
  await j.shot(b, 'join-wrong-code')
  j.log('join: empty name, short code and unknown room refused')

  // --- Host lobby: too few seats ----------------------------------------------------
  const room = await createGame(host, j, 'Hana')
  const start = host.getByRole('button', { name: 'START GAME' })
  await expect(start).toBeDisabled()
  // What the room waits for is said once, in the phase bar (BL-017).
  await expect(host.getByTestId('game-phase')).toHaveText('NEED 2 MORE PLAYERS TO START')
  await j.shot(host, 'host-cannot-start-alone')

  // --- Duplicate name (case-insensitive) ----------------------------------------------
  await joinAttempt(b, 'hana', room)
  // Every refusal is said at the code field; one about the name offers to change it.
  await expect(joinError(b)).toHaveText('Player name already taken')
  await j.shot(b, 'join-duplicate-name')
  await b.getByTestId('join-name-taken-change').click()
  await expect(nameError(b)).toHaveText('That name is taken in this room: pick another')
  await expect(b.getByTestId('name-input')).toBeFocused()
  await expect(b.getByTestId('name-input')).toHaveValue('hana')
  expect(b.url()).toMatch(/\/$/)
  await j.shot(b, 'join-duplicate-name-change')
  j.log('join: duplicate name refused; back on the name step to change it')

  // --- Fill the room to 6 with AI seats; a 7th person is refused --------------------
  await addBot(host, j)
  await expect(host.getByTestId('game-phase')).toHaveText('NEED 1 MORE PLAYER TO START')
  await addBot(host, j)
  await expect(start).toBeEnabled()
  await expect(host.getByTestId('game-phase')).toHaveText('START WHEN EVERYONE IS IN')
  await addBot(host, j)
  await addBot(host, j)
  await addAi(host, j, 'llm:fake')
  await expect(host.locator('[data-testid^="lobby-player-"]')).toHaveCount(6)
  await expect(host.getByTestId('add-bot-button')).toBeDisabled()
  await expect(host.getByTestId('add-ai-button')).toBeDisabled()
  await j.shot(host, 'host-room-full')
  await joinAttempt(b, 'Bob', room)
  await expect(joinError(b)).toHaveText('Room is full')
  await j.shot(b, 'join-room-full')
  j.log('join: full room refused')

  // --- Remove an AI seat; now Bob fits ------------------------------------------------
  const bot4Name = await seatName(host, 'bot', 3)
  const llmName = await seatName(host, 'llm')
  const bot4 = host.locator('[data-testid^="lobby-player-"]', { hasText: bot4Name })
  await bot4.getByRole('button', { name: `Remove ${bot4Name}` }).click()
  await expect(host.locator('[data-testid^="lobby-player-"]')).toHaveCount(5)
  await expect(bot4).toHaveCount(0)
  await expect(host.getByTestId('add-bot-button')).toBeEnabled()
  await j.shot(host, 'host-removed-bot4')
  await joinAttempt(b, 'Bob', room)
  await b.waitForURL(new RegExp(`/play/${room}$`))
  await expectInLobby(b, ['Hana', 'Bob', llmName])
  await expectInLobby(host, ['Bob'])
  // Humans cannot be removed, and only the host sees remove buttons.
  await expect(host.getByRole('button', { name: 'Remove Bob' })).toHaveCount(0)
  await expect(b.getByRole('button', { name: /^Remove / })).toHaveCount(0)
  await j.shot(b, 'bob-joined-after-removal')

  // --- Start; joining a started game is refused --------------------------------------
  await startGame(host, j)
  await expect(b.getByTestId('tile-rack')).toBeVisible()
  const ctxC = await browser.newContext()
  const c = await ctxC.newPage()
  j.watch(c, 'p3')
  await openHome(c, j, 'p3')
  await joinAttempt(c, 'Cara', room)
  await expect(joinError(c)).toHaveText('Game already started')
  await j.shot(c, 'join-started-game')

  // --- Unknown URL -> not-found page -> back home -----------------------------------
  await c.goto('/no/such/page')
  await expect(c.getByRole('heading', { name: '404' })).toBeVisible()
  await expect(c.getByText('Page not found')).toBeVisible()
  await j.shot(c, 'not-found-page')
  await c.getByRole('link', { name: 'Back to Lobby' }).click()
  await c.waitForURL(/\/$/)
  await expect(c.getByTestId('create-button')).toBeVisible()

  // --- /play/XXXX for a room that does not exist ----------------------------------------
  await c.goto('/play/QZQZ')
  await expect(c.getByTestId('room-unavailable')).toBeVisible()
  await expect(c.getByTestId('room-unavailable')).toContainText('Game QZQZ was not found')
  await j.shot(c, 'play-unknown-room')
  await c.getByRole('button', { name: 'BACK TO HOME' }).click()
  await c.waitForURL(/\/$/)

  // --- /play/<room> for a real game this browser never joined ------------------------
  await c.goto(`/play/${room}`)
  await expect(c.getByTestId('room-unavailable')).toBeVisible()
  await expect(c.getByTestId('room-unavailable')).toContainText('You are not a player in game')
  await j.shot(c, 'play-room-not-joined')
  await c.getByRole('button', { name: 'BACK TO HOME' }).click()
  await c.waitForURL(/\/$/)

  // The game itself was not disturbed by any of this.
  await expect(host.getByTestId('game-phase')).not.toHaveText(/TO START|EVERYONE IS IN/)
  await ctxB.close()
  await ctxC.close()
})
