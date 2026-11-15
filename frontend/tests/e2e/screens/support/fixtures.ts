/**
 * Snapshot fixture access (generated files; never edited by hand).
 * See frontend/tests/e2e/fixtures/snapshots/README.md.
 */
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SNAPSHOT_DIR = path.resolve(here, '../../fixtures/snapshots')

export interface ExpectedChain {
  available: number
  price: number
  safe: boolean
  size: number
}

export interface ExpectedPlayer {
  player_id: string
  name: string
  cash: number
  holdings: Record<string, number>
  tile_count: number
}

export interface ExpectedDecision {
  kind: string
  player_id: string
  context: Record<string, unknown>
  legal: Record<string, unknown>
}

export interface TradeDict {
  trade_id: string
  from_player_id: string
  to_player_id: string
  offering_stocks: Record<string, number>
  offering_money: number
  requesting_stocks: Record<string, number>
  requesting_money: number
}

export interface Expect {
  phase: string
  current_player: string
  game_over?: unknown
  human: {
    player_id: string
    name: string
    cash: number
    hand: string[]
    holdings: Record<string, number>
    unplayable_tiles: Record<string, string>
  }
  players: ExpectedPlayer[]
  active_chains: Record<string, ExpectedChain>
  inactive_chains: string[]
  decisions: ExpectedDecision[]
  human_decisions: ExpectedDecision[]
  pending_trades: TradeDict[]
  tiles_on_board: number
  tiles_remaining: number
}

export interface Fixture {
  name: string
  human_seat: string
  expect: Expect
  snapshot: Record<string, unknown>
  recipe: unknown
}

export function loadFixture(name: string): Fixture {
  return JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, `${name}.json`), 'utf8')) as Fixture
}

export function dollars(n: number): string {
  return `$${n.toLocaleString('en-US')}`
}
