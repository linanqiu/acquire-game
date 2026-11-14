/**
 * Playing turns through the player page UI, exactly as a user would: read the phase
 * banner, click a rack tile, PLACE TILE, pick chains in the chain selector, move the
 * disposition sliders, step stock purchases, BUY & END TURN / END GAME.
 *
 * Every action is logged with the seat's turn number and screenshotted. Anything
 * unexpected (no playable tile, a prompt that does not go away, cash that does not
 * change after a purchase) throws: journeys never work around a bug.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import type { Journey } from './journey'

/** Phase banner texts that need an action from this seat. */
export const ACTIONABLE =
  /^(PLACE A TILE|CHOOSE A CHAIN|CHOOSE SURVIVING CHAIN|DISPOSE YOUR STOCK|BUY STOCKS|GAME OVER)$/

/**
 * Observation-only instrumentation (no effect on the app): records every value the
 * header cash shows, and which seats showed the "thinking" indicator, so assertions do
 * not depend on catching a 50 ms state with a poll. Must run before the first goto.
 */
export async function installObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Obs = { cash: string[]; thinking: Record<string, number>; phases: string[] }
    const w = window as unknown as { __obs: Obs }
    w.__obs = { cash: [], thinking: {}, phases: [] }
    const scan = () => {
      const ph = document.querySelector('[data-testid="game-phase"]')?.textContent ?? ''
      if (ph && !w.__obs.phases.includes(ph)) w.__obs.phases.push(ph)
      const c = document.querySelector('[data-testid="header-cash"]')
      if (c) {
        const v = c.textContent ?? ''
        if (w.__obs.cash[w.__obs.cash.length - 1] !== v) w.__obs.cash.push(v)
      }
      document.querySelectorAll('[data-testid="ai-thinking"]').forEach((el) => {
        const row = el.closest('[data-testid^="player-row-"]') as HTMLElement | null
        const card = el.closest('[data-testid="player-card"]') as HTMLElement | null
        let id = '?'
        if (row) id = (row.dataset.testid ?? '').replace('player-row-', '')
        else if (card) {
          const badge = card.querySelector('[data-testid^="seat-kind-"]') as HTMLElement | null
          id = (badge?.dataset.testid ?? '?').replace('seat-kind-', '')
        }
        w.__obs.thinking[id] = (w.__obs.thinking[id] ?? 0) + 1
      })
    }
    new MutationObserver(scan).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    })
  })
}

export async function observed(
  page: Page
): Promise<{ cash: number[]; thinking: Record<string, number>; phases: string[] }> {
  const obs = await page.evaluate(
    () =>
      (
        window as unknown as {
          __obs: { cash: string[]; thinking: Record<string, number>; phases: string[] }
        }
      ).__obs
  )
  return { cash: obs.cash.map(parseMoney), thinking: obs.thinking, phases: obs.phases }
}

export function parseMoney(text: string): number {
  return Number(text.replace(/[^0-9-]/g, ''))
}

export interface Policy {
  /** Shares to aim for per turn (0-3). Default 2. */
  maxShares?: number
  /** Never spend below this much cash. Default 1500. */
  cashReserve?: number
  /** Click END GAME (instead of buying) when it is offered and this returns true. */
  declareEnd?: (seat: Seat) => boolean
  /** Tap instead of click (touch devices). */
  touch?: boolean
}

export interface SeatStats {
  tilesPlaced: string[]
  chainsFounded: string[]
  survivorChoices: string[]
  dispositions: { defunct: string; sell: number; trade: number; hold: number }[]
  sharesBought: number
  cashSpent: number
  declaredEnd: boolean
  /** Buy phases in which the END GAME button was offered. */
  endGameOffered: number
}

export class Seat {
  /** Turns this seat has started (PLACE A TILE seen) and completed (turn ended). */
  turn = 0
  turnsCompleted = 0
  private boardAtLastTurn = -1
  readonly stats: SeatStats = {
    tilesPlaced: [],
    chainsFounded: [],
    survivorChoices: [],
    dispositions: [],
    sharesBought: 0,
    cashSpent: 0,
    declaredEnd: false,
    endGameOffered: 0,
  }

  /** Called after this seat placed a tile (e.g. to check another screen sees it live). */
  onPlaced?: (coord: string) => Promise<void>

  constructor(
    readonly page: Page,
    readonly j: Journey,
    readonly who: string,
    public policy: Policy = {}
  ) {}

