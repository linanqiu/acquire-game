/**
 * Tier 3 (BL-011, BL-013): each decision appears in place, in the table panel (under the board
 * on a phone, next to it on a wide screen), with the information needed to make it; the page
 * brings it into view by itself instead of popping cards over other tabs.
 *
 * - Buying: every chain's holders (engine roles), my shares next to the stepper, the bonuses,
 *   the projection as I step; the buy button on screen without scrolling, seven chains too.
 * - A merger: the defunct chain's holders and decisions, the survivor after the merger (engine
 *   size, price, bank, everyone's shares, undecided players), my controls with the projection
 *   following the trade slider, the confirm button on screen.
 * - Survivor choice and waiting; the Board tab shows the full board in every phase on phones.
 * - Redirect: an opponent's merger takes me back to the board and the merger under it from
 *   another tab, but not while I have a chat draft (a badge then).
 * - A merger result needs no closing: it stays until the next tile is placed, then it is gone,
 *   and the last merger is one quiet line that opens in place.
 *
 * Values are checked against the fixture's `expect` block (engine figures). Setup is tier 3:
 * snapshot fixtures, idle seats whose moves are posted through the action route.
 */
import type { Page } from '@playwright/test'
import { test, expect, type Shots } from './support/test'
import { startFromSnapshot, type RoomContext } from './support/room'
import { dollars, loadFixture } from './support/fixtures'
import {
  expectFullBoard,
  expectNoInnerScroll,
  layoutProblems,
  pageFrameProblems,
  clippedBy,
} from './support/layout'
import { phaseBanner } from './support/ui'
import { openTab, tab, tabBadge, tablePanel, tableTab, tableTabId } from '../support/tabs'

const SIZES = [
  { label: '390x844', width: 390, height: 844 },
  { label: '360x640', width: 360, height: 640 },
  { label: '1366x768', width: 1366, height: 768 },
]
const PHONES = SIZES.filter((s) => s.width < 768)

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768

/**
 * The decision is on screen without scrolling anything (BL-019): no box scrolls inside the
 * page, the phase bar and the parts that stay put (dock and tab bar; board and tabs on a wide
 * screen) are on screen and apart, the board is whole, and the given controls are on screen,
 * clear of the dock and the tab bar. What follows the decision (the players matrix, who holds
 * what) may be under it: the page scrolls to it, never a panel.
 */
async function expectNoScroll(page: Page, controls: string[] = []) {
  const frame = isPhone(page) ? ['dock', 'tab-bar'] : ['board-pane', 'tab-list']
  const id = await tableTabId(page)
  const loose = { noPageScroll: false }
  await expectNoInnerScroll(page)
  expect(await layoutProblems(page, ['game-phase', ...frame], loose)).toEqual([])
  expect(
    await layoutProblems(page, [`tabpanel-${id}`], { ...loose, vertical: false }),
    'the decision tab is inside the width'
  ).toEqual([])
  if (isPhone(page)) {
    // The board is whole and the decision is under it, in the same view.
    await expectFullBoard(page)
    expect(await layoutProblems(page, ['board', ...frame], loose)).toEqual([])
  }
  for (const id of controls) expect(await layoutProblems(page, [id, ...frame], loose)).toEqual([])
}

