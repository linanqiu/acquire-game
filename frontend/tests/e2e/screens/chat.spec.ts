/**
 * Tier 3: the table chat panel on a mid-game screen, desktop and phone.
 *
 * Setup (tier 3 only): the game is created from the home page, the opponents are a Fake LLM
 * seat (reads chat and answers deterministically) and an idle human "Bob" (joined through the
 * API; his messages are posted through the chat route), then a generated snapshot is loaded.
 * The browser player chats through the UI only.
 */
import type { Page } from '@playwright/test'
import { test, expect } from './support/test'
import { loadFixture } from './support/fixtures'
import { expectFits } from './support/layout'
import { openTab, tab, tabBadge } from '../support/tabs'

/** Catalog label of the test-mode LLM: in its seat badge, never its name (BL-010). */
const MODEL = 'Fake LLM (test)'

interface ChatRoom {
  code: string
  humanId: string
  bobId: string
  llmId: string
  /** The LLM seat's character name, as the server gave it. */
  llmName: string
}

async function chatRoom(page: Page, viewport: { width: number; height: number }) {
  const fixture = loadFixture('three-player-midgame')
  const players = (fixture.snapshot.players as Array<{ player_id: string }>).map((p) => p.player_id)
  const human = fixture.expect.players.find((p) => p.player_id === fixture.human_seat)!.name
  await page.setViewportSize(viewport)
  await page.goto('/')
  await page.getByTestId('name-input').fill(human)
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z0-9]{4}/)
  const code = /\/play\/([A-Z0-9]{4})/.exec(page.url())![1]
  const humanId = await page.evaluate(() => sessionStorage.getItem('player_id') ?? '')

  const add = await page.request.post(`/api/room/${code}/add-seat`, {
    data: { agent_id: 'llm:fake' },
  })
  expect(add.ok(), await add.text()).toBeTruthy()
  const added = (await add.json()) as { player_id: string; name: string }
  const llmId = added.player_id
  const llmName = added.name
  expect(llmName).not.toContain(MODEL)
  const join = await page.request.post('/api/join', {
    form: { room_code: code, player_name: 'Bob' },
  })
  expect(join.ok(), await join.text()).toBeTruthy()
  const bobId = ((await join.json()) as { player_id: string }).player_id

  const others = players.filter((p) => p !== fixture.human_seat)
  const seatMap = { [fixture.human_seat]: humanId, [others[0]]: llmId, [others[1]]: bobId }
  const load = await page.request.post(`/api/test/room/${code}/load-snapshot`, {
    data: { snapshot: fixture.snapshot, seat_map: seatMap },
  })
  expect(load.ok(), await load.text()).toBeTruthy()
  await expect(page.getByTestId('game-phase')).toBeVisible()
  await expect(page.getByTestId('tile-rack')).toBeVisible()
  return { code, humanId, bobId, llmId, llmName } satisfies ChatRoom
}