  log(msg: string) {
    this.j.log(`(${this.who}) [turn ${this.turn}] ${msg}`)
  }

  async shot(label: string) {
    await this.j.shot(this.page, `${this.who}-t${String(this.turn).padStart(2, '0')}-${label}`)
  }

  /** Click, or tap on a touch device. */
  async press(loc: Locator): Promise<void> {
    if (this.policy.touch) await loc.tap()
    else await loc.click()
  }

  phase(): Locator {
    return this.page.getByTestId('game-phase')
  }

  async phaseText(): Promise<string> {
    return ((await this.phase().textContent()) ?? '').trim()
  }

  async cash(): Promise<number> {
    return parseMoney((await this.page.getByTestId('header-cash').textContent()) ?? '')
  }

  /** Placed tiles on the board (board is shown in the place-tile and waiting screens). */
  async boardCount(): Promise<number> {
    return this.page.getByTestId('board').locator('[data-chain]:not([data-chain="empty"])').count()
  }

  /** My holdings from the players panel: { chain: count }. */
  async holdings(playerId: string): Promise<Record<string, number>> {
    // One atomic read: badges can change while other seats play.
    const entries = await this.page
      .locator(`[data-testid^="player-stock-${playerId}-"]`)
      .evaluateAll((els) =>
        els.map((e) => [e.getAttribute('data-testid') ?? '', Number(e.textContent)] as const)
      )
    const out: Record<string, number> = {}
    for (const [id, n] of entries) out[id.replace(`player-stock-${playerId}-`, '')] = n
    return out
  }

  /** My player id (from the YOU row of the players panel). */
  async myId(): Promise<string> {
    const row = this.page.locator('[data-testid^="player-row-"]', { hasText: 'YOU' })
    return ((await row.getAttribute('data-testid')) ?? '').replace('player-row-', '')
  }

  /** Wait until this seat has something to do (or the game is over). */
  async waitActionable(timeout = 90_000): Promise<string> {
    await expect(this.phase()).toHaveText(ACTIONABLE, { timeout })
    return this.phaseText()
  }

  /** Wait for the banner to move off `from`. */
  private async waitPhaseLeaves(from: string, timeout = 15_000) {
    await expect(this.phase()).not.toHaveText(from, { timeout })
  }

  /**
   * Perform the one action the current phase asks for. Returns the phase handled.
   * A completed turn (BUY & END TURN, SKIP, END GAME) increments `turnsCompleted`.
   */
  async act(): Promise<string> {
    const phase = await this.waitActionable()
    switch (phase) {
      case 'PLACE A TILE':
        await this.placeTile()
        break
      case 'CHOOSE A CHAIN':
        await this.foundChain()
        break
      case 'CHOOSE SURVIVING CHAIN':
        await this.chooseSurvivor()
        break
      case 'DISPOSE YOUR STOCK':
        await this.dispose()
        break
      case 'BUY STOCKS':
        await this.buyAndEnd()
        break
      case 'GAME OVER':
        break
    }
    return phase
  }

  async placeTile(): Promise<string> {
    this.turn++
    await expect(this.page.getByTestId('board')).toBeVisible()
    const board = await this.boardCount()
    if (this.boardAtLastTurn >= 0 && board < this.boardAtLastTurn) {
      throw new Error(
        `${this.who}: board lost tiles between my turns (${this.boardAtLastTurn} -> ${board})`
      )
    }
    const rack = this.page.getByTestId('tile-rack')
    const playable = rack.locator('[role="button"]')
    await expect(playable.first(), 'a playable tile in the rack').toBeVisible({ timeout: 10_000 })
    const tile = playable.first()
    const coord = ((await tile.getAttribute('data-testid')) ?? '').replace('tile-', '')
    this.log(`board has ${board} tiles; select rack tile ${coord}`)
    await this.press(tile)
    const place = this.page.getByTestId('place-tile-button')
    await expect(place).toBeEnabled()
    await expect(this.page.getByText(`Selected: ${coord}`)).toBeVisible()
    await this.shot(`tile-selected-${coord}`)
    await this.press(place)
    await this.waitPhaseLeaves('PLACE A TILE')
    this.stats.tilesPlaced.push(coord)
    this.boardAtLastTurn = board + 1
    this.log(`placed ${coord}; phase now "${await this.phaseText()}"`)
    await this.shot(`placed-${coord}`)
    if (this.onPlaced) await this.onPlaced(coord)
    return coord
  }

