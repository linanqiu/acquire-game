/**
 * A game ruleset as served by the backend (`GET /api/config/game`, `game_state.ruleset`,
 * transcript header `ruleset`). Source of truth: backend/game/ruleset.py and the "Ruleset"
 * section of docs/architecture/seat-contract.md.
 *
 * Everything a player sees that is specific to one game variant (title, wording, board size,
 * chains, prices, limits) comes from here. Chain ids are opaque strings.
 */

/** Chain id as used in state and on the wire (opaque: never parse or case-map it). */
export type ChainId = string

export interface RulesetTheme {
  chain_noun: string
  chain_noun_plural: string
  share_noun: string
  share_noun_plural: string
  /** Heading for holdings ("Stocks", "Equity", ...). */
  stock_label: string
  merger_noun: string
  merger_noun_plural: string
  /** What a chain too big to be taken over is called ("safe"). */
  safe_phrase: string
  currency_symbol: string
  tagline: string
  game_description: string
}

export interface PriceBracket {
  /** Smallest chain size this price applies to. */
  from: number
  price: number
}

export interface TierSpec {
  id: string
  label: string
  prices: PriceBracket[]
}

export interface ChainSpec {
  id: ChainId
  name: string
  tier: string
  /** `#RRGGBB` */
  color: string
  /** 1-3 alphanumerics */
  abbreviation: string
}

export interface Ruleset {
  id: string
  version: number
  title: string
  theme: RulesetTheme
  board: { columns: number; rows: number }
  /** Cheapest first. */
  tiers: TierSpec[]
  /** Display / state order. */
  chains: ChainSpec[]
  bonuses: { majority_multiplier: number; minority_multiplier: number; tie_round_up_to: number }
  stocks_per_chain: number
  starting_cash: number
  hand_size: number
  max_stock_purchases_per_turn: number
  safe_chain_size: number
  end_game_chain_size: number
  founder_bonus_shares: number
  merger_trade_ratio: number
  min_players: number
  max_players: number
  max_pending_trades_per_player: number
  /** First 12 hex chars of the SHA-256 of the canonical dict (absent in the built-in fallback). */
  fingerprint?: string
}
