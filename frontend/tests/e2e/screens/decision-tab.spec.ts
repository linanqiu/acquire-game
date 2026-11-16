/**
 * Tier 3 (BL-011): the decision tab ("Now") shows each decision with the information needed to
 * make it, and the page goes there by itself instead of popping cards over other tabs.
 *
 * - Buying: every chain's holders (engine roles), my shares next to the stepper, the bonuses,
 *   the projection as I step; the buy button on screen without scrolling, seven chains too.
 * - A merger: the defunct chain's holders and decisions, the survivor after the merger (engine
 *   size, price, bank, everyone's shares, undecided players), my controls with the projection
 *   following the trade slider, the confirm button on screen.
 * - Survivor choice and waiting; the Board tab shows the full board in every phase on phones.
 * - Redirect: an opponent's merger takes me to the decision tab from another tab, but not while
 *   I have a chat draft (a badge then).
 *
 * Values are checked against the fixture's `expect` block (engine figures). Setup is tier 3:
 * snapshot fixtures, idle seats whose moves are posted through the action route.
 */
import type { Page } from '@playwright/test'
import { test, expect, type Shots } from './support/test'
import { startFromSnapshot, type RoomContext } from './support/room'
import { dollars } from './support/fixtures'
import { expectFullBoard, layoutProblems } from './support/layout'
import { phaseBanner } from './support/ui'
import { openTab, tab, tabBadge, tabPanel } from '../support/tabs'

const SIZES = [
  { label: '390x844', width: 390, height: 844 },
  { label: '360x640', width: 360, height: 640 },
  { label: '1366x768', width: 1366, height: 768 },
]
const PHONES = SIZES.filter((s) => s.width < 768)

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768

/**
 * The page does not scroll, the decision tab and the dock / sidebar do not overlap, and the
 * given controls (inside the tab) are clear of the dock and the tab bar.
 */
async function expectNoScroll(page: Page, controls: string[] = []) {
  const frame = isPhone(page) ? ['dock', 'tab-bar'] : ['board-pane', 'tab-list']
  expect(await layoutProblems(page, ['game-phase', 'tabpanel-now', ...frame])).toEqual([])
  for (const id of controls) expect(await layoutProblems(page, [id, ...frame])).toEqual([])
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
  }
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
    await expect(tab(page, 'now')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('decision-view')).toHaveAttribute('data-view', 'buy')
    await expectBuyRows(page, room)
    await expect(page.getByTestId('end-turn-button')).toBeInViewport({ ratio: 1 })
    await expect(page.getByTestId('purchase-cash-after')).toBeInViewport({ ratio: 1 })
    await expectNoScroll(page, ['end-turn-button'])
    await expect(page.getByTestId('status-line')).toHaveText(/Your move: buy shares/)
    await shots.take(page, 'buy', { fullPage: false })

    // Step a chain with stock left that I can afford: my chip and the projection follow.
    const { chain_holders, active_chains, human } = room.fixture.expect
    const chain = Object.keys(active_chains).find(
      (c) => active_chains[c].available > 0 && active_chains[c].price <= human.cash
    )!
    const row = page.getByTestId(`buy-row-${chain}`)
    const mine = human.holdings[chain] ?? 0
    await row.getByTestId('stepper-increment').click()
    await expect(row.getByTestId(`buy-holders-${chain}-${room.humanId}`)).toContainText(
      `${mine}→${mine + 1}`
    )
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

