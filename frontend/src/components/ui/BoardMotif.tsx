import type { ChainSpec } from '../../types/ruleset'

/**
 * A small decorative board for the home page: a few chain shapes in the ruleset's own colours
 * (whatever the theme), drawn the way the game board draws them (joined squares, rounded outer
 * corners), plus a couple of unincorporated tiles. Pure SVG, no image files; hidden from
 * screen readers.
 */
const COLS = 11
const ROWS = 5
const CELL = 14
const GAP = 3
const STEP = CELL + GAP

/** Shapes as [col, row] lists; each takes the next chain colour. */
const SHAPES: [number, number][][] = [
  [
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  [
    [4, 0],
    [5, 0],
    [4, 1],
    [5, 1],
  ],
  [
    [7, 1],
    [7, 2],
    [7, 3],
    [8, 3],
  ],
  [
    [1, 3],
    [2, 3],
    [2, 4],
  ],
  [
    [9, 0],
    [10, 0],
  ],
  [
    [4, 3],
    [5, 3],
    [5, 4],
  ],
  [
    [10, 2],
    [10, 3],
  ],
]
const ORPHANS: [number, number][] = [
  [3, 2],
  [9, 1],
  [0, 4],
]

export function BoardMotif({ chains }: { chains: ChainSpec[] }) {
  const used = new Set<string>()
  const shapes = chains.length
    ? SHAPES.slice(0, Math.max(3, Math.min(SHAPES.length, chains.length))).map((cells, i) => ({
        color: chains[i % chains.length].color,
        cells,
      }))
    : []
  for (const s of shapes) for (const [c, r] of s.cells) used.add(`${c},${r}`)
  for (const [c, r] of ORPHANS) used.add(`${c},${r}`)

  const w = COLS * STEP - GAP
  const h = ROWS * STEP - GAP
  const empties: [number, number][] = []
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) if (!used.has(`${c},${r}`)) empties.push([c, r])

  return (
    <svg
      className="board-motif"
      viewBox={`-4 -4 ${w + 8} ${h + 8}`}
      width={w + 8}
      height={h + 8}
      aria-hidden="true"
      focusable="false"
      data-testid="home-motif"
    >
      <rect x={-4} y={-4} width={w + 8} height={h + 8} rx={6} fill="var(--bg-tertiary)" />
      {empties.map(([c, r]) => (
        <rect
          key={`e${c}-${r}`}
          x={c * STEP}
          y={r * STEP}
          width={CELL}
          height={CELL}
          rx={2.5}
          fill="var(--board-square)"
        />
      ))}
      {ORPHANS.map(([c, r]) => (
        <rect
          key={`o${c}-${r}`}
          x={c * STEP}
          y={r * STEP}
          width={CELL}
          height={CELL}
          rx={2.5}
          fill="var(--chain-orphan)"
        />
      ))}
      {shapes.map(({ color, cells }, i) => {
        const has = (c: number, r: number) => cells.some(([x, y]) => x === c && y === r)
        return (
          <g key={i} fill={color}>
            {cells.map(([c, r]) => (
              <rect
                key={`${c}-${r}`}
                x={c * STEP}
                y={r * STEP}
                width={CELL + (has(c + 1, r) ? GAP : 0)}
                height={CELL + (has(c, r + 1) ? GAP : 0)}
                rx={has(c + 1, r) || has(c, r + 1) || has(c - 1, r) || has(c, r - 1) ? 0 : 2.5}
              />
            ))}
          </g>
        )
      })}
    </svg>
  )
}