/** Every chain row of the buy decision against the fixture's engine figures. */
async function expectBuyRows(page: Page, room: RoomContext) {
  const { chain_holders, human, active_chains } = room.fixture.expect
  const me = room.humanId
  await expect(page.locator('[data-testid^="buy-row-"]')).toHaveCount(
    Object.keys(active_chains).length
  )
  for (const [chain, info] of Object.entries(chain_holders)) {
    const row = page.getByTestId(`buy-row-${chain}`)
    await expect(row).toHaveAttribute('data-mine', String(human.holdings[chain] ?? 0))
    await expect(row.getByTestId('buy-price')).toHaveText(dollars(info.price))
    await expect(row.getByTestId('buy-available')).toHaveText(
      `${active_chains[chain].available} left`
    )
    // The row is one line: tiles and my shares next to the price and the bank, under a header
    // that names the columns once. My shares carry the same 1st / 2nd mark as the table.
    await expect(row.getByTestId('buy-size')).toHaveText(`${info.size} tiles`)
    const myHolder = info.holders.find((h) => h.player_id === room.fixture.human_seat)
    const held = human.holdings[chain] ?? 0
    await expect(row.getByTestId('buy-mine')).toContainText(String(held))
    if (held > 0 && myHolder?.role)
      await expect(row.getByTestId('buy-mine')).toContainText(
        myHolder.role === 'majority' ? 'most shares' : 'second most shares'
      )
    // Holders and bonuses are one tap away (the chain's name), not printed in every row.
    await expect(row.getByTestId('buy-bonus')).toHaveCount(0)
    await row.getByRole('button', { name: /holders and bonuses$/ }).click()
    await expect(row.getByTestId('buy-bonus')).toHaveText(
      `1st ${dollars(info.majority_bonus)} · 2nd ${dollars(info.minority_bonus)}`
    )
    // Every holder with their count, in rank order; me always (0 when I hold none).
    const prefix = `buy-holders-${chain}-`
    const ids = await row
      .locator(`[data-testid^="${prefix}"]`)
      .evaluateAll(
        (els, n) => els.map((e) => e.getAttribute('data-testid')!.slice(n)),
        prefix.length
      )
    const others = info.holders.filter((h) => h.player_id !== room.fixture.human_seat)
    for (const h of info.holders) {
      const chip = row.getByTestId(`buy-holders-${chain}-${room.seatMap[h.player_id]}`)
      await expect(chip).toHaveAttribute('data-shares', String(h.shares))
      if (h.role === 'majority') await expect(chip).toContainText('1st')
      if (h.role === 'minority') await expect(chip).toContainText('2nd')
    }
    expect(ids.filter((id) => id !== me)).toEqual(others.map((h) => room.seatMap[h.player_id]))
    await expect(row.getByTestId(`buy-holders-${chain}-${me}`)).toHaveAttribute(
      'data-shares',
      String(human.holdings[chain] ?? 0)
    )
    await row.getByRole('button', { name: /holders and bonuses$/ }).click()
    await expect(row.getByTestId('buy-bonus')).toHaveCount(0)
  }
  await expect(page.getByTestId('buy-head')).toHaveText('PriceTilesBankYouBuy')
  // Each heading sits over its own column: its centre is inside the cell below it, row by row.
  const misplaced = await page.evaluate(() => {
    const head = document.querySelector('[data-testid="buy-head"]')
    const rows = document.querySelectorAll('[data-testid^="buy-row-"]')
    const bad: string[] = []
    if (!head) return ['no header']
    const labels = Array.from(head.children).slice(1)
    rows.forEach((row) => {
      const cells = Array.from(row.children).slice(1, 6)
      labels.forEach((label, i) => {
        const l = label.getBoundingClientRect()
        const c = cells[i].getBoundingClientRect()
        const mid = l.left + l.width / 2
        if (mid < c.left - 1 || mid > c.right + 1) {
          bad.push(`${label.textContent} over ${Math.round(c.left)}..${Math.round(c.right)}`)
        }
      })
    })
    return bad
  })
  expect(misplaced, 'buy headings over their columns').toEqual([])
}

