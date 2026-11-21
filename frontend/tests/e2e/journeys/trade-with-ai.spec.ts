/**
 * Journey 3: trading with an AI seat.
 *
 * One human and two heuristic bots. Once the human holds stock, they offer the first bot a
 * clearly generous trade (2 shares for $100: accepted) and a clearly bad one
 * ($50 for $1,000: rejected). Before each is sent the composer says what the bot would answer
 * (BL-021); the bot then answers on its own, the same way; the Trades tab, toasts, cash and
 * holdings reflect each answer. Then play continues.
 */
import { test, expect } from './support/journey'
import { addBot, createGame, seatName, startGame } from './support/lobby'
import { Seat, installObservers, myCash as myCashCell, parseMoney } from './support/play'
import { addShares, openComposer, outgoingTo, proposeTrade, tradePanel } from './support/trade'
import { openTab } from '../support/tabs'

test('trade with AI: the bot accepts a generous offer and rejects a bad one', async ({
  page,
  journey: j,
}) => {
  test.setTimeout(180_000)
  await installObservers(page)
  await createGame(page, j, 'Alice')
  await addBot(page, j)
  await addBot(page, j)
  // The first bot's character name, as the server named it (random per room, BL-010).
  const BOT = await seatName(page, 'bot', 0)
  j.log(`trading with "${BOT}"`)
  await j.shot(page, 'lobby-two-bots')
  await startGame(page, j)

  const seat = new Seat(page, j, 'alice', { maxShares: 3, cashReserve: 1000 })
  const me = await seat.myId()
  const botRow = page.getByTestId('player-row').filter({ hasText: BOT })
  const botId = (await botRow.getAttribute('data-player-id')) ?? ''
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

  // --- The composer says what is missing, and cannot send an incomplete offer --------
  {
    await openTab(page, 'trades')
    // Started from my own shares: one given, nobody chosen yet.
    await page.getByTestId(`trade-start-${me}-${chain}`).click()
    const builder = page.getByTestId('trade-builder')
    await expect(builder.getByTestId('trade-hint')).toHaveText('Choose who to offer to')
    await expect(builder.getByTestId('propose-trade')).toBeDisabled()
    await builder.locator('[data-testid^="player-select-"]', { hasText: BOT }).click()
    await expect(builder.getByTestId('trade-hint')).toHaveCount(0)
    await expect(builder.getByTestId('propose-trade')).toBeEnabled()
    // Nothing in the deal: it says so and cannot be sent.
    const row = builder.getByTestId(`offer-stock-${chain}`)
    await row.getByTestId('stepper-decrement').click()
    await expect(row).toHaveCount(0)
    await expect(builder.getByTestId('trade-hint')).toHaveText('Add what you give or what you get')
    await expect(builder.getByTestId('propose-trade')).toBeDisabled()
    // You cannot offer more of a chain than you hold: the chip and the stepper stop there.
    const held = (await seat.holdings(me))[chain]
    await addShares(seat, builder, 'offer', chain, held)
    await expect(builder.getByTestId(`offer-add-${chain}`)).toBeDisabled()
    await expect(row.getByTestId('stepper-increment')).toBeDisabled()
    await seat.shot('composer-validation')
    await builder.getByTestId('cancel-trade').click()
    await expect(builder).toBeHidden()
    await expect(tradePanel(page).getByTestId('trade-table-empty')).toHaveText('No open offers')
  }

  // --- The composer says what the bot would answer, before anything is sent ----------
  {
    const builder = await openComposer(seat, BOT)
    await addShares(seat, builder, 'offer', chain, 2)
    await builder.getByTestId('want-cash-input').fill('100')
    const verdict = builder.getByTestId('trade-bot-verdict')
    await expect(verdict).toHaveText(`${BOT} (bot) would accept`)
    await seat.shot('composer-bot-would-accept')
    // Asking the bot for far more than the shares are worth: it would refuse.
    await builder.getByTestId('want-cash-input').fill('5900')
    await expect(verdict).toContainText(`${BOT} (bot) would refuse`)
    await seat.shot('composer-bot-would-refuse')
    await builder.getByTestId('cancel-trade').click()
    await expect(builder).toBeHidden()
    j.log('composer: the bot would accept 2 shares for $100, refuse them for $5,900')
  }

  // --- Generous: 2 shares for $100 -> accepted --------------------------------------
  {
    const myCash = await seat.cash()
    const theirCash = await botCash()
    const mine = (await seat.holdings(me))[chain]
    await proposeTrade(
      seat,
      { partner: BOT, offerStocks: { [chain]: 2 }, wantCash: 100 },
      'generous'
    )
    await expect(page.getByText(`${BOT} accepted your offer`)).toBeVisible({ timeout: 20_000 })
    await expect(outgoingTo(page, BOT)).toHaveCount(0)
    await expect(myCashCell(page)).toHaveText(`$${(myCash + 100).toLocaleString('en-US')}`)
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
    await proposeTrade(seat, { partner: BOT, offerCash: 50, wantCash: 1000 }, 'bad')
    await expect(page.getByText(`${BOT} rejected your offer`)).toBeVisible({ timeout: 20_000 })
    await expect(outgoingTo(page, BOT)).toHaveCount(0)
    await expect(tradePanel(page).getByTestId('trade-table-empty')).toHaveText('No open offers')
    expect(await seat.cash()).toBe(myCash)
    expect(await botCash()).toBe(theirCash)
    await seat.shot('bad-rejected')
  }

  // Play continues normally afterwards.
  expect(await seat.playTurns(3)).toBe(true)
  j.log(`turns ${seat.turnsCompleted}; ${JSON.stringify(seat.stats)}`)
})
