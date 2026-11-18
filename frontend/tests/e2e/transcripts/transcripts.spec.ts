import { test, expect, type Page, type Locator } from '@playwright/test'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { captureStep, resetStepCounter } from '../support/screenshot'
import { createGameViaUI, addBotViaUI, startGameViaUI } from '../support/game-setup'
import { BENCH_DIR, BENCH_RUN_DIR } from './dirs'
import { openTab } from '../support/tabs'

/**
 * Game transcripts + Buyout Bench, end to end on the real servers (no mocks, no API
 * shortcuts): a human plays a real game through the UI against a bot and the test-mode
 * "Fake LLM (test)" seat; the live transcript is inspected from a second tab while the
 * game runs (it must be redacted); after game over the full transcript is replayed,
 * its LLM prompts opened, its JSON downloaded; then the leaderboard produced by a real
 * standalone `python -m bench run` is checked, and one of its games opened.
 *
 * Needs: backend with GAME_TEST_MODE=1 and GAME_BENCH_DIR=BENCH_DIR (playwright.config.ts
 * starts it that way), frontend on :5173.
 */

const SHOTS = { category: 'transcripts', testName: 'full-flow' }
const shot = (page: Page, name: string) => captureStep(page, name, SHOTS)

const PROMPT_MARKERS = ['# Your seat', 'Rejected because', 'Legal action types']

/** Bench games: 4 games of one series (every seating of the lineup on the first seed). */
const BENCH_GAMES = 4

const tileRe = (tile: string) => new RegExp(`(?<![0-9A-Za-z])${tile}(?![0-9A-Za-z])`)

function watchErrors(page: Page, label: string, sink: string[]) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') sink.push(`[${label}] console.error: ${msg.text()}`)
  })
  page.on('pageerror', (err) => sink.push(`[${label}] pageerror: ${err.message}`))
}

function log(...args: unknown[]) {
  console.log(...args)
}

interface DriveResult {
  over: boolean
  tilesPlaced: number
  hand: string[]
}

/**
 * Play the human seat through the UI until the game is over, or until the human is about
 * to place their `stopAtTile`-th tile (the hand is then stable: the game waits for us).
 */
