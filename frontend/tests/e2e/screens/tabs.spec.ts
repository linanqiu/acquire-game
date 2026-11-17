/**
 * Tier 3 (BL-008, BL-011, BL-013): how the game pages are laid out and navigated.
 *
 * Phones: the Board tab is the game: the whole board, and under it the table panel (my decision
 * in place when there is one, otherwise who the table waits for; always the players matrix),
 * then the rack and the tab bar. No Now tab to be sent to, no Players tab to toggle with: the
 * reference tabs are Chains, Chat and Trades. Wide screens: the board (status line and rack
 * under it) stays on the left; the table panel is the first sidebar tab.
 *
 * In every decision state the board is whole, the decision and its main button are on screen
 * without scrolling the page, nothing overlaps, and each tab shows its content (checked against
 * the fixture's `expect`).
 *
 * Setup (tier 3 only): snapshot fixtures and, for the chat, an idle human seat whose lines are
 * posted through the chat route. The browser player uses the UI only.
 */
import type { Page } from '@playwright/test'
import { test, expect, type Shots } from './support/test'
import { startFromSnapshot, type RoomContext } from './support/room'
import { dollars, loadFixture } from './support/fixtures'
import { expectFullBoard, layoutProblems } from './support/layout'
import { openDecision, phaseBanner, waitForMyDecision } from './support/ui'
import {
  openTab,
  tab,
  tabBadge,
  tabPanel,
  tablePanel,
  tableTabId,
  type TabName,
} from '../support/tabs'

const STATES = [
  { state: 'place tile', fixture: 'three-player-midgame', banner: 'PLACE A TILE' },
  { state: 'buy', fixture: 'buy-phase-multi-chain', banner: 'BUY STOCKS' },
  { state: 'disposition', fixture: 'disposition-human-first', banner: 'DISPOSE YOUR SHARES' },
  {
    state: 'waiting',
    fixture: 'disposition-waiting-on-other',
    banner: /^.+ IS DISPOSING OF SHARES$/,
    idle: ['p2'],
  },
]
const PHONES = [
  { label: '390x844', width: 390, height: 844 },
  { label: '360x640', width: 360, height: 640 },
]
const WIDE = [
  { label: '1366x768', width: 1366, height: 768 },
  { label: '768x1024', width: 768, height: 1024 },
]

/**
 * Answer the prompts the other seats' moves bring (a disposition, a chain choice) until it is my
 * turn to place a tile. With `stayOn` (I am typing in the chat there) the page must not switch
 * by itself: the Board tab gets a badge and the phase bar takes me to the decision, as a
 * player would tap it; then back to `stayOn`.
 */
async function untilMyPlaceTurn(
  page: Page,
  room: RoomContext,
  stayOn?: 'chat' | 'chains',
  typing = true
) {
  for (let i = 0; i < 8; i++) {
    const banner = await waitForMyDecision(page, room)
    if (banner === 'PLACE A TILE') return
    if (stayOn && typing) {
      await expect(tab(page, stayOn)).toHaveAttribute('aria-selected', 'true')
      await expect(tabBadge(page, 'board')).toBeVisible()
      await page.getByTestId('phase-link').click()
    } else if (stayOn) {
      // Not typing: the page comes back to the board and the decision under it by itself.
      await expect(tab(page, 'board')).toHaveAttribute('aria-selected', 'true')
    }
    await openDecision(page)
    if (banner === 'DISPOSE YOUR SHARES') await page.getByTestId('confirm-disposition').click()
    else if (banner === 'BUY STOCKS') await page.getByTestId('end-turn-button').click()
    else await page.locator('[data-testid^="chain-button-"]:not([disabled])').first().click()
    await expect(phaseBanner(page)).not.toHaveText(banner)
    if (stayOn) await openTab(page, stayOn)
  }
  throw new Error('my place-tile turn never came')
}

const name = (room: RoomContext, seat: string) => room.names[room.seatMap[seat]]