for (const vp of SIZES) {
  test(`buy at ${vp.label}: every chain's holders and my shares next to the stepper, the button on screen`, async ({
    page,
    shots,
  }) => {
    const room = await startFromSnapshot(page, 'buy-phase-multi-chain', {
      viewport: vp,
      idle: ['p2'],
    })
    await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
    await expect(await tableTab(page)).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('decision-view')).toHaveAttribute('data-view', 'buy')
    await expectBuyRows(page, room)
    // Every container that can clip the buy button holds all of it. (Said in px, so a failure
    // names the box and by how much, where a viewport ratio alone does not.)
    expect(await clippedBy(page, '[data-testid="end-turn-button"]')).toEqual([])
    await expect(page.getByTestId('end-turn-button')).toBeInViewport({ ratio: 1 })
    await expect(page.getByTestId('purchase-cash-after')).toBeInViewport({ ratio: 1 })
    await expectNoScroll(page, ['end-turn-button'])
    // The phase bar names the decision; nothing under the board repeats it, on any screen.
    await expect(page.getByTestId('status-line')).toHaveCount(0)
    // Every chain's row is on screen with the board and the button: nothing to scroll for.
    for (const chain of Object.keys(room.fixture.expect.active_chains)) {
      await expect(page.getByTestId(`buy-row-${chain}`)).toBeInViewport({ ratio: 1 })
    }
    if (isPhone(page)) await expect(page.getByTestId('board')).toBeInViewport({ ratio: 1 })
    // The players matrix is in the same panel, under the decision.
    await expect(tablePanel(page).getByTestId('holdings-matrix')).toBeAttached()
    await shots.take(page, 'buy', { fullPage: false })

    // Step a chain with stock left that I can afford: my chip and the projection follow.
    const { chain_holders, active_chains, human } = room.fixture.expect
    const chain = Object.keys(active_chains).find(
      (c) => active_chains[c].available > 0 && active_chains[c].price <= human.cash
    )!
    const row = page.getByTestId(`buy-row-${chain}`)
    const mine = human.holdings[chain] ?? 0
    await row.getByTestId('stepper-increment').click()
    await expect(row.getByTestId('buy-mine')).toContainText(String(mine))
    await expect(row.getByTestId('buy-mine-next')).toContainText(String(mine + 1))
    // The row I am buying in says what 1st and 2nd are paid, without a tap.
    await expect(row.getByTestId('buy-bonus')).toBeVisible()
    await expect(page.getByTestId('buy-bonus')).toHaveCount(1)
    const others = chain_holders[chain].holders.filter(
      (h) => h.player_id !== room.fixture.human_seat
    )
    const above = others.filter((h) => h.shares > mine + 1).length
    const tie = others.some((h) => h.shares === mine + 1)
    const place = ['1st', '2nd', '3rd', '4th', '5th', '6th'][above]
    await expect(row.getByTestId('buy-projection')).toContainText(place)
    if (tie) await expect(row.getByTestId('buy-projection')).toContainText('tie')
    await expect(page.getByTestId('purchase-cash-after')).toHaveText(
      `Cash after ${dollars(human.cash - active_chains[chain].price)}`
    )
    await expect(page.getByTestId('end-turn-button')).toHaveText('BUY & END TURN')
    await shots.take(page, 'buy-stepped', { fullPage: false })
  })
}

// 390x675: what a phone browser really leaves with its toolbars showing (BL-014).
for (const vp of [SIZES[0], { label: '390x675', width: 390, height: 675 }, SIZES[2]]) {
  test(`buy at ${vp.label} with seven chains: the buy button stays on screen without scrolling`, async ({
    page,
    shots,
  }) => {
    const room = await startFromSnapshot(page, 'low-cash', { viewport: vp, idle: ['p2'] })
    expect(Object.keys(room.fixture.expect.active_chains)).toHaveLength(7)
    await expect(page.getByTestId('decision-view')).toHaveAttribute('data-view', 'buy')
    await expectBuyRows(page, room)
    // Every container that can clip the buy button holds all of it. (Said in px, so a failure
    // names the box and by how much, where a viewport ratio alone does not.)
    expect(await clippedBy(page, '[data-testid="end-turn-button"]')).toEqual([])
    await expect(page.getByTestId('end-turn-button')).toBeInViewport({ ratio: 1 })
    await expectNoScroll(page, ['end-turn-button'])
    // Every chain's row, whole and not under the pinned footer, with the whole board (BL-017).
    const footerTop = (await page.getByTestId('end-turn-button').boundingBox())!.y
    for (const chain of Object.keys(room.fixture.expect.active_chains)) {
      const row = page.getByTestId(`buy-row-${chain}`)
      await expect(row).toBeInViewport({ ratio: 1 })
      const box = (await row.boundingBox())!
      expect(box.y + box.height, `${chain} row clear of the buy button`).toBeLessThanOrEqual(
        footerTop
      )
      // One compact line per chain (the owner asked for ~44-48px).
      expect(box.height, `${chain} row height`).toBeLessThanOrEqual(48)
    }
    if (isPhone(page)) await expect(page.getByTestId('board')).toBeInViewport({ ratio: 1 })
    await shots.take(page, 'buy-seven-chains', { fullPage: false })
  })
}

