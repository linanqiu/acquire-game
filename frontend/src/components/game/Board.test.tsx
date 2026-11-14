import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Board } from './Board'
import type { TileState } from '../../types/game'
import { RulesetScope } from '../../ruleset/RulesetScope'
import { CLASSIC, MINI, VALLEY } from '../../../tests/unit/fixtures/rulesets'

// Helper to create empty tile matrix
function createEmptyTiles(): TileState[][] {
  return Array.from({ length: 9 }, () => Array.from({ length: 12 }, () => ({ state: 'empty' })))
}

// Helper to create tiles with specific states
function createTilesWithState(overrides: Record<string, TileState>): Record<string, TileState> {
  return overrides
}

describe('Board', () => {
  describe('grid rendering', () => {
    it('renders 12 columns and 9 rows', () => {
      render(<Board tiles={createEmptyTiles()} />)

      // Check column labels (1-12)
      for (let col = 1; col <= 12; col++) {
        expect(screen.getByText(String(col))).toBeInTheDocument()
      }

      // Check row labels (A-I)
      for (const row of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']) {
        expect(screen.getByText(row)).toBeInTheDocument()
      }
    })

    it('renders 108 tiles (12x9 grid)', () => {
      render(<Board tiles={createEmptyTiles()} />)
      const tiles = screen.getAllByTestId(/^tile-/)
      expect(tiles).toHaveLength(108)
    })

    it('renders tiles with correct coordinates', () => {
      render(<Board tiles={createEmptyTiles()} />)

      // Check some specific tiles
      expect(screen.getByTestId('tile-1A')).toBeInTheDocument()
      expect(screen.getByTestId('tile-12I')).toBeInTheDocument()
      expect(screen.getByTestId('tile-6E')).toBeInTheDocument()
    })

    it('renders board with data-testid', () => {
      render(<Board tiles={createEmptyTiles()} />)
      expect(screen.getByTestId('board')).toBeInTheDocument()
    })
  })

  describe('tile states', () => {
    it('renders empty tiles with neutral background', () => {
      render(<Board tiles={createEmptyTiles()} />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('empty')
    })

    it('renders orphan tiles with distinct color', () => {
      const tiles = createTilesWithState({
        '3B': { state: 'orphan' },
      })
      render(<Board tiles={tiles} />)
      const tile = screen.getByTestId('tile-3B')
      expect(tile.className).toContain('orphan')
    })

    it('renders chain tiles with chain color', () => {
      const tiles = createTilesWithState({
        '5C': { state: 'chain', chain: 'Luxor' },
        '6C': { state: 'chain', chain: 'Tower' },
      })
      render(<Board tiles={tiles} />)

      const luxorTile = screen.getByTestId('tile-5C')
      expect(luxorTile).toHaveAttribute('data-chain', 'Luxor')
      expect(luxorTile.style.getPropertyValue('--chain-bg')).toBe('#FFD700')

      const towerTile = screen.getByTestId('tile-6C')
      expect(towerTile).toHaveAttribute('data-chain', 'Tower')
      expect(towerTile.style.getPropertyValue('--chain-bg')).toBe('#8B4513')
    })

    it('supports matrix format for tiles', () => {
      const matrix = createEmptyTiles()
      matrix[1][2] = { state: 'orphan' } // Row B, Col 3 = 3B
      render(<Board tiles={matrix} />)

      const tile = screen.getByTestId('tile-3B')
      expect(tile.className).toContain('orphan')
    })

    it('supports object format for tiles', () => {
      const tiles = {
        '3B': { state: 'orphan' } as TileState,
      }
      render(<Board tiles={tiles} />)

      const tile = screen.getByTestId('tile-3B')
      expect(tile.className).toContain('orphan')
    })
  })

  describe('highlighting', () => {
    it('highlights specified tile', () => {
      render(<Board tiles={createEmptyTiles()} highlightedTile="5D" />)
      const tile = screen.getByTestId('tile-5D')
      expect(tile.className).toContain('highlighted')
    })

    it('highlights playable tiles', () => {
      const playableTiles = new Set(['1A', '2B', '3C'])
      render(<Board tiles={createEmptyTiles()} playableTiles={playableTiles} />)

      expect(screen.getByTestId('tile-1A').className).toContain('highlighted')
      expect(screen.getByTestId('tile-2B').className).toContain('highlighted')
      expect(screen.getByTestId('tile-3C').className).toContain('highlighted')
      expect(screen.getByTestId('tile-4D').className).not.toContain('highlighted')
    })
  })

  describe('interactivity', () => {
    it('calls onTileClick when empty tile is clicked in interactive mode', () => {
      const handleClick = vi.fn()
      render(<Board tiles={createEmptyTiles()} interactive onTileClick={handleClick} />)

      const tile = screen.getByTestId('tile-3B')
      fireEvent.click(tile)

      expect(handleClick).toHaveBeenCalledWith('3B')
    })

    it('does not call onTileClick when tile is not empty', () => {
      const handleClick = vi.fn()
      const tiles = createTilesWithState({
        '3B': { state: 'orphan' },
      })
      render(<Board tiles={tiles} interactive onTileClick={handleClick} />)

      const tile = screen.getByTestId('tile-3B')
      fireEvent.click(tile)

      expect(handleClick).not.toHaveBeenCalled()
    })

    it('does not call onTileClick when not in interactive mode', () => {
      const handleClick = vi.fn()
      render(<Board tiles={createEmptyTiles()} onTileClick={handleClick} />)

      const tile = screen.getByTestId('tile-3B')
      fireEvent.click(tile)

      expect(handleClick).not.toHaveBeenCalled()
    })

    it('respects playableTiles when interactive', () => {
      const handleClick = vi.fn()
      const playableTiles = new Set(['1A'])
      render(
        <Board
          tiles={createEmptyTiles()}
          interactive
          onTileClick={handleClick}
          playableTiles={playableTiles}
        />
      )

      // Click on playable tile
      fireEvent.click(screen.getByTestId('tile-1A'))
      expect(handleClick).toHaveBeenCalledWith('1A')

      // Click on non-playable tile
      fireEvent.click(screen.getByTestId('tile-2B'))
      expect(handleClick).toHaveBeenCalledTimes(1) // Still only 1 call
    })
  })

  describe('size variants', () => {
    it('sets the size bound on the board frame (sm / md default / lg)', () => {
      for (const size of ['sm', 'md', 'lg'] as const) {
        const { unmount } = render(<Board tiles={createEmptyTiles()} size={size} />)
        const frame = screen.getByTestId('board').parentElement as HTMLElement
        expect(frame.className).toContain(size)
        unmount()
      }
      render(<Board tiles={createEmptyTiles()} />)
      expect((screen.getByTestId('board').parentElement as HTMLElement).className).toContain('md')
    })

    it('board squares fill their grid cell', () => {
      render(<Board tiles={createEmptyTiles()} size="lg" />)
      expect(screen.getByTestId('tile-1A').className).toContain('fluid')
    })
  })

  describe('board size comes from the ruleset', () => {
    const cases = [
      ['classic', CLASSIC, '12I'],
      ['valley', VALLEY, '12I'],
      ['mini', MINI, '9G'],
    ] as const
    for (const [name, rs, last] of cases) {
      it(`${name}: ${rs.board.columns}x${rs.board.rows}`, () => {
        render(
          <RulesetScope ruleset={rs}>
            <Board tiles={{}} />
          </RulesetScope>
        )
        const board = screen.getByTestId('board')
        expect(screen.getAllByTestId(/^tile-/)).toHaveLength(rs.board.columns * rs.board.rows)
        expect(board).toHaveAttribute('data-columns', String(rs.board.columns))
        expect(board).toHaveAttribute('data-rows', String(rs.board.rows))
        expect(board.style.getPropertyValue('--cols')).toBe(String(rs.board.columns))
        expect(screen.getByTestId(`tile-${last}`)).toBeInTheDocument()
      })
    }

    it('lays out any grid from 6x6 to 15x12', () => {
      for (const [columns, rows] of [
        [6, 6],
        [15, 12],
      ]) {
        const rs = { ...MINI, board: { columns, rows } }
        const { unmount } = render(
          <RulesetScope ruleset={rs}>
            <Board tiles={{}} />
          </RulesetScope>
        )
        expect(screen.getAllByTestId(/^tile-/)).toHaveLength(columns * rows)
        const lastRow = 'ABCDEFGHIJKL'[rows - 1]
        expect(screen.getByTestId(`tile-${columns}${lastRow}`)).toBeInTheDocument()
        unmount()
      }
    })
  })
})