/** What each tab must show, from the fixture's engine figures. */
async function expectTabContent(page: Page, room: RoomContext, which: TabName) {
  const { net_worth, chain_holders } = room.fixture.expect
  if (which === 'table') {
    // The table panel: the decision (or what the table waits for) and every player's figures.
    const panel = tablePanel(page)
    await expect(panel.getByTestId('decision-view')).toBeVisible()
    for (const [seat, w] of Object.entries(net_worth)) {
      await expect(panel.getByTestId(`player-networth-${room.seatMap[seat]}`)).toHaveText(
        dollars(w.net_worth)
      )
    }
    if ((await tableTabId(page)) === 'board') {
      // Phones: with the whole board above it, in the same tab.
      await expect(tabPanel(page, 'board').getByTestId('board')).toBeVisible()
      await expectFullBoard(page)
      expect(await layoutProblems(page, ['board', 'table-panel'])).toEqual([])
    }
    return
  }
  const panel = tabPanel(page, which)
  if (which === 'chains') {
    for (const [chain, info] of Object.entries(chain_holders)) {
      for (const h of info.holders.filter((x) => x.role === 'majority')) {
        await expect(panel.getByTestId(`chain-majority-${chain}`)).toContainText(
          name(room, h.player_id)
        )
      }
    }
  } else if (which === 'chat') {
    await expect(panel.getByTestId('chat-input')).toBeVisible()
  } else if (which === 'trades') {
    await expect(panel.getByRole('button', { name: 'PROPOSE TRADE' })).toBeVisible()
  }
}

async function checkEveryTab(
  page: Page,
  room: RoomContext,
  shots: Shots,
  label: string,
  opts: { rackHidden: boolean; mine: boolean }
) {
  const phone = (await tab(page, 'board').count()) > 0
  const ids = await page
    .getByRole('tab')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  // No Now tab and no Players tab: fewer tabs, the table panel holds both.
  expect(ids).toEqual(
    (phone ? ['board', 'chains', 'chat', 'trades'] : ['now', 'chains', 'chat', 'trades']).map(
      (t) => `tab-${t}`
    )
  )
  for (const which of ['table', 'chains', 'chat', 'trades'] as TabName[]) {
    await openTab(page, which)
    await expectTabContent(page, room, which)
    const id = which === 'table' ? await tableTabId(page) : which
    // The open tab, the rack and the tab bar are all on screen, apart, and the page does not
    // scroll in either direction. No card sits on top of the tab.
    expect(
      await layoutProblems(page, [
        'game-phase',
        `tabpanel-${id}`,
        ...(phone ? ['dock', 'tab-bar'] : ['board-pane', 'tab-list']),
      ]),
      `${label}, ${which} tab`
    ).toEqual([])
    if (phone && which === 'table' && opts.rackHidden) {
      // A short phone gives the rack's row to my decision while it is open.
      await expect(page.getByTestId('tile-rack')).toBeHidden()
    } else {
      await expect(page.getByTestId('tile-rack')).toBeInViewport({ ratio: 1 })
    }
    if (phone && which !== 'table') {
      // The decision is not on top of the reference tabs.
      await expect(page.getByTestId('decision-view')).toBeHidden()
    }
    // Said once (BL-015). With the table panel open, the header leaves my cash and worth to
    // the players table and the phase bar is plain text. On another tab the header carries
    // my numbers, and while my move waits the phase bar itself is the way back, naming the
    // tab it leads to. No second "your move" line anywhere.
    const link = page.getByTestId('phase-link')
    if (which === 'table') {
      await expect(link).toHaveCount(0)
      await expect(page.getByTestId('header-cash')).toHaveCount(0)
      await expect(page.getByTestId('header-room')).toBeInViewport({ ratio: 1 })
    } else {
      await expect(page.getByTestId('header-cash')).toBeInViewport({ ratio: 1 })
      await expect(page.getByTestId('header-networth')).toBeInViewport({ ratio: 1 })
      await expect(page.getByTestId('header-rank')).toBeInViewport({ ratio: 1 })
      if (opts.mine) {
        await expect(link).toBeInViewport({ ratio: 1 })
        await expect(link).toHaveAttribute('data-go', phone ? 'Board' : 'Table')
      } else {
        await expect(link).toHaveCount(0)
      }
    }
    await expect(page.getByText(/^Your move/)).toHaveCount(0)
    await expect(page.getByTestId('header-tile-pool')).toBeInViewport({ ratio: 1 })
    await shots.take(page, `${label}-${which}`, { fullPage: false })
  }
  await openTab(page, 'table')
}