/** The merger view against the fixture: defunct holders and decisions, survivor after. */
async function expectMergerView(page: Page, room: RoomContext) {
  const merger = room.fixture.expect.mergers.find((m) => !m.complete)!
  const d = merger.defunct.find((x) => x.waiting_on.length > 0)!
  const players = room.fixture.expect.players
  const held = (seat: string) => players.find((p) => p.player_id === seat)!.holdings[d.chain] ?? 0
  const view = page.getByTestId('decision-view')
  await expect(view.getByTestId('merger-result-title')).toContainText(
    new RegExp(`${merger.survivor} takes over`, 'i')
  )
  for (const [i, seat] of d.waiting_on.entries()) {
    const row = view.getByTestId(`merger-waiting-${d.chain}-${room.seatMap[seat]}`)
    await expect(row).toContainText(String(held(seat)))
    await expect(row).toContainText(i === 0 ? 'deciding' : 'to decide')
  }
  for (const b of d.bonuses ?? []) {
    await expect(
      view.getByTestId(`merger-bonus-${d.chain}-${room.seatMap[b.player_id]}`)
    ).toHaveText(new RegExp(dollars(b.majority + b.minority).replace('$', '\\$')))
  }
  const after = merger.survivor_after!
  // The survivor's size after the merger: once, in the summary line.
  await expect(view.getByTestId('merger-result-summary')).toContainText(`→ ${after.size} tiles`)
  await expect(view.getByTestId('survivor-after-size')).toHaveCount(0)
  await expect(view.getByTestId('survivor-after-price')).toHaveText(dollars(after.price))
  await expect(view.getByTestId('survivor-after-bank')).toHaveText(`bank ${after.bank}`)
  await expect(view.getByTestId('survivor-after-bonus')).toContainText(
    `1st ${dollars(after.majority_bonus)} · 2nd ${dollars(after.minority_bonus)}`
  )
  for (const h of after.holders) {
    const row = view.getByTestId(`survivor-row-${room.seatMap[h.player_id]}`)
    await expect(row).toHaveAttribute('data-shares', String(h.shares))
    if (h.undecided && h.player_id !== room.fixture.human_seat)
      await expect(row).toContainText('undecided')
  }
  return { merger, d, after }
}

