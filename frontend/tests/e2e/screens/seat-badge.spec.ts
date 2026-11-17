/**
 * Tier 3: the AI seat badge (BL-010) on the Players tab, on a phone and on a laptop.
 *
 * AI seats have character names; the badge next to the name is one small icon whose accessible
 * name says the kind and model, and which opens a popover saying what the seat is. Checked here:
 * the tap target, the row not growing, Enter / tap / click to open, Escape and outside click to
 * close, and the popover fully on screen (never under the phone's bottom bar or clipped by the
 * tab panel).
 *
 * Setup (tier 3 only): the game is created from the home page; the opponents are a Fake LLM seat
 * and a rules-based bot added through the add-seat route, then a generated snapshot is loaded.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect } from './support/test'
import { loadFixture } from './support/fixtures'
import { openTab, tablePanel } from '../support/tabs'

const MODEL = 'Fake LLM (test)'

async function badgeRoom(page: Page, viewport: { width: number; height: number }) {
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
  const seats: Record<string, { player_id: string; name: string }> = {}
  for (const agent of ['llm:fake', 'bot']) {
    const res = await page.request.post(`/api/room/${code}/add-seat`, {
      data: { agent_id: agent },
    })
    expect(res.ok(), await res.text()).toBeTruthy()
    seats[agent] = (await res.json()) as { player_id: string; name: string }
  }
  const others = players.filter((p) => p !== fixture.human_seat)
  const seatMap = {
    [fixture.human_seat]: humanId,
    [others[0]]: seats['llm:fake'].player_id,
    [others[1]]: seats.bot.player_id,
  }
  const load = await page.request.post(`/api/test/room/${code}/load-snapshot`, {
    data: { snapshot: fixture.snapshot, seat_map: seatMap },
  })
  expect(load.ok(), await load.text()).toBeTruthy()
  await expect(page.getByTestId('tile-rack')).toBeVisible()
  return { humanId, llm: seats['llm:fake'], bot: seats.bot }
}

/** The popover is wholly inside the viewport and topmost at its corners and centre. */
async function expectFullyOnScreen(page: Page, pop: Locator) {
  const box = (await pop.boundingBox())!
  const vp = page.viewportSize()!
  expect(box.x, 'popover left edge on screen').toBeGreaterThanOrEqual(0)
  expect(box.y, 'popover top edge on screen').toBeGreaterThanOrEqual(0)
  expect(box.x + box.width, 'popover right edge on screen').toBeLessThanOrEqual(vp.width)
  expect(box.y + box.height, 'popover bottom edge on screen').toBeLessThanOrEqual(vp.height)
  const hidden = await pop.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const out: string[] = []
    for (const fx of [0.05, 0.5, 0.95]) {
      for (const fy of [0.08, 0.5, 0.92]) {
        const x = r.left + r.width * fx
        const y = r.top + r.height * fy
        const hit = document.elementFromPoint(x, y)
        if (!hit || !el.contains(hit)) out.push(`${Math.round(x)},${Math.round(y)}`)
      }
    }
    return out
  })
  expect(hidden, 'popover covered or clipped at').toEqual([])
}

async function checkBadges(
  page: Page,
  shots: { take: (p: Page, n: string) => Promise<string> },
  seats: Awaited<ReturnType<typeof badgeRoom>>,
  opts: { touch: boolean }
) {
  await openTab(page, 'table')
  const panel = tablePanel(page)
  const rowOf = (id: string) => panel.locator(`[data-testid="player-row"][data-player-id="${id}"]`)
  const llmRow = rowOf(seats.llm.player_id)
  const botRow = rowOf(seats.bot.player_id)
  const humanRow = rowOf(seats.humanId)

  // Names are characters; the model is not spelled out in the row.
  await expect(llmRow).toContainText(seats.llm.name)
  await expect(llmRow).not.toContainText(MODEL)
  expect(seats.llm.name).not.toContain('LLM')
  const llmBadge = llmRow.getByRole('button', { name: `AI player, ${MODEL}` })
  const botBadge = botRow.getByRole('button', { name: 'Rules-based bot' })
  await expect(llmBadge).toBeVisible()
  await expect(botBadge).toBeVisible()
  await expect(humanRow.locator('[data-testid^="seat-kind-"]')).toHaveCount(0)

  // Thumb-sized target, yet the AI rows are no taller than the human's row.
  const b = (await llmBadge.boundingBox())!
  expect(b.width, 'badge tap target width').toBeGreaterThanOrEqual(32)
  expect(b.height, 'badge tap target height').toBeGreaterThanOrEqual(32)
  const hRow = (await humanRow.boundingBox())!
  const lRow = (await llmRow.boundingBox())!
  expect(Math.abs(lRow.height - hRow.height), 'row height with a badge').toBeLessThanOrEqual(1)
  await shots.take(page, 'players-badges-closed')

  // Keyboard: focus and Enter opens; Escape closes and keeps focus.
  await llmBadge.focus()
  await page.keyboard.press('Enter')
  const pop = page.getByRole('dialog', { name: `About ${seats.llm.name}` })
  await expect(pop).toBeVisible()
  await expect(pop).toContainText(`AI player · ${MODEL}`)
  await expect(pop).toContainText('Reads the table chat')
  await expect(llmBadge).toHaveAttribute('aria-expanded', 'true')
  await expectFullyOnScreen(page, pop)
  await shots.take(page, 'llm-popover-open')
  await page.keyboard.press('Escape')
  await expect(pop).toBeHidden()
  await expect(llmBadge).toBeFocused()

  // Tap (phone) or click (laptop) the bot's badge; an outside tap closes it.
  if (opts.touch) await botBadge.tap()
  else await botBadge.click()
  const botPop = page.getByRole('dialog', { name: `About ${seats.bot.name}` })
  await expect(botPop).toContainText('Rules-based bot · does not chat')
  await expectFullyOnScreen(page, botPop)
  await shots.take(page, 'bot-popover-open')
  if (opts.touch) await page.getByTestId('header-title').tap()
  else await page.getByTestId('header-title').click()
  await expect(botPop).toBeHidden()

  // Re-open the LLM popover for the evidence screenshot and leave it open.
  if (opts.touch) await llmBadge.tap()
  else await llmBadge.click()
  await expect(pop).toBeVisible()
  await expectFullyOnScreen(page, pop)
  await shots.take(page, 'llm-popover-open-by-pointer')
}

test.describe('seat badge on a phone', () => {
  test.use({ hasTouch: true })
  test('seat badge on a phone: tap opens the model popover, fully on screen', async ({
    page,
    shots,
  }) => {
    const seats = await badgeRoom(page, { width: 390, height: 844 })
    await checkBadges(page, shots, seats, { touch: true })
  })
})

test('seat badge on a laptop: click and Enter open the model popover, fully on screen', async ({
  page,
  shots,
}) => {
  const seats = await badgeRoom(page, { width: 1366, height: 768 })
  await checkBadges(page, shots, seats, { touch: false })
})
