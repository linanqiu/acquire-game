/**
 * Rendering cost of the board (BL-020): a state that does not touch the board redraws no
 * square, and one placed tile redraws a handful of squares, not all of them. Counted through
 * `useRules`, which the board and every square call once per render.
 */
import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Board } from './Board'
import { RulesetScope } from '../../ruleset/RulesetScope'
import { rulesFor } from '../../ruleset/useRules'
import { transformBoardToTileStates } from '../../utils/transforms'
import { playedGame } from '../../../tests/unit/fixtures/wire'
import type { Coordinate } from '../../types/game'

const renders = vi.hoisted(() => ({ n: 0 }))
vi.mock('../../ruleset/useRules', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../ruleset/useRules')>()
  return {
    ...mod,
    useRules: () => {
      renders.n++
      return mod.useRules()
    },
  }
})

describe('Board render cost', () => {
  it('redraws only what changed', () => {
    const state = playedGame('default').states['buy_stocks/with_chains']
    const tiles = transformBoardToTileStates(state.board.cells)
    const squares = state.ruleset.board.columns * state.ruleset.board.rows
    const draw = (t: typeof tiles, onTileClick: (c: Coordinate) => void) => (
      <RulesetScope ruleset={state.ruleset}>
        <Board tiles={t} size="lg" interactive onTileClick={onTileClick} />
      </RulesetScope>
    )

    renders.n = 0
    const { rerender } = render(draw(tiles, () => {}))
    expect(renders.n).toBe(1 + squares)

    // A new state that leaves the board alone (same tiles object from the store), with a new
    // click handler from the page: the board itself may run, its squares do not.
    renders.n = 0
    rerender(draw(tiles, () => {}))
    expect(renders.n).toBeLessThanOrEqual(1)

    // One tile placed on an empty square: that square (and at most its neighbours' joins).
    const { rows, cols } = rulesFor(state.ruleset)
    const empty = rows.flatMap((r) => cols.map((c) => `${c}${r}`)).find((c) => !tiles[c])
    expect(empty, 'an empty square on the recorded board').toBeTruthy()
    renders.n = 0
    rerender(draw({ ...tiles, [empty!]: { state: 'orphan' } }, () => {}))
    expect(renders.n).toBeGreaterThanOrEqual(2)
    expect(renders.n).toBeLessThanOrEqual(1 + 5)
  })
})