for (const vp of SIZES) {
  test(`disposition at ${vp.label}: holders and decisions, the survivor after the merger, my controls and the live projection`, async ({
    page,
    shots,
  }) => {
    const room = await startFromSnapshot(page, 'disposition-human-first', {
      viewport: vp,
      idle: ['p2', 'p3', 'p4'],
    })
    await expect(phaseBanner(page)).toHaveText('DISPOSE YOUR SHARES')
    await expect(await tableTab(page)).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('decision-view')).toHaveAttribute('data-view', 'disposition')
    const { d, after } = await expectMergerView(page, room)
    // The whole decision is on screen with the board: every control and the button.
    for (const id of [
      'disposition-title',
      'slider-sell-to-bank',
      'disposition-trade-max',
      'hold-display',
      'disposition-cash-after',
      'confirm-disposition',
    ])
      await expect(page.getByTestId(id), id).toBeInViewport({ ratio: 1 })
    await expectNoScroll(page, ['confirm-disposition', 'slider-sell-to-bank'])
    await shots.take(page, 'disposition', { fullPage: false })

    // Trade as much as the bank allows: my survivor shares and place after it are over the
    // button, next to the control (BL-019); the survivor table under the decision keeps
    // everyone's shares as they stand (my number is not said twice).
    const { human } = room.fixture.expect
    const meSeat = room.fixture.human_seat
    const mine = after.holders.find((h) => h.player_id === meSeat)?.shares ?? 0
    const trade = page.locator('[data-testid^="slider-trade-"]')
    const max = Number(await trade.getAttribute('max'))
    expect(max).toBeGreaterThan(0)
    await page.getByTestId('disposition-trade-max').click()
    await expect(trade).toHaveValue(String(max))
    const got = max / 2
    const others = after.holders.filter((h) => h.player_id !== meSeat)
    const above = others.filter((h) => h.shares > mine + got).length
    const consequence = page.getByTestId('disposition-survivor-after')
    await expect(consequence).toContainText(`${mine}→${mine + got}`)
    await expect(consequence).toContainText(['1st', '2nd', '3rd', '4th', '5th', '6th'][above])
    await expect(consequence).toBeInViewport({ ratio: 1 })
    await expect(page.getByTestId(`survivor-row-${room.humanId}`)).toHaveAttribute(
      'data-shares',
      String(mine)
    )
    await expect(page.getByTestId('survivor-my-place')).toHaveCount(0)
    // The numbers of my choice are at the controls, once; my row among the stockholders only
    // says that I am deciding.
    await expect(page.getByTestId('disposition-trade')).toContainText(`${max} → ${got}`)
    await expect(page.getByTestId(`merger-waiting-${d.chain}-${room.humanId}`)).toContainText(
      'deciding…'
    )
    await expect(page.getByTestId('disposition-summary')).toHaveCount(0)
    // Selling the rest: the cash after the sale.
    const owned = human.holdings[d.chain]
    await page.getByTestId('slider-sell-to-bank').fill(String(owned - max))
    await expect(page.getByTestId('disposition-cash-after')).toHaveText(
      `Cash after ${dollars(human.cash + (owned - max) * d.price)}`
    )
    await expect(page.getByTestId('confirm-disposition')).toBeInViewport({ ratio: 1 })
    await shots.take(page, 'disposition-projected', { fullPage: false })
    await page.getByTestId('confirm-disposition').click()
    await expect(phaseBanner(page)).not.toHaveText('DISPOSE YOUR SHARES')
    // My decision is now in the merger view (waiting on the next stockholder).
    await expect(
      page.getByTestId('decision-view').getByTestId(`merger-disposition-${d.chain}-${room.humanId}`)
    ).toContainText(`traded ${max}`)
    await shots.take(page, 'disposition-done', { fullPage: false })
  })
}

test('survivor choice: each tied chain with size, price, bank stock and holders', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'merger-survivor-tie', {
    viewport: { width: 390, height: 844 },
  })
  const tied = room.fixture.expect.decisions[0].legal.chains as string[]
  await expect(page.getByTestId('decision-view')).toHaveAttribute('data-view', 'survivor')
  for (const chain of tied) {
    const info = room.fixture.expect.chain_holders[chain]
    const facts = page.getByTestId(`choice-facts-${chain}`)
    await expect(facts).toContainText(`${info.size} tiles · ${dollars(info.price)}`)
    await expect(facts).toContainText(`${room.fixture.expect.active_chains[chain].available} left`)
    for (const h of info.holders) {
      await expect(
        facts.getByTestId(`choice-holders-${chain}-${room.seatMap[h.player_id]}`)
      ).toHaveAttribute('data-shares', String(h.shares))
    }
    await expect(page.getByTestId(`chain-button-${chain}`)).toBeEnabled()
  }
  await expectNoScroll(page)
  await shots.take(page, 'survivor-choice', { fullPage: false })
})

