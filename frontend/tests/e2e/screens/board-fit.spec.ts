/**
 * Tier 3 (BL-014): the Board tab of a phone fits the screen that is really there.
 *
 * A phone browser with its toolbars showing leaves about 390x675 CSS px (an iPhone in Chrome
 * or Safari), 375x630 on the smaller ones; not the 844 of the device. In that space the Board
 * tab shows the header, the phase bar, the whole board, every row of the players matrix (one
 * line per player), its footer (tiles, price, bank) and the tile rack, with nothing to scroll
 * and nothing cut off. Checked here at exactly those sizes:
 *
 *  - 390x675 and 375x630, four players, at the start of a game (AI seats with their character
 *    names, as in a real game against bots) and in the middle of one;
 *  - 390x675, six players, in the middle of a game;
 *  - 360x600: four players still fit; with six the board stays whole and only the table panel
 *    scrolls inside itself (the documented way it degrades);
 *  - the seat-kind icon is a small icon in the name's line, and still opens its popover.
 *
 * Setup (tier 3 only): the game is created from the home page; opponents are added through the
 * add-seat route and a generated snapshot is loaded. The browser player uses the UI only.
 */
import type { Page } from '@playwright/test'
import { test, expect } from './support/test'
import { startFromSnapshot } from './support/room'
import { loadFixture } from './support/fixtures'
import { expectFullBoard, layoutProblems } from './support/layout'
import { phaseBanner } from './support/ui'
import { tablePanel } from '../support/tabs'

const IPHONE = { width: 390, height: 675 }
const IPHONE_SE = { width: 375, height: 630 }
const SMALL = { width: 360, height: 600 }

/**
 * A room whose other seats are AI seats with their own character names (a Fake LLM first, then
 * rules-based bots), started from a snapshot in which the human is to move, so nobody acts.
 */
async function aiRoom(
  page: Page,
  fixtureName: string,
  viewport: { width: number; height: number }
) {
  const fixture = loadFixture(fixtureName)
  const seats = (fixture.snapshot.players as Array<{ player_id: string }>).map((p) => p.player_id)
  await page.setViewportSize(viewport)
  await page.goto('/')
  await page.getByTestId('name-input').fill('Linan')
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z0-9]{4}/)
  const code = /\/play\/([A-Z0-9]{4})/.exec(page.url())![1]
  const humanId = await page.evaluate(() => sessionStorage.getItem('player_id') ?? '')
  const seatMap: Record<string, string> = { [fixture.human_seat]: humanId }
  const ai: Array<{ player_id: string; name: string; agent: string }> = []
  for (const seat of seats) {
    if (seat === fixture.human_seat) continue
    const agent = ai.length === 0 ? 'llm:fake' : 'bot'
    const res = await page.request.post(`/api/room/${code}/add-seat`, { data: { agent_id: agent } })
    expect(res.ok(), await res.text()).toBeTruthy()
    const body = (await res.json()) as { player_id: string; name: string }
    seatMap[seat] = body.player_id
    ai.push({ ...body, agent })
  }
  for (const id of Object.values(seatMap)) {
    await expect(page.getByTestId(`lobby-player-${id}`)).toBeVisible()
  }
  const load = await page.request.post(`/api/test/room/${code}/load-snapshot`, {
    data: { snapshot: fixture.snapshot, seat_map: seatMap },
  })
  expect(load.ok(), await load.text()).toBeTruthy()
  await expect(page.getByTestId('tile-rack')).toBeVisible()
  return { humanId, ai, players: seats.length }
}

interface Fit {
  viewport: { width: number; height: number }
  panel: { scrollHeight: number; clientHeight: number; scrollWidth: number; clientWidth: number }
  rackTop: number
  rows: Array<{
    id: string
    top: number
    bottom: number
    left: number
    right: number
    height: number
  }>
  matrixRight: number
  playerRowHeights: number[]
  nameLines: number[]
  square: { width: number; height: number }
}

/** The boxes that decide whether the Board tab fits. */
async function measure(page: Page): Promise<Fit> {
  return page.evaluate(() => {
    const q = (id: string) => document.querySelector(`[data-testid="${id}"]`)!
    const panel = q('table-panel')
    const matrix = q('holdings-matrix')
    const rows = Array.from(matrix.querySelectorAll('tr')).map((tr) => {
      const r = tr.getBoundingClientRect()
      return {
        id: tr.getAttribute('data-testid') ?? 'head',
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        height: r.height,
      }
    })
    const playerRows = Array.from(matrix.querySelectorAll('tbody tr'))
    const sq = q('board').querySelector('[data-testid="tile-1A"]')!.getBoundingClientRect()
    return {
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      panel: {
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
        scrollWidth: panel.scrollWidth,
        clientWidth: panel.clientWidth,
      },
      rackTop: q('tile-rack').getBoundingClientRect().top,
      rows,
      matrixRight: matrix.getBoundingClientRect().right,
      playerRowHeights: playerRows.map((tr) => tr.getBoundingClientRect().height),
      // How many lines of boxes the name cell holds (1 = name, icon and YOU side by side).
      nameLines: playerRows.map((tr) => {
        const tops = Array.from(tr.querySelectorAll('th > span > *'))
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 1 && r.height > 1)
          .map((r) => Math.round((r.top + r.bottom) / 2))
        return new Set(tops.map((t) => Math.round(t / 6))).size
      }),
      square: { width: sq.width, height: sq.height },
    }
  })
}