async function drive(page: Page, opts: { stopAtTile?: number; tilesPlaced?: number }) {
  const over = page.getByTestId('game-over')
  const chainBtn = page.getByTestId('chain-selector').locator('button:not([disabled])')
  const orderBtn = page.getByTestId('merger-order').getByRole('button')
  const confirm = page.getByTestId('confirm-disposition')
  const endGame = page.getByTestId('end-game-button')
  const endTurn = page.locator('[data-testid="end-turn-button"]:not([disabled])')
  const placeBtn = page.getByTestId('place-tile-button')
  const rackTile = page.getByTestId('tile-rack').locator('[role="button"]')
  const actionable = page.locator(
    [
      '[data-testid="game-over"]',
      '[data-testid="chain-selector"] button:not([disabled])',
      '[data-testid="merger-order"] button',
      '[data-testid="confirm-disposition"]',
      '[data-testid="end-turn-button"]:not([disabled])',
      '[data-testid="place-tile-button"]',
      '[data-testid="tile-rack"] [role="button"]',
    ].join(', ')
  )
  const phase = page.getByTestId('game-phase')
  let tilesPlaced = opts.tilesPlaced ?? 0

  for (let i = 0; i < 3000; i++) {
    await expect(actionable.first()).toBeVisible({ timeout: 90_000 })
    if (await over.isVisible()) return { over: true, tilesPlaced, hand: [] } as DriveResult

    if (await chainBtn.first().isVisible()) {
      const label = (await chainBtn.first().textContent())?.trim()
      log(`[human] choose chain ${label}`)
      await chainBtn.first().click({ timeout: 5000 })
      await expect(page.getByTestId('chain-selector')).toBeHidden({ timeout: 10_000 })
      continue
    }
    if (await orderBtn.first().isVisible()) {
      log('[human] choose the merger order (first offered chain)')
      await orderBtn.first().click({ timeout: 5000 })
      await expect(page.getByTestId('merger-order')).toBeHidden({ timeout: 10_000 })
      continue
    }
    if (await confirm.isVisible()) {
      log('[human] confirm stock disposition')
      await confirm.click({ timeout: 5000 })
      await expect(confirm).toBeHidden({ timeout: 10_000 })
      continue
    }
    if (await endTurn.isVisible()) {
      const declare = (await endGame.isVisible()) && (await endGame.isEnabled())
      if (declare) {
        log('[human] declare end game')
        await endGame.click({ timeout: 5000 })
        await expect(over).toBeVisible({ timeout: 30_000 })
        return { over: true, tilesPlaced, hand: [] }
      }
      log('[human] skip buying, end turn')
      await endTurn.click({ timeout: 5000 })
      await expect(endTurn).toHaveCount(0, { timeout: 15_000 })
      continue
    }
    if (await placeBtn.isVisible()) {
      log('[human] place tile')
      await placeBtn.click({ timeout: 5000 })
      tilesPlaced++
      await expect(phase).not.toContainText('PLACE A TILE', { timeout: 15_000 })
      continue
    }
    if (await rackTile.first().isVisible()) {
      if (opts.stopAtTile !== undefined && tilesPlaced >= opts.stopAtTile) {
        const hand = await page
          .getByTestId('tile-rack')
          .locator('[data-testid^="tile-"]')
          .evaluateAll((els) =>
            els
              .map((e) => e.getAttribute('data-testid') ?? '')
              .map((id) => id.replace(/^tile-/, ''))
              .filter((t) => /^\d{1,2}[A-I]$/.test(t))
          )
        return { over: false, tilesPlaced, hand }
      }
      const coord = (await rackTile.first().getAttribute('data-testid'))?.replace('tile-', '')
      log(`[human] select tile ${coord}`)
      await rackTile.first().click({ timeout: 5000 })
      await expect(placeBtn).toBeEnabled({ timeout: 5000 })
    }
  }
  throw new Error('the game did not finish within the action budget')
}

async function seatTotals(rows: Locator, pattern: RegExp) {
  const out: Record<string, string> = {}
  for (const row of await rows.all()) {
    const id = ((await row.getAttribute('data-testid')) ?? '').replace(/^[a-z]+-/, '')
    out[id] = ((await row.textContent()) ?? '').match(pattern)?.[0] ?? ''
  }
  return out
}

