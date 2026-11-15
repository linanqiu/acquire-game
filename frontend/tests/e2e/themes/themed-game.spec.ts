/**
 * A themed ruleset end to end, through the UI only (see playwright.themes.config.ts: this runs
 * once against a server started with GAME_RULESET=valley and once with GAME_RULESET=mini).
 *
 * Home page -> create a game -> add bots -> START -> play at least 8 human turns (founding a
 * chain and buying shares along the way) -> open the transcript viewer for that game.
 * On every screen: the brand ("Buyout", the product name), the ruleset's theme title, chain
 * names and board size are shown, and no default-theme word (its title, hotel words, or a default
 * chain name the theme does not share) is anywhere in the page. Console errors fail the test.
 */
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

interface Chain {
  id: string
  name: string
  abbreviation: string
  color: string
}
interface Ruleset {
  id: string
  title: string
  theme: Record<string, string>
  board: { columns: number; rows: number }
  chains: Chain[]
  min_players: number
  max_players: number
  max_stock_purchases_per_turn: number
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RULESETS = path.resolve(HERE, '../../../../backend/rulesets')
const readRuleset = (name: string): Ruleset =>
  JSON.parse(fs.readFileSync(path.join(RULESETS, `${name}.json`), 'utf8')) as Ruleset
const DEFAULT_RS = readRuleset('default')

const MIN_HUMAN_TURNS = 8
const MAX_HUMAN_TURNS = 40

/** The product name (server setting GAME_BRAND_NAME, default "Buyout"): the same in every theme. */
const BRAND = 'Buyout'

/**
 * Default-theme words that must never be on a page of theme `rs` (case-sensitive, whole words).
 * mini uses five of the default chains, so only the default chains `rs` does not have count.
 */
function forbiddenFor(rs: Ruleset): string[] {
  const own = new Set(rs.chains.map((c) => c.name))
  return [
    ...DEFAULT_RS.chains
      .filter((c) => !own.has(c.name))
      .flatMap((c) => [c.name, c.name.toUpperCase()]),
    DEFAULT_RS.title,
    DEFAULT_RS.title.toUpperCase(),
    'hotel',
    'HOTEL',
  ]
}
let FORBIDDEN: string[] = []

function article(phrase: string) {
  return /^[aeiou]/i.test(phrase) ? 'an' : 'a'
}

class Shots {
  private n = 0
  readonly dir: string
  constructor(info: TestInfo, ruleset: string) {
    this.dir = path.join('test-results', 'themes', ruleset)
    fs.rmSync(this.dir, { recursive: true, force: true })
    fs.mkdirSync(this.dir, { recursive: true })
    void info
  }
  async take(page: Page, name: string) {
    this.n += 1
    const file = path.join(this.dir, `${String(this.n).padStart(3, '0')}-${name}.png`)
    await page.screenshot({ path: file, fullPage: true })
  }
}

async function expectNoDefaultText(page: Page, where: string) {
  const text = await page.evaluate(() => document.body.textContent ?? '')
  const leaks = FORBIDDEN.filter((w) => new RegExp(`\\b${w}\\b`).test(text))
  expect(leaks, `default words on ${where}`).toEqual([])
}

async function expectBoard(page: Page, rs: Ruleset) {
  const board = page.getByTestId('board')
  await expect(board).toBeVisible()
  await expect(board).toHaveAttribute('data-columns', String(rs.board.columns))
  await expect(board).toHaveAttribute('data-rows', String(rs.board.rows))
  await expect(board.locator('[data-testid^="tile-"]')).toHaveCount(
    rs.board.columns * rs.board.rows
  )
  const lastRow = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[rs.board.rows - 1]
  await expect(board.getByTestId(`tile-${rs.board.columns}${lastRow}`)).toBeVisible()
  await expect(board.getByTestId(`tile-${rs.board.columns + 1}A`)).toHaveCount(0)
}

test('themed game from the home page to the transcript', async ({ page }, testInfo) => {
  const name = String(testInfo.project.metadata.ruleset)
  const rs = readRuleset(name)
  const t = rs.theme
  FORBIDDEN = forbiddenFor(rs)
  const PHASE = {
    place: 'PLACE A TILE',
    found: `CHOOSE ${article(t.chain_noun)} ${t.chain_noun}`.toUpperCase(),
    survivor: `CHOOSE THE SURVIVING ${t.chain_noun}`.toUpperCase(),
    dispose: `DISPOSE YOUR ${t.share_noun_plural}`.toUpperCase(),
    buy: `BUY ${t.stock_label}`.toUpperCase(),
    over: 'GAME OVER',
  }
  const actionable = new Set(Object.values(PHASE))
  const shots = new Shots(testInfo, name)
  const log = (msg: string) => console.log(`[${name}] ${msg}`)

  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))