/**
 * Nothing scrolls and nothing is cut: the table panel is as tall as its content, every row of
 * the matrix is on screen above the rack, the table ends inside the screen, the board is whole,
 * and the page itself does not scroll. `players` rows of one line each.
 */
async function expectBoardTabFits(page: Page, players: number, opts: { footer: boolean }) {
  // The panel's height follows its content (measured after layout): wait for it to settle.
  await expect
    .poll(
      async () => {
        const m = await measure(page)
        return m.panel.scrollHeight - m.panel.clientHeight
      },
      { message: 'the table panel does not scroll' }
    )
    .toBeLessThanOrEqual(0)
  const m = await measure(page)
  expect(m.panel.scrollWidth, 'the table panel does not scroll sideways').toBeLessThanOrEqual(
    m.panel.clientWidth
  )
  expect(m.matrixRight, 'the table ends inside the screen').toBeLessThanOrEqual(m.viewport.width)
  expect(m.rows.filter((r) => r.id === 'player-row')).toHaveLength(players)
  const footer = m.rows.filter((r) => r.id.startsWith('matrix-'))
  expect(footer.map((r) => r.id)).toEqual(
    opts.footer ? ['matrix-size', 'matrix-price', 'matrix-bank'] : []
  )
  for (const r of m.rows) {
    expect(r.top, `${r.id} starts on screen`).toBeGreaterThanOrEqual(0)
    expect(r.bottom, `${r.id} ends above the rack`).toBeLessThanOrEqual(m.rackTop + 0.5)
    expect(r.left, `${r.id} left edge`).toBeGreaterThanOrEqual(0)
    expect(r.right, `${r.id} right edge`).toBeLessThanOrEqual(m.viewport.width + 0.5)
  }
  // One line per player: about 28px, the name, the seat icon and YOU side by side.
  for (const h of m.playerRowHeights) expect(h, 'player row height').toBeLessThanOrEqual(30)
  expect(m.nameLines, 'lines in each name cell').toEqual(m.playerRowHeights.map(() => 1))
  // A square never gets too flat to tap, and never taller than wide.
  expect(m.square.height, 'board square height').toBeGreaterThanOrEqual(20)
  expect(m.square.height).toBeLessThanOrEqual(m.square.width + 0.5)
  await expectFullBoard(page)
  expect(
    await layoutProblems(page, [
      'header-room',
      'header-tile-pool',
      'game-phase',
      'board',
      'table-panel',
      'tile-rack',
      'tab-bar',
    ])
  ).toEqual([])
  // The table under the board has my cash, worth and rank: the header does not repeat them.
  await expect(page.getByTestId('header-cash')).toHaveCount(0)
  await expect(page.getByTestId('header-networth')).toHaveCount(0)
  for (const id of ['header-room', 'header-tile-pool', 'game-phase', 'tile-rack', 'tab-bar']) {
    await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 })
  }
}