test.describe('Transcripts and Buyout Bench on the real servers', () => {
  test.beforeAll(() => {
    // The standalone benchmark, exactly as a person would run it, into the directory the
    // backend serves at /bench/* (GAME_BENCH_DIR, set by playwright.config.ts).
    fs.rmSync(BENCH_DIR, { recursive: true, force: true })
    execFileSync(
      'python3',
      [
        '-m',
        'bench',
        'run',
        '--protocol',
        'bench-v1',
        '--models',
        'llm:fake',
        '--track',
        'vs-baseline',
        '--games',
        String(BENCH_GAMES),
        '--out',
        BENCH_RUN_DIR,
        '--quiet',
      ],
      {
        cwd: path.resolve(process.cwd(), '../backend'),
        env: { ...process.env, GAME_TEST_MODE: '1' },
        stdio: 'inherit',
        timeout: 240_000,
      }
    )
  })

  test('play a game, read its live and full transcript, then the benchmark', async ({
    page,
    context,
  }) => {
    resetStepCounter()
    const errors: string[] = []
    watchErrors(page, 'play', errors)
    const noErrors = () => expect(errors, 'browser console / page errors').toEqual([])

    let roomCode = ''
    /** The LLM seat's character name (random per room, BL-010; the model is its badge). */
    let llmName = ''
    let gameId = ''
    let hand: string[] = []
    let live: Page

    // ------------------------------------------------------------------ the game
    await test.step('home page: create a game with a bot and the Fake LLM seat', async () => {
      await page.goto('/')
      await shot(page, 'home')
      const ctx = await createGameViaUI(page, 'Dana')
      roomCode = ctx.roomCode
      await addBotViaUI(page)
      await page.getByTestId('add-ai-button').click()
      await shot(page, 'ai-menu')
      await page.getByTestId('ai-option-llm:fake').click()
      const llmSeat = page
        .locator('[data-testid^="lobby-player-"]')
        .filter({ has: page.locator('[data-kind="llm"]') })
      await expect(
        llmSeat.getByRole('button', { name: 'AI player, Fake LLM (test)' })
      ).toBeVisible()
      llmName = ((await llmSeat.locator('span').first().textContent()) ?? '').trim()
      expect(llmName).not.toBe('')
      expect(llmName).not.toContain('Fake LLM')
      log(`[test] LLM seat name: ${llmName}`)
      await expect(page.locator('[data-testid^="lobby-player-"]')).toHaveCount(3)
      await shot(page, 'lobby-with-bot-and-fake-llm')
      await startGameViaUI(page)
      await expect(page.getByTestId('tile-rack')).toBeVisible()
      await shot(page, 'game-started')
      // Say something at the table: the Fake LLM answers a human, so the transcript gets
      // table-chat lines and a talk call (seats no longer comment on game events).
      await openTab(page, 'chat')
      await page.getByTestId('chat-input').fill('Good luck, everyone')
      await page.getByTestId('chat-input').press('Enter')
      await expect(
        page.getByTestId('chat-message').filter({ hasText: 'Fake LLM heard you, Dana' })
      ).toHaveCount(1, { timeout: 15_000 })
      await shot(page, 'table-chat')
      noErrors()
    })

    await test.step('play a few turns, then watch the live transcript from a second tab', async () => {
      const r = await drive(page, { stopAtTile: 6 })
      expect(r.over, 'the game should still be running').toBe(false)
      hand = r.hand
      expect(hand.length).toBeGreaterThanOrEqual(4)
      log(`[test] human hand while the game runs: ${hand.join(', ')}`)
      await shot(page, 'mid-game-before-placing-a-tile')

      live = await context.newPage()
      watchErrors(live, 'live', errors)
      await live.goto('/games')
      const row = live.locator('[data-testid^="game-row-"]', { hasText: `Room ${roomCode}` })
      await expect(row).toBeVisible()
      await expect(row).toHaveAttribute('data-status', 'live')
      await expect(row).toContainText('LIVE')
      // The LIVE badge says it is in progress; the outcome line stays empty (said once, BL-017).
      await expect(row.getByTestId('game-winner')).toHaveText('')
      // The games list compares models: the model first, the character name second.
      await expect(row).toContainText('Fake LLM (test)')
      await expect(row).toContainText(llmName)
      await shot(live, 'games-list-with-live-game')
      await row.getByRole('link').click()
      await live.waitForURL(/\/games\/[\w-]+$/)
      gameId = new URL(live.url()).pathname.split('/').pop()!
      await expect(live.getByTestId('transcript-viewer')).toBeVisible()
      await expect(live.getByTestId('redacted-banner')).toBeVisible()
      await expect(live.getByTestId('live-bar')).toBeVisible()
      await expect(live.getByTestId('summary-header')).toContainText('IN PROGRESS')
      await shot(live, 'live-transcript-redacted')

      // step to a decision of the LLM seat: its prompt and raw output are locked
      // (the timeline shows the decisions around the current step; "All decisions" opens it)
      await live.getByTestId('timeline-all').click()
      const llmStep = live.locator('[data-testid^="timeline-step-"][data-source="llm"]').first()
      await llmStep.click()
      await expect(live.getByTestId('llm-locked')).toBeVisible()
      await shot(live, 'live-llm-decision-locked')

      // Page text without the board grid (every cell of the 12x9 board is labelled, played or
      // not): a hand tile's label there says nothing; whether it is drawn as played does.
      const text = await live.evaluate(() => {
        const clone = document.body.cloneNode(true) as HTMLElement
        clone.querySelectorAll('[data-testid="board"]').forEach((el) => el.remove())
        document.body.append(clone)
        const out = clone.innerText
        clone.remove()
        return out
      })
      for (const t of hand) {
        const cls = await live
          .locator(`[data-testid="replay-board"] [data-testid="tile-${t}"]`)
          .getAttribute('class')
        expect(cls, `hand tile ${t} must not be drawn as played on the live board`).toMatch(/empty/)
      }
      for (const t of hand) {
        expect(text, `hand tile ${t} must not appear in the live transcript page`).not.toMatch(
          tileRe(t)
        )
      }
      for (const marker of PROMPT_MARKERS) expect(text).not.toContain(marker)
      expect(text).not.toContain('Rules as implemented') // the system prompt is not shown either

      // what the server actually sends, for the same game (read-only check)
      const res = await live.request.get(`/api/games/${gameId}/transcript`)
      expect(res.ok()).toBe(true)
      const body = await res.json()
      expect(body.redacted).toBe(true)
      expect(body.footer).toBeNull()
      expect(body.header.seed).toBeNull()
      expect(body.header.tile_order ?? null).toBeNull()
      expect(body.live_totals).toBeTruthy()
      const raw = JSON.stringify({ ...body, header: { ...body.header, system_prompts: {} } })
      for (const t of hand) expect(raw).not.toMatch(tileRe(t))
      for (const marker of PROMPT_MARKERS) expect(raw).not.toContain(marker)
      expect(
        body.entries.some((e: { type: string; event?: { private_to?: string } }) =>
          e.type === 'event' ? !!e.event?.private_to : false
        )
      ).toBe(false)
      noErrors()
    })

    await test.step('finish the game through the UI', async () => {
      const r = await drive(page, { tilesPlaced: 6 })
      expect(r.over).toBe(true)
      await expect(page.getByTestId('game-over')).toBeVisible()
      await shot(page, 'game-over')
      noErrors()
    })

    let overTotals: Record<string, string> = {}
    await test.step('the live tab flips from redacted to the full transcript by itself', async () => {
      await expect(live.getByTestId('redacted-banner')).toBeHidden({ timeout: 20_000 })
      await expect(live.getByTestId('summary-header')).toContainText('FINISHED')
      await shot(live, 'live-tab-after-game-over')
      await live.close()
    })

    await test.step('game over: follow "View full transcript"', async () => {
      overTotals = await seatTotals(page.locator('[data-testid^="rank-"]'), /\$[\d,]+/)
      expect(Object.keys(overTotals)).toHaveLength(3)
      await page.getByTestId('view-transcript-link').click()
      await page.waitForURL(new RegExp(`/games/${gameId}$`))
      await expect(page.getByTestId('transcript-viewer')).toBeVisible()
      await expect(page.getByTestId('redacted-banner')).toHaveCount(0)
      await expect(page.getByTestId('live-bar')).toHaveCount(0)
      await expect(page.getByTestId('summary-header')).toContainText('FINISHED')
      await shot(page, 'full-transcript-summary')
    })

    await test.step('summary standings equal the game-over screen', async () => {
      const summary = await seatTotals(page.locator('[data-testid^="score-"]'), /\$[\d,]+/)
      log('[test] game-over screen:', JSON.stringify(overTotals))
      log('[test] transcript summary:', JSON.stringify(summary))
      expect(summary).toEqual(overTotals)
      // and the server's own game summary agrees with what the page shows
      const detail = await (await page.request.get(`/api/games/${gameId}`)).json()
      expect(detail.status).toBe('finished')
      for (const st of detail.standings) {
        expect(overTotals[st.player_id]).toBe(`$${st.score.toLocaleString('en-US')}`)
      }
      noErrors()
    })

    await test.step('replay: first / next / scrub / keys / deep link', async () => {
      const counter = page.getByTestId('step-counter')
      await expect(counter).toHaveText(/^Step 0 \/ \d+$/)
      const last = Number((await counter.textContent())!.match(/\/ (\d+)/)![1])
      expect(last).toBeGreaterThan(40)
      await expect(page.getByTestId('event-log')).toContainText('Game started')
      await expect(page.getByTestId('step-first')).toBeDisabled()
      await shot(page, 'replay-start')

      await page.getByTestId('step-next').click()
      await expect(counter).toHaveText(`Step 1 / ${last}`)
      await expect(page).toHaveURL(/step=1$/)
      await expect(page.getByTestId('decision-panel')).toContainText('STEP 1')
      await shot(page, 'replay-step-1')

      const mid = Math.floor(last / 2)
      await page.getByTestId('scrubber').fill(String(mid))
      await expect(counter).toHaveText(`Step ${mid} / ${last}`)
      await shot(page, 'replay-scrubbed-to-middle')

      await page.keyboard.press('ArrowRight')
      await expect(counter).toHaveText(`Step ${mid + 1} / ${last}`)
      await page.getByTestId('step-prev').click()
      await expect(counter).toHaveText(`Step ${mid} / ${last}`)

      await page.getByTestId('step-last').click()
      await expect(counter).toHaveText(`Step ${last} / ${last}`)
      await expect(page.getByTestId('event-log')).toContainText('Game over')
      await shot(page, 'replay-end')
      await page.getByTestId('step-first').click()
      await expect(counter).toHaveText(`Step 0 / ${last}`)

      // deep link
      await page.goto(`/games/${gameId}?step=7`)
      await expect(counter).toHaveText(`Step 7 / ${last}`)
      await expect(page.getByTestId('timeline-step-7')).toHaveAttribute('aria-current', 'step')
      await shot(page, 'replay-deep-link-step-7')
      noErrors()
    })

    await test.step('on a phone (390x675): one page, nothing sideways, board and move together', async () => {
      await page.setViewportSize({ width: 390, height: 675 })
      await page.goto(`/games/${gameId}?step=12`)
      await expect(page.getByTestId('step-counter')).toHaveText(/^Step 12 \//)
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
      expect(sideways, 'the page scrolls sideways').toBeLessThanOrEqual(0)
      // No box scrolls inside the page (the seats table, the timeline): BL-019.
      const inner = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('body *'))
          .filter((el) => {
            const cs = getComputedStyle(el)
            return (
              (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) ||
              (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1)
            )
          })
          .map((el) => el.getAttribute('data-testid') ?? el.className)
      )
      expect(inner, 'boxes that scroll inside the page').toEqual([])
      // Each seat on one line: its name and icon side by side.
      for (const chip of await page.locator('[data-testid^="seat-chip-"]').all()) {
        const b = (await chip.boundingBox())!
        expect(b.height, 'a seat on one line').toBeLessThanOrEqual(30)
      }
      // The replay controls: one row of buttons over a full-width scrubber.
      const mids = await page
        .getByRole('group', { name: 'Replay controls' })
        .locator('button, select')
        .evaluateAll((els) =>
          els.map((e) => {
            const r = e.getBoundingClientRect()
            return r.top + r.height / 2
          })
        )
      expect(Math.max(...mids) - Math.min(...mids), 'controls on one row').toBeLessThanOrEqual(4)
      const bar = (await page.getByTestId('scrubber').boundingBox())!
      expect(bar.width).toBeGreaterThan(330)
      // The board and what happened in this step fit one screen under the controls.
      await page.getByTestId('replay-board').scrollIntoViewIfNeeded()
      const board = (await page.getByTestId('board').boundingBox())!
      const events = (await page.getByTestId('event-log').boundingBox())!
      const controls = (await page.getByRole('group', { name: 'Replay controls' }).boundingBox())!
      expect(events.y + events.height - board.y, 'board and move together').toBeLessThanOrEqual(
        675 - controls.height
      )
      await shot(page, 'phone-replay')
      await page.setViewportSize({ width: 1280, height: 900 })
      noErrors()
    })

    await test.step('a long drag and playback: the scrubber follows, the address a few writes', async () => {
      // The owner: "the left-right scroller jams up after a while". Each step used to be
      // written to the address and read back from it; Safari refuses more than 100 history
      // writes in 10 seconds, after which the scrubber stopped following (BL-019). Count the
      // writes while dragging through the whole game and back, as a finger would.
      const counter = page.getByTestId('step-counter')
      const scrubber = page.getByTestId('scrubber')
      const last = Number((await counter.textContent())!.match(/\/ (\d+)/)![1])
      await page.evaluate(() => {
        const w = window as unknown as { __writes: number }
        w.__writes = 0
        const replace = history.replaceState.bind(history)
        const push = history.pushState.bind(history)
        history.replaceState = (...a: Parameters<History['replaceState']>) => {
          w.__writes++
          return replace(...a)
        }
        history.pushState = (...a: Parameters<History['pushState']>) => {
          w.__writes++
          return push(...a)
        }
      })
      await scrubber.scrollIntoViewIfNeeded()
      const box = (await scrubber.boundingBox())!
      const y = box.y + box.height / 2
      const at = (f: number) => box.x + 8 + (box.width - 16) * f
      const t0 = Date.now()
      await page.mouse.move(at(0), y)
      await page.mouse.down()
      for (let i = 0; i <= 150; i++) await page.mouse.move(at(i / 150), y)
      for (let i = 150; i >= 75; i--) await page.mouse.move(at(i / 150), y)
      await page.mouse.up()
      const elapsed = Date.now() - t0
      // The counter shows where the thumb is, and the address catches up with it.
      const value = Number(await scrubber.inputValue())
      expect(value).toBeGreaterThan(last / 4)
      expect(value).toBeLessThan((3 * last) / 4)
      await expect(counter).toHaveText(`Step ${value} / ${last}`)
      await expect(page).toHaveURL(new RegExp(`step=${value}$`))
      const writes = await page.evaluate(() => (window as unknown as { __writes: number }).__writes)
      log(`[test] drag: ${elapsed} ms, ${writes} address writes, ended on step ${value}`)
      expect(writes, 'address writes during the drag').toBeLessThanOrEqual(
        Math.ceil(elapsed / 400) + 3
      )
      expect(writes).toBeLessThan(100)
      await shot(page, 'replay-after-long-drag')

      // Playback at 8x moves step by step, the scrubber with it, and stops on pause.
      await page.getByTestId('speed').selectOption('8')
      await page.getByTestId('play-pause').click()
      await expect
        .poll(async () => Number(await scrubber.inputValue()), { timeout: 5000 })
        .toBeGreaterThan(value + 5)
      await page.getByTestId('play-pause').click()
      const stopped = Number(await scrubber.inputValue())
      await expect(counter).toHaveText(`Step ${stopped} / ${last}`)
      await page.waitForTimeout(600)
      expect(Number(await scrubber.inputValue()), 'paused: it stays').toBe(stopped)
      await expect(page).toHaveURL(new RegExp(`step=${stopped}$`))
      noErrors()
    })

    await test.step('an LLM decision: real user prompt, system prompt and raw output', async () => {
      await page.getByTestId('timeline-all').click()
      await page.locator('[data-testid^="timeline-step-"][data-source="llm"]').first().click()
      const panel = page.getByTestId('llm-panel')
      await expect(panel).toBeVisible()
      await expect(page.getByTestId('llm-locked')).toHaveCount(0)
      await expect(panel.getByTestId('attempt-0')).toHaveAttribute('data-outcome', 'accepted')
      await shot(page, 'llm-decision')

      const userToggle = panel.locator('[data-testid^="toggle-user-prompt-"]')
      await userToggle.click()
      const userBody = panel.locator('[data-testid^="body-user-prompt-"]')
      await expect(userBody).toContainText('# Your seat')
      // The seat knows its own (character) name.
      await expect(userBody).toContainText(`You are ${llmName} (player id`)
      await shot(page, 'llm-user-prompt-open')

      await panel.locator('[data-testid^="toggle-system-prompt-"]').click()
      const sysBody = panel.locator('[data-testid^="body-system-prompt-"]')
      await expect(sysBody).toBeVisible()
      expect(((await sysBody.textContent()) ?? '').length).toBeGreaterThan(500)
      await shot(page, 'llm-system-prompt-open')

      await panel.locator('[data-testid^="toggle-attempt-"][data-testid$="-raw"]').first().click()
      const raw = panel.locator('[data-testid^="body-attempt-"][data-testid$="-raw"]').first()
      await expect(raw).toContainText('"action"')
      await shot(page, 'llm-raw-output-open')
      noErrors()
    })

    await test.step('download the transcript JSON', async () => {
      // The record's details (ids, times, seed, prompt, download) are behind "Details".
      await page.getByTestId('transcript-details').locator('summary').click()
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('download-transcript').click(),
      ])
      expect(download.suggestedFilename()).toBe(`${gameId}.json`)
      const file = await download.path()
      const t = JSON.parse(fs.readFileSync(file, 'utf8'))
      expect(t.header.game_id).toBe(gameId)
      expect(t.header.source).toBe('live')
      expect(t.header.seats).toHaveLength(3)
      expect(t.header.seed).not.toBeNull()
      expect(Array.isArray(t.entries)).toBe(true)
      expect(t.entries.length).toBeGreaterThan(200)
      // Dana spoke at the table and the Fake LLM answered, so the file has table-chat
      // lines and the seat's talk calls between the game lines.
      expect(new Set(t.entries.map((e: { type: string }) => e.type))).toEqual(
        new Set(['event', 'decision', 'state', 'chat', 'chat_reply'])
      )
      expect(t.footer.standings).toHaveLength(3)
      expect(t.redacted).toBe(false)
      log(
        `[test] downloaded transcript: ${fs.statSync(file).size} bytes, ${t.entries.length} entries`
      )
    })

    // ------------------------------------------------------- viewer responsiveness
    await test.step('measure the viewer on the real (large) transcript', async () => {
      const samples: { load: number; step: number; bytes: number }[] = []
      for (let i = 0; i < 3; i++) {
        const fresh = await context.newPage()
        watchErrors(fresh, `perf${i}`, errors)
        let bytes = 0
        fresh.on('response', async (r) => {
          if (r.url().endsWith(`/api/games/${gameId}/transcript`)) {
            bytes = Number((await r.allHeaders())['content-length'] ?? 0)
          }
        })
        const t0 = Date.now()
        await fresh.goto(`/games/${gameId}`)
        const next = fresh.getByTestId('step-next')
        await expect(next).toBeEnabled()
        const load = Date.now() - t0
        const counter = fresh.getByTestId('step-counter')
        const s0 = Date.now()
        await next.click()
        await expect(counter).toHaveText(/^Step 1 \//)
        const step = Date.now() - s0
        samples.push({ load, step, bytes })
        if (i === 0) await shot(fresh, 'viewer-measured')
        await fresh.close()
      }
      log(
        `[perf] viewer time-to-interactive (goto -> step buttons enabled): ${samples
          .map((s) => `${s.load} ms`)
          .join(', ')}; click -> next step rendered: ${samples
          .map((s) => `${s.step} ms`)
          .join(', ')}; transcript response ${samples[0].bytes} bytes (wire)`
      )
      test.info().annotations.push({
        type: 'viewer-tti-ms',
        description: JSON.stringify(samples),
      })
      noErrors()
    })

    // ---------------------------------------------------------------- the benchmark
    await test.step('games list: the benchmark games are there too', async () => {
      await page.goto('/')
      await page.getByTestId('games-link').click()
      await expect(page.getByTestId('games-list')).toBeVisible()
      await page.getByTestId('filter-benchmark').click()
      const rows = page.locator('[data-testid^="game-row-"][data-status="finished"]')
      await expect(rows).toHaveCount(BENCH_GAMES)
      await expect(rows.first()).toContainText('BENCH')
      await shot(page, 'games-list-benchmark-filter')
    })

    let seriesId = ''
    await test.step('leaderboard from the standalone run', async () => {
      await page.goto('/')
      await page.getByTestId('bench-link').click()
      const table = page.getByTestId('leaderboard-table')
      await expect(
        table,
        `leaderboard empty: is the backend serving GAME_BENCH_DIR=${BENCH_DIR}?`
      ).toBeVisible()
      await shot(page, 'leaderboard')
      await expect(page.getByTestId('bench-protocol-id')).toHaveText('bench-v1')
      await expect(page.getByTestId('bench-prompt-version')).toContainText(/prompt\s+v\d+-/)
      await expect(page.getByTestId('bench-track')).toContainText('all')
      await expect(page.getByTestId('bench-warnings')).toHaveCount(0)
      await expect(page.getByTestId('bench-sample-size')).toContainText(`${BENCH_GAMES} games`)

      const bot = page.getByTestId('leaderboard-row-bot')
      const model = page.getByTestId('leaderboard-row-llm:fake')
      await expect(bot).toHaveAttribute('data-anchor', 'true')
      await expect(bot).toContainText('ANCHOR')
      await expect(bot).toContainText('1,500')
      await expect(bot).toContainText(`${BENCH_GAMES * 3} seat-games`)
      await expect(model).not.toHaveAttribute('data-anchor')
      await expect(model).toContainText('Fake LLM (test)')
      await expect(model).toContainText(`${BENCH_GAMES}`)
      await expect(page.getByTestId('cost-llm:fake')).toHaveText('$0.00')
      await expect(page.getByTestId('winrate-bar-llm:fake')).toBeVisible()

      const link = page.locator('[data-testid^="series-link-"]')
      await expect(link).toHaveCount(1)
      await expect(link).toContainText(`${BENCH_GAMES} of ${BENCH_GAMES} games played`)
      await expect(link).toContainText('vs-baseline')
      await expect(link).toContainText('PARTIAL RUN')
      seriesId = ((await link.getAttribute('data-testid')) ?? '').replace('series-link-', '')

      // switch tracks: head-to-head has no results from this run
      await page.getByTestId('track-head-to-head').click()
      await expect(page.getByTestId('bench-track')).toContainText('head-to-head')
      await expect(page.getByTestId('bench-empty')).toBeVisible()
      await shot(page, 'leaderboard-head-to-head-empty')
      await page.getByTestId('track-vs-baseline').click()
      await expect(page.getByTestId('leaderboard-table')).toBeVisible()
      noErrors()
    })

    await test.step('series page and one of its games', async () => {
      await page.getByTestId(`series-link-${seriesId}`).click()
      await page.waitForURL(/\/bench\/series\//)
      const list = page.getByTestId('series-games')
      await expect(list).toBeVisible()
      await expect(page.getByTestId('series-played')).toHaveText(String(BENCH_GAMES))
      await expect(page.locator('[data-testid^="series-game-"]')).toHaveCount(BENCH_GAMES)
      await shot(page, 'series')
      const first = page.locator('[data-testid^="series-view-"]').first()
      const href = await first.getAttribute('href')
      await first.click()
      await page.waitForURL(new RegExp(`${href}$`))
      await expect(page.getByTestId('transcript-viewer')).toBeVisible()
      await expect(page.getByTestId('summary-header')).toContainText('BENCH')
      await expect(page.getByTestId('summary-header')).toContainText('FINISHED')
      await expect(page.getByTestId('summary-header')).toContainText('bench-v1')
      await expect(page.getByTestId('redacted-banner')).toHaveCount(0)
      await page.getByTestId('step-next').click()
      await expect(page.getByTestId('step-counter')).toHaveText(/^Step 1 \//)
      await page.getByTestId('timeline-all').click()
      await page.locator('[data-testid^="timeline-step-"][data-source="llm"]').first().click()
      await expect(page.getByTestId('llm-panel')).toBeVisible()
      await shot(page, 'bench-game-transcript')
      noErrors()
    })

    noErrors()
  })
})
