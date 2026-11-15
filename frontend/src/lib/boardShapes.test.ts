import { describe, expect, it } from 'vitest'
import { chainShapes, joinAttr, type SquareContent } from './boardShapes'

/** Grid from rows of strings: '.' empty, 'o' orphan, any other letter a chain id. */
function grid(...rows: string[]): SquareContent[][] {
  return rows.map((row) => [...row].map((ch) => (ch === '.' ? null : ch === 'o' ? 'orphan' : ch)))
}

const anchors = (shapes: ReturnType<typeof chainShapes>) =>
  shapes.flatMap((row, r) => row.flatMap((s, c) => (s.anchor ? [[r, c]] : [])))

describe('chainShapes', () => {
  it('joins horizontal and vertical neighbours of the same chain only', () => {
    const s = chainShapes(grid('AAB', 'A.B', '...'))
    expect(joinAttr(s[0][0])).toBe('e s')
    expect(joinAttr(s[0][1])).toBe('w')
    // B touches A on its left but is another chain: no join that way.
    expect(joinAttr(s[0][2])).toBe('s')
    expect(joinAttr(s[1][2])).toBe('n')
    expect(joinAttr(s[1][0])).toBe('n')
  })

  it('never joins orphans or empty squares, and they have no anchor', () => {
    const s = chainShapes(grid('oo', 'o.'))
    for (const row of s) for (const sq of row) expect(sq).toMatchObject({ anchor: false })
    expect(s.flat().map(joinAttr)).toEqual(['', '', '', ''])
  })

  it('does not join a chain to an orphan next to it', () => {
    const s = chainShapes(grid('Ao'))
    expect(joinAttr(s[0][0])).toBe('')
    expect(s[0][0].anchor).toBe(true)
  })

  it('labels each connected group once, near its centre', () => {
    // A straight chain of five: the middle square.
    let s = chainShapes(grid('AAAAA'))
    expect(anchors(s)).toEqual([[0, 2]])
    expect(s[0][2]).toMatchObject({ dx: 0, dy: 0 })

    // Two chains, one anchor each.
    s = chainShapes(grid('AA.', '..B', '..B'))
    expect(anchors(s)).toEqual([
      [0, 0],
      [1, 2],
    ])
  })

  it('nudges a 2-square or 2x2 label to the middle of the shape, never outside it', () => {
    let s = chainShapes(grid('AA'))
    expect(s[0][0]).toMatchObject({ anchor: true, dx: 0.5, dy: 0 })
    s = chainShapes(grid('A', 'A'))
    expect(s[0][0]).toMatchObject({ anchor: true, dx: 0, dy: 0.5 })
    s = chainShapes(grid('AA', 'AA'))
    expect(s[0][0]).toMatchObject({ anchor: true, dx: 0.5, dy: 0.5 })
    // An L: the centre is off the corner square's joined sides in neither direction beyond half.
    s = chainShapes(grid('A..', 'AAA'))
    const [[r, c]] = anchors(s)
    expect(Math.abs(s[r][c].dx)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(s[r][c].dy)).toBeLessThanOrEqual(0.5)
    if (s[r][c].dy < 0) expect(s[r][c].n).toBe(true)
  })

  it('works on any board size, including ragged or empty grids', () => {
    expect(chainShapes([])).toEqual([])
    const big = Array.from({ length: 12 }, () => 'A'.repeat(15))
    const s = chainShapes(grid(...big))
    expect(anchors(s)).toHaveLength(1)
    expect(joinAttr(s[5][7])).toBe('n e s w')
    expect(joinAttr(s[0][0])).toBe('e s')
    expect(joinAttr(s[11][14])).toBe('n w')
  })

  it('keeps the label centred in its square for an L shape (the centre is an inner corner)', () => {
    // 11E 12E / . 12F as seen on a phone: the nudged label sat on the notch of the L.
    const s = chainShapes([
      ['a', 'a'],
      [null, 'a'],
    ])
    const anchors = s.flat().filter((q) => q.anchor)
    expect(anchors).toHaveLength(1)
    expect(anchors[0]).toMatchObject({ dx: 0, dy: 0 })
  })
})
