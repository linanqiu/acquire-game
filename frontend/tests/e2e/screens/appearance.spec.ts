/**
 * Tier 3 (BL-009, visual pass): what the board and the colour schemes look like, checked on the
 * real app.
 *  - A chain is drawn as ONE block: neighbouring squares of the same chain touch (no gap), and
 *    the chain's label is visible on exactly one square. Orphans stay separate squares.
 *  - "Your turn": the phase bar carries data-turn=mine while the table waits on me, and goes
 *    back to "other" once it does not.
 *  - Light and dark both render the home page and the key game screens (board, chains, players,
 *    a modal) legibly and with no console errors; the toggle switches the scheme, is remembered
 *    across a reload, and the system preference is followed until the player picks.
 *  - Reduced motion: a placed tile and the money in the header do not animate.
 *
 * Setup (tier 3 only): snapshot fixtures; the player uses the UI only.
 */
import type { Page } from '@playwright/test'
import { test, expect } from './support/test'
import { startFromSnapshot } from './support/room'
import { clickableRackTiles, phaseBanner } from './support/ui'
import { openTab, showBoard } from '../support/tabs'

type Box = { x: number; y: number; width: number; height: number }

/** Board squares by coordinate with their chain and box. */
async function boardSquares(page: Page) {
  return page.getByTestId('board').evaluate((board) => {
    const out: Record<string, { chain: string; join: string; anchor: string | null } & Box> = {}
    for (const el of board.querySelectorAll<HTMLElement>('[data-testid^="tile-"]')) {
      const r = el.getBoundingClientRect()
      out[el.dataset.testid!.slice(5)] = {
        chain: el.dataset.chain ?? 'empty',
        join: el.dataset.join ?? '',
        anchor: el.dataset.anchor ?? null,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      }
    }
    return out
  })
}

const right = (coord: string) => {
  const [, c, r] = /^(\d+)([A-Z])$/.exec(coord)!
  return `${Number(c) + 1}${r}`
}
const below = (coord: string) => {
  const [, c, r] = /^(\d+)([A-Z])$/.exec(coord)!
  return `${c}${String.fromCharCode(r.charCodeAt(0) + 1)}`
}

/** Let finite CSS animations/transitions (a modal fading in) finish before a screenshot. */
async function settled(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined))
    )
  )
}

/** Relative luminance of a CSS rgb() colour. */
async function bodyLuminance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const m = getComputedStyle(document.body)
      .backgroundColor.match(/\d+(\.\d+)?/g)!
      .map(Number)
    const lin = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * lin(m[0]) + 0.7152 * lin(m[1]) + 0.0722 * lin(m[2])
  })
}

for (const size of [
  { label: 'phone 390x844', width: 390, height: 844 },
  { label: 'laptop 1366x768', width: 1366, height: 768 },
]) {
  test(`a chain is one block with one label, orphans stay apart (${size.label})`, async ({
    page,
    shots,
  }) => {
    await startFromSnapshot(page, 'dead-tile-in-hand', { viewport: size })
    await showBoard(page)
    const squares = await boardSquares(page)
    let joins = 0
    const labels: Record<string, number> = {}
    for (const [coord, sq] of Object.entries(squares)) {
      if (sq.chain === 'empty') continue
      if (sq.chain === 'orphan') {
        expect(sq.join, `orphan ${coord} never joins`).toBe('')
        continue
      }
      // Same chain to the right / below: the squares touch (the gap is filled).
      for (const [next, side] of [
        [right(coord), 'e'],
        [below(coord), 's'],
      ] as const) {
        const n = squares[next]
        if (n?.chain !== sq.chain) {
          expect(sq.join.split(' ')).not.toContain(side)
          continue
        }
        joins++
        expect(sq.join.split(' '), `${coord} joins ${side}`).toContain(side)
        if (side === 'e') expect(sq.x + sq.width).toBeGreaterThanOrEqual(n.x - 0.5)
        else expect(sq.y + sq.height).toBeGreaterThanOrEqual(n.y - 0.5)
      }
      if (sq.anchor === 'true') labels[sq.chain] = (labels[sq.chain] ?? 0) + 1
    }
    expect(joins, 'the fixture has chains of several squares').toBeGreaterThan(5)
    // Exactly one visible label per chain; the other squares keep theirs for screen readers.
    const chains = new Set(
      Object.values(squares)
        .map((s) => s.chain)
        .filter((c) => c !== 'empty' && c !== 'orphan')
    )
    expect(chains.size).toBe(7)
    for (const c of chains) expect(labels[c], c).toBe(1)
    const visibleLabels = await page
      .getByTestId('board')
      .locator('[data-anchor] span')
      .evaluateAll((spans) => spans.filter((s) => s.getBoundingClientRect().width > 2).length)
    expect(visibleLabels).toBe(chains.size)
    await shots.take(page, 'chain-shapes', { fullPage: false })
  })
}

