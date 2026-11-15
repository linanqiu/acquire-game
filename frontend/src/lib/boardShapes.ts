/**
 * Chains read as shapes: which sides of a chain square touch another square of the SAME chain,
 * and which square of each connected group carries the chain's abbreviation.
 *
 * Pure geometry over a rows x columns grid of "what is on this square" (a chain id, `orphan`,
 * or nothing), so it works for any board size and any ruleset. The board turns the result into
 * data attributes (`data-join`, `data-anchor`) and CSS joins the squares into one block.
 */

/** What is on one square: a chain id, `'orphan'` (played, in no chain), or null (empty). */
export type SquareContent = string | null

export interface SquareShape {
  /** Neighbour of the same chain above / right / below / left. */
  n: boolean
  e: boolean
  s: boolean
  w: boolean
  /** This square shows the chain's label (one square per connected group). */
  anchor: boolean
  /**
   * Anchor only: where to nudge the label, in squares (-0.5..0.5), towards the group's centre,
   * so a 2-square chain is labelled in the middle. Only towards a joined side: the label never
   * leaves the shape.
   */
  dx: number
  dy: number
}

const NONE: SquareShape = { n: false, e: false, s: false, w: false, anchor: false, dx: 0, dy: 0 }

const clampHalf = (v: number) => Math.max(-0.5, Math.min(0.5, v))

/** A chain square (orphans and empty squares never join: they stay separate tiles). */
function isChain(c: SquareContent): c is string {
  return c !== null && c !== 'orphan'
}

/**
 * Shape of every square, indexed `[row][col]`. Squares that are not part of a chain get
 * `anchor: false` and no joins. For each 4-connected group of one chain, the anchor is the
 * square nearest the group's centre (ties: first in reading order), so the label sits inside
 * the shape rather than on an edge.
 */
export function chainShapes(grid: SquareContent[][]): SquareShape[][] {
  const rows = grid.length
  const at = (r: number, c: number): SquareContent =>
    r >= 0 && r < rows && c >= 0 && c < (grid[r]?.length ?? 0) ? (grid[r][c] ?? null) : null

  const out: SquareShape[][] = grid.map((row, r) =>
    row.map((cell, c) => {
      if (!isChain(cell)) return NONE
      return {
        n: at(r - 1, c) === cell,
        e: at(r, c + 1) === cell,
        s: at(r + 1, c) === cell,
        w: at(r, c - 1) === cell,
        anchor: false,
        dx: 0,
        dy: 0,
      }
    })
  )

  // One anchor per connected group.
  const seen = grid.map((row) => row.map(() => false))
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const chain = grid[r][c]
      if (!isChain(chain) || seen[r][c]) continue
      const group: [number, number][] = []
      const stack: [number, number][] = [[r, c]]
      seen[r][c] = true
      while (stack.length) {
        const [y, x] = stack.pop()!
        group.push([y, x])
        for (const [dy, dx] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          const ny = y + dy
          const nx = x + dx
          if (at(ny, nx) === chain && !seen[ny][nx]) {
            seen[ny][nx] = true
            stack.push([ny, nx])
          }
        }
      }
      const cy = group.reduce((n, [y]) => n + y, 0) / group.length
      const cx = group.reduce((n, [, x]) => n + x, 0) / group.length
      let best = group[0]
      let bestD = Infinity
      for (const [y, x] of group) {
        const d = (y - cy) ** 2 + (x - cx) ** 2
        const tie = Math.abs(d - bestD) < 1e-9
        const earlier = y < best[0] || (y === best[0] && x < best[1])
        if (d < bestD - 1e-9 || (tie && earlier)) {
          best = [y, x]
          bestD = d
        }
      }
      const shape = out[best[0]][best[1]]
      const rawX = clampHalf(cx - best[1])
      const rawY = clampHalf(cy - best[0])
      const dx = (rawX > 0 && shape.e) || (rawX < 0 && shape.w) ? rawX : 0
      const dy = (rawY > 0 && shape.s) || (rawY < 0 && shape.n) ? rawY : 0
      out[best[0]][best[1]] = { ...shape, anchor: true, dx: dx || 0, dy: dy || 0 }
    }
  }
  return out
}

/** `data-join` value: the joined sides, e.g. `"e s"`; empty string when none. */
export function joinAttr(shape: SquareShape): string {
  return (['n', 'e', 's', 'w'] as const).filter((k) => shape[k]).join(' ')
}