  async foundChain(): Promise<string> {
    const selector = this.page.getByTestId('chain-selector')
    await expect(selector).toBeVisible()
    await this.shot('found-chain-selector')
    const btn = selector.locator('[data-testid^="chain-button-"]:enabled').first()
    const chain = ((await btn.getAttribute('data-testid')) ?? '').replace('chain-button-', '')
    this.log(`found chain ${chain}`)
    await this.press(btn)
    await this.waitPhaseLeaves('CHOOSE A CHAIN')
    this.stats.chainsFounded.push(chain)
    await this.shot(`founded-${chain}`)
    return chain
  }

  async chooseSurvivor(): Promise<string> {
    const selector = this.page.getByTestId('chain-selector')
    await expect(selector).toBeVisible()
    await this.shot('survivor-selector')
    const btn = selector.locator('[data-testid^="chain-button-"]:enabled').first()
    const chain = ((await btn.getAttribute('data-testid')) ?? '').replace('chain-button-', '')
    this.log(`choose surviving chain ${chain}`)
    await this.press(btn)
    await this.waitPhaseLeaves('CHOOSE SURVIVING CHAIN')
    this.stats.survivorChoices.push(chain)
    await this.shot(`survivor-${chain}`)
    return chain
  }

  /** Sell half, trade 2:1 as much of the rest as allowed, hold the remainder. */
  async dispose(): Promise<void> {
    const form = this.page.getByTestId('merger-disposition')
    await expect(form).toBeVisible()
    const title =
      (await this.page.locator('h3', { hasText: /^DISPOSE OF YOUR/ }).textContent()) ?? ''
    const owned = Number(
      ((await form.getByText(/^You have:/).textContent()) ?? '').match(/\d+/)?.[0] ?? '0'
    )
    const defunct = title.replace('DISPOSE OF YOUR ', '').replace(' STOCK', '')
    await this.shot(`disposition-${defunct}`)
    const sell = Math.floor(owned / 2)
    const sellSlider = form.getByTestId('slider-sell-to-bank')
    await sellSlider.fill(String(sell))
    const tradeSlider = form.locator('[data-testid^="slider-trade"]')
    let trade = 0
    if (await tradeSlider.isEnabled()) {
      const max = Number(await tradeSlider.getAttribute('max'))
      trade = Math.min(max, Math.floor((owned - sell) / 2) * 2)
      if (trade > 0) await tradeSlider.fill(String(trade))
    }
    const hold = owned - sell - trade
    await expect(form.getByTestId('disposition-summary')).toContainText(`SELL ${sell} `)
    await expect(form.getByTestId('disposition-summary')).toContainText(`HOLD ${hold}`)
    await expect(form.getByTestId('disposition-summary')).toContainText(`TRADE ${trade} `)
    this.log(`dispose ${owned} ${defunct}: sell ${sell}, trade ${trade}, hold ${hold}`)
    await this.shot(`disposition-${defunct}-set`)
    await this.press(form.getByTestId('confirm-disposition'))
    // The form must go away (or move on to the next defunct chain), not linger.
    await expect
      .poll(
        async () => {
          // Non-waiting reads: the form may vanish between two calls.
          const titles = await this.page
            .locator('h3', { hasText: /^DISPOSE OF YOUR/ })
            .allTextContents()
          if (titles.length === 0) return 'gone'
          return titles[0] === title ? 'same' : 'next'
        },
        {
          timeout: 15_000,
          message: `${this.who}: disposition form for ${defunct} did not close after confirming`,
        }
      )
      .not.toBe('same')
    this.stats.dispositions.push({ defunct, sell, trade, hold })
    await this.shot(`disposition-${defunct}-done`)
  }

