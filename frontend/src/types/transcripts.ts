/**
 * Game transcript and Buyout Bench wire types.
 * Source of truth: docs/architecture/seat-contract.md, "Game transcripts and Buyout Bench".
 */

import type { ChainId, SeatKind } from './api'
import type { Ruleset } from './ruleset'

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
  /** Attempts that got a model answer (`raw` not null). */
  llm_calls: number
  /** Attempts with a non-null error (rejected or cut off). */
  retries: number
  fallbacks: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  /** 0 for seats that used no tokens, null when a price is unknown. */
  cost_usd: number | null
  latency_s: number
}

/** `header.bench` of a benchmark game. */
export interface BenchHeader {
  series_id: string
  matchup: string
  seed: number
  rotation: number
  protocol?: string
  track?: string
  prompt_version?: string
  series_games?: number
  seating_index?: number
  lineup?: string[]
}

export interface GamesResponse {
  games: GameSummary[]
  /** `before` cursor for the next page; null on the last page. */
  next: string | null
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
  bench: BenchHeader | null
  started_at: string
  /** Null while the game is unfinished (it would determine every hand). */
  seed: number | null
  tile_order?: string[] | null
  seats: TranscriptSeat[]
  prompt_version: string
  system_prompts: Record<string, string>
  /** True for a transcript that starts at a loaded snapshot (test mode), not at a deal. */
  loaded_from_snapshot?: boolean
  /** The game's ruleset (current backends); older transcripts were all default. */
  ruleset?: Ruleset | null
  start_seq?: number
}

export interface TranscriptFooter {
  type?: 'footer'
  ended_at: string
  reason: 'declared' | 'no_playable_tiles' | 'forced' | 'abandoned' | string
  detail?: string
  standings: Standing[]
  totals: Record<string, SeatTotals>
}

/** An engine event (the `event` of a `{"type":"event","event":{...}}` line, verbatim). */
export interface EngineEvent {
  seq: number
  type: string
  player_id: string | null
  private_to: string | null
  [key: string]: unknown
}

export type DecisionSource = 'human' | 'bot' | 'scripted' | 'llm' | 'fallback'

export interface LlmAttempt {
  /** Absent in redacted transcripts; null when the attempt was cut off by the timeout. */
  raw?: string | null
  /** Always null in redacted transcripts. */
  parsed: Record<string, unknown> | null
  /** In redacted transcripts a generic text when rejected. */
  error: string | null
  /** Only in redacted transcripts: whether the attempt was rejected. */
  rejected?: boolean
  latency_s: number | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens?: number
  /** Absent in redacted transcripts. */
  retry_prompt?: string | null
}

export interface LlmRecord {
  model: string
  /** Empty for a forced decision. */
  system_prompt_id: string
  /** A prompt not in the header (a custom agent) is stored inline. */
  system_prompt?: string
  /** Absent in redacted transcripts. */
  user_prompt?: string
  attempts: LlmAttempt[]
  /** Absent in redacted transcripts. */
  why?: string | null
  note?: string | null
  /** 'forced': nothing to decide, so no model call was made (no attempts, no prompts). */
  outcome?: 'answered' | 'failed' | 'forced'
  /** Why the agent gave up (absent in redacted transcripts). */
  error?: string
}

