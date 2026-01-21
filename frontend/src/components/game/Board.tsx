import { Tile } from './Tile'
import styles from './Board.module.css'
import type { Coordinate, TileState } from '../../types/game'
import { ROWS, COLS } from '../../types/game'

interface BoardProps {
  /** 9 rows x 12 cols tile state matrix, or a sparse object mapping coordinates to states */
  tiles: TileState[][] | Record<string, TileState>
  highlightedTile?: Coordinate
  onTileClick?: (coord: Coordinate) => void
  size?: 'sm' | 'md' | 'lg'
  interactive?: boolean
  /** Set of coordinates that are playable (for highlighting valid moves) */
  playableTiles?: Set<string>
}

/**
 * Get tile state from either matrix or object format
 */
function getTileState(
  tiles: TileState[][] | Record<string, TileState>,
  coord: Coordinate,
  rowIdx: number,
  colIdx: number
): TileState {
  if (Array.isArray(tiles)) {
    return tiles[rowIdx]?.[colIdx] ?? { state: 'empty' }
  }
  return tiles[coord] ?? { state: 'empty' }
}

export function Board({
  tiles,
  highlightedTile,
  onTileClick,
  size = 'md',
  interactive = false,
  playableTiles,
}: BoardProps) {
  return (
    <div className={`${styles.board} ${styles[size]}`} data-testid="board">
      {/* Column headers */}
      <div className={styles.header}>
        <div className={styles.corner} />
        {COLS.map((col) => (
          <div key={col} className={styles.colLabel}>
            {col}
          </div>
        ))}
      </div>

      {/* Grid rows */}
      {ROWS.map((row, rowIdx) => (
        <div key={row} className={styles.row}>
          <div className={styles.rowLabel}>{row}</div>
          {COLS.map((col, colIdx) => {
            const coord = `${col}${row}` as Coordinate
            const tileState = getTileState(tiles, coord, rowIdx, colIdx)
            const isHighlighted = highlightedTile === coord
            const isPlayable = playableTiles?.has(coord)
            const isEmpty = tileState.state === 'empty'
            const canClick = interactive && isEmpty && (isPlayable ?? true)

            return (
              <Tile
                key={coord}
                coordinate={coord}
                chain={
                  tileState.state === 'chain'
                    ? tileState.chain
                    : tileState.state === 'orphan'
                      ? 'orphan'
                      : undefined
                }
                state="default"
                highlighted={isHighlighted || isPlayable}
                onClick={canClick && onTileClick ? () => onTileClick(coord) : undefined}
                size={size}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}
