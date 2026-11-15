/**
 * Tier 3 (BL-007): net worth, majority/minority holders and the merger result, on the player
 * page and the host page, at desktop and phone sizes, asserted against the fixture's `expect`
 * block (computed by the engine's calculator when the fixture was generated). Also the layout
 * promises of the redesign: the tile rack is on screen without scrolling at 1366x768 in every
 * phase, nothing overlaps and nothing leaves the screen sideways.
 */
import type { Browser, Page } from '@playwright/test'
import { test, expect, type Shots } from './support/test'
import { startFromSnapshot, type RoomContext } from './support/room'
import { dollars, loadFixture } from './support/fixtures'
import { phaseBanner, playHumanTurns } from './support/ui'

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

/** Boxes of the given test ids: none leaves the screen sideways, no two overlap. */
async function layoutProblems(page: Page, ids: string[]): Promise<string[]> {
  return page.evaluate((ids) => {
    const width = document.documentElement.clientWidth
    const out: string[] = []
    if (document.documentElement.scrollWidth > width) out.push('page scrolls sideways')
    const boxes = ids
      .map((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return {
          id,
          left: r.left,
          right: r.right,
          top: r.top + window.scrollY,
          bottom: r.bottom + window.scrollY,
        }
      })
      .filter((b): b is NonNullable<typeof b> => b !== null && b.right > b.left)
    for (const b of boxes) {
      if (b.left < -0.5 || b.right > width + 0.5) out.push(`${b.id} leaves the screen`)
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]]
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (x > 1 && y > 1) out.push(`${a.id} overlaps ${b.id}`)
      }
    }
    return out
  }, ids)
}

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
    if (first.length > 1) await expect(majority).toContainText('(tie)')
    for (const h of second) {
      const minority = page.getByTestId(`chain-minority-${chain}`)
      await expect(minority).toContainText(name(h.player_id))
      await expect(minority).toContainText(dollars(h.bonus))
      if (second.length > 1) await expect(minority).toContainText('(tie)')
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
  await expect(page.getByTestId('tile-rack')).toBeInViewport()
  expect(
    await layoutProblems(page, [
      'board-pane',
      'action-panel',
      'merger-result',
      'players-panel',
      'chain-list',
    ])
  ).toEqual([])
  await shots.take(page, `${label}-player`)

  const host = await openHost(browser, room, vp)
  await expectTableView(host, room, true)
  expect(
    await layoutProblems(host, ['board', 'scoreboard', 'chain-list', 'merger-result'])
  ).toEqual([])
  await shots.take(host, `${label}-host`)
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
    await expect(card).toContainText(`${d.size} tiles at ${dollars(d.price)}`)
    for (const b of d.bonuses!) {
      const row = p.getByTestId(`merger-bonus-${d.chain}-${id(b.player_id)}`)
      await expect(row).toContainText(name(b.player_id))
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
    await expect(p.getByTestId('merger-result-summary')).toContainText(
      /grows from \d+ to \d+ tiles/
    )
  }
  await shots.take(page, 'player-merger-done')
  await shots.take(host, 'host-merger-done')

  // Close it; it stays available from the log.
  for (const p of [page, host]) {
    await p.getByTestId('merger-result-dismiss').click()
    await expect(p.getByTestId('merger-result')).toHaveCount(0)
    await p.getByTestId(`merger-log-${merger.seq}`).click()
    await expect(p.getByTestId('merger-result')).toBeVisible()
    await p.getByTestId('merger-result-dismiss').click()
  }
  await shots.take(page, 'player-merger-closed')
  await playHumanTurns(page, room, 2, shots)
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

  const card = page.getByTestId('merger-result')
  await expect(card).toBeVisible()
  await expect(page.getByTestId('merger-result-title')).toContainText(
    new RegExp(`${survivor} takes over ${defunct}`, 'i')
  )
  for (const h of holders) {
    const row = page.getByTestId(`merger-bonus-${defunct}-${room.seatMap[h.player_id]}`)
    await expect(row).toContainText(dollars(h.bonus))
  }
  await shots.take(page, 'own-merger-result')
  if (await page.getByTestId('merger-disposition').isVisible()) {
    await page.getByTestId('confirm-disposition').click()
  }
  await expect(page.getByTestId('merger-result-summary')).toContainText(
    /grows from \d+ to \d+ tiles/
  )
  await shots.take(page, 'own-merger-done')
})

async function rackOnScreen(page: Page, shots: Shots, label: string, fixture: string) {
  loadFixture(fixture)
  await startFromSnapshot(page, fixture, { viewport: DESKTOP })
  await expect(page.getByTestId('tile-rack')).toBeInViewport({ ratio: 1 })
  await expect(page.getByTestId('board').getByTestId('tile-12I')).toBeInViewport({ ratio: 1 })
  await expect(page.getByTestId('action-panel')).toBeInViewport()
  expect(
    await layoutProblems(page, ['board-pane', 'action-panel', 'players-panel', 'chain-list'])
  ).toEqual([])
  await shots.take(page, label, { fullPage: false })
}

test('1366x768, place tile: the rack is on screen without scrolling, the action panel next to the board', async ({
  page,
  shots,
}) => {
  await rackOnScreen(page, shots, 'place-tile', 'three-player-midgame')
})
test('1366x768, found chain: the rack is on screen without scrolling, the action panel next to the board', async ({
  page,
  shots,
}) => {
  await rackOnScreen(page, shots, 'found-chain', 'found-chain-choice')
})
test('1366x768, survivor choice: the rack is on screen without scrolling, the action panel next to the board', async ({
  page,
  shots,
}) => {
  await rackOnScreen(page, shots, 'survivor-choice', 'merger-survivor-tie')
})
test('1366x768, disposition: the rack is on screen without scrolling, the action panel next to the board', async ({
  page,
  shots,
}) => {
  await rackOnScreen(page, shots, 'disposition', 'disposition-human-first')
})
test('1366x768, buy: the rack is on screen without scrolling, the action panel next to the board', async ({
  page,
  shots,
}) => {
  await rackOnScreen(page, shots, 'buy', 'buy-phase-multi-chain')
})
