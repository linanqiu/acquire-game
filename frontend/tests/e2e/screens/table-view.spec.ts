/**
 * Tier 3 (BL-007, BL-013): net worth, majority/minority holders and the merger result, on the
 * player page and the host page, at desktop and phone sizes, asserted against the fixture's
 * `expect` block (computed by the engine's calculator when the fixture was generated). The
 * players matrix: one row per player, one column per chain in the ruleset's order (the same for
 * every player and everywhere else chains are listed), majority and minority marked in the
 * cell, no sideways scrolling at 360, 390 and 1366 wide. Also the layout
 * promises of the redesign: the tile rack is on screen without scrolling at 1366x768 in every
 * phase, nothing overlaps and nothing leaves the screen sideways.
 */
import type { Browser, Page } from '@playwright/test'
import { test, expect, type Shots } from './support/test'
import { startFromSnapshot, type RoomContext } from './support/room'
import { dollars, loadFixture } from './support/fixtures'
import { phaseBanner, playHumanTurns } from './support/ui'
import { layoutProblems } from './support/layout'
import { expectFullBoard, outsideWidth } from './support/layout'
import { openTab, tab, tablePanel, tableTabId, type TabName } from '../support/tabs'

const DESKTOP = { width: 1366, height: 768 }
const PHONE = { width: 390, height: 844 }

async function openHost(browser: Browser, room: RoomContext, viewport = DESKTOP): Promise<Page> {
  const ctx = await browser.newContext({ viewport })
  const host = await ctx.newPage()
  host.on('pageerror', (err) => {
    throw new Error(`host page error: ${err.message}`)
  })
  await host.goto(`/host/${room.code}`)
  await expect(host.getByTestId('game-phase')).toBeVisible()
  return host
}

/** The chains of the server's ruleset, in its order: the one order used everywhere. */
async function rulesetChains(page: Page): Promise<string[]> {
  const res = await page.request.get('/api/config/game')
  expect(res.ok(), 'GET /api/config/game').toBeTruthy()
  const body = (await res.json()) as { chains: Array<{ id: string }> }
  return body.chains.map((c) => c.id)
}

/**
 * The players matrix against the fixture: every row lists every chain in the ruleset's order;
 * a cell is the share count (empty cells carry no count), marked majority / minority exactly
 * where the engine's `chain_holders` says so (ties too); the footer gives each chain's size,
 * price and bank stock; chains not on the board keep their column, marked inactive.
 */
