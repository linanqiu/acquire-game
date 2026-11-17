/**
 * Journey 1: one human against the heuristic bot and the Fake LLM, a whole game.
 *
 * Home -> create -> lobby -> add BOT and Fake LLM through the lobby menus -> start ->
 * every human turn through the UI (tiles, chain founding, survivor choice, stock
 * disposition, purchases) -> one trade with the LLM seat -> game over -> PLAY AGAIN ->
 * home -> a fresh game can be created.
 */
import { test, expect } from './support/journey'
import {
  addAi,
  addBot,
  createGame,
  expectSeatBadge,
  seatBadges,
  seatName,
  startGame,
} from './support/lobby'
import { Seat, installObservers, myCash, observed } from './support/play'
import { outgoingTo, proposeTrade } from './support/trade'
import { openTab } from '../support/tabs'

const MIN_TURNS = 20
/** Catalog label of the test-mode LLM: shown in its seat badge, never as its name. */
const MODEL = 'Fake LLM (test)'

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
  // AI seats have character names; the model is in the badge (accessible name, popover).
  await expectSeatBadge(page, 'bot', 'Rules-based bot')
  await expectSeatBadge(page, 'llm', `AI player, ${MODEL}`)
  const LLM = await seatName(page, 'llm')
  const BOT = await seatName(page, 'bot')
  j.log(`seat names: bot "${BOT}", LLM "${LLM}"`)
  expect(LLM).not.toContain('LLM')
  await expect(page.locator('[data-testid^="lobby-player-"]', { hasText: MODEL })).toHaveCount(0)
  await seatBadges(page, 'llm').click()
  await expect(page.getByRole('dialog', { name: `About ${LLM}` })).toContainText(
    `AI player · ${MODEL}`
  )
  await j.shot(page, 'lobby-llm-badge-open')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const aiIds = await page
    .locator('[data-testid^="lobby-player-"] [data-testid^="seat-kind-"]')
    .evaluateAll((els) =>
      els.map((e) => (e.getAttribute('data-testid') ?? '').replace('seat-kind-', ''))
    )
  expect(aiIds).toHaveLength(2)
  await expect(page.locator('[data-testid^="lobby-player-"]')).toHaveCount(3)
  await j.shot(page, 'lobby-with-ai-seats')

  // --- Table chat with the Fake LLM (UI only) ----------------------------------------------
  // In the lobby the chat is under the content, no tab to open.
  const chat = page.getByTestId('chat-panel')
  await expect(chat).toBeVisible()
  // Who reads the chat at this table, in one line; what holds at every table is behind "?".
  await expect(page.getByTestId('chat-readers')).toHaveText(
    `${LLM} (AI) reads the chat and may answer.`
  )
  await page.getByTestId('chat-about-button').click()
  await expect(page.getByTestId('chat-about')).toContainText(
    'Rules-based bots never read or write chat.'
  )
  const hello = `Hello ${LLM}, I take the majority in the first chain, deal?`
  j.log(`chat: "${hello}"`)
  await page.getByTestId('chat-input').fill(hello)
  await page.getByTestId('chat-input').press('Enter')
  await expect(page.getByTestId('chat-input')).toHaveValue('')
  const lines = chat.getByTestId('chat-message')
  const mine = chat.locator('[data-testid="chat-message"][data-source="human"]')
  await expect(mine.filter({ hasText: hello })).toContainText('YOU')
  const reply = lines.filter({ hasText: `Fake LLM heard you, Alice` })
  await expect(reply).toHaveCount(1, { timeout: 15_000 })
  await expect(reply).toHaveAttribute('data-kind', 'llm')
  await expect(reply).toHaveAttribute('data-source', 'reply')
  await expect(reply.getByRole('button', { name: /^AI player, / })).toBeVisible()
  j.log(`chat: ${LLM} replied "${await reply.textContent()}"`)
  await j.shot(page, 'lobby-chat-llm-replied')

  await startGame(page, j)
  // The chat (and its history) stays through the start of the game, in the Chat tab.
  await openTab(page, 'chat')
  await expect(mine.filter({ hasText: hello })).toBeVisible()
  await j.shot(page, 'game-started-chat-tab')

  // AI seats carry their kind badges in the players panel.
  await openTab(page, 'table')
  for (const id of aiIds)
    await expect(page.locator(`[data-testid="player-row"][data-player-id="${id}"]`)).toBeVisible()
  await expect(page.locator('[data-testid="player-row"] [data-kind="bot"]')).toHaveCount(1)
  await expect(page.locator('[data-testid="player-row"] [data-kind="llm"]')).toHaveCount(1)

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
        await expect(myCash(page)).toHaveText(`$${(cashBefore + 100).toLocaleString('en-US')}`)
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
  // The Fake LLM answered the lobby "deal?" with its first move ("say": table talk with a move).
  const said = lines.filter({ hasText: 'Fake LLM here: noted.' })
  await expect(said).toHaveCount(1)
  await expect(said).toHaveAttribute('data-source', 'say')
  await j.shot(page, 'game-over-chat')

  // --- Transcript of the finished game ------------------------------------------------
  const winner = (
    (await page.getByTestId('winner-announcement').locator('p').first().textContent()) ?? ''
  ).trim()
  const gameUrl = page.url()
  j.log(`winner ${winner}; open "View full transcript"`)
  await page.getByTestId('view-transcript-link').click()
  await page.waitForURL(/\/games\/[^/]+$/)
  const viewer = page.getByTestId('transcript-viewer')
  await expect(viewer).toBeVisible()
  const summary = page.getByTestId('summary-header')
  await expect(summary).toContainText('FINISHED')
  // Rank-1 row of the seat summary is the same winner the game-over screen showed.
  const firstRow = summary.getByTestId('seat-summary').locator('tbody tr').first()
  await expect(firstRow.locator('td').first()).toHaveText('1')
  await expect(firstRow).toContainText(winner)
  await expect(page.getByTestId('step-counter')).toHaveText(/^Step 0 \/ \d+$/)
  // The table chat is in the timeline, in order with the moves.
  await expect(
    page
      .locator('[data-testid="timeline-chat"][data-source="human"]')
      .filter({ hasText: 'I take the majority' })
  ).toHaveCount(1)
  await expect(
    page.locator('[data-testid="timeline-chat"][data-source="reply"]').first()
  ).toContainText('Fake LLM heard you, Alice')
  const total = Number(((await page.getByTestId('step-counter').textContent()) ?? '').split('/')[1])
  expect(total, 'the transcript has the whole game').toBeGreaterThan(60)
  await j.shot(page, 'transcript-start')
  for (let i = 1; i <= 3; i++) {
    await page.getByTestId('step-next').click()
    await expect(page.getByTestId('step-counter')).toHaveText(`Step ${i} / ${total}`)
    await expect(page.getByTestId('event-log').locator('li').first()).toBeVisible()
  }
  await j.shot(page, 'transcript-step-3')
  await page.getByTestId('step-prev').click()
  await expect(page.getByTestId('step-counter')).toHaveText(`Step 2 / ${total}`)
  await page.getByTestId('step-last').click()
  await expect(page.getByTestId('step-counter')).toHaveText(`Step ${total} / ${total}`)
  await j.shot(page, 'transcript-last-step')

  // Browser back: the game page reconnects and shows the same final screen and breakdown.
  await page.goBack()
  await page.waitForURL(gameUrl)
  await expect(page.getByTestId('game-over')).toBeVisible()
  await expect(page.getByTestId('winner-announcement')).toContainText(winner)
  await expect(page.getByTestId('breakdown-bonuses')).toBeVisible()
  await j.shot(page, 'game-over-after-back')

  // --- Play again ----------------------------------------------------------------------
  await page.getByTestId('play-again').click()
  await page.waitForURL(/\/$/)
  await expect(page.getByTestId('name-input')).toBeVisible()
  await j.shot(page, 'after-play-again-home')
  await page.getByTestId('name-input').fill('Alice')
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z]{4}\?is_host=1$/)
  await expect(page.getByTestId('lobby')).toBeVisible()
  await expect(page.locator('[data-testid^="lobby-player-"]')).toHaveCount(1)
  await j.shot(page, 'second-game-lobby')
})
