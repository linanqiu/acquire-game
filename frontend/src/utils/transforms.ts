/**
 * Transformation utilities for converting backend data to UI formats.
 *
 * These functions bridge the gap between backend API formats and
 * frontend component expectations.
 */

import type { BoardCell, TilePlayabilityInfo } from '../types/api'
import type { TileState, Coordinate } from '../types/game'

/**
 * Transform backend board cells to UI tile states.
 *
 * Backend format:
 *   { cells: { "1A": { state: "played", chain: null }, "2B": { state: "in_chain", chain: "American" } } }
 *
 * UI format:
 *   { "1A": { state: 'orphan' }, "2B": { state: 'chain', chain: 'American' } }
 *
 * Transformation rules:
 *   - If tile not in cells → not included (empty by default)
 *   - If cell.state === "played" && chain === null → { state: 'orphan' }
 *   - If cell.state === "in_chain" && chain !== null → { state: 'chain', chain }
 */
export function transformBoardToTileStates(
  cells: Record<string, BoardCell>
): Record<string, TileState> {
  const result: Record<string, TileState> = {}
  for (const [coord, cell] of Object.entries(cells)) {
    if (cell.state === 'played' && cell.chain === null) {
      result[coord] = { state: 'orphan' }
    } else if (cell.state === 'in_chain' && cell.chain !== null) {
      result[coord] = { state: 'chain', chain: cell.chain }
    }
  }
  return result
}

// Playability type matches TileRack component expectations
type Playability = 'playable' | 'merger' | 'temp_unplayable' | 'perm_unplayable'

/**
 * Transform player hand strings to RackTile format.
 *
 * @param hand Array of tile coordinate strings (e.g., ["1A", "2B", "3C"])
 * @param playabilityMap Optional map of tile playability status
 * @returns Array of RackTile objects for TileRack component
 */
export function transformHandToRackTiles(
  hand: string[],
  playabilityMap?: Record<string, Playability>
): { coordinate: Coordinate; playability: Playability }[] {
  return hand.map((tile) => ({
    coordinate: tile as Coordinate,
    playability: playabilityMap?.[tile] ?? 'playable',
  }))
}

/**
 * Transform backend tile playability info to frontend Playability type.
 *
 * Backend format:
 *   { "1A": { playable: false, reason: "would_create_eighth_chain", permanent: true, would_trigger_merger: false } }
 *
 * Frontend format:
 *   { "1A": "perm_unplayable" }
 *
 * Transformation rules:
 *   - If playable === false && permanent === true → "perm_unplayable"
 *   - If playable === false && permanent === false → "temp_unplayable"
 *   - If playable === true && would_trigger_merger === true → "merger"
 *   - If playable === true && would_trigger_merger === false → "playable"
 */
export function transformPlayabilityMap(
  playabilityInfo: Record<string, TilePlayabilityInfo>
): Record<string, Playability> {
  const result: Record<string, Playability> = {}
  for (const [tile, info] of Object.entries(playabilityInfo)) {
    if (!info.playable) {
      result[tile] = info.permanent ? 'perm_unplayable' : 'temp_unplayable'
    } else if (info.would_trigger_merger) {
      result[tile] = 'merger'
    } else {
      result[tile] = 'playable'
    }
  }
  return result
}
