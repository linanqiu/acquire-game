/**
 * The commentary strip of the watch page (LO-014, docs/ai/commentary.md).
 *
 * The test server has no commentary model, so the lines are the rules-only ones (templated
 * from the engine's facts): what they say is fixed by the game, which makes them testable.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test as base, expect } from './support/test'
import { startFromSnapshot, type RoomContext } from './support/room'
import { expectNoInnerScroll, layoutProblems } from './support/layout'
import { openTab } from '../support/tabs'

type Viewport = { width: number; height: number }
const test = base.extend<{
  openHost: (code: string, viewport?: Viewport) => Promise<Page>
}>({
  openHost: async ({ browser, guard }, provide) => {
    const contexts: BrowserContext[] = []
    await provide(async (code, viewport = { width: 1366, height: 768 }) => {
      const ctx = await browser.newContext({ viewport })
      contexts.push(ctx)
      const host = await ctx.newPage()
      guard.watch(host, 'host')
      await host.goto(`/host/${code}`)
      return host
    })
    await Promise.all(contexts.map((c) => c.close()))
  },
})

const strip = (host: Page) => host.getByTestId('commentary-strip')
const line = (host: Page) => host.getByTestId('commentary-line')

async function setCommentary(room: RoomContext, enabled: boolean) {
  const res = await room.request.post(`/api/room/${room.code}/commentary`, { data: { enabled } })
  expect(res.ok(), `commentary ${enabled}: ${await res.text()}`).toBeTruthy()
}

/** Font size of the latest line, in CSS pixels. */
const lineSize = (host: Page) =>
  line(host).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))

test('watch page: a founded chain is said in the commentary strip; it fits a laptop, a TV and a phone', async ({
  page,
  openHost,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'found-chain-choice')
  const me = room.names[room.humanId]
  await setCommentary(room, true)
  const host = await openHost(room.code)

  // On, nothing said yet: the strip says so, and that the lines here are templated.
  await expect(strip(host)).toBeVisible()
  await expect(host.getByTestId('commentary-waiting')).toHaveText(
    'The commentary starts with the first notable move.'
  )
  await expect(host.getByTestId('commentary-source')).toHaveText('rules')
  const boardBefore = await host.getByTestId('board').boundingBox()
  await shots.take(host, 'strip-waiting')

  // The human founds a chain on the player page: the commentator says it on the watch page.
  const chosen = (room.fixture.expect.decisions[0].legal.chains as string[])[1]
  const chainName = chosen[0].toUpperCase() + chosen.slice(1)
  await page.getByTestId(`chain-button-${chosen}`).click()
  await expect(line(host)).toContainText(`${me} founds ${chainName} at `)
  await expect(line(host)).toContainText(`and the founder's share goes to ${me}.`)
  await expect(host.getByTestId('commentary-waiting')).toHaveCount(0)
  await expect(strip(host)).toHaveAttribute('data-source', 'rules')
  // The player's own page has no commentary.
  await expect(page.getByTestId('commentary-strip')).toHaveCount(0)

  // Laptop: the strip is under the board, nothing overlaps or scrolls, and the board did not
  // move when the line arrived (the strip keeps its height).
  expect(await layoutProblems(host, ['board', 'commentary-strip', 'tab-list'])).toEqual([])
  await expectNoInnerScroll(host)
  const boardAfter = await host.getByTestId('board').boundingBox()
  expect(boardAfter).toEqual(boardBefore)
  const stripBox = (await strip(host).boundingBox())!
  expect(stripBox.y).toBeGreaterThanOrEqual(boardAfter!.y + boardAfter!.height - 1)
  expect(await lineSize(host)).toBeGreaterThanOrEqual(17)
  await shots.take(host, 'strip-laptop')

  // A TV: the line is large enough to read from across a room.
  await host.setViewportSize({ width: 1920, height: 1080 })
  await expect(line(host)).toBeVisible()
  expect(await lineSize(host)).toBeGreaterThanOrEqual(26)
  expect(await layoutProblems(host, ['board', 'commentary-strip'])).toEqual([])
  await expectNoInnerScroll(host)
  await shots.take(host, 'strip-tv')

  // A phone with its toolbars showing: one compact line above the tab bar, the board whole.
  await host.setViewportSize({ width: 390, height: 675 })
  await expect(line(host)).toBeVisible()
  await expect(host.getByTestId('commentary-earlier')).toHaveCount(0)
  expect(
    await layoutProblems(host, ['board', 'commentary-strip', 'tab-bar'], { noPageScroll: false })
  ).toEqual([])
  await expectNoInnerScroll(host)
  const phoneStrip = (await strip(host).boundingBox())!
  const tabBar = (await host.getByTestId('tab-bar').boundingBox())!
  expect(phoneStrip.height).toBeLessThanOrEqual(70)
  expect(phoneStrip.y + phoneStrip.height).toBeLessThanOrEqual(tabBar.y + 1)
  await shots.take(host, 'strip-phone')
})