async function expectMatrix(page: Page, room: RoomContext) {
  const { players, chain_holders, active_chains, inactive_chains } = room.fixture.expect
  const order = await rulesetChains(page)
  const matrix = page.getByTestId('holdings-matrix')
  await expect(matrix).toHaveCount(1)
  const cols = await matrix
    .locator('thead [data-testid^="matrix-chain-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(13)))
  expect(cols, 'chain columns are the ruleset order').toEqual(order)
  const rows = matrix.locator('tbody tr[data-player-id]')
  await expect(rows).toHaveCount(players.length)
  for (const p of players) {
    const id = room.seatMap[p.player_id]
    const row = matrix.locator(`tbody tr[data-player-id="${id}"]`)
    const cells = await row
      .locator('[data-testid^="matrix-cell-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
    expect(cells, `${p.name}: same chain order as everyone`).toEqual(
      order.map((c) => `matrix-cell-${id}-${c}`)
    )
    for (const chain of order) {
      const cell = row.getByTestId(`matrix-cell-${id}-${chain}`)
      const held = p.holdings[chain] ?? 0
      const count = cell.getByTestId(`player-stock-${id}-${chain}`)
      if (held > 0) await expect(count).toHaveText(String(held))
      else await expect(count).toHaveCount(0)
      const holder = chain_holders[chain]?.holders.find((h) => h.player_id === p.player_id)
      const role = held > 0 ? (holder?.role ?? null) : null
      if (role) await expect(cell, `${p.name} ${chain}`).toHaveAttribute('data-role', role)
      else await expect(cell, `${p.name} ${chain}`).not.toHaveAttribute('data-role', /.+/)
      if (role && holder?.tied) await expect(cell).toHaveAttribute('data-tied', 'true')
      else await expect(cell).not.toHaveAttribute('data-tied', /.+/)
    }
  }
  for (const [chain, c] of Object.entries(active_chains)) {
    await expect(matrix.getByTestId(`matrix-chain-${chain}`)).toHaveAttribute('data-active', 'true')
    await expect(matrix.getByTestId(`matrix-size-${chain}`)).toContainText(String(c.size))
    await expect(matrix.getByTestId(`matrix-price-${chain}`)).toHaveAttribute(
      'data-price',
      String(c.price)
    )
    await expect(matrix.getByTestId(`matrix-bank-${chain}`)).toHaveText(String(c.available))
  }
  for (const chain of inactive_chains) {
    await expect(matrix.getByTestId(`matrix-chain-${chain}`)).toHaveAttribute(
      'data-active',
      'false'
    )
  }
  // The same order in the Chains tab (active chains only).
  const listed = await page
    .getByTestId('chain-list')
    .locator('[data-testid^="chain-row-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(10)))
  expect(listed).toEqual(order.filter((c) => c in active_chains))
}

/**
 * Open each reference tab in turn: it fits next to the rack without overlapping, and the merger
 * in progress lives in the table panel (BL-011, BL-013), never on top of another tab.
 */
async function expectTabsFit(page: Page, shots: Shots, label: string, tabs: TabName[]) {
  const phone = (await tab(page, 'board').count()) > 0
  for (const name of tabs) {
    await openTab(page, name)
    await expect(page.getByTestId('merger-result')).toBeHidden()
    expect(
      await layoutProblems(page, [
        'game-phase',
        `tabpanel-${name}`,
        ...(phone ? ['dock', 'tab-bar'] : ['board-pane', 'tab-list']),
      ])
    ).toEqual([])
    await shots.take(page, `${label}-${name}`, { fullPage: false })
  }
  await openTab(page, 'table')
  await expect(tablePanel(page).getByTestId('merger-result')).toBeVisible()
  // The matrix fits the width of its panel: no sideways scrolling anywhere.
  const matrix = page.getByTestId('holdings-matrix')
  await matrix.scrollIntoViewIfNeeded()
  expect(
    await outsideWidth(
      page,
      '[data-testid="holdings-matrix"] td, [data-testid="holdings-matrix"] th'
    )
  ).toEqual([])
  expect(
    await tablePanel(page).evaluate((el) => el.scrollWidth - el.clientWidth),
    'the table panel does not scroll sideways'
  ).toBeLessThanOrEqual(1)
  await shots.take(page, `${label}-matrix`, { fullPage: false })
  if ((await tableTabId(page)) === 'board') await expectFullBoard(page)
}

/** The holder's row of the merger view that shows the bonus the engine paid them. */
const bonusRow = (p: Page, chain: string, id: string) =>
  p.getByTestId(`merger-bonus-${chain}-${id}`).locator('xpath=ancestor::tr')

/** Net worth, rank and the majority/minority lines match the fixture's engine figures. */
async function expectTableView(page: Page, room: RoomContext, host = false) {
  const { net_worth, chain_holders } = room.fixture.expect
  const name = (seat: string) => room.names[room.seatMap[seat]]
  for (const [seat, w] of Object.entries(net_worth)) {
    const id = room.seatMap[seat]
    await expect(page.getByTestId(`player-networth-${id}`)).toHaveText(dollars(w.net_worth))
    await expect(page.getByTestId(`player-stockvalue-${id}`)).toHaveText(dollars(w.stock_value))
    await expect(page.getByTestId(`player-cash-${id}`)).toHaveText(dollars(w.cash))
    await expect(page.getByTestId(`player-rank-${id}`)).toContainText(String(w.rank))
  }
  for (const [chain, info] of Object.entries(chain_holders)) {
    const first = info.holders.filter((h) => h.role === 'majority')
    const second = info.holders.filter((h) => h.role === 'minority')
    const majority = page.getByTestId(`chain-majority-${chain}`)
    for (const h of first) {
      await expect(majority).toContainText(name(h.player_id))
      await expect(majority).toContainText(dollars(h.bonus))
    }
    if (first.length > 1) await expect(majority).toHaveAttribute('data-tied', 'true')
    for (const h of second) {
      const minority = page.getByTestId(`chain-minority-${chain}`)
      await expect(minority).toContainText(name(h.player_id))
      await expect(minority).toContainText(dollars(h.bonus))
      if (second.length > 1) await expect(minority).toHaveAttribute('data-tied', 'true')
    }
    if (!host) {
      const mine = info.holders.find((h) => h.player_id === room.fixture.human_seat)
      const you = page.getByTestId(`chain-you-${chain}`)
      if (!mine) await expect(you).toHaveCount(0)
      else if (mine.role === 'majority') await expect(you).toContainText('1st')
      else if (mine.role === 'minority') await expect(you).toContainText('2nd')
      else await expect(you).toContainText('behind')
    }
  }
  if (!host) {
    const me = net_worth[room.fixture.human_seat]
    await expect(page.getByTestId('header-networth')).toHaveText(dollars(me.net_worth))
    await expect(page.getByTestId('header-rank')).toContainText(`#${me.rank}`)
  }
}

async function tableView(
  page: Page,
  browser: Browser,
  shots: Shots,
  label: string,
  vp: { width: number; height: number }
) {
  const room = await startFromSnapshot(page, 'disposition-waiting-on-other', {
    idle: ['p2'],
    viewport: vp,
  })
  await expectTableView(page, room)
  await expectMatrix(page, room)
  await expect(page.getByTestId('tile-rack')).toBeInViewport()
  await expectTabsFit(page, shots, `${label}-player`, ['chains'])

  const host = await openHost(browser, room, vp)
  await expectTableView(host, room, true)
  await expectMatrix(host, room)
  await expectTabsFit(host, shots, `${label}-host`, ['chains'])
}

test('table view on desktop: net worth, ranks and majority/minority holders, player and host', async ({
  page,
  browser,
  shots,
}) => {
  await tableView(page, browser, shots, 'desktop', DESKTOP)
})

test('table view on phone: net worth, ranks and majority/minority holders, player and host', async ({
  page,
  browser,
  shots,
}) => {
  await tableView(page, browser, shots, 'phone', PHONE)
})

for (const vp of [
  { label: '360x640', width: 360, height: 640 },
  { label: '390x844', width: 390, height: 844 },
  { label: '1366x768', width: 1366, height: 768 },
]) {
  test(`players matrix at ${vp.label}, six players: one chain order for everyone, majority and minority marked, with the board`, async ({
    page,
    shots,
  }) => {
    const room = await startFromSnapshot(page, 'six-player-midgame', { viewport: vp })
    await expect(phaseBanner(page)).toHaveText('PLACE A TILE')
    // No tab to switch to: the matrix is in the table panel, with the board on screen.
    await expect(page.getByTestId('tab-players')).toHaveCount(0)
    await expect(tablePanel(page).getByTestId('holdings-matrix')).toBeInViewport()
    await expectFullBoard(page)
    expect(await layoutProblems(page, ['board', 'table-panel', 'tile-rack'])).toEqual([])
    await expectMatrix(page, room)
    // A real table: column headers name the chains, row headers the players.
    const matrix = page.getByTestId('holdings-matrix')
    await expect(matrix.getByRole('columnheader')).toHaveCount(
      (await rulesetChains(page)).length + 3
    )
    for (const p of room.fixture.expect.players) {
      await expect(matrix.getByRole('rowheader', { name: new RegExp(p.name) })).toBeVisible()
    }
    // Me, marked.
    await expect(
      matrix.locator(`tr[data-player-id="${room.humanId}"]`).getByText('YOU')
    ).toBeVisible()
    expect(
      await outsideWidth(
        page,
        '[data-testid="holdings-matrix"] td, [data-testid="holdings-matrix"] th'
      )
    ).toEqual([])
    expect(
      await tablePanel(page).evaluate((el) => el.scrollWidth - el.clientWidth),
      'no sideways scrolling'
    ).toBeLessThanOrEqual(1)
    await shots.take(page, `matrix-${vp.label}`, { fullPage: false })
  })
}

test('merger result: bonuses at once, then each stockholder decision as it comes, on player and host', async ({
  page,
  browser,
  shots,
}) => {
  // Bob (p2) decides first and is idle, so the merger stays in progress while we look.
  const room = await startFromSnapshot(page, 'disposition-waiting-on-other', { idle: ['p2'] })
  const merger = room.fixture.expect.mergers.find((m) => !m.complete)!
  const d = merger.defunct[0]
  const id = (seat: string) => room.seatMap[seat]
  const name = (seat: string) => room.names[id(seat)]
  const host = await openHost(browser, room)

  for (const p of [page, host]) {
    const card = p.getByTestId('merger-result')
    await expect(card).toBeVisible()
    await expect(p.getByTestId('merger-result-title')).toContainText(
      new RegExp(`${merger.survivor} takes over ${d.chain}`, 'i')
    )
    await expect(card).toContainText(`${d.size} tiles · ${dollars(d.price)}`)
    for (const b of d.bonuses!) {
      const row = bonusRow(p, d.chain, id(b.player_id))
      // The player page calls its own seat "You".
      const me = p === page && b.player_id === room.fixture.human_seat
      await expect(row).toContainText(me ? 'You' : name(b.player_id))
      await expect(row).toContainText(dollars(b.majority + b.minority))
    }
    await expect(p.getByTestId(`merger-waiting-${d.chain}-${id(d.waiting_on[0])}`)).toContainText(
      'deciding'
    )
  }
  await shots.take(page, 'player-merger-in-progress')
  await shots.take(host, 'host-merger-in-progress')

  // Bob sells everything; the scripted seats sell too; then it is the human's turn to decide.
  expect(await room.driveIdle()).toBe(true)
  await expect(page.getByTestId('merger-disposition')).toBeVisible()
  for (const p of [page, host]) {
    await expect(p.getByTestId(`merger-disposition-${d.chain}-${id('p2')}`)).toContainText('sold')
  }
  await page.getByTestId('confirm-disposition').click() // default: keep everything
  await expect(phaseBanner(page)).not.toHaveText('DISPOSE YOUR SHARES')

  // Everyone has decided: the card says what each did and how big the survivor became.
  for (const p of [page, host]) {
    for (const seat of d.waiting_on) {
      await expect(p.getByTestId(`merger-disposition-${d.chain}-${id(seat)}`)).toBeVisible()
    }
    await expect(p.getByTestId(`merger-disposition-${d.chain}-${id('p1')}`)).toContainText('kept')
    await expect(p.getByTestId('merger-result-summary')).toContainText(/\d+ → \d+ tiles/)
    // Nothing to close.
    await expect(p.getByTestId('merger-result-dismiss')).toHaveCount(0)
  }
  await shots.take(page, 'player-merger-done')
  await shots.take(host, 'host-merger-done')

  // It stays available in the log (the Trades tab on the player page, Log on the host): the
  // line opens to the full result in place, and closes again.
  for (const p of [page, host]) {
    const logTab = p === page ? 'trades' : 'log'
    await openTab(p, logTab)
    const panel = p.getByTestId(`tabpanel-${logTab}`)
    const line = panel.getByTestId(`merger-log-${merger.seq}`)
    await line.click()
    await expect(panel.getByTestId('merger-result')).toBeVisible()
    await expect(panel.getByTestId('merger-result-summary')).toContainText(/\d+ → \d+ tiles/)
    await line.click()
    await expect(panel.getByTestId('merger-result')).toHaveCount(0)
    await openTab(p, 'table')
  }
  await shots.take(page, 'player-merger-log')
  // Play moves on (my turns among them): the result leaves the table panel by itself.
  await playHumanTurns(page, room, 2, shots)
  for (const p of [page, host]) {
    await expect(tablePanel(p).getByTestId('merger-result')).toHaveCount(0)
  }
})

test("merger result after the human's own merger (survivor chosen on screen)", async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'merger-survivor-tie')
  const tied = room.fixture.expect.decisions[0].legal.chains as string[]
  const [survivor, defunct] = [tied[0], tied[1]]
  // Who gets the defunct chain's bonuses is fixed by the holdings in the fixture.
  const holders = room.fixture.expect.chain_holders[defunct].holders.filter((h) => h.bonus > 0)
  await expect(page.getByTestId('merger-result')).toHaveCount(0)
  await page.getByTestId(`chain-button-${survivor}`).click()

  // The whole merger in the decision tab: the takeover, the bonuses paid, who decides.
  await expect(page.getByTestId('merger-result-title')).toBeVisible()
  await expect(page.getByTestId('merger-result-title')).toContainText(
    new RegExp(`${survivor} takes over ${defunct}`, 'i')
  )
  for (const h of holders) {
    await expect(bonusRow(page, defunct, room.seatMap[h.player_id])).toContainText(dollars(h.bonus))
  }
  await shots.take(page, 'own-merger-result')
  if (await page.getByTestId('merger-disposition').isVisible()) {
    await page.getByTestId('confirm-disposition').click()
  }
  // My buy takes the place of the merger by itself; the quiet "last merger" line under the
  // players brings the result back in place, and closes it again.
  await expect(page.getByTestId('decision-view')).toHaveAttribute('data-view', 'buy')
  await expect(tablePanel(page).getByTestId('merger-result')).toHaveCount(0)
  const line = page.getByTestId('decision-last-merger').locator('[data-testid^="merger-log-"]')
  await line.scrollIntoViewIfNeeded()
  await line.click()
  await expect(page.getByTestId('merger-result-summary')).toContainText(/\d+ → \d+ tiles/)
  await shots.take(page, 'own-merger-done')
  await line.click()
  await expect(tablePanel(page).getByTestId('merger-result')).toHaveCount(0)
  await expect(page.getByTestId('decision-view')).toHaveAttribute('data-view', 'buy')
  await openTab(page, 'trades')
  await expect(page.getByTestId('merger-log')).toContainText(new RegExp(`${survivor}`, 'i'))
})

async function rackOnScreen(page: Page, shots: Shots, label: string, fixture: string) {
  loadFixture(fixture)
  await startFromSnapshot(page, fixture, { viewport: DESKTOP })
  await expect(page.getByTestId('tile-rack')).toBeInViewport({ ratio: 1 })
  await expect(page.getByTestId('board').getByTestId('tile-12I')).toBeInViewport({ ratio: 1 })
  // The table panel is open next to the board, the status line under it.
  await expect(page.getByTestId('decision-view')).toBeInViewport()
  await expect(page.getByTestId('status')).toBeInViewport({ ratio: 1 })
  for (const name of ['table', 'chains', 'chat', 'trades'] as const) {
    await openTab(page, name)
    const id = name === 'table' ? 'now' : name
    expect(await layoutProblems(page, ['board-pane', 'tab-list', `tabpanel-${id}`])).toEqual([])
  }
  await shots.take(page, label, { fullPage: false })
}

test('1366x768, place tile: the rack is on screen without scrolling, the decision tab next to the board', async ({
  page,
  shots,
}) => {
  await rackOnScreen(page, shots, 'place-tile', 'three-player-midgame')
})
test('1366x768, found chain: the rack is on screen without scrolling, the decision tab next to the board', async ({
  page,
  shots,
}) => {
  await rackOnScreen(page, shots, 'found-chain', 'found-chain-choice')
})
test('1366x768, survivor choice: the rack is on screen without scrolling, the decision tab next to the board', async ({
  page,
  shots,
}) => {
  await rackOnScreen(page, shots, 'survivor-choice', 'merger-survivor-tie')
})
test('1366x768, disposition: the rack is on screen without scrolling, the decision tab next to the board', async ({
  page,
  shots,
}) => {
  await rackOnScreen(page, shots, 'disposition', 'disposition-human-first')
})
test('1366x768, buy: the rack is on screen without scrolling, the decision tab next to the board', async ({
  page,
  shots,
}) => {
  await rackOnScreen(page, shots, 'buy', 'buy-phase-multi-chain')
})
