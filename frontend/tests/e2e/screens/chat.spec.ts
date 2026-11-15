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

const LLM = 'Fake LLM (test)'

interface ChatRoom {
  code: string
  humanId: string
  bobId: string
  llmId: string
}

async function chatRoom(page: Page, viewport: { width: number; height: number }) {
  const fixture = loadFixture('three-player-midgame')
  const players = (fixture.snapshot.players as Array<{ player_id: string }>).map((p) => p.player_id)
  const human = fixture.expect.players.find((p) => p.player_id === fixture.human_seat)!.name
  await page.setViewportSize(viewport)
  await page.goto('/')
  await page.getByTestId('create-name-input').fill(human)
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z0-9]{4}/)
  const code = /\/play\/([A-Z0-9]{4})/.exec(page.url())![1]
  const humanId = await page.evaluate(() => sessionStorage.getItem('player_id') ?? '')

  const add = await page.request.post(`/api/room/${code}/add-seat`, {
    data: { agent_id: 'llm:fake' },
  })
  expect(add.ok(), await add.text()).toBeTruthy()
  const llmId = ((await add.json()) as { player_id: string }).player_id
  const join = await page.request.post('/api/join', { form: { room_code: code, player_name: 'Bob' } })
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
  return { code, humanId, bobId, llmId } satisfies ChatRoom
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
  const panel = page.getByTestId('chat-panel')
  await expect(panel).toHaveAttribute('data-open', 'true')
  await expect(page.getByTestId('chat-readers')).toHaveText(
    `AI that reads chat and may answer: ${LLM}. Talk is not binding; deals happen through trade offers.`
  )
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
  await expect(reply).toContainText(`${LLM}AI`)
  await shots.take(page, 'chat-llm-replied')

  // Another human's message arrives live; the LLM answers him too.
  await bobSays(page, room, `${LLM}, will you sell me shares?`)
  await expect(lines(page).filter({ hasText: 'will you sell me shares?' })).toHaveCount(2)
  await expect(lines(page)).toHaveCount(4)

  // The game is untouched: it is still the player's tile to place.
  await expect(page.getByTestId('game-phase')).toHaveText('PLACE A TILE')

  // The host / spectator view shows the same chat, read-only.
  const host = await page.context().newPage()
  await host.setViewportSize({ width: 1280, height: 900 })
  await host.goto(`/host/${room.code}`)
  const hostPanel = host.getByTestId('chat-panel')
  await expect(hostPanel.getByTestId('chat-message')).toHaveCount(4)
  await expect(hostPanel.getByTestId('chat-input')).toHaveCount(0)
  await expect(hostPanel.getByTestId('chat-read-only')).toHaveText(
    'Spectators can read the chat but not write.'
  )
  await hostPanel.scrollIntoViewIfNeeded()
  await shots.take(host, 'host-chat-read-only')
  await host.close()

  // Reload: the history comes back in order.
  await page.reload()
  await expect(page.getByTestId('tile-rack')).toBeVisible()
  await expect(lines(page)).toHaveCount(4)
  await expect(lines(page).first()).toContainText('Hello table')
  await shots.take(page, 'chat-after-reload')
})

test('chat on a phone: collapsed by default, unread count, never over the board or the rack', async ({
  page,
  shots,
}) => {
  const room = await chatRoom(page, { width: 390, height: 844 })
  const panel = page.getByTestId('chat-panel')
  await expect(panel).toHaveAttribute('data-open', 'false')
  await expect(page.getByTestId('chat-list')).toHaveCount(0)
  await expectApart(page, '[data-testid="chat-panel"]', '[data-testid="board"]')
  await expectApart(page, '[data-testid="chat-panel"]', '[data-testid="tile-rack"]')
  await expectNoHorizontalScroll(page)
  await shots.take(page, 'phone-collapsed', { fullPage: false })

  // Bob talks; the LLM answers him: two unread on the collapsed bar.
  await bobSays(page, room, 'anyone up for a deal?')
  await expect(page.getByTestId('chat-unread')).toHaveText('2')
  await page.getByTestId('chat-toggle').scrollIntoViewIfNeeded()
  await expectApart(page, '[data-testid="chat-toggle"]', '[data-testid="tile-rack"]')
  await shots.take(page, 'phone-unread', { fullPage: false })

  await page.getByTestId('chat-toggle').click()
  await expect(panel).toHaveAttribute('data-open', 'true')
  await expect(page.getByTestId('chat-unread')).toHaveCount(0)
  await expect(lines(page)).toHaveCount(2)
  await page.getByTestId('chat-input').fill('Not today, Bob')
  await page.getByTestId('chat-send').click()
  await expect(lines(page).filter({ hasText: 'Not today, Bob' })).toContainText('YOU')
  await expect(lines(page).filter({ hasText: 'Fake LLM heard you, Bob' })).toHaveCount(1)
  await page.getByTestId('chat-input').scrollIntoViewIfNeeded()
  await expectApart(page, '[data-testid="chat-input"]', '[data-testid="tile-rack"]')
  await expectNoHorizontalScroll(page)
  await shots.take(page, 'phone-open', { fullPage: false })

  // Collapsing again hides the list; the rack still works.
  await page.getByTestId('chat-toggle').click()
  await expect(page.getByTestId('chat-list')).toHaveCount(0)
  await expect(page.getByTestId('tile-rack')).toBeVisible()
})
