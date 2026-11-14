/**
 * Game-specific types for UI components
 *
 * Note: The backend sends board state as:
 *   { cells: { "1A": { state: "played", chain: null }, "2B": { state: "in_chain", chain: "Tower" } } }
 *
 * TileState here uses semantic states ('empty'/'orphan'/'chain') for UI rendering.
 * Transformation from backend format should happen in the game store (RT-002).
 *
 * Transformation logic:
 *   - If tile not in cells → { state: 'empty' }
 *   - If cell.state === "played" && chain === null → { state: 'orphan' }
 *   - If cell.state === "in_chain" && chain !== null → { state: 'chain', chain: ChainId }
 */

import type { ChainId } from './api'

// Coordinate format: column number + row letter, e.g., "1A", "12I" (board size from the ruleset)
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
  chain?: ChainId
}

// Board geometry (columns x rows) comes from the ruleset: see lib/ruleset.ts rowLabels/columnLabels.