test("waiting during someone else's disposition: who and what, the merger read-only", async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'disposition-waiting-on-other', {
    viewport: { width: 390, height: 844 },
    idle: ['p2'],
  })
  const awaited = room.names[room.seatMap[room.fixture.expect.decisions[0].player_id]]
  await expect(tab(page, 'board')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('decision-view')).toHaveAttribute('data-view', 'merger')
  // Who and what: the phase bar, once.
  await expect(phaseBanner(page)).toHaveText(`${awaited.toUpperCase()} IS DISPOSING OF SHARES`)
  await expect(page.getByTestId('waiting-message')).toHaveCount(0)
  await expectMergerView(page, room)
  await expect(page.getByTestId('merger-disposition')).toHaveCount(0)
  // Read-only, and nothing to close.
  await expect(page.getByTestId('merger-result-dismiss')).toHaveCount(0)
  await expect(tablePanel(page).getByRole('button', { name: /close/i })).toHaveCount(0)
  await expectNoScroll(page)
  await shots.take(page, 'waiting-merger-under-the-board', { fullPage: false })
  // From another tab the phase bar still says who the table waits for; it is not a link (no
  // move of mine is waiting), and no second line repeats it over the rack.
  await openTab(page, 'chains')
  await expect(phaseBanner(page)).toHaveText(`${awaited.toUpperCase()} IS DISPOSING OF SHARES`)
  await expect(page.getByTestId('phase-link')).toHaveCount(0)
  await expect(page.getByTestId('status-line')).toHaveCount(0)
})

const PHASES = [
  { phase: 'place tile', fixture: 'three-player-midgame' },
  { phase: 'buy', fixture: 'low-cash' },
  { phase: 'disposition', fixture: 'disposition-human-first', idle: ['p2', 'p3', 'p4'] },
  { phase: 'survivor choice', fixture: 'merger-survivor-tie' },
  { phase: 'waiting', fixture: 'disposition-waiting-on-other', idle: ['p2'] },
]
for (const vp of PHONES) {
  test(`board tab at ${vp.label}: the full board in every phase`, async ({ page, shots }) => {
    for (const p of PHASES) {
      await startFromSnapshot(page, p.fixture, { viewport: vp, idle: p.idle })
      await openTab(page, 'board')
      await expectFullBoard(page)
      // The board whole with the phase bar, the dock and the tab bar; what the table panel
      // holds below the screen is reached by scrolling the page (BL-019), not a panel.
      expect(
        await pageFrameProblems(
          page,
          ['game-phase', 'board', 'dock', 'tab-bar'],
          ['tabpanel-board']
        )
      ).toEqual([])
      await shots.take(page, `board-${p.phase.replace(' ', '-')}`, { fullPage: false })
    }
  })
}

/**
 * low-cash: Bob (p2, idle) holds 7H, which merges two tied chains the human holds. End my turn,
 * leave for `away`, then Bob places 7H and picks the survivor (posted through the action route,
 * as his client would).
 */
async function opponentMerges(page: Page, shots: Shots, away: 'chains' | 'chat') {
  const room = await startFromSnapshot(page, 'low-cash', {
    viewport: { width: 390, height: 844 },
    idle: ['p2'],
  })
  await page.getByTestId('end-turn-button').click()
  await expect(phaseBanner(page)).not.toHaveText('BUY STOCKS')
  await openTab(page, away)
  const bob = room.seatMap.p2
  const placed = await room.act(bob, { action: 'place_tile', tile: '7H' })
  expect(placed.status, JSON.stringify(placed)).toBe('ok')
  // A tie: Bob chooses the survivor; no merger record before that, no switch.
  await expect(tab(page, away)).toHaveAttribute('aria-selected', 'true')
  const live = await room.liveSnapshot()
  const tied = (live.pending_action?.tied_chains as string[]) ?? []
  expect(tied.length).toBe(2)
  return { room, bob, survivor: tied[0] }
}

