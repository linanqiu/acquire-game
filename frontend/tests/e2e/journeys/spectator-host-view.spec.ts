/**
 * Journey 4: the spectator / host screen.
 *
 * Home -> WATCH BOTS PLAY -> host lobby (room code, "Need N more players") -> add two
 * bots and the Fake LLM with the host's own controls -> START GAME -> watch the all-AI
 * game on the host screen (board fills, scoreboard with seat badges and the thinking
 * indicator, chains panel) until GAME OVER with final standings and the full breakdown
 * -> PLAY AGAIN goes home.
 */
import { test, expect } from './support/journey'
import { openHome, roomFromUrl } from './support/lobby'
import { installObservers, observed } from './support/play'

test('spectator host view: watch an all-AI game to game over', async ({ page, journey: j }) => {
  test.setTimeout(240_000)
  await installObservers(page)
  await openHome(page, j)
  await j.shot(page, 'home')
  j.log('click WATCH BOTS PLAY')
  await page.getByTestId('watch-bots-button').click()
  await page.waitForURL(/\/host\/[A-Z]{4}$/)
  const room = roomFromUrl(page)
  await expect(page.getByText('ROOM CODE')).toBeVisible()
  await expect(page.getByText(room, { exact: true })).toBeVisible()
  await expect(page.getByText('PLAYERS (0/6)')).toBeVisible()
  await expect(page.getByText('Need 3 more players to start')).toBeVisible()
  await expect(page.getByRole('button', { name: 'START GAME' })).toBeDisabled()
  await j.shot(page, 'host-lobby-empty')

  // Add seats with the host's own controls.
  j.log('add two bots and the Fake LLM')
  await page.getByTestId('add-bot-button').click()
  await expect(page.getByText('PLAYERS (1/6)')).toBeVisible()
  await page.getByTestId('add-bot-button').click()
  await expect(page.getByText('PLAYERS (2/6)')).toBeVisible()
  await expect(page.getByText('Need 1 more player to start')).toBeVisible()
  await page.getByTestId('add-ai-button').click()
  await page.getByTestId('ai-option-llm:fake').click()
  await expect(page.getByText('PLAYERS (3/6)')).toBeVisible()
  await expect(page.getByText('Ready to start!')).toBeVisible()
  await expect(page.locator('[data-kind="bot"]')).toHaveCount(2)
  await expect(page.locator('[data-kind="llm"]')).toHaveCount(1)
  await j.shot(page, 'host-lobby-three-ai')

  j.log('start game')
  await page.getByRole('button', { name: 'START GAME' }).click()
  const board = page.getByTestId('board')
  await expect(board).toBeVisible()
  await expect(page.getByTestId('player-card')).toHaveCount(3)
  await expect(page.getByTestId('game-phase')).toContainText("'s TURN")
  await j.shot(page, 'host-game-started')

  // Watch it progress: the board keeps filling up until the game ends.
  const placed = () => board.locator('[data-chain]:not([data-chain="empty"])').count()
  let last = 0
  let sawChains = false
  let midShot = false
  const phasesSeen = new Set<string>()
  const thinkingSeen = new Set<string>()
  const merge = (o: { thinking: Record<string, number>; phases: string[] }) => {
    o.phases.forEach((p) => phasesSeen.add(p))
    Object.keys(o.thinking).forEach((id) => thinkingSeen.add(id))
  }
  const phase = page.getByTestId('game-phase')
  while ((await phase.textContent()) !== 'GAME OVER') {
    await expect
      .poll(async () => ((await phase.textContent()) === 'GAME OVER' ? Infinity : await placed()), {
        timeout: 30_000,
        message: 'host board stopped changing',
      })
      .toBeGreaterThan(last)
    if ((await phase.textContent()) === 'GAME OVER') break
    // max(): the board disappears when the game-over screen replaces it mid-read.
    last = Math.max(last, await placed())
    if (!sawChains && (await page.getByText('No active chains').count()) === 0) {
      sawChains = true
      j.log(`chains visible on host at ${last} tiles`)
    }
    if (!midShot && last >= 30) {
      midShot = true
      await j.shot(page, 'host-mid-game')
      await expect(page.getByTestId('turn-marker')).toHaveCount(1)
      await expect(page.getByRole('log', { name: 'Game activity' })).toContainText('Bot 1 joined')
      // Refresh the host screen mid-game: the board and scoreboard come back.
      merge(await observed(page))
      j.log(`reload host page at ${last} tiles`)
      await page.reload()
      await expect(board).toBeVisible()
      await expect(page.getByTestId('player-card')).toHaveCount(3)
      await expect
        .poll(placed, { message: 'host board restored after reload' })
        .toBeGreaterThanOrEqual(last)
      await j.shot(page, 'host-after-reload')
    }
    j.log(`host board: ${last} tiles; ${await phase.textContent()}`)
  }

  await expect(page.getByTestId('game-over')).toBeVisible()
  await expect(page.getByTestId('full-breakdown')).toBeVisible()
  await expect(page.getByTestId('rankings').locator('[data-testid^="rank-"]')).toHaveCount(3)
  await expect(page.getByTestId('winner-announcement')).toBeVisible()
  await j.shot(page, 'host-game-over')
  merge(await observed(page))
  j.log(
    `final board ${last} tiles; thinking seen for ${[...thinkingSeen].join(', ')}; ` +
      `banners: ${[...phasesSeen].join(' | ')}`
  )
  expect(midShot, 'host page reloaded mid-game').toBe(true)
  expect(last, 'the game really progressed').toBeGreaterThanOrEqual(30)
  expect(sawChains, 'chains appeared in the CHAINS panel').toBe(true)
  expect(thinkingSeen.size, 'thinking indicator seen for every AI seat').toBe(3)
  expect(
    [...phasesSeen].some((p) => p.endsWith('- MERGER')),
    'a merger was shown on the host banner'
  ).toBe(true)

  await page.getByTestId('play-again').click()
  await page.waitForURL(/\/$/)
  await expect(page.getByTestId('watch-bots-button')).toBeVisible()
  await j.shot(page, 'home-after-play-again')
})
