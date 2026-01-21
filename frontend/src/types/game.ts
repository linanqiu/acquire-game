/**
 * Game-specific types for UI components
 *
 * Note: The backend sends board state as:
 *   { cells: { "1A": { state: "played", chain: null }, "2B": { state: "in_chain", chain: "American" } } }
 *
 * TileState here uses semantic states ('empty'/'orphan'/'chain') for UI rendering.
 * Transformation from backend format should happen in the game store (RT-002).
 *
 * Transformation logic:
 *   - If tile not in cells → { state: 'empty' }
 *   - If cell.state === "played" && chain === null → { state: 'orphan' }
 *   - If cell.state === "in_chain" && chain !== null → { state: 'chain', chain: ChainName }
 */

import type { ChainName } from './api'

// Coordinate format: column (1-12) + row (A-I), e.g., "1A", "12I"
export type Coordinate = `${number}${string}`

// Tile state on the board
export type TileBoardState = 'empty' | 'orphan' | 'chain'

// Tile visual state for rendering
export type TileVisualState =
  | 'default'
  | 'selected'
  | 'disabled'
  | 'merger'
  | 'dead'
  | 'highlighted'

// Board tile state representation
export interface TileState {
  state: TileBoardState
  chain?: ChainName
}

// Board constants
export const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const
export const COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

export type RowLabel = (typeof ROWS)[number]
export type ColNumber = (typeof COLS)[number]
