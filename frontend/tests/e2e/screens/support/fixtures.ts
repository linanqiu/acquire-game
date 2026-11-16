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
  /** The table view game_state carries (engine calculator), by snapshot seat id. */
  net_worth: Record<string, { cash: number; stock_value: number; net_worth: number; rank: number }>
  chain_holders: Record<
    string,
    {
      size: number
      price: number
      majority_bonus: number
      minority_bonus: number
      holders: Array<{
        player_id: string
        shares: number
        role: 'majority' | 'minority' | null
        tied: boolean
        majority: number
        minority: number
        bonus: number
      }>
    }
  >
  mergers: Array<{
    seq: number
    player_id: string | null
    tile: string | null
    survivor: string
    sizes: Record<string, number>
    defunct: Array<{
      chain: string
      size: number
      price: number
      bonuses: Array<{ player_id: string; majority: number; minority: number }> | null
      dispositions: Array<{ player_id: string; sell: number; trade: number; hold: number }>
      waiting_on: string[]
    }>
    survivor_size: number | null
    complete: boolean
    /** The survivor after the merger (BL-011), while it is in progress. */
    survivor_after: {
      size: number
      price: number
      majority_bonus: number
      minority_bonus: number
      bank: number
      holders: Array<{
        player_id: string
        shares: number
        received: number
        undecided: boolean
        role: 'majority' | 'minority' | null
        tied: boolean
        bonus: number
      }>
    } | null
  }>
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
