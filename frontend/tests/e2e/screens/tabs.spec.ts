/**
 * Tier 3 (BL-008, BL-011): the game pages navigate by tabs. On phones the selected tab fills the
 * screen between the phase bar and a slim dock (status line, rack) above the tab bar; on wide
 * screens the board (status line and rack under it) stays on the left and the tabs, the
 * decision tab first, are in the sidebar. In every decision state the status line, the rack and
 * the tab bar are on screen, apart, and the page itself does not scroll; each tab shows its
 * content (checked against the fixture's `expect`).
 *
 * Setup (tier 3 only): snapshot fixtures and, for the chat, an idle human seat whose lines are
 * posted through the chat route. The browser player uses the UI only.
 */
import type { Page } from '@playwright/test'
import { test, expect, type Shots } from './support/test'
import { startFromSnapshot, type RoomContext } from './support/room'
import { dollars } from './support/fixtures'
import { expectFullBoard, layoutProblems } from './support/layout'
import { phaseBanner, waitForMyDecision } from './support/ui'
import { openTab, tab, tabBadge, tabPanel, type TabName } from '../support/tabs'

const STATES = [
  { state: 'place tile', fixture: 'three-player-midgame', banner: 'PLACE A TILE' },
  { state: 'buy', fixture: 'buy-phase-multi-chain', banner: 'BUY STOCKS' },
  { state: 'disposition', fixture: 'disposition-human-first', banner: 'DISPOSE YOUR SHARES' },
  {
    state: 'waiting',
    fixture: 'disposition-waiting-on-other',
    banner: /'s TURN$/i,
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
 * turn to place a tile. Each decision is in the decision tab. With `stayOn` (I am typing in the
 * chat there) the page must not switch by itself: the decision tab gets a badge and the status
 * line takes me there, as a player would tap it; then back to `stayOn`.
 */
async function untilMyPlaceTurn(page: Page, room: RoomContext, stayOn?: TabName) {
  for (let i = 0; i < 8; i++) {
    const banner = await waitForMyDecision(page, room)
    if (banner === 'PLACE A TILE') return
    if (stayOn) {
      await expect(tab(page, stayOn)).toHaveAttribute('aria-selected', 'true')
      await expect(tabBadge(page, 'now')).toBeVisible()
      await page.getByTestId('status-line').click()
    }
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
  const panel = tabPanel(page, which)
  const { net_worth, chain_holders } = room.fixture.expect
  if (which === 'board') {
    await expect(panel.getByTestId('board')).toBeVisible()
    await expectFullBoard(page)
  } else if (which === 'now') {
    await expect(panel.getByTestId('decision-view')).toBeVisible()
  } else if (which === 'players') {
    for (const [seat, w] of Object.entries(net_worth)) {
      await expect(panel.getByTestId(`player-networth-${room.seatMap[seat]}`)).toHaveText(
        dollars(w.net_worth)
      )
    }
  } else if (which === 'chains') {
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

async function checkEveryTab(page: Page, room: RoomContext, shots: Shots, label: string) {
  const phone = (await tab(page, 'board').count()) > 0
  const tabs: TabName[] = phone
    ? ['board', 'now', 'players', 'chains', 'chat', 'trades']
    : ['now', 'players', 'chains', 'chat', 'trades']
  for (const which of tabs) {
    await openTab(page, which)
    await expectTabContent(page, room, which)
    // The status line, the rack and the tab bar (and the open tab) are all on screen, apart,
    // and the page does not scroll in either direction. No card sits on top of the tab.
    expect(
      await layoutProblems(page, [
        'game-phase',
        `tabpanel-${which}`,
        ...(phone ? ['dock', 'tab-bar'] : ['board-pane', 'tab-list']),
      ]),
      `${label}, ${which} tab`
    ).toEqual([])
    await expect(page.getByTestId('status')).toBeInViewport({ ratio: 1 })
    await expect(page.getByTestId('tile-rack')).toBeInViewport({ ratio: 1 })
    if (phone && which !== 'now') await expect(page.getByTestId('decision-view')).toBeHidden()
    await shots.take(page, `${label}-${which}`, { fullPage: false })
  }
}

for (const vp of [...PHONES, ...WIDE]) {
  for (const s of STATES) {
    test(`tabs at ${vp.label}, ${s.state}: status line, rack and tabs fit; every tab shows its content`, async ({
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
      // A decision of mine or a merger in progress opens the decision tab; my place-tile turn
      // opens the Board on a phone (wide screens show the decision tab next to the board).
      const opensOn = s.state === 'place tile' && phone ? 'board' : 'now'
      await expect(tab(page, opensOn)).toHaveAttribute('aria-selected', 'true')
      await checkEveryTab(page, room, shots, s.state.replace(' ', '-'))

      // The decision's main button is on screen in the decision tab, without scrolling.
      const action =
        s.state === 'buy'
          ? 'end-turn-button'
          : s.state === 'disposition'
            ? 'confirm-disposition'
            : null
      if (action) {
        await openTab(page, 'now')
        await expect(page.getByTestId(action)).toBeInViewport({ ratio: 1 })
        expect(
          await layoutProblems(page, [action, 'tile-rack', phone ? 'tab-bar' : 'tab-list'])
        ).toEqual([])
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

  // Write a draft, then end the turn (the status line opens the decision tab): my next
  // decisions and my place-tile turn would switch tabs, but not while I am writing.
  await page.getByTestId('chat-input').fill('let me think')
  await page.getByTestId('status-line').click()
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
  const room = await startFromSnapshot(page, 'buy-phase-multi-chain', {
    viewport: { width: 390, height: 844 },
  })
  await openTab(page, 'chains')
  await page.reload()
  await expect(page.getByTestId('game-phase')).toBeVisible()
  // Remembered for the session, per room.
  await expect(tab(page, 'chains')).toHaveAttribute('aria-selected', 'true')
  // The buy still waiting for me is not news after a reload: a badge, and the status line.
  await expect(tabBadge(page, 'now')).toBeVisible()
  await expect(page.getByTestId('status-line')).toHaveText(/Your move: buy shares/)
  await shots.take(page, 'chains-after-reload', { fullPage: false })

  await page.getByTestId('status-line').click()
  await expect(tab(page, 'now')).toHaveAttribute('aria-selected', 'true')
  await expect(tabBadge(page, 'now')).toHaveCount(0)
  await page.getByTestId('end-turn-button').click()
  // Wait for the server's answer before reading the banner again (a stale BUY STOCKS would send
  // a second END TURN at a page that has moved on).
  await expect(phaseBanner(page)).not.toHaveText('BUY STOCKS')
  await untilMyPlaceTurn(page, room)
  await expect(tab(page, 'board')).toHaveAttribute('aria-selected', 'true')
  await expect(tabBadge(page, 'board')).toHaveCount(0)
  await expect(page.getByTestId('board')).toBeVisible()
  await shots.take(page, 'board-on-my-turn', { fullPage: false })
})

test('phone: an incoming trade offer is a decision: in the decision tab, with a badge on Trades', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'trade-incoming', {
    viewport: { width: 390, height: 844 },
  })
  const trade = room.fixture.expect.pending_trades[0]
  await expect(tabBadge(page, 'trades')).toHaveText('1')
  await expect(tab(page, 'now')).toHaveAttribute('aria-selected', 'true')
  const offer = tabPanel(page, 'now').getByTestId(`trade-offer-${trade.trade_id}`)
  await expect(offer).toBeVisible()
  await expect(page.getByTestId(`trade-accept-${trade.trade_id}`)).toBeInViewport({ ratio: 1 })
  // Nothing sits on top of the other tabs.
  for (const which of ['board', 'players', 'chat'] as TabName[]) {
    await openTab(page, which)
    await expect(offer).toBeHidden()
    expect(
      await layoutProblems(page, ['game-phase', `tabpanel-${which}`, 'dock', 'tab-bar'])
    ).toEqual([])
  }
  await shots.take(page, 'chat-tab-clear', { fullPage: false })
  await openTab(page, 'now')
  await shots.take(page, 'incoming-offer-in-decision-tab', { fullPage: false })
  await page.getByTestId(`trade-reject-${trade.trade_id}`).click()
  await expect(tabBadge(page, 'trades')).toHaveCount(0)
  await expect(page.getByTestId('trade-incoming')).toHaveCount(0)
})

test('phone: the merger result stays in the decision tab, not over other tabs; the log reopens it there', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'merger-survivor-tie', {
    viewport: { width: 390, height: 844 },
  })
  const [survivor] = room.fixture.expect.decisions[0].legal.chains as string[]
  await page.getByTestId(`chain-button-${survivor}`).click()
  await expect(tabPanel(page, 'now').getByTestId('merger-result-title')).toBeVisible()
  for (const which of ['board', 'players', 'chains', 'chat'] as TabName[]) {
    await openTab(page, which)
    await expect(page.getByTestId('merger-result-title')).toBeHidden()
    expect(
      await layoutProblems(page, ['game-phase', `tabpanel-${which}`, 'dock', 'tab-bar'])
    ).toEqual([])
  }
  await shots.take(page, 'chat-tab-no-overlay', { fullPage: false })
  await openTab(page, 'trades')
  await page.locator('[data-testid^="merger-log-"]').first().click()
  await expect(tab(page, 'now')).toHaveAttribute('aria-selected', 'true')
  await expect(tabPanel(page, 'now').getByTestId('merger-result')).toBeVisible()
  await shots.take(page, 'merger-result-reopened', { fullPage: false })
})
