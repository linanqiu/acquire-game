/**
 * Journey 1: one human against the heuristic bot and the Fake LLM, a whole game.
 *
 * Home -> create -> lobby -> add BOT and Fake LLM through the lobby menus -> start ->
 * every human turn through the UI (tiles, chain founding, survivor choice, stock
 * disposition, purchases) -> one trade with the LLM seat -> game over -> PLAY AGAIN ->
 * home -> a fresh game can be created.
 */
import { test, expect } from './support/journey'
import { addAi, addBot, createGame, seatBadges, startGame } from './support/lobby'
import { Seat, installObservers, observed } from './support/play'
import { outgoingTo, proposeTrade } from './support/trade'

const MIN_TURNS = 20
const LLM = 'Fake LLM (test)'

test('@ci solo vs AI: full game from the home page to game over and play again', async ({
  page,
  journey: j,
}) => {
  test.setTimeout(300_000)
  await installObservers(page)

  // --- Home -> lobby with two AI seats ------------------------------------------------
  await createGame(page, j, 'Alice')
  await addBot(page, j)
  await addAi(page, j, 'llm:fake')
  await expect(seatBadges(page, 'bot')).toHaveCount(1)
  await expect(seatBadges(page, 'llm')).toHaveCount(1)
  await expect(seatBadges(page, 'bot')).toHaveText('BOT')
  await expect(seatBadges(page, 'llm')).toContainText('Fake LLM')
  const aiIds = await page
    .locator('[data-testid^="lobby-player-"] [data-testid^="seat-kind-"]')
    .evaluateAll((els) =>
      els.map((e) => (e.getAttribute('data-testid') ?? '').replace('seat-kind-', ''))
    )
  expect(aiIds).toHaveLength(2)
  await expect(page.getByText('3/6 players')).toBeVisible()
  await j.shot(page, 'lobby-with-ai-seats')

  await startGame(page, j)
  await j.shot(page, 'game-started')

  // AI seats carry their kind badges in the players panel.
  for (const id of aiIds) await expect(page.getByTestId(`player-row-${id}`)).toBeVisible()
  await expect(page.locator('[data-testid^="player-row-"] [data-kind="bot"]')).toHaveCount(1)
  await expect(page.locator('[data-testid^="player-row-"] [data-kind="llm"]')).toHaveCount(1)

  // --- Play the whole game --------------------------------------------------------------
  const seat = new Seat(page, j, 'alice', {
    maxShares: 2,
    cashReserve: 1200,
    // Declare the end (END GAME) once it is offered and this is at least the 20th turn.
    declareEnd: (s) => s.turnsCompleted >= MIN_TURNS - 1,
  })
  const myId = await seat.myId()
  let traded = false
  let maxActiveChains = 0

  while (true) {
    const phase = await seat.waitActionable()
    if (phase === 'GAME OVER') break
    if (phase === 'BUY STOCKS') {
      maxActiveChains = Math.max(
        maxActiveChains,
        await page.locator('[data-testid^="buy-row-"]').count()
      )
      // Once Alice holds stock, sell one share to the LLM seat for $100 (it accepts).
      const holdings = await seat.holdings(myId)
      const chain = Object.keys(holdings).find((c) => holdings[c] > 0)
      if (!traded && chain && seat.turnsCompleted >= 4) {
        const cashBefore = await seat.cash()
        await proposeTrade(
          seat,
          { partner: LLM, offerStocks: { [chain]: 1 }, wantCash: 100 },
          'trade-llm'
        )
        await expect(page.getByText(`${LLM} accepted your offer`)).toBeVisible({ timeout: 20_000 })
        await expect(outgoingTo(page, LLM)).toHaveCount(0)
        await expect(page.getByTestId('header-cash')).toHaveText(
          `$${(cashBefore + 100).toLocaleString('en-US')}`
        )
        const after = await seat.holdings(myId)
        expect(after[chain] ?? 0).toBe(holdings[chain] - 1)
        await seat.shot('trade-llm-accepted')
        traded = true
      }
    }
    await seat.act()
    if (seat.turnsCompleted > 45) throw new Error('Game not over after 45 human turns')
  }

  // --- Game over ---------------------------------------------------------------------
  const gameOver = page.getByTestId('game-over')
  await expect(gameOver).toBeVisible()
  await expect(page.getByTestId('winner-announcement')).toBeVisible()
  await expect(page.getByTestId('rankings').locator('[data-testid^="rank-"]')).toHaveCount(3)
  await expect(page.getByTestId(`rank-${myId}`)).toBeVisible()
  await j.shot(page, 'game-over')

  const obs = await observed(page)
  j.log(
    `game over after ${seat.turnsCompleted} human turns; stats ${JSON.stringify(seat.stats)}; ` +
      `max active chains ${maxActiveChains}; thinking seen ${JSON.stringify(obs.thinking)}`
  )
  expect(seat.turnsCompleted, 'minimum real play').toBeGreaterThanOrEqual(MIN_TURNS)
  expect(seat.stats.sharesBought, 'Alice bought stock').toBeGreaterThan(0)
  expect(maxActiveChains, 'chains appeared on the board').toBeGreaterThan(0)
  expect(traded, 'a trade with the LLM seat happened').toBe(true)
  expect(seat.stats.dispositions.length, 'Alice disposed of stock in a merger').toBeGreaterThan(0)
  // With the suite seed the END GAME button is first offered on Alice's 20th turn and
  // she takes it. If this fails, the seeded game took a different path (e.g. a bot
  // declared first): check the log before changing the expectation.
  expect(seat.stats.declaredEnd, 'Alice ended the game with END GAME').toBe(true)
  await expect(page.getByTestId('breakdown')).toBeVisible()
  await expect(page.getByTestId('breakdown-bonuses')).toHaveText(/^\+\$[\d,]+$/)
  for (const id of aiIds) {
    expect(obs.thinking[id] ?? 0, `thinking indicator seen for AI seat ${id}`).toBeGreaterThan(0)
  }

  // --- Play again ----------------------------------------------------------------------
  await page.getByTestId('play-again').click()
  await page.waitForURL(/\/$/)
  await expect(page.getByTestId('create-name-input')).toBeVisible()
  await j.shot(page, 'after-play-again-home')
  await page.getByTestId('create-name-input').fill('Alice')
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z]{4}\?is_host=1$/)
  await expect(page.getByText('WAITING FOR PLAYERS')).toBeVisible()
  await expect(page.getByText('1/6 players')).toBeVisible()
  await j.shot(page, 'second-game-lobby')
})