for (const vp of [...PHONES, ...WIDE]) {
  for (const s of STATES) {
    test(`tabs at ${vp.label}, ${s.state}: board, decision, rack and tabs fit; every tab shows its content`, async ({
      page,
      shots,
    }) => {
      const room = await startFromSnapshot(page, s.fixture, {
        viewport: { width: vp.width, height: vp.height },
        idle: s.idle,
      })
      await expect(phaseBanner(page)).toHaveText(s.banner)
      const phone = vp.width < 768
      expect(await tab(page, 'board').count(), 'Board is a tab on phones only').toBe(phone ? 1 : 0)
      // The page opens where the game is: the Board (with the decision under it) on a phone,
      // the table panel next to the board on a wide screen. Nothing to hunt for.
      await expect(tab(page, phone ? 'board' : 'now')).toHaveAttribute('aria-selected', 'true')
      const deciding = s.state === 'buy' || s.state === 'disposition' || s.state === 'waiting'
      await checkEveryTab(page, room, shots, s.state.replace(' ', '-'), {
        rackHidden: deciding && vp.height <= 700,
        mine: s.state !== 'waiting',
      })

      // The decision's main button is on screen with the board, without scrolling.
      const action =
        s.state === 'buy'
          ? 'end-turn-button'
          : s.state === 'disposition'
            ? 'confirm-disposition'
            : null
      if (action) {
        await expect(page.getByTestId(action)).toBeInViewport({ ratio: 1 })
        expect(
          await layoutProblems(page, [action, 'tile-rack', phone ? 'tab-bar' : 'tab-list'])
        ).toEqual([])
        if (phone) {
          await expectFullBoard(page)
          expect(await layoutProblems(page, ['board', action])).toEqual([])
        }
      }
    })
  }
}

test('phone: unread chat badge, Chat tab content, and no tab switch while typing', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'buy-phase-multi-chain', {
    idle: ['p2'],
    viewport: { width: 390, height: 844 },
  })
  const bob = room.idleIds.p2
  const say = async (text: string) => {
    const res = await page.request.post(`/api/room/${room.code}/chat/${bob}`, { data: { text } })
    expect(res.ok(), await res.text()).toBeTruthy()
  }
  await expect(tabBadge(page, 'chat')).toHaveCount(0)
  await say('psst, want to trade?')
  await expect(tabBadge(page, 'chat')).toHaveText('1')
  await shots.take(page, 'chat-unread', { fullPage: false })
  await openTab(page, 'chat')
  await expect(tabBadge(page, 'chat')).toHaveCount(0)
  await expect(tabPanel(page, 'chat').getByTestId('chat-message')).toContainText(
    'psst, want to trade?'
  )

  // Write a draft, then end the turn (the phase bar leads back to the decision): my next
  // decisions and my place-tile turn would switch tabs, but not while I am writing.
  await page.getByTestId('chat-input').fill('let me think')
  await page.getByTestId('phase-link').click()
  await expect(tab(page, 'board')).toHaveAttribute('aria-selected', 'true')
  await page.getByTestId('end-turn-button').click()
  await expect(phaseBanner(page)).not.toHaveText('BUY STOCKS')
  await openTab(page, 'chat')
  await untilMyPlaceTurn(page, room, 'chat')
  await expect(tab(page, 'chat')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('chat-input')).toHaveValue('let me think')
  // The Board tab is marked: my tile is waiting.
  await expect(tabBadge(page, 'board')).toBeVisible()
  await shots.take(page, 'typing-no-switch', { fullPage: false })
})

test('phone: my place-tile turn opens the Board when I am on another tab; the choice is remembered', async ({
  page,
  shots,
}) => {
  // The other seats are idle and move only when this test drives them (inside
  // `untilMyPlaceTurn`), so what happens while I am on another tab is not a race.
  const fx = loadFixture('buy-phase-multi-chain')
  const room = await startFromSnapshot(page, 'buy-phase-multi-chain', {
    viewport: { width: 390, height: 844 },
    idle: fx.expect.players.map((p) => p.player_id).filter((s) => s !== fx.human_seat),
  })
  await openTab(page, 'chains')
  await page.reload()
  await expect(page.getByTestId('game-phase')).toBeVisible()
  // Remembered for the session, per room.
  await expect(tab(page, 'chains')).toHaveAttribute('aria-selected', 'true')
  // The buy still waiting for me is not news after a reload: a badge, and the phase bar, which
  // names the move and is the way to it.
  await expect(tabBadge(page, 'board')).toBeVisible()
  await expect(page.getByTestId('phase-link')).toHaveText('BUY STOCKS')
  await expect(page.getByTestId('phase-link')).toHaveAccessibleName('BUY STOCKS. Go to Board')
  await expect(page.getByTestId('status-line')).toHaveCount(0)
  await shots.take(page, 'chains-after-reload', { fullPage: false })

  await page.getByTestId('phase-link').click()
  await expect(tab(page, 'board')).toHaveAttribute('aria-selected', 'true')
  await expect(tabBadge(page, 'board')).toHaveCount(0)
  await page.getByTestId('end-turn-button').click()
  // Wait for the server's answer before reading the banner again (a stale BUY STOCKS would send
  // a second END TURN at a page that has moved on).
  await expect(phaseBanner(page)).not.toHaveText('BUY STOCKS')
  // I look at the chains while the others play; my tile brings the Board back by itself.
  await openTab(page, 'chains')
  await untilMyPlaceTurn(page, room, 'chains', false)
  await expect(tab(page, 'board')).toHaveAttribute('aria-selected', 'true')
  await expect(tabBadge(page, 'board')).toHaveCount(0)
  await expect(page.getByTestId('board')).toBeVisible()
  await shots.take(page, 'board-on-my-turn', { fullPage: false })
})