  // -- Home page: the configured product, before any game exists ------------------------
  await page.goto('/')
  await expect(page.getByRole('heading', { name: BRAND.toUpperCase() })).toBeVisible()
  await expect(page.getByTestId('home-theme')).toHaveText(rs.title)
  await expect(page.getByTestId('home-tagline')).toHaveText(t.tagline)
  await expect(page).toHaveTitle(BRAND)
  await expect(page.getByTestId('home-meta')).toContainText(
    `${rs.board.columns}×${rs.board.rows} board`
  )
  // The entry card's title, then its one-line hint (BL-009 home page).
  await expect(page.getByTestId('bench-link')).toHaveText(new RegExp(`^${BRAND} Bench\\b`))
  await expectNoDefaultText(page, 'home')
  await shots.take(page, 'home')

  // -- Create a game and fill it with bots -----------------------------------------------
  await page.getByTestId('create-name-input').fill('Alice')
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z]{4}\?is_host=1$/)
  const room = /\/play\/([A-Z]{4})/.exec(page.url())![1]
  log(`room ${room}`)
  await expect(page.getByTestId('header-title')).toHaveText(BRAND.toUpperCase())
  await expect(page.getByText(`1/${rs.max_players} players`)).toBeVisible()
  await shots.take(page, 'lobby')
  const seats = Math.max(rs.min_players, 3)
  for (let n = 2; n <= seats; n++) {
    await page.getByTestId('add-bot-button').click()
    await expect(page.getByText(`${n}/${rs.max_players} players`)).toBeVisible()
  }
  await expect(page.getByTestId('start-hint')).toHaveText('Ready to start!')
  await expectNoDefaultText(page, 'lobby')
  await shots.take(page, 'lobby-full')
  await page.getByRole('button', { name: 'START GAME' }).click()
  await expect(page.getByTestId('game-phase')).toBeVisible()
  await expectBoard(page, rs)
  await shots.take(page, 'game-started')

  // -- Play ------------------------------------------------------------------------------
  const phaseBanner = page.getByTestId('game-phase')
  const chainNames = new Set(rs.chains.map((c) => c.name))
  let turns = 0
  let founded = 0
  let bought = 0
  const seenPhases = new Set<string>()

  const waitActionable = async () => {
    await expect
      .poll(async () => actionable.has(((await phaseBanner.textContent()) ?? '').trim()), {
        timeout: 90_000,
        message: 'waiting for my turn',
      })
      .toBe(true)
    return ((await phaseBanner.textContent()) ?? '').trim()
  }

  /** Coordinates of the board by state (`empty` / `orphan` / chain id). */
  const boardState = async () =>
    page
      .getByTestId('board')
      .locator('[data-testid^="tile-"]')
      .evaluateAll((els) =>
        Object.fromEntries(
          els.map((e) => [
            (e.getAttribute('data-testid') ?? '').replace('tile-', ''),
            e.getAttribute('data-chain') ?? 'empty',
          ])
        )
      )

  const neighbours = (coord: string) => {
    const m = /^(\d+)([A-Z])$/.exec(coord)!
    const col = Number(m[1])
    const row = m[2].charCodeAt(0)
    return [
      `${col - 1}${m[2]}`,
      `${col + 1}${m[2]}`,
      `${col}${String.fromCharCode(row - 1)}`,
      `${col}${String.fromCharCode(row + 1)}`,
    ]
  }

  while (true) {
    const phase = await waitActionable()
    seenPhases.add(phase)
    if (phase === PHASE.over) break
    if (turns >= MIN_HUMAN_TURNS && founded > 0 && bought > 0 && phase === PHASE.place) break
    if (turns >= MAX_HUMAN_TURNS) {
      throw new Error(
        `${MAX_HUMAN_TURNS} turns without founding (${founded}) and buying (${bought})`
      )
    }
    await expectBoard(page, rs)
    await expectNoDefaultText(page, phase)

    if (phase === PHASE.place) {
      turns += 1
      const board = await boardState()
      const rack = page.getByTestId('tile-rack').locator('[role="button"]')
      await expect(rack.first(), 'a playable rack tile').toBeVisible()
      const coords = (await rack.evaluateAll((els) =>
        els.map((e) => (e.getAttribute('data-testid') ?? '').replace('tile-', ''))
      )) as string[]
      // Prefer a tile that founds a chain (next to an unincorporated tile, no chain around).
      const founds = coords.find((c) => {
        const around = neighbours(c)
          .map((n) => board[n])
          .filter(Boolean)
        return around.includes('orphan') && around.every((s) => s === 'orphan' || s === 'empty')
      })
      const coord = founds ?? coords[0]
      log(`turn ${turns}: place ${coord}${founds ? ' (founds)' : ''}`)
      await page.getByTestId('tile-rack').getByTestId(`tile-${coord}`).click()
      await expect(page.getByText(`Selected: ${coord}`)).toBeVisible()
      await shots.take(page, `t${turns}-selected-${coord}`)
      await page.getByTestId('place-tile-button').click()
      await expect(phaseBanner).not.toHaveText(PHASE.place)
      await expect(page.getByTestId('board').getByTestId(`tile-${coord}`)).not.toHaveAttribute(
        'data-chain',
        'empty'
      )
      await shots.take(page, `t${turns}-placed-${coord}`)
    } else if (phase === PHASE.found || phase === PHASE.survivor) {
      const selector = page.getByTestId('chain-selector')
      const buttons = selector.locator('[data-testid^="chain-button-"]')
      await expect(buttons).toHaveCount(rs.chains.length)
      for (const c of rs.chains) {
        await expect(selector.getByTestId(`chain-button-${c.id.toLowerCase()}`)).toContainText(
          c.name
        )
      }
      await shots.take(page, `t${turns}-${phase === PHASE.found ? 'found' : 'survivor'}`)
      const btn = selector.locator('[data-testid^="chain-button-"]:enabled').first()
      const id = ((await btn.getAttribute('data-testid')) ?? '').replace('chain-button-', '')
      const chain = rs.chains.find((c) => c.id.toLowerCase() === id)!
      log(`turn ${turns}: ${phase} -> ${chain.name}`)
      await btn.click()
      await expect(phaseBanner).not.toHaveText(phase)
      if (phase === PHASE.found) {
        founded += 1
        await expect(page.getByTestId(`portfolio-row-${id}`)).toContainText(chain.name)
      }
      await shots.take(page, `t${turns}-chose-${id}`)
    } else if (phase === PHASE.dispose) {
      const form = page.getByTestId('merger-disposition')
      await expect(form).toBeVisible()
      await expect(form).toContainText(t.share_noun_plural)
      await shots.take(page, `t${turns}-disposition`)
      log(`turn ${turns}: dispose (hold all)`)
      await form.getByTestId('confirm-disposition').click()
      await expect(form).toBeHidden()
      await shots.take(page, `t${turns}-disposed`)
    } else if (phase === PHASE.buy) {
      await expect(page.getByTestId('purchase-shares')).toContainText(
        `/${rs.max_stock_purchases_per_turn} ${t.share_noun_plural}`
      )
      const rows = page.locator('[data-testid^="buy-row-"]')
      for (const row of await rows.all()) {
        const text = (await row.textContent()) ?? ''
        expect(
          [...chainNames].some((n) => text.includes(n)),
          `buy row names: ${text}`
        ).toBe(true)
      }
      await shots.take(page, `t${turns}-buy`)
      let buying = false
      for (const row of await rows.all()) {
        const plus = row.getByTestId('stepper-increment')
        if (await plus.isEnabled()) {
          await plus.click()
          buying = true
          log(`turn ${turns}: buy 1 ${(await row.getAttribute('data-testid'))?.slice(8)}`)
          break
        }
      }
      const cashBefore = (await page.getByTestId('header-cash').textContent()) ?? ''
      await shots.take(page, `t${turns}-buy-chosen`)
      const end = page.getByTestId('end-turn-button')
      await expect(end).toHaveText(buying ? 'BUY & END TURN' : 'SKIP & END TURN')
      await end.click()
      await expect(phaseBanner).not.toHaveText(PHASE.buy)
      if (buying) {
        bought += 1
        await expect(page.getByTestId('header-cash')).not.toHaveText(cashBefore)
      }
      await shots.take(page, `t${turns}-ended`)
    }
  }

  log(`done: ${turns} turns, founded ${founded}, bought ${bought}; phases ${[...seenPhases]}`)
  expect(turns).toBeGreaterThanOrEqual(MIN_HUMAN_TURNS)
  expect(founded, 'founded a chain').toBeGreaterThan(0)
  expect(bought, 'bought shares').toBeGreaterThan(0)
  await shots.take(page, 'played')

  // -- Transcript viewer for this game -------------------------------------------------------
  await page.goto('/')
  await page.getByTestId('games-link').click()
  const row = page.locator('[data-testid^="game-row-"]', { hasText: 'Alice' }).first()
  await expect(row).toBeVisible()
  await expectNoDefaultText(page, 'games list')
  await shots.take(page, 'games-list')
  await row.locator('a').first().click()
  const viewer = page.getByTestId('transcript-viewer')
  await expect(viewer).toBeVisible()
  await expect(viewer).toHaveAttribute('data-ruleset', rs.id)
  await page.getByTestId('step-last').click()
  await expectBoard(page, rs)
  const chainTable = page.getByTestId('chain-table')
  await expect(chainTable).toBeVisible()
  const tableText = (await chainTable.textContent()) ?? ''
  expect(
    [...chainNames].some((n) => tableText.includes(n)),
    'chain names in replay'
  ).toBe(true)
  await expectNoDefaultText(page, 'transcript viewer')
  await shots.take(page, 'transcript-last-step')
  // Step back through a few decisions: every event sentence uses the theme's names.
  for (let i = 0; i < 6; i++) {
    await page.getByTestId('step-prev').click()
    await expectNoDefaultText(page, `transcript step -${i + 1}`)
  }
  await shots.take(page, 'transcript-earlier-step')

  expect(errors, 'browser console errors').toEqual([])
})