test('redirect: an opponent starts a merger while I am on another tab: the page goes to the board and the merger under it', async ({
  page,
  shots,
}) => {
  const { room, bob, survivor } = await opponentMerges(page, shots, 'chains')
  await shots.take(page, 'chains-before-merger', { fullPage: false })
  const chose = await room.act(bob, { action: 'merger_choice', surviving_chain: survivor })
  expect(chose.status, JSON.stringify(chose)).toBe('ok')
  await expect(tab(page, 'board')).toHaveAttribute('aria-selected', 'true')
  await expect(tablePanel(page).getByTestId('merger-result-title')).toContainText(
    new RegExp(`${survivor} takes over`, 'i')
  )
  await expect(tablePanel(page).getByTestId('merger-result-title')).toBeInViewport()
  await expect(tablePanel(page).getByTestId('merger-survivor-after')).toBeVisible()
  await expectFullBoard(page)
  await shots.take(page, 'redirected-to-merger', { fullPage: false })
  // Once per event: I go back to Chains and stay there while the same merger goes on.
  await openTab(page, 'chains')
  await page.waitForTimeout(500)
  await expect(tab(page, 'chains')).toHaveAttribute('aria-selected', 'true')
})

test('no redirect while I have a chat draft: a badge on the Board tab instead', async ({
  page,
  shots,
}) => {
  const { room, bob, survivor } = await opponentMerges(page, shots, 'chat')
  await page.getByTestId('chat-input').fill('hold on, thinking')
  const chose = await room.act(bob, { action: 'merger_choice', surviving_chain: survivor })
  expect(chose.status, JSON.stringify(chose)).toBe('ok')
  await expect(tabBadge(page, 'board')).toBeVisible()
  await expect(tab(page, 'chat')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('chat-input')).toHaveValue('hold on, thinking')
  await expect(page.getByTestId('merger-result-title')).toBeHidden()
  await shots.take(page, 'draft-kept-badge', { fullPage: false })
  // The Board tab (marked) takes me there.
  await tab(page, 'board').click()
  await expect(tab(page, 'board')).toHaveAttribute('aria-selected', 'true')
  await expect(tabBadge(page, 'board')).toHaveCount(0)
  await expect(tablePanel(page).getByTestId('merger-result-title')).toBeVisible()
  await shots.take(page, 'opened-from-status-line', { fullPage: false })
})

