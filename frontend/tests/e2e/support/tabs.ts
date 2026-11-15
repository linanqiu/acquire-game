/**
 * The game pages show one tab at a time (BL-008): Board (phones only), Players, Chains, Chat,
 * Trades (player) or Log (host). These helpers open a tab through the UI, like a user would.
 */
import { expect, type Locator, type Page } from '@playwright/test'

export type TabName = 'board' | 'players' | 'chains' | 'chat' | 'trades' | 'log'

export const tab = (page: Page, name: TabName): Locator => page.getByTestId(`tab-${name}`)
export const tabPanel = (page: Page, name: TabName): Locator => page.getByTestId(`tabpanel-${name}`)
export const tabBadge = (page: Page, name: TabName): Locator =>
  page.getByTestId(`tab-badge-${name}`)

/**
 * Open a tab (tap or click its button) and wait for its panel. A tab that is pinned on this
 * screen (host on a TV) has no button: its card is already on screen. Fails if neither exists.
 */
export async function openTab(page: Page, name: TabName, opts: { tap?: boolean } = {}) {
  const pinned = page.getByTestId(`pinned-${name}`)
  if ((await pinned.count()) > 0) {
    await expect(pinned).toBeVisible()
    return
  }
  const button = tab(page, name)
  await expect(button, `tab ${name} exists`).toBeVisible()
  // On a phone the page jumps to the Board tab when my place-tile turn starts; that can land
  // right after this tap and undo it, as it would for a player. Tap again, as a player would.
  await expect(async () => {
    if ((await button.getAttribute('aria-selected')) !== 'true') {
      if (opts.tap) await button.tap()
      else await button.click()
    }
    await expect(button).toHaveAttribute('aria-selected', 'true', { timeout: 1500 })
  }).toPass({ timeout: 10000 })
  await expect(tabPanel(page, name)).toBeVisible()
}

/** Show the board: on phones open the Board tab; on wide screens it is always there. */
export async function showBoard(page: Page, opts: { tap?: boolean } = {}) {
  if ((await tab(page, 'board').count()) > 0) await openTab(page, 'board', opts)
  await expect(page.getByTestId('board')).toBeVisible()
}