for (const vp of [SIZES[0], SIZES[2]]) {
  test(`buy at ${vp.label} with seven chains: the buy button stays on screen without scrolling`, async ({
    page,
    shots,
  }) => {
    const room = await startFromSnapshot(page, 'low-cash', { viewport: vp, idle: ['p2'] })
    expect(Object.keys(room.fixture.expect.active_chains)).toHaveLength(7)
    await expect(page.getByTestId('decision-view')).toHaveAttribute('data-view', 'buy')
    await expectBuyRows(page, room)
    await expect(page.getByTestId('end-turn-button')).toBeInViewport({ ratio: 1 })
    await expectNoScroll(page, ['end-turn-button'])
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
  await expect(view.getByTestId('survivor-after-size')).toHaveText(`${after.size} tiles`)
  await expect(view.getByTestId('survivor-after-price')).toHaveText(dollars(after.price))
  await expect(view.getByTestId('survivor-after-bank')).toHaveText(`bank ${after.bank}`)
  await expect(view.getByTestId('survivor-after-bonus')).toContainText(
    `1st pays ${dollars(after.majority_bonus)}, 2nd ${dollars(after.minority_bonus)}`
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
    await expect(tab(page, 'now')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('decision-view')).toHaveAttribute('data-view', 'disposition')
    const { d, after } = await expectMergerView(page, room)
    await expect(page.getByTestId('confirm-disposition')).toBeInViewport({ ratio: 1 })
    await expect(page.getByTestId('slider-sell-to-bank')).toBeInViewport()
    await expectNoScroll(page, ['confirm-disposition'])
    await shots.take(page, 'disposition', { fullPage: false })

    // Trade as much as the bank allows: my survivor shares, place and the bank follow live.
    const { human } = room.fixture.expect
    const meSeat = room.fixture.human_seat
    const mine = after.holders.find((h) => h.player_id === meSeat)?.shares ?? 0
    const trade = page.locator('[data-testid^="slider-trade-"]')
    const max = Number(await trade.getAttribute('max'))
    expect(max).toBeGreaterThan(0)
    await trade.fill(String(max))
    const got = max / 2
    const myRow = page.getByTestId(`survivor-row-${room.humanId}`)
    await myRow.scrollIntoViewIfNeeded()
    await expect(myRow).toHaveAttribute('data-shares', String(mine + got))
    await expect(myRow).toContainText(`${mine}→${mine + got}`)
    await expect(page.getByTestId('survivor-after-bank')).toHaveText(
      `bank ${after.bank} → ${after.bank - got}`
    )
    const others = after.holders.filter((h) => h.player_id !== meSeat)
    const above = others.filter((h) => h.shares > mine + got).length
    await expect(page.getByTestId('survivor-my-place')).toContainText(
      ['1st', '2nd', '3rd', '4th', '5th', '6th'][above]
    )
    await expect(page.getByTestId('disposition-survivor-after')).toContainText(
      `${mine} → ${mine + got}`
    )
    await expect(page.getByTestId(`merger-waiting-${d.chain}-${room.humanId}`)).toContainText(
      `deciding: sell 0, trade ${max}`
    )
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
  await expect(tab(page, 'now')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('decision-view')).toHaveAttribute('data-view', 'merger')
  await expect(page.getByTestId('waiting-message')).toHaveText(
    `Waiting for ${awaited} to dispose of their shares...`
  )
  await expect(page.getByTestId('status-line')).toHaveText(
    new RegExp(`Waiting for ${awaited} to dispose of their shares`)
  )
  await expectMergerView(page, room)
  await expect(page.getByTestId('merger-disposition')).toHaveCount(0)
  await expect(page.getByTestId('merger-result-dismiss')).toHaveCount(0)
  await expectNoScroll(page)
  await shots.take(page, 'waiting-now', { fullPage: false })
  await openTab(page, 'board')
  await expectFullBoard(page)
  await shots.take(page, 'waiting-board', { fullPage: false })
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
      expect(
        await layoutProblems(page, ['game-phase', 'tabpanel-board', 'dock', 'tab-bar'])
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
async function opponentMerges(page: Page, shots: Shots, away: 'players' | 'chat') {
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

test('redirect: an opponent starts a merger while I am on another tab: the page goes to the decision tab', async ({
  page,
  shots,
}) => {
  const { room, bob, survivor } = await opponentMerges(page, shots, 'players')
  await shots.take(page, 'players-before-merger', { fullPage: false })
  const chose = await room.act(bob, { action: 'merger_choice', surviving_chain: survivor })
  expect(chose.status, JSON.stringify(chose)).toBe('ok')
  await expect(tab(page, 'now')).toHaveAttribute('aria-selected', 'true')
  await expect(tabPanel(page, 'now').getByTestId('merger-result-title')).toContainText(
    new RegExp(`${survivor} takes over`, 'i')
  )
  await expect(tabPanel(page, 'now').getByTestId('merger-survivor-after')).toBeVisible()
  await shots.take(page, 'redirected-to-merger', { fullPage: false })
  // Once per event: I go back to Players and stay there while the same merger goes on.
  await openTab(page, 'players')
  await page.waitForTimeout(500)
  await expect(tab(page, 'players')).toHaveAttribute('aria-selected', 'true')
})

test('no redirect while I have a chat draft: a badge on the decision tab instead', async ({
  page,
  shots,
}) => {
  const { room, bob, survivor } = await opponentMerges(page, shots, 'chat')
  await page.getByTestId('chat-input').fill('hold on, thinking')
  const chose = await room.act(bob, { action: 'merger_choice', surviving_chain: survivor })
  expect(chose.status, JSON.stringify(chose)).toBe('ok')
  await expect(tabBadge(page, 'now')).toBeVisible()
  await expect(tab(page, 'chat')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('chat-input')).toHaveValue('hold on, thinking')
  await expect(page.getByTestId('merger-result-title')).toBeHidden()
  await shots.take(page, 'draft-kept-badge', { fullPage: false })
  // The status line names what is happening and takes me there.
  await page.getByTestId('status-line').click()
  await expect(tab(page, 'now')).toHaveAttribute('aria-selected', 'true')
  await expect(tabBadge(page, 'now')).toHaveCount(0)
  await expect(tabPanel(page, 'now').getByTestId('merger-result-title')).toBeVisible()
  await shots.take(page, 'opened-from-status-line', { fullPage: false })
})