test('watch page: commentary is off until asked for; the switch is in the Log tab, OFF is in the strip', async ({
  page,
  openHost,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'found-chain-choice')
  const me = room.names[room.humanId]
  const host = await openHost(room.code)
  await expect(host.getByTestId('board')).toBeVisible()

  // An ordinary room: no strip, nothing added to the page but one line in the Log tab.
  await expect(strip(host)).toHaveCount(0)
  await openTab(host, 'log')
  await expect(host.getByTestId('commentary-log')).toContainText('Off for this room.')
  await shots.take(host, 'log-commentary-off')

  // TURN ON: the strip appears; the next notable move is said.
  await host.getByTestId('commentary-on').click()
  await expect(strip(host)).toBeVisible()
  await expect(host.getByTestId('commentary-on')).toHaveCount(0)
  const chosen = (room.fixture.expect.decisions[0].legal.chains as string[])[0]
  await page.getByTestId(`chain-button-${chosen}`).click()
  await expect(line(host)).toContainText(`${me} founds `)
  await shots.take(host, 'commentary-on')

  // A reload keeps the setting and brings the line back (history on connect).
  const said = await line(host).textContent()
  await host.reload()
  await expect(line(host)).toHaveText(said!)

  // OFF in the strip: the strip goes, the Log tab offers to turn it on again.
  await host.getByTestId('commentary-off').click()
  await expect(strip(host)).toHaveCount(0)
  await openTab(host, 'log')
  await expect(host.getByTestId('commentary-on')).toBeVisible()
  await shots.take(host, 'commentary-off-again')
})

test('a show: lines advance by themselves, earlier ones move to the Log, the result stands over the standings, WATCH ANOTHER starts the next', async ({
  page,
  shots,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  // What the home page's "Watch bots play" does: the game starts when this page connects.
  const res = await page.request.post('/api/create-show')
  expect(res.ok()).toBeTruthy()
  const { room_code: code } = (await res.json()) as { room_code: string }
  await page.goto(`/host/${code}`)

  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('player-card')).toHaveCount(4)
  await expect(strip(page)).toBeVisible()
  await expect(line(page)).not.toBeEmpty()
  const first = await line(page).textContent()
  await shots.take(page, 'show-first-line')

  // A new line takes the top place; the two before it stay under it, quieter.
  await expect(line(page)).not.toHaveText(first!)
  await expect(page.getByTestId('commentary-earlier').locator('li')).toHaveCount(2)
  await expectNoInnerScroll(page)
  await shots.take(page, 'show-three-lines')

  // The Log tab holds the lines that left the strip; every line is on the page once.
  await openTab(page, 'log')
  await expect(page.getByTestId('commentary-log-line').first()).toBeVisible()
  // (read in one go: the game is running and lines keep moving from the strip to the Log)
  const ids = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-line-id]')).map((el) =>
      el.getAttribute('data-line-id')
    )
  )
  expect(ids.length).toBeGreaterThanOrEqual(4)
  expect(new Set(ids).size, `a line is on the page twice: ${ids.join(' ')}`).toBe(ids.length)
  await shots.take(page, 'show-log-tab')

  // The end: the commentator's last line names the winner, over the final standings.
  await expect(page.getByTestId('game-phase')).toHaveText('GAME OVER', { timeout: 90_000 })
  await expect(page.getByTestId('game-over')).toBeVisible()
  const winner = (await page.getByTestId('winner-announcement').locator('p').textContent())!
  const final = page.getByTestId('commentary-final')
  await expect(final).toContainText(winner.split(' & ')[0])
  await expect(final).toContainText(/ wins with \$[\d,]+| share the win on \$[\d,]+/)
  await expectNoInnerScroll(page)
  await shots.take(page, 'show-game-over')

  // The transcript keeps the commentary: each line at the step it followed, quietly.
  await page.getByTestId('view-transcript-link').click()
  await expect(page.getByTestId('timeline')).toBeVisible()
  await page.getByTestId('timeline-all').click()
  const said = page.getByTestId('timeline-commentary')
  await expect(said.first()).toBeVisible()
  expect(await said.count()).toBeGreaterThanOrEqual(4)
  // (the line this page saw first is one of the game's opening lines)
  await expect(said.filter({ hasText: first! })).toHaveCount(1)
  await expect(said.first()).toContainText('COMMENTARY · RULES')
  await expect(said.last()).toContainText(/ wins with \$[\d,]+| share the win on \$[\d,]+/)
  await expectNoInnerScroll(page)
  await shots.take(page, 'show-transcript-commentary')
  await page.goBack()
  await expect(page.getByTestId('game-over')).toBeVisible()
  await expect(page.getByTestId('commentary-final')).toBeVisible()

  // WATCH ANOTHER: a new room, a new game, commentary on.
  await page.getByTestId('watch-another').click()
  await page.waitForURL(
    (url) => /\/host\/[A-Z]{4}$/.test(url.pathname) && !url.pathname.endsWith(code)
  )
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(strip(page)).toBeVisible()
  await expect(page.getByTestId('commentary-final')).toHaveCount(0)
  await shots.take(page, 'show-next-game')
})