test('your-turn signal: accent while the table waits on me, calm after', async ({
  page,
  shots,
}) => {
  await startFromSnapshot(page, 'buy-phase-multi-chain', { viewport: { width: 390, height: 844 } })
  await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
  await expect(phaseBanner(page)).toHaveAttribute('data-turn', 'mine')
  await shots.take(page, 'my-turn', { fullPage: false })
  await page.getByTestId('end-turn-button').click()
  await expect(phaseBanner(page)).not.toHaveText('BUY STOCKS')
  // The scripted seats play on; whenever it is not on me, the bar is calm (and says who the
  // table waits for).
  await expect
    .poll(async () => {
      const turn = await phaseBanner(page).getAttribute('data-turn')
      const text = (await phaseBanner(page).innerText()).trim()
      return turn === 'other' ? / IS /.test(text) : turn === 'mine'
    })
    .toBe(true)
  await shots.take(page, 'after-my-turn', { fullPage: false })
})

for (const scheme of ['light', 'dark'] as const) {
  test(`system colour scheme: home and the key game screens render (${scheme})`, async ({
    page,
    shots,
  }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/')
    await expect(page.getByTestId('home-motif')).toBeVisible()
    await expect(page.getByTestId('theme-toggle')).toHaveAttribute('data-theme-current', scheme)
    const lum = await bodyLuminance(page)
    if (scheme === 'light') expect(lum).toBeGreaterThan(0.7)
    else expect(lum).toBeLessThan(0.05)
    await shots.take(page, 'home')

    const room = await startFromSnapshot(page, 'buy-phase-multi-chain', {
      viewport: { width: 1366, height: 768 },
    })
    await expect(page.getByTestId('board')).toBeVisible()
    // In a game the switch is in the menu (BL-019): the header carries what changes.
    await page.getByTestId('header-menu-button').click()
    await expect(page.getByTestId('menu-theme-toggle')).toHaveAttribute(
      'data-theme-current',
      scheme
    )
    await shots.take(page, 'game-menu', { fullPage: false })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('header-menu')).toHaveCount(0)
    for (const t of ['table', 'chains', 'trades'] as const) {
      await openTab(page, t)
      await shots.take(page, `game-${t}`, { fullPage: false })
    }
    // A modal on top of the game.
    await page.getByRole('button', { name: 'PROPOSE TRADE' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await settled(page)
    await shots.take(page, 'trade-modal', { fullPage: false })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // The host view in the same scheme.
    const host = await page.context().newPage()
    await host.emulateMedia({ colorScheme: scheme })
    await host.setViewportSize({ width: 1920, height: 1080 })
    await host.goto(`/host/${room.code}`)
    await expect(host.getByTestId('board')).toBeVisible()
    await shots.take(host, 'host', { fullPage: false })
    await host.close()
  })
}

test('the toggle switches the scheme, is remembered after a reload, and can go back', async ({
  page,
  shots,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  const toggle = page.getByTestId('theme-toggle')
  await expect(toggle).toHaveAttribute('data-theme-current', 'dark')
  await toggle.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(toggle).toHaveAttribute('data-theme-current', 'light')
  expect(await bodyLuminance(page)).toBeGreaterThan(0.7)
  await shots.take(page, 'switched-to-light')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await bodyLuminance(page)).toBeGreaterThan(0.7)
  await page.getByTestId('theme-toggle').click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./)
  expect(await bodyLuminance(page)).toBeLessThan(0.05)
})

test('reduced motion: a placed tile and the money do not animate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await startFromSnapshot(page, 'opening-place-tile', { viewport: { width: 1366, height: 768 } })
  await expect(phaseBanner(page)).toHaveText('PLACE A TILE')
  const tile = clickableRackTiles(page).first()
  const coord = (await tile.getAttribute('data-testid'))!.replace('tile-', '')
  await tile.click()
  await page.getByTestId('place-tile-button').click()
  await expect(phaseBanner(page)).not.toHaveText('PLACE A TILE')
  const square = page.getByTestId('board').getByTestId(`tile-${coord}`)
  await expect(square).not.toHaveAttribute('data-chain', 'empty')
  // None of the explanatory animations (tile settle, merger sweep, money flash) runs. (Status
  // indicators such as the AI "thinking" dots are not part of this pass.)
  const ours = await page.evaluate(() =>
    document
      .getAnimations()
      .map((a) => (a as CSSAnimation).animationName ?? '')
      .filter((n) => /settle|sweep|flash/.test(n))
  )
  expect(ours, 'no tile / money animation under prefers-reduced-motion').toEqual([])
  await expect(square).not.toHaveAttribute('data-anim', /./)
})
