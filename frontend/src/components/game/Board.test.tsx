import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Board } from './Board'
import type { TileState } from '../../types/game'

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
      expect(luxorTile.className).toContain('luxor')

      const towerTile = screen.getByTestId('tile-6C')
      expect(towerTile.className).toContain('tower')
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
    it('applies sm size class', () => {
      render(<Board tiles={createEmptyTiles()} size="sm" />)
      const board = screen.getByTestId('board')
      expect(board.className).toContain('sm')
    })

    it('applies md size class (default)', () => {
      render(<Board tiles={createEmptyTiles()} />)
      const board = screen.getByTestId('board')
      expect(board.className).toContain('md')
    })

    it('applies lg size class', () => {
      render(<Board tiles={createEmptyTiles()} size="lg" />)
      const board = screen.getByTestId('board')
      expect(board.className).toContain('lg')
    })

    it('passes size to Tile components', () => {
      render(<Board tiles={createEmptyTiles()} size="lg" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('lg')
    })
  })
})
