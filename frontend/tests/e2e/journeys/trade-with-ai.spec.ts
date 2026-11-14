/**
 * Journey 3: trading with an AI seat.
 *
 * One human and two heuristic bots. Once the human holds stock, they offer Bot 1 a
 * clearly generous trade (2 shares for $100: accepted) and a clearly bad one
 * ($50 for $1,000: rejected). The bot answers both on its own; the TRADES panel,
 * toasts, cash and holdings reflect each answer. Then play continues.
 */
import { test, expect } from './support/journey'
import { addBot, createGame, startGame } from './support/lobby'
import { Seat, installObservers, parseMoney } from './support/play'
import { outgoingTo, proposeTrade, tradePanel } from './support/trade'

test('trade with AI: the bot accepts a generous offer and rejects a bad one', async ({
  page,
  journey: j,
}) => {
  test.setTimeout(180_000)
  await installObservers(page)
  await createGame(page, j, 'Alice')
  await addBot(page, j)
  await addBot(page, j)
  await j.shot(page, 'lobby-two-bots')
  await startGame(page, j)

  const seat = new Seat(page, j, 'alice', { maxShares: 3, cashReserve: 1000 })
  const me = await seat.myId()
  const botRow = page.locator('[data-testid^="player-row-"]', { hasText: 'Bot 1' })
  const botId = ((await botRow.getAttribute('data-testid')) ?? '').replace('player-row-', '')
  const botCash = async () =>
    parseMoney((await page.getByTestId(`player-cash-${botId}`).textContent()) ?? '')

  // Play until Alice holds at least 2 shares of one chain (cap: 8 turns).
  let chain: string | undefined
  while (!chain) {
    await seat.playTurns(1)
    const h = await seat.holdings(me)
    chain = Object.keys(h).find((c) => h[c] >= 2)
    if (!chain && seat.turnsCompleted >= 8) throw new Error('Alice holds no 2 shares after 8 turns')
  }
  await seat.waitActionable()
  j.log(`Alice holds ${JSON.stringify(await seat.holdings(me))}; trading ${chain}`)

  // --- The builder refuses incomplete offers ------------------------------------------
  {
    await page.getByTestId('trade-offers').getByRole('button', { name: 'PROPOSE TRADE' }).click()
    const builder = page.getByTestId('trade-builder')
    await builder.getByTestId('propose-trade').click()
    await expect(builder.getByTestId('trade-error')).toHaveText('Select a trade partner')
    await builder.locator('[data-testid^="player-select-"]', { hasText: 'Bot 1' }).click()
    await builder.getByTestId('propose-trade').click()
    await expect(builder.getByTestId('trade-error')).toHaveText('You must offer something')
    await builder.getByTestId('offer-cash-input').fill('100')
    await builder.getByTestId('propose-trade').click()
    await expect(builder.getByTestId('trade-error')).toHaveText('You must request something')
    // You cannot offer more of a chain than you hold: the stepper stops there.
    const row = builder.getByTestId(`offer-stock-${chain}`)
    const held = (await seat.holdings(me))[chain]
    for (let i = 0; i < held; i++) await row.getByTestId('stepper-increment').click()
    await expect(row.getByTestId('stepper-value')).toHaveText(String(held))
    await expect(row.getByTestId('stepper-increment')).toBeDisabled()
    await seat.shot('builder-validation')
    await builder.getByTestId('cancel-trade').click()
    await expect(builder).toBeHidden()
    await expect(tradePanel(page)).toContainText('No pending offers')
  }

  // --- Generous: 2 shares for $100 -> accepted --------------------------------------
  {
    const myCash = await seat.cash()
    const theirCash = await botCash()
    const mine = (await seat.holdings(me))[chain]
    await proposeTrade(
      seat,
      { partner: 'Bot 1', offerStocks: { [chain]: 2 }, wantCash: 100 },
      'generous'
    )
    await expect(page.getByText('Bot 1 accepted your offer')).toBeVisible({ timeout: 20_000 })
    await expect(outgoingTo(page, 'Bot 1')).toHaveCount(0)
    await expect(page.getByTestId('header-cash')).toHaveText(
      `$${(myCash + 100).toLocaleString('en-US')}`
    )
    await expect(page.getByTestId(`player-cash-${botId}`)).toHaveText(
      `$${(theirCash - 100).toLocaleString('en-US')}`
    )
    expect((await seat.holdings(me))[chain] ?? 0).toBe(mine - 2)
    expect((await seat.holdings(botId))[chain] ?? 0).toBeGreaterThanOrEqual(2)
    await seat.shot('generous-accepted')
  }

  // --- Bad: $50 for $1,000 -> rejected ------------------------------------------------
  {
    const myCash = await seat.cash()
    const theirCash = await botCash()
    await proposeTrade(seat, { partner: 'Bot 1', offerCash: 50, wantCash: 1000 }, 'bad')
    await expect(page.getByText('Bot 1 rejected your offer')).toBeVisible({ timeout: 20_000 })
    await expect(outgoingTo(page, 'Bot 1')).toHaveCount(0)
    await expect(tradePanel(page)).toContainText('No pending offers')
    expect(await seat.cash()).toBe(myCash)
    expect(await botCash()).toBe(theirCash)
    await seat.shot('bad-rejected')
  }

  // Play continues normally afterwards.
  expect(await seat.playTurns(3)).toBe(true)
  j.log(`turns ${seat.turnsCompleted}; ${JSON.stringify(seat.stats)}`)
})
