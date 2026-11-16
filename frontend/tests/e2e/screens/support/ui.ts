/**
 * Locators and UI-driven actions shared by the screen tests. Everything here goes through the
 * real UI (clicks on real controls); nothing calls the API.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import type { RoomContext } from './room'
import type { Shots } from './test'

export const phaseBanner = (page: Page): Locator => page.getByTestId('game-phase')
export const rack = (page: Page): Locator => page.getByTestId('tile-rack')
export const rackTile = (page: Page, coord: string): Locator =>
  rack(page).getByTestId(`tile-${coord}`)
export const boardTile = (page: Page, coord: string): Locator =>
  page.getByTestId('board').getByTestId(`tile-${coord}`)
export const headerCash = (page: Page): Locator => page.getByTestId('header-cash')
export const playerRows = (page: Page): Locator => page.getByTestId('player-row')
export const playerRow = (page: Page, name: string): Locator =>
  playerRows(page).filter({ hasText: name })

const MY_DECISION_BANNERS = [
  'PLACE A TILE',
  'CHOOSE A HOTEL CHAIN',
  'CHOOSE THE SURVIVING HOTEL CHAIN',
  'DISPOSE YOUR SHARES',
  'BUY STOCKS',
]

/** Tiles in the rack the user can click (playable ones expose role=button). */
export const clickableRackTiles = (page: Page): Locator => rack(page).locator('[role="button"]')

/** "$1,234" -> 1234 */
export function money(text: string): number {
  return Number(text.replace(/[^0-9-]/g, ''))
}

/** Wait until it is the browser player's turn to make a decision; returns the banner text. */
export async function waitForMyDecision(page: Page, room?: RoomContext | null): Promise<string> {
  let banner = ''
  await expect
    .poll(
      async () => {
        if (room) await room.driveIdle()
        banner = (await phaseBanner(page).innerText()).trim()
        if (banner === 'GAME OVER') throw new Error('game ended while waiting for my decision')
        return MY_DECISION_BANNERS.includes(banner)
      },
      { message: 'waiting for the human to be asked for a decision', timeout: 15000 }
    )
    .toBe(true)
  return banner
}

/**
 * Show the decision tab ("Now", BL-011), as a player would: tap the status line when another tab
 * is open (the page only switches by itself for new events).
 */
export async function openDecision(page: Page): Promise<void> {
  const view = page.getByTestId('decision-view')
  if (await view.isVisible()) return
  await page.getByTestId('status-line').click()
  await expect(view).toBeVisible()
}

/**
 * Play one complete human turn through the UI with first-available choices: place a tile, answer
 * any chain/merger prompts, then end the turn (buying nothing). Returns a short log line.
 */
async function playHumanTurn(
  page: Page,
  room: RoomContext | null,
  shots?: Shots,
  label = 'turn'
): Promise<string> {
  const log: string[] = []
  for (let step = 0; step < 12; step++) {
    const banner = await waitForMyDecision(page, room)
    log.push(banner)
    if (banner === 'PLACE A TILE') {
      const tile = clickableRackTiles(page).first()
      const coord = (await tile.getAttribute('data-testid'))!.replace('tile-', '')
      await tile.click()
      await shots?.take(page, `${label}-tile-selected-${coord}`)
      await page.getByTestId('place-tile-button').click()
      await expect(phaseBanner(page)).not.toHaveText('PLACE A TILE')
    } else if (banner === 'CHOOSE A HOTEL CHAIN' || banner === 'CHOOSE THE SURVIVING HOTEL CHAIN') {
      await openDecision(page)
      await shots?.take(page, `${label}-chain-choice`)
      await page.locator('[data-testid^="chain-button-"]:not([disabled])').first().click()
      await expect(page.getByTestId('chain-selector')).toBeHidden()
      // The banner follows the server's answer; do not act again on the stale one.
      await expect(phaseBanner(page)).not.toHaveText(banner)
    } else if (banner === 'DISPOSE YOUR SHARES') {
      await openDecision(page)
      const title = await page.getByTestId('merger-disposition').innerText()
      await shots?.take(page, `${label}-disposition`)
      await page.getByTestId('confirm-disposition').click()
      await expect
        .poll(async () => {
          const d = page.getByTestId('merger-disposition')
          return (await d.count()) === 0 || (await d.innerText()) !== title
        })
        .toBe(true)
    } else if (banner === 'BUY STOCKS') {
      await openDecision(page)
      await shots?.take(page, `${label}-buy-phase`)
      await page.getByTestId('end-turn-button').click()
      await expect(phaseBanner(page)).not.toHaveText('BUY STOCKS')
      return log.join(' > ')
    }
  }
  throw new Error(`human turn did not finish: ${log.join(' > ')}`)
}

/** Play `n` full human turns; each must complete (a stuck turn throws). */
export async function playHumanTurns(
  page: Page,
  room: RoomContext | null,
  n: number,
  shots?: Shots
): Promise<void> {
  for (let i = 1; i <= n; i++) {
    const log = await playHumanTurn(page, room, shots, `follow-up-${i}`)
    console.log(`[follow-up turn ${i}/${n}] ${log}`)
  }
}
