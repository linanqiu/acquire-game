// Re-export API types for WebSocket integration
// Note: chain ids (ChainId) are opaque strings from the game's ruleset.
//
// Type hierarchy:
//   - api.ts: Wire format types (what backend sends over WebSocket)
//   - index.ts: Client-side game state types (for store/state management)
//   - game.ts: UI-specific types (for component rendering)
//
// Transformation from api.ts types to these types happens in RT-002 (Real-time Integration)
export * from './api'
export * from './transcripts'
export * from './ruleset'

// Player's stock holdings, keyed by chain id
import type { ChainId } from './ruleset'
export type Stocks = Record<ChainId, number>

// Tile identifier (e.g., "1A", "12I")
export type TileId = string

// Board cell state
export type CellState = ChainId | 'unincorporated' | null

// The game board
export type Board = Record<TileId, CellState>

// Chain information
export interface Chain {
  name: ChainId
  tiles: TileId[]
  size: number
}

// Chains on the board
export type Chains = Partial<Record<ChainId, Chain>>

// Player information
export interface Player {
  id: string
  name: string
  cash: number
  stocks: Stocks
  tiles: TileId[]
}

// Game phases
export type GamePhase =
  | 'waiting'
  | 'place_tile'
  | 'found_chain'
  | 'buy_stock'
  | 'merger_choose_survivor'
  | 'merger_dispose_stock'
  | 'game_over'

// Game state
export interface GameState {
  phase: GamePhase
  currentPlayer: number
  players: Player[]
  board: Board
  chains: Chains
  tilePool: number
}

// Room state
export interface RoomState {
  id: string
  name: string
  players: Player[]
  gameState: GameState | null
  status: 'waiting' | 'in_progress' | 'finished'
}

// WebSocket message types
export type MessageType =
  | 'room_joined'
  | 'room_updated'
  | 'game_started'
  | 'game_state'
  | 'game_over'
  | 'error'

export interface WebSocketMessage {
  type: MessageType
  payload: unknown
}