async function bobSays(page: Page, room: ChatRoom, text: string) {
  const res = await page.request.post(`/api/room/${room.code}/chat/${room.bobId}`, {
    data: { text },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
}

/**
 * The chat never covers `target`: at points spread over the target's visible part, the
 * topmost element is the target itself (or inside it), never the chat panel.
 */
async function expectNotCoveredByChat(page: Page, target: string) {
  const covered = await page.evaluate((sel) => {
    const el = document.querySelector(sel)!
    const chat = document.querySelector('[data-testid="chat-panel"]')!
    const r = el.getBoundingClientRect()
    const top = Math.max(r.top, 0)
    const bottom = Math.min(r.bottom, window.innerHeight)
    const out: string[] = []
    for (const fx of [0.05, 0.5, 0.95]) {
      for (const fy of [0.05, 0.5, 0.95]) {
        if (bottom <= top) continue
        const x = r.left + (r.right - r.left) * fx
        const y = top + (bottom - top) * fy
        const hit = document.elementFromPoint(x, y)
        if (hit && chat.contains(hit)) out.push(`${Math.round(x)},${Math.round(y)}`)
      }
    }
    return out
  }, target)
  expect(covered, `chat covers ${target} at`).toEqual([])
}

async function expectApart(page: Page, _chat: string, target: string) {
  await expectNotCoveredByChat(page, target)
}

async function expectNoHorizontalScroll(page: Page) {
  const extra = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(extra, 'page scrolls sideways').toBeLessThanOrEqual(0)
}

const lines = (page: Page) => page.getByTestId('chat-panel').getByTestId('chat-message')

test('chat on desktop: talk to the table, the Fake LLM answers, the host view reads only', async ({
  page,
  shots,
}) => {
  const room = await chatRoom(page, { width: 1280, height: 900 })
  // The chat is a tab of the sidebar; the board stays on the left.
  await openTab(page, 'chat')
  // Who reads the chat at this table; what holds at every table is behind the "?".
  await expect(page.getByTestId('chat-readers')).toHaveText(
    `${room.llmName} (AI) reads the chat and may answer.`
  )
  await expect(page.getByTestId('chat-about')).toHaveCount(0)
  await page.getByRole('button', { name: 'About the chat' }).click()
  await expect(page.getByTestId('chat-about')).toContainText(
    'Talk is not binding: deals happen through trade offers.'
  )
  await page.getByRole('button', { name: 'About the chat' }).click()
  await expect(page.getByTestId('chat-about')).toHaveCount(0)
  await expectApart(page, '[data-testid="chat-panel"]', '[data-testid="board"]')
  await expectApart(page, '[data-testid="chat-panel"]', '[data-testid="tile-rack"]')
  await shots.take(page, 'chat-empty')

  // An unaddressed message from the browser player: the LLM seat answers it.
  await page.getByTestId('chat-input').fill('Hello table <b>not bold</b>')
  await page.getByTestId('chat-input').press('Enter')
  const mine = page
    .locator('[data-testid="chat-message"][data-source="human"]')
    .filter({ hasText: 'Hello table' })
  await expect(mine).toContainText('YOU')
  await expect(mine.locator('b')).toHaveCount(0) // plain text, never HTML
  await expect(mine).toContainText('<b>not bold</b>')
  const reply = lines(page).filter({ hasText: 'Fake LLM heard you' })
  await expect(reply).toHaveCount(1)
  await expect(reply).toHaveAttribute('data-kind', 'llm')
  // Author: the character name and the seat badge, whose accessible name carries the model.
  await expect(reply).toContainText(room.llmName)
  await expect(reply).not.toContainText(MODEL)
  await expect(reply.getByRole('button', { name: `AI player, ${MODEL}` })).toBeVisible()
  await shots.take(page, 'chat-llm-replied')

  // Another human's message arrives live; the LLM answers him too.
  await bobSays(page, room, `${room.llmName}, will you sell me shares?`)
  await expect(lines(page).filter({ hasText: 'will you sell me shares?' })).toHaveCount(2)
  await expect(lines(page)).toHaveCount(4)

  // The game is untouched: it is still the player's tile to place.
  await expect(page.getByTestId('game-phase')).toHaveText('PLACE A TILE')

  // The host / spectator view shows the same chat, read-only.
  const host = await page.context().newPage()
  await host.setViewportSize({ width: 1280, height: 900 })
  await host.goto(`/host/${room.code}`)
  await expect(host.getByTestId('game-phase')).toBeVisible()
  // Lines that arrived before the host opened the page are history, not unread.
  await expect(tabBadge(host, 'chat')).toHaveCount(0)
  await openTab(host, 'chat')
  const hostPanel = host.getByTestId('chat-panel')
  await expect(hostPanel.getByTestId('chat-message')).toHaveCount(4)
  await expect(hostPanel.getByTestId('chat-input')).toHaveCount(0)
  await expect(hostPanel.getByTestId('chat-read-only')).toHaveText(
    'Spectators can read the chat but not write.'
  )
  await hostPanel.scrollIntoViewIfNeeded()
  await shots.take(host, 'host-chat-read-only')
  await host.close()

  // Reload: the Chat tab is still the open one (remembered for the session) and the history
  // comes back in order.
  await page.reload()
  await expect(page.getByTestId('tile-rack')).toBeVisible()
  await expect(tab(page, 'chat')).toHaveAttribute('aria-selected', 'true')
  await expect(lines(page)).toHaveCount(4)
  await expect(lines(page).first()).toContainText('Hello table')
  await shots.take(page, 'chat-after-reload')
})

test('chat on a phone: a tab with an unread count, never over the board, the rack or the tab bar', async ({
  page,
  shots,
}) => {
  const room = await chatRoom(page, { width: 390, height: 844 })
  // The Board tab is open while I place a tile; the chat is one tap away.
  await expect(tab(page, 'board')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('chat-list')).toBeHidden()
  await expectNoHorizontalScroll(page)
  await shots.take(page, 'phone-board-tab', { fullPage: false })

  // Bob talks; the LLM answers him: two unread on the Chat tab.
  await bobSays(page, room, 'anyone up for a deal?')
  await expect(tabBadge(page, 'chat')).toHaveText('2')
  await expect(tab(page, 'chat')).toHaveAccessibleName('Chat (2 unread)')
  await expectFits(page, ['game-phase', 'tabpanel-board', 'now-area', 'tab-bar'])
  await shots.take(page, 'phone-unread', { fullPage: false })

  await openTab(page, 'chat')
  await expect(tabBadge(page, 'chat')).toHaveCount(0)
  await expect(lines(page)).toHaveCount(2)
  await page.getByTestId('chat-input').fill('Not today, Bob')
  await page.getByTestId('chat-send').click()
  await expect(lines(page).filter({ hasText: 'Not today, Bob' })).toContainText('YOU')
  await expect(lines(page).filter({ hasText: 'Fake LLM heard you, Bob' })).toHaveCount(1)
  // The input, the rack and the tab bar are all on screen, apart, without scrolling the page.
  await expect(page.getByTestId('chat-input')).toBeInViewport({ ratio: 1 })
  await expectApart(page, '[data-testid="chat-panel"]', '[data-testid="tile-rack"]')
  await expectApart(page, '[data-testid="chat-panel"]', '[data-testid="tab-bar"]')
  await expectFits(page, ['game-phase', 'tabpanel-chat', 'now-area', 'tab-bar'])
  await shots.take(page, 'phone-chat-tab', { fullPage: false })

  // Back to the board: the chat hides, the rack still works.
  await openTab(page, 'board')
  await expect(page.getByTestId('chat-list')).toBeHidden()
  await expect(page.getByTestId('tile-rack')).toBeVisible()
})
