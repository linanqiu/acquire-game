// Re-export API types for WebSocket integration
// Note: ChainName uses Title Case to match backend API ('Luxor', 'Tower', etc.)
//
// Type hierarchy:
//   - api.ts: Wire format types (what backend sends over WebSocket)
//   - index.ts: Client-side game state types (for store/state management)
//   - game.ts: UI-specific types (for component rendering)
//
// Transformation from api.ts types to these types happens in RT-002 (Real-time Integration)
export * from './api'

// Player's stock holdings (uses ChainName from api.ts)
import type { ChainName } from './api'
export type Stocks = Record<ChainName, number>

/**
 * Convert a ChainName to lowercase for CSS class usage.
 * Example: 'Luxor' -> 'luxor' for use with .bg-luxor, .text-luxor classes
 */
export function chainToCssClass(chain: ChainName): string {
  return chain.toLowerCase()
}

// Tile identifier (e.g., "1A", "12L")
export type TileId = string

// Board cell state
export type CellState = ChainName | 'unincorporated' | null

// The game board
export type Board = Record<TileId, CellState>

// Chain information
export interface Chain {
  name: ChainName
  tiles: TileId[]
  size: number
}

// Chains on the board
export type Chains = Partial<Record<ChainName, Chain>>

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
