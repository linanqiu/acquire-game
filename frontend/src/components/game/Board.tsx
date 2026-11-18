import { memo, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import { Tile } from './Tile'
import styles from './Board.module.css'
import type { Coordinate, TileState } from '../../types/game'
import { useRules } from '../../ruleset/useRules'
import { chainShapes, joinAttr, type SquareContent } from '../../lib/boardShapes'

interface BoardProps {
  /** rows x columns tile state matrix, or a sparse object mapping coordinates to states */
  tiles: TileState[][] | Record<string, TileState>
  highlightedTile?: Coordinate
  onTileClick?: (coord: Coordinate) => void
  /** Upper bound for the square size; the board always shrinks to fit its container's width. */
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

function contentOf(t: TileState): SquareContent {
  return t.state === 'chain' ? (t.chain ?? null) : t.state === 'orphan' ? 'orphan' : null
}

/**
 * The game board: `columns x rows` from the ruleset. Squares are sized to fit the container's
 * width (and `--board-max-height` when a page sets it), between a per-size minimum and maximum,
 * so any board from 6x6 to 15x12 fits a phone and fills a desktop column.
 */
export const Board = memo(function Board({
  tiles,
  highlightedTile,
  onTileClick,
  size = 'md',
  interactive = false,
  playableTiles,
}: BoardProps) {
  const { rows, cols } = useRules()
  // One stable click handler per square (calling the latest `onTileClick`), so the memoised
  // squares are not all re-rendered for a new handler (BL-020).
  const clickRef = useRef(onTileClick)
  useLayoutEffect(() => {
    clickRef.current = onTileClick
  })
  const handlers = useMemo(() => {
    const out: Record<string, () => void> = {}
    for (const row of rows) {
      for (const col of cols) {
        const coord = `${col}${row}` as Coordinate
        out[coord] = () => clickRef.current?.(coord)
      }
    }
    return out
  }, [rows, cols])
  const gridStyle = { '--cols': cols.length, '--rows': rows.length } as CSSProperties
  // Chains draw as shapes: each square knows which sides touch the same chain (lib/boardShapes).
  const shapes = useMemo(
    () =>
      chainShapes(
        rows.map((row, r) =>
          cols.map((col, c) => contentOf(getTileState(tiles, `${col}${row}` as Coordinate, r, c)))
        )
      ),
    [tiles, rows, cols]
  )
  return (
    <div className={`${styles.frame} ${styles[size]}`}>
      <div
        className={styles.board}
        style={gridStyle}
        data-testid="board"
        data-columns={cols.length}
        data-rows={rows.length}
      >
        <div className={styles.corner} />
        {cols.map((col) => (
          <div key={`c${col}`} className={styles.colLabel}>
            {col}
          </div>
        ))}
        {rows.map((row, rowIdx) => [
          <div key={`r${row}`} className={styles.rowLabel}>
            {row}
          </div>,
          ...cols.map((col, colIdx) => {
            const coord = `${col}${row}` as Coordinate
            const tileState = getTileState(tiles, coord, rowIdx, colIdx)
            const isHighlighted = highlightedTile === coord
            const isPlayable = playableTiles?.has(coord)
            const isEmpty = tileState.state === 'empty'
            const canClick = interactive && isEmpty && (isPlayable ?? true)
            const shape = shapes[rowIdx]?.[colIdx]

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
                picked={isHighlighted && isEmpty}
                onClick={canClick && onTileClick ? handlers[coord] : undefined}
                size="fluid"
                join={tileState.state === 'chain' && shape ? joinAttr(shape) : undefined}
                anchor={shape?.anchor ?? true}
                labelShift={shape?.anchor ? { dx: shape.dx, dy: shape.dy } : undefined}
              />
            )
          }),
        ])}
      </div>
    </div>
  )
})