for (const vp of [IPHONE, IPHONE_SE]) {
  const label = `${vp.width}x${vp.height}`

  test(`Board tab at ${label}, four players at the start of a game: everything on screen, nothing scrolls`, async ({
    page,
    shots,
  }) => {
    const room = await aiRoom(page, 'opening-place-tile', vp)
    await expect(phaseBanner(page)).toHaveText('PLACE A TILE')
    console.log(`[${label}] four players at game start: ${room.ai.map((s) => s.name).join(', ')}`)
    await shots.take(page, `${label}-start-four-players`, { fullPage: false })
    // No chain on the board yet: the footer has nothing to say and is not there.
    await expectBoardTabFits(page, 4, { footer: false })
    // Squares are still square here: the board did not have to give anything up.
    const m = await measure(page)
    console.log(
      `[${label}] square ${m.square.width.toFixed(1)}x${m.square.height.toFixed(1)}, panel ${m.panel.scrollHeight}/${m.panel.clientHeight}`
    )
    expect(Math.abs(m.square.width - m.square.height)).toBeLessThanOrEqual(0.5)
    // The instruction is not a line under the board; it is behind the "?" of the phase bar.
    await expect(tablePanel(page).getByText(/pick a tile from your rack/i)).toHaveCount(0)
    // AI seats print their first name where the column is narrow; the whole name is the tooltip.
    for (const seat of room.ai) {
      const name = page
        .locator(`[data-testid="player-row"][data-player-id="${seat.player_id}"]`)
        .getByTestId('player-name')
      await expect(name).toHaveAttribute('title', seat.name)
      const box = (await name.boundingBox())!
      const fits = await name.evaluate((el) => el.scrollWidth <= el.clientWidth)
      expect(fits, `${seat.name} is not cut off (${Math.round(box.width)}px)`).toBe(true)
    }
    // Picking a tile brings the PLACE TILE line: the matrix is still whole above it.
    await page.getByTestId('tile-rack').locator('[role="button"]').first().click()
    await expect(page.getByTestId('place-tile-button')).toBeVisible()
    await expectBoardTabFits(page, 4, { footer: false })
    await expect(page.getByTestId('place-tile-button')).toBeInViewport({ ratio: 1 })
    await shots.take(page, `${label}-start-tile-picked`, { fullPage: false })
  })

  test(`Board tab at ${label}, four players mid-game: every player row and the footer on screen, nothing scrolls`, async ({
    page,
    shots,
  }) => {
    // Bob (p2) is an idle seat: after my buy the table waits for him and the screen stays put.
    await startFromSnapshot(page, 'buy-phase-multi-chain', { idle: ['p2'], viewport: vp })
    await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
    await shots.take(page, `${label}-mid-buy`, { fullPage: false })
    await page.getByTestId('end-turn-button').click()
    // Who the table waits for is in the phase bar, once: no line of the panel is spent on it.
    await expect(phaseBanner(page)).toHaveText(/^BOB IS /)
    await expect(page.getByTestId('waiting-message')).toHaveCount(0)
    await shots.take(page, `${label}-mid-four-players`, { fullPage: false })
    await expectBoardTabFits(page, 4, { footer: true })
    const m = await measure(page)
    console.log(
      `[${label}] mid-game square ${m.square.width.toFixed(1)}x${m.square.height.toFixed(1)}, panel ${m.panel.scrollHeight}/${m.panel.clientHeight}`
    )
  })
}

test('Board tab at 390x675, six players mid-game: all six rows and the footer on screen, nothing scrolls', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'six-player-midgame', { viewport: IPHONE })
  await expect(phaseBanner(page)).toHaveText('PLACE A TILE')
  await shots.take(page, '390x675-six-players', { fullPage: false })
  await expectBoardTabFits(page, 6, { footer: true })
  const m = await measure(page)
  console.log(
    `[390x675] six players: square ${m.square.width.toFixed(1)}x${m.square.height.toFixed(1)}, panel ${m.panel.scrollHeight}/${m.panel.clientHeight}`
  )
  // Every seat is named in full (single names here), me marked.
  for (const p of room.fixture.expect.players) {
    await expect(
      page.getByTestId('holdings-matrix').getByRole('rowheader', { name: new RegExp(p.name) })
    ).toBeInViewport({ ratio: 1 })
  }
  // The last merger is one quiet line under the table, on screen too.
  await expect(page.getByTestId('decision-last-merger')).toBeInViewport({ ratio: 1 })
})

test('Board tab at 360x600: four players fit; with six the board stays whole and only the table panel scrolls', async ({
  page,
  shots,
}) => {
  await aiRoom(page, 'opening-place-tile', SMALL)
  await expect(phaseBanner(page)).toHaveText('PLACE A TILE')
  await shots.take(page, '360x600-start-four-players', { fullPage: false })
  await expectBoardTabFits(page, 4, { footer: false })

  await startFromSnapshot(page, 'six-player-midgame', { viewport: SMALL })
  await expect(phaseBanner(page)).toHaveText('PLACE A TILE')
  await shots.take(page, '360x600-six-players', { fullPage: false })
  // Degrades in one way only: the panel under the board scrolls inside itself. The board is
  // whole, the rack and the tab bar are on screen, the page does not scroll, nothing is wider
  // than the screen.
  await expectFullBoard(page)
  expect(
    await layoutProblems(page, ['game-phase', 'board', 'table-panel', 'tile-rack', 'tab-bar'])
  ).toEqual([])
  const m = await measure(page)
  console.log(
    `[360x600] six players: square ${m.square.width.toFixed(1)}x${m.square.height.toFixed(1)}, panel ${m.panel.scrollHeight}/${m.panel.clientHeight}`
  )
  expect(m.matrixRight).toBeLessThanOrEqual(m.viewport.width)
  expect(m.panel.scrollWidth).toBeLessThanOrEqual(m.panel.clientWidth)
  expect(m.square.height).toBeGreaterThanOrEqual(20)
  // At least the head and four player rows show without scrolling; the rest is one flick away.
  const visible = m.rows.filter((r) => r.id === 'player-row' && r.bottom <= m.rackTop + 0.5)
  expect(visible.length).toBeGreaterThanOrEqual(4)
  await tablePanel(page).evaluate((el) => (el.scrollTop = el.scrollHeight))
  await expect(page.getByTestId('matrix-bank')).toBeInViewport({ ratio: 1 })
  await shots.take(page, '360x600-six-players-scrolled', { fullPage: false })
})