export interface DecisionEntry {
  type: 'decision'
  index: number
  after_seq: number
  player_id: string
  kind: string
  /** Null for an out-of-turn action (a trade proposal/cancel). `tiles` is absent in redacted transcripts. */
  legal: Record<string, unknown> | null
  action: Record<string, unknown>
  source: DecisionSource
  /** `detail` (the raw failure) is absent in redacted transcripts. */
  fallback: { reason: string; message: string; detail?: string } | null
  /** Null for humans. */
  latency_s: number | null
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
  board: { cells: Record<string, { state: 'played' | 'in_chain'; chain: ChainId | null }> }
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

export interface EventEntry {
  type: 'event'
  event: EngineEvent
}

/** A table-chat message, in order with the events (`after_seq`: -1 in the lobby). */
export interface ChatEntry {
  type: 'chat'
  id: number
  player_id: string
  name: string
  kind: string
  source: 'human' | 'say' | 'reply'
  text: string
  at: string
  after_seq: number
  reply_to: number | null
  /** The decision a `say` was posted with. */
  decision_index: number | null
}

/** One off-turn table-talk call of an LLM seat (its tokens count in the totals). */
export interface ChatReplyEntry {
  type: 'chat_reply'
  after_seq: number
  player_id: string
  trigger: { source: string; message_id: number | null; events: string[] } | null
  reply_to: number | null
  outcome: 'replied' | 'silent' | 'failed' | 'dropped'
  message_id: number | null
  latency_s: number | null
  llm: Record<string, unknown> | null
}

/** An entry of `transcript.entries`, in file order: `decision -> its events -> state`. */
/**
 * A line of the commentator (docs/ai/commentary.md), in order with the events. `text` is null
 * when a model call produced nothing that was said (`outcome` silent / dropped).
 */
export interface CommentaryEntry {
  type: 'commentary'
  id: number | null
  text: string | null
  source: 'model' | 'rules' | null
  turn?: number
  after_seq: number
  moments: string[]
  outcome: 'model' | 'rules' | 'silent' | 'dropped'
  llm?: {
    model?: string | null
    cost_usd?: number | null
    attempts?: LlmAttempt[]
  } | null
}

export type TranscriptEntry =
  | DecisionEntry
  | StateEntry
  | EventEntry
  | ChatEntry
  | ChatReplyEntry
  | CommentaryEntry

export interface Transcript {
  header: TranscriptHeader
  entries: TranscriptEntry[]
  footer: TranscriptFooter | null
  redacted: boolean
  /** Footer-shaped totals so far; only while the game is unfinished. */
  live_totals?: Record<string, SeatTotals>
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
  /** Seat-games (a vs-baseline game has three rules-based seats). */
  seat_games: number
  wins: number
  win_rate: number
  ci_low: number
  ci_high: number
  mean_rank: number
  rating: number
  /** Null when there is nothing to bootstrap (e.g. the anchor). */
  rating_ci: [number, number] | null
  fallback_rate: number
  retry_rate: number
  tokens_per_game: number
  cost_per_game: number | null
  latency_p50_s: number | null
  verdict: string
  decisions: number
  /** The rating anchor (the rules-based bot, fixed at 1500). */
  is_anchor: boolean
}

export type BenchTrack = 'all' | 'vs-baseline' | 'head-to-head'

export interface BenchSeriesRow {
  series_id: string
  matchup: string
  track: string | null
  games: number
  /** Games the series is meant to have. */
  planned: number | null
  started_at: string
  finished: boolean
  /** True when the series ran the protocol's full game count. */
  full_protocol: boolean
}

export interface Leaderboard {
  protocol: BenchProtocol
  prompt_version: string | null
  track: BenchTrack
  updated_at: string | null
  games: number
  agents: LeaderboardAgent[]
  series: BenchSeriesRow[]
  available: { protocols: string[]; prompt_versions: string[] }
  rating: { method: string; anchor: string; anchor_rating: number; prior: string }
  /** Shown verbatim. */
  warnings: string[]
}

export interface SeriesGame {
  game_id: string | null
  seed: number
  /** Seating index. */
  rotation: number
  /** The bench runner's status (`completed` or `aborted`). */
  status: string | null
  seat_order: string[] | null
  standings: SeriesStanding[]
}

export interface SeriesStanding {
  player_id: string
  name: string | null
  agent_id: string | null
  /** Ties share an average rank (e.g. 1.5). */
  rank: number
  score: number
}

export interface SeriesDetail {
  series_id: string
  matchup: string
  protocol: string
  track: string | null
  prompt_version: string | null
  planned: number | null
  games: SeriesGame[]
}
