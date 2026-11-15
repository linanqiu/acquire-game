import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Board } from './Board'
import { RulesetScope } from '../../ruleset/RulesetScope'
import { transformBoardToTileStates } from '../../utils/transforms'
import { playedGame, playerState, rulesetOf } from '../../../tests/unit/fixtures/wire'

/** The board of a real server state, drawn with that state's own ruleset. */
function drawBoard(state, props = {}) {
  const tiles = transformBoardToTileStates(state.board.cells)
  render(
    <RulesetScope ruleset={state.ruleset}>
      <Board tiles={tiles} {...props} />
    </RulesetScope>
  )
  return tiles
}

describe('Board', () => {
  it('draws every square the ruleset has, labelled by column and row', () => {
    for (const name of ['default', 'valley', 'mini']) {
      const state = playedGame(name).states['place_tile/place_tile']
      const { columns, rows } = rulesetOf(name).board
      const { unmount } = render(
        <RulesetScope ruleset={state.ruleset}>
          <Board tiles={{}} />
        </RulesetScope>
      )
      expect(screen.getAllByTestId(/^tile-/), name).toHaveLength(columns * rows)
      const board = screen.getByTestId('board')
      expect(board).toHaveAttribute('data-columns', String(columns))
      expect(board).toHaveAttribute('data-rows', String(rows))
      const lastRow = 'ABCDEFGHIJKL'[rows - 1]
      expect(screen.getByTestId(`tile-${columns}${lastRow}`)).toBeInTheDocument()
      expect(screen.queryByTestId(`tile-${columns + 1}A`)).not.toBeInTheDocument()
      unmount()
    }
  })

  it('shows a busy real board as the server has it: chain squares in their chain, orphans apart, the rest empty', () => {
    const state = playerState('six-player-midgame')
    const tiles = drawBoard(state)
    const placed = Object.entries(state.board.cells)
    expect(placed.length).toBeGreaterThan(20)
    for (const [coord, cell] of placed) {
      const expected = cell.state === 'in_chain' ? cell.chain : 'orphan'
      expect(screen.getByTestId(`tile-${coord}`), coord).toHaveAttribute('data-chain', expected)
    }
    const empty = screen
      .getAllByTestId(/^tile-/)
      .filter((t) => t.getAttribute('data-chain') === 'empty')
    expect(empty).toHaveLength(12 * 9 - Object.keys(tiles).length)
  })

  it('when interactive, only empty squares the player may play can be clicked', () => {
    const state = playerState('opening-place-tile')
    const onTileClick = vi.fn()
    const hand = state.your_hand
    drawBoard(state, { interactive: true, onTileClick, playableTiles: new Set(hand.slice(0, 1)) })
    fireEvent.click(screen.getByTestId(`tile-${hand[0]}`))
    expect(onTileClick).toHaveBeenCalledWith(hand[0])
    fireEvent.click(screen.getByTestId(`tile-${hand[1]}`))
    expect(onTileClick).toHaveBeenCalledTimes(1)
  })

  it('an occupied square is never clickable, and a board that is not interactive ignores clicks', () => {
    const state = playerState('six-player-midgame')
    const onTileClick = vi.fn()
    const [occupied] = Object.keys(state.board.cells)
    drawBoard(state, { interactive: true, onTileClick })
    fireEvent.click(screen.getByTestId(`tile-${occupied}`))
    expect(onTileClick).not.toHaveBeenCalled()
  })

  it('without interactive nothing can be clicked', () => {
    const state = playerState('opening-place-tile')
    const onTileClick = vi.fn()
    drawBoard(state, { onTileClick })
    fireEvent.click(screen.getByTestId(`tile-${state.your_hand[0]}`))
    expect(onTileClick).not.toHaveBeenCalled()
  })

  it('draws each chain as one shape: joined sides between same-chain neighbours, one visible label per chain', () => {
    const state = playerState('six-player-midgame')
    drawBoard(state)
    const cells = state.board.cells
    const chainOf = (coord) => (cells[coord]?.state === 'in_chain' ? cells[coord].chain : null)
    const anchorsByChain = {}
    for (const [coord, cell] of Object.entries(cells)) {
      const tile = screen.getByTestId(`tile-${coord}`)
      if (cell.state !== 'in_chain') {
        // Unincorporated tiles stay separate squares.
        expect(tile, coord).not.toHaveAttribute('data-join')
        expect(tile).not.toHaveAttribute('data-anchor')
        continue
      }
      const m = /^(\d+)([A-Z])$/.exec(coord)
      const col = Number(m[1])
      const row = m[2]
      const right = `${col + 1}${row}`
      const below = `${col}${String.fromCharCode(row.charCodeAt(0) + 1)}`
      const joins = (tile.getAttribute('data-join') ?? '').split(' ')
      expect(joins.includes('e'), `${coord} joins right`).toBe(chainOf(right) === cell.chain)
      expect(joins.includes('s'), `${coord} joins below`).toBe(chainOf(below) === cell.chain)
      // Every chain square keeps its abbreviation in the DOM (screen readers, tests).
      expect(tile.textContent).not.toBe('')
      if (tile.getAttribute('data-anchor') === 'true') {
        anchorsByChain[cell.chain] = (anchorsByChain[cell.chain] ?? 0) + 1
      }
    }
    const chains = new Set(
      Object.values(cells)
        .filter((c) => c.state === 'in_chain')
        .map((c) => c.chain)
    )
    expect(chains.size).toBeGreaterThan(1)
    // Chains on a real board are connected, so exactly one label each.
    for (const c of chains) expect(anchorsByChain[c], c).toBe(1)
  })

  it('works for every ruleset board size', () => {
    for (const name of ['default', 'valley', 'mini']) {
      const state = playedGame(name).states['place_tile/place_tile']
      const { unmount } = render(
        <RulesetScope ruleset={state.ruleset}>
          <Board tiles={transformBoardToTileStates(state.board.cells)} />
        </RulesetScope>
      )
      const anchors = document.querySelectorAll('[data-anchor="true"]')
      const chains = new Set(
        Object.values(state.board.cells)
          .filter((c) => c.state === 'in_chain')
          .map((c) => c.chain)
      )
      expect(anchors.length, name).toBe(chains.size)
      unmount()
    }
  })
})
