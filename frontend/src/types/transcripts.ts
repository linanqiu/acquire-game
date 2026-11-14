/**
 * Game transcript and Acquire Bench wire types.
 * Source of truth: docs/architecture/seat-contract.md, "Game transcripts and Acquire Bench".
 */

import type { ChainName, SeatKind } from './api'

export type GameSource = 'live' | 'bench'
export type GameStatus = 'live' | 'finished' | 'abandoned'

export interface SummarySeat {
  player_id: string
  name: string
  kind: SeatKind
  agent_label: string | null
  model: string | null
}

/** One row of `GET /games`. */
export interface GameSummary {
  game_id: string
  source: GameSource
  status: GameStatus
  started_at: string
  ended_at: string | null
  room_code: string | null
  series_id: string | null
  seats: SummarySeat[]
  winners: string[]
  turns: number
}

export interface Standing {
  player_id: string
  name: string
  rank: number
  score: number
}

export interface SeatTotals {
  decisions: number
  llm_calls: number
  retries: number
  fallbacks: number
  input_tokens: number
  output_tokens: number
  cost_usd: number | null
  latency_s: number
}

/** `GET /games/{id}`. */
export interface GameDetail extends GameSummary {
  standings: Standing[]
  totals: Record<string, SeatTotals>
}

export interface GamesResponse {
  games: GameSummary[]
}

// -- Transcript ---------------------------------------------------------------

export interface TranscriptSeat extends SummarySeat {
  agent_id: string | null
}

export interface TranscriptHeader {
  type?: 'header'
  transcript_version: number
  game_id: string
  source: GameSource
  room_code: string | null
  bench: { series_id: string; matchup: string; seed: number; rotation: number } | null
  started_at: string
  seed: number | null
  seats: TranscriptSeat[]
  prompt_version: string
  system_prompts: Record<string, string>
}

export interface TranscriptFooter {
  type?: 'footer'
  ended_at: string
  reason: 'declared' | 'no_playable_tiles' | 'forced' | 'abandoned' | string
  standings: Standing[]
  totals: Record<string, SeatTotals>
}

/** An engine event as stored (verbatim from `game.events`). */
export interface EngineEvent {
  seq: number
  type: string
  player_id: string | null
  private_to: string | null
  [key: string]: unknown
}

export type DecisionSource = 'human' | 'bot' | 'scripted' | 'llm' | 'fallback'

export interface LlmAttempt {
  /** Absent in redacted transcripts. */
  raw?: string
  parsed: Record<string, unknown> | null
  error: string | null
  latency_s: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  /** Absent in redacted transcripts. */
  retry_prompt?: string | null
}

export interface LlmRecord {
  model: string
  system_prompt_id: string
  /** Absent in redacted transcripts. */
  user_prompt?: string
  attempts: LlmAttempt[]
  /** Absent in redacted transcripts. */
  why?: string | null
  note?: string | null
}

export interface DecisionEntry {
  type: 'decision'
  index: number
  after_seq: number
  player_id: string
  kind: string
  legal: Record<string, unknown>
  action: Record<string, unknown>
  source: DecisionSource
  fallback: { reason: string; message: string } | null
  latency_s: number
  llm: LlmRecord | null
}

export interface PublicChain {
  active: boolean
  size: number
  stock_price: number
  available_stocks: number
  safe: boolean
  color?: string
}

export interface PublicPlayer {
  player_id: string
  name: string
  money: number
  tile_count: number
  stocks: Record<string, number>
  is_bot?: boolean
}

/** `game.get_public_state()`. */
export interface PublicState {
  phase: string
  current_player: string | null
  board: { cells: Record<string, { state: 'played' | 'in_chain'; chain: ChainName | null }> }
  chains: Record<string, PublicChain>
  players: PublicPlayer[]
  tiles_remaining: number
  merger_state?: Record<string, unknown> | null
  pending_trades?: unknown[]
  [key: string]: unknown
}

export interface StateEntry {
  type: 'state'
  after_seq: number
  public: PublicState
}

/**
 * An entry of `transcript.entries`. Engine events are stored verbatim, so their own
 * `type` (e.g. `tile_placed`) is the discriminator; `{type:"event", event:{...}}` is
 * also accepted (see `normalizeEntries`).
 */
export type TranscriptEntry = DecisionEntry | StateEntry | EngineEvent

export interface Transcript {
  header: TranscriptHeader
  entries: TranscriptEntry[]
  footer: TranscriptFooter | null
  redacted: boolean
}

// -- Leaderboard --------------------------------------------------------------

export interface BenchProtocol {
  id: string
  description: string
  players: number
  games_per_matchup: number
  seeds: number[]
}

export interface LeaderboardAgent {
  agent_id: string
  label: string
  model: string | null
  games: number
  wins: number
  win_rate: number
  ci_low: number
  ci_high: number
  mean_rank: number
  rating: number
  rating_ci: [number, number]
  fallback_rate: number
  retry_rate: number
  tokens_per_game: number
  cost_per_game: number | null
  latency_p50_s: number | null
  verdict: string
}

export interface BenchSeriesRow {
  series_id: string
  matchup: string
  games: number
  started_at: string
  finished: boolean
}

export interface Leaderboard {
  protocol: BenchProtocol
  updated_at: string | null
  agents: LeaderboardAgent[]
  series: BenchSeriesRow[]
}

export interface SeriesGame {
  game_id: string
  seed: number
  rotation: number
  standings: Standing[]
}

export interface SeriesDetail {
  series_id: string
  matchup: string
  protocol: string
  games: SeriesGame[]
}