test.describe('seat icon in the players matrix on a phone', () => {
  test.use({ hasTouch: true })

  test('the seat-kind icon is small, in the line of the name, and still opens its popover', async ({
    page,
    shots,
  }) => {
    const room = await aiRoom(page, 'opening-place-tile', IPHONE)
    const rowOf = (id: string) => page.locator(`[data-testid="player-row"][data-player-id="${id}"]`)
    const humanRow = (await rowOf(room.humanId).boundingBox())!
    for (const seat of room.ai) {
      const row = rowOf(seat.player_id)
      const badge = row.getByTestId(`seat-kind-${seat.player_id}`)
      await expect(badge).toBeVisible()
      // Drawn small (the owner: "the bot icon is unnecessarily big")...
      const icon = (await badge.locator('svg').boundingBox())!
      expect(icon.width, 'icon width').toBeLessThanOrEqual(16)
      expect(icon.height, 'icon height').toBeLessThanOrEqual(16)
      // ...with a thumb-sized hit area around it...
      const hit = (await badge.boundingBox())!
      expect(hit.width, 'tap target width').toBeGreaterThanOrEqual(32)
      expect(hit.height, 'tap target height').toBeGreaterThanOrEqual(32)
      // ...next to the name, on its line, in a row no taller than a person's.
      const name = (await row.getByTestId('player-name').boundingBox())!
      const mid = (b: { y: number; height: number }) => b.y + b.height / 2
      expect(Math.abs(mid(icon) - mid(name)), 'icon on the name line').toBeLessThanOrEqual(3)
      expect(icon.x, 'icon after the name').toBeGreaterThanOrEqual(name.x + name.width - 1)
      const box = (await row.boundingBox())!
      expect(Math.abs(box.height - humanRow.height), 'row height with an icon').toBeLessThanOrEqual(
        1
      )
    }
    await expect(rowOf(room.humanId).locator('[data-testid^="seat-kind-"]')).toHaveCount(0)
    await shots.take(page, 'icons-closed', { fullPage: false })

    // A tap opens the popover: the full name, what the seat is, its cash and share value.
    const llm = room.ai.find((s) => s.agent === 'llm:fake')!
    const bot = room.ai.find((s) => s.agent === 'bot')!
    await page.getByTestId(`seat-kind-${llm.player_id}`).tap()
    const pop = page.getByRole('dialog', { name: `About ${llm.name}` })
    await expect(pop).toBeVisible()
    await expect(pop).toContainText(llm.name)
    await expect(pop).toContainText('AI player')
    await expect(page.getByTestId(`seat-popover-extra-${llm.player_id}`)).toContainText(
      /Cash \$6,000/
    )
    const p = (await pop.boundingBox())!
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.x + p.width).toBeLessThanOrEqual(IPHONE.width)
    expect(p.y + p.height).toBeLessThanOrEqual(IPHONE.height)
    await shots.take(page, 'icon-popover-open', { fullPage: false })
    // A tap elsewhere closes it; the neighbour's icon opens its own (the hit areas do not mix).
    await page.getByTestId('header-title').tap()
    await expect(pop).toBeHidden()
    await page.getByTestId(`seat-kind-${bot.player_id}`).tap()
    await expect(page.getByRole('dialog', { name: `About ${bot.name}` })).toContainText(
      'Rules-based bot'
    )
    await shots.take(page, 'bot-popover-open', { fullPage: false })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})

/** The "?" of the phase bar: the hint and the table's legend, without costing a line. */
test('the "?" in the phase bar holds the placing hint and the legend of the table', async ({
  page,
  shots,
}) => {
  await aiRoom(page, 'opening-place-tile', IPHONE)
  const help = page.getByTestId('phase-help')
  await expect(help).toBeVisible()
  // It does not make the phase bar taller.
  const bar = (await phaseBanner(page).boundingBox())!
  expect(bar.height).toBeLessThanOrEqual(30)
  await help.click()
  const panel = page.getByTestId('phase-help-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('pick a tile from your rack')
  await expect(panel.getByTestId('matrix-legend')).toContainText('second most')
  const box = (await panel.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(IPHONE.width)
  await shots.take(page, 'phase-help-open', { fullPage: false })
  await page.getByTestId('tile-rack').click()
  await expect(panel).toBeHidden()
})
