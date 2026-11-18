/**
 * Tier 3 (BL-019): the page is the one scroller. The owner: "make it feel better as a web
 * page: don't have to scroll too much or trigger within-page 'frame' type things." On every
 * main game screen of a phone (iPhone-like: 390x675, touch, mobile viewport) and of a laptop,
 * no box scrolls inside the page; only the header with the phase bar (top) and the rack with
 * the tab bar (foot) stay put. Long tabs scroll the document; the chat's input stays above
 * the tab bar; the in-game menu opens from the header and holds what does not change.
 *
 * Setup (tier 3 only): the game is created from the home page; opponents are idle seats, a
 * generated snapshot is loaded. The browser player uses the UI only.
 */
import { test, expect } from './support/test'
import { startFromSnapshot } from './support/room'
import { expectNoInnerScroll, innerScrollers, pageFrameProblems } from './support/layout'
import { openTab, type TabName } from '../support/tabs'

const PHONE = { width: 390, height: 675 }
const LAPTOP = { width: 1366, height: 768 }

const SCREENS = [
  { fixture: 'six-player-midgame', idle: undefined },
  { fixture: 'buy-phase-multi-chain', idle: ['p2'] },
  { fixture: 'disposition-waiting-on-other', idle: ['p2'] },
  { fixture: 'trade-incoming', idle: ['p2', 'p3'] },
]

