/**
 * The game pages show one tab at a time (BL-008, BL-013). Phones: Board (the board with the
 * table panel under it: my decision in place, the players matrix), Chains, Chat, Trades (player)
 * or Log (host). Wide screens: the board is always there; the sidebar's first tab is the table
 * panel (id `now`), then the same reference tabs. There is no separate Now or Players tab any
 * more: `table` names the tab that holds the table panel on the layout in use.
 * These helpers open a tab through the UI, like a user would.
 */
import { expect, type Locator, type Page } from '@playwright/test'

export type TabName = 'board' | 'table' | 'chains' | 'chat' | 'trades' | 'log'

/** The id of the tab that holds the table panel here: `board` on phones, `now` on wide screens. */
export async function tableTabId(page: Page): Promise<'board' | 'now' | null> {
  if ((await page.getByTestId('tab-board').count()) > 0) return 'board'
  if ((await page.getByTestId('tab-now').count()) > 0) return 'now'
  return null // pinned (the host on a TV): the panel is always on screen
}

async function resolve(page: Page, name: TabName): Promise<string | null> {
  return name === 'table' ? tableTabId(page) : name
}

export const tab = (page: Page, name: Exclude<TabName, 'table'> | 'now'): Locator =>
  page.getByTestId(`tab-${name}`)
export const tabPanel = (page: Page, name: Exclude<TabName, 'table'> | 'now'): Locator =>
  page.getByTestId(`tabpanel-${name}`)
export const tabBadge = (page: Page, name: Exclude<TabName, 'table'> | 'now'): Locator =>
  page.getByTestId(`tab-badge-${name}`)

/** The table panel: my decision (or what the table waits for) and the players matrix. */
export const tablePanel = (page: Page): Locator => page.getByTestId('table-panel')

/** The tab button of the table panel on this layout (fails where it is pinned). */
export async function tableTab(page: Page): Promise<Locator> {
  const id = await tableTabId(page)
  if (!id) throw new Error('the table panel is pinned on this layout: it has no tab')
  return page.getByTestId(`tab-${id}`)
}

/** The badge on the table panel's tab (something new needs me / my tile to place). */
export async function tableBadge(page: Page): Promise<Locator> {
  const id = await tableTabId(page)
  return page.getByTestId(`tab-badge-${id ?? 'now'}`)
}

/**
 * Open a tab (tap or click its button) and wait for its panel. A tab that is pinned on this
 * screen (host on a TV) has no button: its card is already on screen. Fails if neither exists.
 */
export async function openTab(page: Page, name: TabName, opts: { tap?: boolean } = {}) {
  const id = await resolve(page, name)
  const pinned = page.getByTestId(`pinned-${id ?? 'now'}`)
  if ((await pinned.count()) > 0) {
    await expect(pinned).toBeVisible()
    return
  }
  if (!id) throw new Error(`tab ${name} does not exist on this layout`)
  const button = page.getByTestId(`tab-${id}`)
  await expect(button, `tab ${name} exists`).toBeVisible()
  // The page brings the table panel into view when something new needs me; that can land right
  // after this tap and undo it, as it would for a player. Tap again, as a player would.
  await expect(async () => {
    if ((await button.getAttribute('aria-selected')) !== 'true') {
      if (opts.tap) await button.tap()
      else await button.click()
    }
    await expect(button).toHaveAttribute('aria-selected', 'true', { timeout: 1500 })
  }).toPass({ timeout: 10000 })
  await expect(page.getByTestId(`tabpanel-${id}`)).toBeVisible()
}

/** Show the board: on phones open the Board tab; on wide screens it is always there. */
export async function showBoard(page: Page, opts: { tap?: boolean } = {}) {
  if ((await page.getByTestId('tab-board').count()) > 0) await openTab(page, 'board', opts)
  await expect(page.getByTestId('board')).toBeVisible()
}