for (const vp of PHONES) {
  test(`merger result at ${vp.label}: shown with what was paid, nothing to close, gone when the next tile is placed`, async ({
    page,
    shots,
  }) => {
    // Bob (p2, idle) merged and decides first; the other seats are idle too, so every step
    // is posted here, as their clients would.
    const fx = loadFixture('disposition-waiting-on-other')
    const others = fx.expect.players.map((p) => p.player_id).filter((s) => s !== fx.human_seat)
    const room = await startFromSnapshot(page, 'disposition-waiting-on-other', {
      viewport: vp,
      idle: others,
    })
    const merger = room.fixture.expect.mergers.find((m) => !m.complete)!
    const panel = tablePanel(page)
    await expect(page.getByTestId('decision-view')).toHaveAttribute('data-view', 'merger')
    await shots.take(page, 'merger-in-progress', { fullPage: false })

    // Everyone sells; when it is my turn I confirm (keep everything) through the UI.
    for (let guard = 0; guard < 12; guard++) {
      const live = await room.liveSnapshot()
      const pa = live.pending_action
      if (!pa || pa.type !== 'stock_disposition') break
      if (pa.player_id === room.humanId) {
        await expect(page.getByTestId('confirm-disposition')).toBeInViewport({ ratio: 1 })
        await expectFullBoard(page)
        await shots.take(page, 'my-disposition', { fullPage: false })
        await page.getByTestId('confirm-disposition').click()
        await expect(page.getByTestId('merger-disposition')).toHaveCount(0)
      } else {
        const res = await room.act(String(pa.player_id), {
          action: 'merger_disposition',
          defunct_chain: pa.defunct_chain,
          disposition: { sell: pa.stock_count, trade: 0, hold: 0 },
        })
        expect(res.status, JSON.stringify(res)).toBe('ok')
      }
    }
    const done = await room.liveSnapshot()
    expect(done.phase).toBe('buying_stocks')

    // The merger is over: its result is on screen by itself, with the bonuses the engine paid.
    const result = panel.getByTestId('merger-result')
    await expect(page.getByTestId('decision-view')).toHaveAttribute('data-view', 'waiting')
    await expect(result).toBeVisible()
    await expect(result.getByTestId('merger-result-title')).toContainText(
      new RegExp(`${merger.survivor} takes over`, 'i')
    )
    await expect(result.getByTestId('merger-result-title')).toBeInViewport()
    for (const d of merger.defunct) {
      for (const b of d.bonuses ?? []) {
        await expect(
          result.getByTestId(`merger-bonus-${d.chain}-${room.seatMap[b.player_id]}`)
        ).toContainText(dollars(b.majority + b.minority))
      }
      await expect(
        result.getByTestId(`merger-disposition-${d.chain}-${room.humanId}`)
      ).toContainText('kept')
    }
    await expect(result.getByTestId('merger-survivor-now')).toBeVisible()
    // Nothing asks to be closed.
    await expect(page.getByTestId('merger-result-dismiss')).toHaveCount(0)
    await expect(panel.getByRole('button', { name: /close|back/i })).toHaveCount(0)
    await expectFullBoard(page)
    await shots.take(page, 'merger-result', { fullPage: false })

    // Still there while the merging player buys (same board) ...
    const bob = String(done.players[done.current_player_index].player_id)
    expect((await room.act(bob, { action: 'end_turn' })).status).toBe('ok')
    await expect(phaseBanner(page)).not.toHaveText(
      new RegExp(`^${room.names[bob]} IS BUYING SHARES$`, 'i')
    )
    const after = await room.liveSnapshot()
    const next = after.players[after.current_player_index]
    if (next.player_id === room.humanId) {
      // ... and gone by itself when the next decision is mine.
      await expect(page.getByTestId('decision-view')).toHaveAttribute('data-view', 'place')
    } else {
      await expect(result).toBeVisible()
      // ... and gone by itself when the next tile is placed.
      let placed = false
      for (const tile of next.hand) {
        if (
          (await room.act(String(next.player_id), { action: 'place_tile', tile })).status === 'ok'
        ) {
          placed = true
          break
        }
      }
      expect(placed, 'the next player placed a tile').toBe(true)
    }
    await expect(panel.getByTestId('merger-result')).toHaveCount(0)
    // The players matrix has the room back, and the outcome is one quiet line away.
    await expect(panel.getByTestId('holdings-matrix')).toBeInViewport()
    const line = panel.getByTestId('decision-last-merger').locator('[data-testid^="merger-log-"]')
    await expect(line).toHaveAttribute('aria-expanded', 'false')
    await expect(line).toContainText(new RegExp(merger.survivor, 'i'))
    await shots.take(page, 'after-the-merger', { fullPage: false })
    await line.scrollIntoViewIfNeeded()
    await line.click()
    await expect(panel.getByTestId('merger-result')).toBeVisible()
    await shots.take(page, 'last-merger-opened-in-place', { fullPage: false })
    await line.click()
    await expect(panel.getByTestId('merger-result')).toHaveCount(0)
  })
}