test('phone: an incoming trade offer is a decision: under the board, with a badge on Trades', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'trade-incoming', {
    viewport: { width: 390, height: 844 },
  })
  const trade = room.fixture.expect.pending_trades[0]
  await expect(tabBadge(page, 'trades')).toHaveText('1')
  await expect(tab(page, 'board')).toHaveAttribute('aria-selected', 'true')
  const offer = tablePanel(page).getByTestId(`trade-offer-${trade.trade_id}`)
  await expect(offer).toBeVisible()
  await expect(page.getByTestId(`trade-accept-${trade.trade_id}`)).toBeInViewport({ ratio: 1 })
  await expectFullBoard(page)
  // Nothing sits on top of the other tabs.
  for (const which of ['chains', 'chat'] as const) {
    await openTab(page, which)
    await expect(offer).toBeHidden()
    expect(
      await layoutProblems(page, ['game-phase', `tabpanel-${which}`, 'dock', 'tab-bar'])
    ).toEqual([])
  }
  await shots.take(page, 'chat-tab-clear', { fullPage: false })
  // The Trades tab lists it too; ANSWER leads to where it is answered.
  await openTab(page, 'trades')
  await page.getByTestId(`trade-answer-${trade.trade_id}`).click()
  await expect(tab(page, 'board')).toHaveAttribute('aria-selected', 'true')
  await expect(offer).toBeInViewport()
  await shots.take(page, 'incoming-offer-under-the-board', { fullPage: false })
  await page.getByTestId(`trade-reject-${trade.trade_id}`).click()
  await expect(tabBadge(page, 'trades')).toHaveCount(0)
  await expect(page.getByTestId('trade-incoming')).toHaveCount(0)
})

test('phone: a merger is under the board, not over other tabs; the log opens any merger in place', async ({
  page,
  shots,
}) => {
  // The other seats are idle, so the merger stays in progress while we look around.
  const fx = loadFixture('merger-survivor-tie')
  const room = await startFromSnapshot(page, 'merger-survivor-tie', {
    viewport: { width: 390, height: 844 },
    idle: fx.expect.players.map((p) => p.player_id).filter((s) => s !== fx.human_seat),
  })
  const [survivor] = room.fixture.expect.decisions[0].legal.chains as string[]
  await page.getByTestId(`chain-button-${survivor}`).click()
  await expect(tablePanel(page).getByTestId('merger-result-title')).toBeVisible()
  await expectFullBoard(page)
  for (const which of ['chains', 'chat'] as const) {
    await openTab(page, which)
    await expect(page.getByTestId('merger-result-title')).toBeHidden()
    expect(
      await layoutProblems(page, ['game-phase', `tabpanel-${which}`, 'dock', 'tab-bar'])
    ).toEqual([])
  }
  await shots.take(page, 'chat-tab-no-overlay', { fullPage: false })
  // The log in the Trades tab: a line opens to the full result where it is, and closes again.
  await openTab(page, 'trades')
  const line = tabPanel(page, 'trades').locator('[data-testid^="merger-log-"]').first()
  await expect(line).toHaveAttribute('aria-expanded', 'false')
  await line.click()
  await expect(tab(page, 'trades')).toHaveAttribute('aria-selected', 'true')
  await expect(tabPanel(page, 'trades').getByTestId('merger-result')).toBeVisible()
  await shots.take(page, 'merger-opened-in-the-log', { fullPage: false })
  await line.click()
  await expect(tabPanel(page, 'trades').getByTestId('merger-result')).toHaveCount(0)
})