  /** Buy with a simple policy (cheapest chains first, keep a reserve), then end the turn. */
  async buyAndEnd(): Promise<void> {
    const endTurn = this.page.getByTestId('end-turn-button')
    await expect(endTurn).toBeVisible()
    const endGame = this.page.getByTestId('end-game-button')
    const endOffered = await endGame.isVisible()
    if (endOffered) {
      this.stats.endGameOffered++
      this.log('END GAME is offered')
    }
    if (endOffered && this.policy.declareEnd?.(this)) {
      this.log('END GAME offered and policy says declare: click END GAME')
      await this.shot('end-game-offered')
      await this.press(endGame)
      this.stats.declaredEnd = true
      this.turnsCompleted++
      await expect(this.phase()).toHaveText('GAME OVER', { timeout: 15_000 })
      return
    }
    const cash = await this.cash()
    const maxShares = this.policy.maxShares ?? 2
    let budget = cash - (this.policy.cashReserve ?? 1500)
    const rows = await this.page.locator('[data-testid^="buy-row-"]').all()
    const options = []
    for (const row of rows) {
      options.push({
        row,
        chain: ((await row.getAttribute('data-testid')) ?? '').replace('buy-row-', ''),
        price: Number(await row.getAttribute('data-price')),
        available: Number(await row.getAttribute('data-available')),
      })
    }
    options.sort((a, b) => a.price - b.price)
    let shares = 0
    let total = 0
    const bought: Record<string, number> = {}
    let progress = true
    while (shares < maxShares && progress) {
      progress = false
      for (const o of options) {
        if (shares >= maxShares) break
        if (o.price > budget || (bought[o.chain] ?? 0) >= o.available) continue
        await this.press(o.row.getByTestId('stepper-increment'))
        bought[o.chain] = (bought[o.chain] ?? 0) + 1
        await expect(o.row.getByTestId('stepper-value')).toHaveText(String(bought[o.chain]))
        budget -= o.price
        total += o.price
        shares++
        progress = true
      }
    }
    if (shares > 0) {
      await expect(this.page.getByText(`Total: $${total.toLocaleString('en-US')}`)).toBeVisible()
      await expect(endTurn).toHaveText('BUY & END TURN')
    } else {
      await expect(endTurn).toHaveText('SKIP & END TURN')
    }
    this.log(
      `cash $${cash}; ${shares ? `buy ${JSON.stringify(bought)} for $${total}` : 'buy nothing'}; end turn`
    )
    await this.shot(shares ? 'buy-set' : 'buy-skip')
    await this.press(endTurn)
    await this.waitPhaseLeaves('BUY STOCKS')
    if (total > 0) {
      // The header must have shown exactly cash - total right after the purchase.
      await expect
        .poll(async () => (await observed(this.page)).cash.includes(cash - total), {
          timeout: 10_000,
          message: `${this.who}: header cash never showed $${cash - total} after buying`,
        })
        .toBe(true)
      this.stats.sharesBought += shares
      this.stats.cashSpent += total
    }
    this.turnsCompleted++
    this.log(`turn ended; now "${await this.phaseText()}"`)
  }

  /** Act until `n` more turns are completed (or the game ends). Returns false on game over. */
  async playTurns(n: number, beforeEachAction?: () => Promise<void>): Promise<boolean> {
    const target = this.turnsCompleted + n
    while (this.turnsCompleted < target) {
      if (beforeEachAction) await beforeEachAction()
      const phase = await this.act()
      if (phase === 'GAME OVER') return false
    }
    return true
  }

  /** Act until GAME OVER; fails if more than `maxTurns` turns are needed. */
  async playToGameOver(maxTurns: number): Promise<void> {
    while (true) {
      const phase = await this.act()
      if (phase === 'GAME OVER') return
      if (this.turnsCompleted > maxTurns) {
        throw new Error(`${this.who}: game not over after ${maxTurns} turns`)
      }
    }
  }
}

/**
 * Several human seats (one page each) play concurrently until each has completed `turns`
 * more turns. A seat that reached its target does not start a new turn but still answers
 * out-of-turn prompts (stock disposition). Returns false if the game ended first.
 */
export async function playTogether(seats: Seat[], turns: number, timeoutPerTurn = 60_000) {
  const targets = seats.map((s) => s.turnsCompleted + turns)
  const done = (i: number) => seats[i].turnsCompleted >= targets[i]
  const wants = async (i: number): Promise<string | null> => {
    const p = await seats[i].phaseText()
    if (!ACTIONABLE.test(p)) return null
    if (p === 'PLACE A TILE' && done(i)) return null
    return p
  }
  while (!seats.every((_, i) => done(i))) {
    let next = -1
    await expect
      .poll(
        async () => {
          for (let i = 0; i < seats.length; i++) {
            if ((await wants(i)) !== null) {
              next = i
              return true
            }
          }
          return false
        },
        {
          timeout: timeoutPerTurn,
          intervals: [100, 100, 200],
          message: 'no seat got anything to do',
        }
      )
      .toBe(true)
    const phase = await seats[next].act()
    if (phase === 'GAME OVER') return false
  }
  return true
}