test.describe('phone (touch, mobile viewport)', () => {
  test.use({ hasTouch: true, isMobile: true })

  for (const s of SCREENS) {
    test(`${s.fixture} at 390x675: no box scrolls inside the page on any tab`, async ({
      page,
      shots,
    }) => {
      await startFromSnapshot(page, s.fixture, { viewport: PHONE, idle: s.idle })
      for (const t of ['table', 'chains', 'chat', 'trades'] as TabName[]) {
        await openTab(page, t)
        // A tab opens at its top (Chat at its foot, with the newest line and the input).
        const id = t === 'table' ? 'board' : t
        expect(
          await pageFrameProblems(page, ['game-phase', 'dock', 'tab-bar'], [`tabpanel-${id}`]),
          `${s.fixture}, ${t}`
        ).toEqual([])
        await shots.take(page, `${t}`, { fullPage: false })
        // Scrolled to its end, the same holds: the frame stays, nothing scrolls inside.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        expect(await innerScrollers(page), `${s.fixture}, ${t}, scrolled`).toEqual([])
        await expect(page.getByTestId('tab-bar')).toBeInViewport({ ratio: 1 })
        await expect(page.getByTestId('game-phase')).toBeInViewport({ ratio: 1 })
      }
    })
  }

  test('chat: the messages are the page, the input stays over the rack and tab bar', async ({
    page,
    shots,
  }) => {
    const room = await startFromSnapshot(page, 'three-player-midgame', {
      viewport: PHONE,
      idle: ['p2', 'p3'],
    })
    const bob = room.idleIds.p2
    const cara = room.idleIds.p3
    // Long lines from two seats (the server allows five a seat in ten seconds): more than a
    // screen of talk.
    const long = 'shall we trade? I can give you two shares of the big chain for three of yours, '
    for (let i = 1; i <= 8; i++) {
      const res = await page.request.post(`/api/room/${room.code}/chat/${i % 2 ? bob : cara}`, {
        data: { text: `line ${i}: ${long.repeat(3).slice(0, 240)}` },
      })
      expect(res.ok(), await res.text()).toBeTruthy()
    }
    await openTab(page, 'chat')
    await expect(page.getByTestId('chat-message')).toHaveCount(8)
    // The tab opens at its foot: the newest line and the input, above the rack and the bar.
    await expect(page.getByTestId('chat-message').last()).toBeInViewport()
    await expect(page.getByTestId('chat-input')).toBeInViewport({ ratio: 1 })
    expect(await pageFrameProblems(page, ['chat-input', 'dock', 'tab-bar'])).toEqual([])
    expect(
      await page.evaluate(() => window.scrollY),
      'the page scrolled, not a list'
    ).toBeGreaterThan(0)
    await expectNoInnerScroll(page)
    await shots.take(page, 'chat-foot', { fullPage: false })
    // Scrolling up reads the older lines; a new line then says so instead of pulling me down.
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(page.getByTestId('chat-message').first()).toBeInViewport()
    await page.request.post(`/api/room/${room.code}/chat/${bob}`, { data: { text: 'hello?' } })
    await expect(page.getByTestId('chat-new-below')).toBeVisible()
    await page.getByTestId('chat-new-below').click()
    await expect(page.getByTestId('chat-message').last()).toContainText('hello?')
    await expect(page.getByTestId('chat-message').last()).toBeInViewport()
    await expect(page.getByTestId('chat-input')).toBeInViewport({ ratio: 1 })
    await shots.take(page, 'chat-new-line', { fullPage: false })
  })

  test('the in-game menu: room and invite, theme, rules in brief, the way home', async ({
    page,
    shots,
  }) => {
    const room = await startFromSnapshot(page, 'three-player-midgame', { viewport: PHONE })
    // The wordmark gives its place to the menu button; nothing of the menu shows in play.
    await expect(page.getByTestId('header-title')).toBeHidden()
    await expect(page.getByTestId('header-menu')).toHaveCount(0)
    const button = page.getByTestId('header-menu-button')
    const box = (await button.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(44)
    await button.tap()
    const menu = page.getByTestId('header-menu')
    await expect(menu).toBeInViewport({ ratio: 1 })
    await expect(page.getByTestId('menu-room-code')).toHaveText(room.code)
    await expect(page.getByTestId('menu-share')).toHaveAttribute(
      'href',
      new RegExp(`code=${room.code}`)
    )
    await shots.take(page, 'menu-open', { fullPage: false })
    // The theme switch is here (the header carries only what changes).
    const before = await page.getByTestId('menu-theme-toggle').getAttribute('data-theme-current')
    await page.getByTestId('menu-theme-toggle').tap()
    await expect(page.getByTestId('menu-theme-toggle')).not.toHaveAttribute(
      'data-theme-current',
      before!
    )
    await page.getByTestId('menu-rules').locator('summary').tap()
    await expect(page.getByTestId('menu-rules')).toContainText('takes over')
    await expect(menu).toBeInViewport({ ratio: 1 })
    await shots.take(page, 'menu-rules', { fullPage: false })
    // A tap elsewhere closes it; the game is as it was.
    await page.getByTestId('header-room').tap()
    await expect(menu).toHaveCount(0)
    // The way home, and Back returns to the seat.
    await button.tap()
    await page.getByTestId('menu-leave').tap()
    await page.waitForURL((u) => u.pathname === '/')
    await page.goBack()
    await expect(page.getByTestId('tile-rack')).toBeVisible()
    await shots.take(page, 'back-in-the-game', { fullPage: false })
  })
})

test('laptop 1366x768: the board stays beside the tabs, the page scrolls, no box inside it', async ({
  page,
  shots,
}) => {
  await startFromSnapshot(page, 'disposition-waiting-on-other', { viewport: LAPTOP, idle: ['p2'] })
  for (const t of ['table', 'chains', 'chat', 'trades'] as TabName[]) {
    await openTab(page, t)
    const id = t === 'table' ? 'now' : t
    expect(
      await pageFrameProblems(page, ['game-phase', 'board-pane'], [`tabpanel-${id}`]),
      t
    ).toEqual([])
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    // The board stays in view whatever the tab's length.
    await expect(page.getByTestId('board').getByTestId('tile-12I')).toBeInViewport({ ratio: 1 })
    await expect(page.getByTestId('tile-rack')).toBeInViewport({ ratio: 1 })
    expect(await innerScrollers(page), `${t}, scrolled`).toEqual([])
    await shots.take(page, t, { fullPage: false })
    await page.evaluate(() => window.scrollTo(0, 0))
  }
  // The menu button carries the wordmark on a wide screen.
  await expect(page.getByTestId('header-title')).toBeVisible()
})
