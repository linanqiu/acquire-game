import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TileRack, type RackTile } from './TileRack'

const createTiles = (count: number): RackTile[] =>
  Array.from({ length: count }, (_, i) => ({
    coordinate: `${i + 1}A` as const,
    playability: 'playable' as const,
  }))

describe('TileRack', () => {
  describe('rendering', () => {
    it('renders exactly 6 tiles', () => {
      const tiles = createTiles(6)
      const onSelect = vi.fn()
      render(<TileRack tiles={tiles} onTileSelect={onSelect} />)
      expect(screen.getByTestId('tile-rack')).toBeInTheDocument()
      expect(screen.getByTestId('tile-1A')).toBeInTheDocument()
      expect(screen.getByTestId('tile-2A')).toBeInTheDocument()
      expect(screen.getByTestId('tile-3A')).toBeInTheDocument()
      expect(screen.getByTestId('tile-4A')).toBeInTheDocument()
      expect(screen.getByTestId('tile-5A')).toBeInTheDocument()
      expect(screen.getByTestId('tile-6A')).toBeInTheDocument()
    })

    it('renders fewer than 6 tiles when provided', () => {
      const tiles = createTiles(3)
      const onSelect = vi.fn()
      render(<TileRack tiles={tiles} onTileSelect={onSelect} />)
      expect(screen.getByTestId('tile-1A')).toBeInTheDocument()
      expect(screen.getByTestId('tile-2A')).toBeInTheDocument()
      expect(screen.getByTestId('tile-3A')).toBeInTheDocument()
      expect(screen.queryByTestId('tile-4A')).not.toBeInTheDocument()
    })

    it('shows coordinate labels on tiles', () => {
      const tiles: RackTile[] = [
        { coordinate: '3C', playability: 'playable' },
        { coordinate: '12I', playability: 'playable' },
      ]
      const onSelect = vi.fn()
      render(<TileRack tiles={tiles} onTileSelect={onSelect} />)
      expect(screen.getByText('3C')).toBeInTheDocument()
      expect(screen.getByText('12I')).toBeInTheDocument()
    })
  })

  describe('selection', () => {
    it('applies selected state to selected tile', () => {
      const tiles = createTiles(3)
      const onSelect = vi.fn()
      render(<TileRack tiles={tiles} selectedTile="2A" onTileSelect={onSelect} />)
      const selectedTile = screen.getByTestId('tile-2A')
      expect(selectedTile.className).toContain('selected')
    })

    it('non-selected tiles have default state', () => {
      const tiles = createTiles(3)
      const onSelect = vi.fn()
      render(<TileRack tiles={tiles} selectedTile="2A" onTileSelect={onSelect} />)
      const unselectedTile = screen.getByTestId('tile-1A')
      expect(unselectedTile.className).toContain('default')
      expect(unselectedTile.className).not.toContain('selected')
    })
  })

  describe('playability states', () => {
    it('renders playable tiles with default state', () => {
      const tiles: RackTile[] = [{ coordinate: '1A', playability: 'playable' }]
      const onSelect = vi.fn()
      render(<TileRack tiles={tiles} onTileSelect={onSelect} />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('default')
    })

    it('renders merger tiles with warning indicator (!!)', () => {
      const tiles: RackTile[] = [{ coordinate: '1A', playability: 'merger' }]
      const onSelect = vi.fn()
      render(<TileRack tiles={tiles} onTileSelect={onSelect} />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('merger')
      expect(screen.getByText('!!')).toBeInTheDocument()
    })

    it('renders temporarily unplayable tiles dimmed with lock', () => {
      const tiles: RackTile[] = [{ coordinate: '1A', playability: 'temp_unplayable' }]
      const onSelect = vi.fn()
      render(<TileRack tiles={tiles} onTileSelect={onSelect} />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('disabled')
      expect(screen.getByText('🔒')).toBeInTheDocument()
    })

    it('renders permanently unplayable tiles crossed out', () => {
      const tiles: RackTile[] = [{ coordinate: '1A', playability: 'perm_unplayable' }]
      const onSelect = vi.fn()
      render(<TileRack tiles={tiles} onTileSelect={onSelect} />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('dead')
      expect(screen.getByText('✕')).toBeInTheDocument()
    })
  })

  describe('interactivity', () => {
    it('calls onTileSelect when clicking a playable tile', () => {
      const tiles: RackTile[] = [{ coordinate: '1A', playability: 'playable' }]
      const onSelect = vi.fn()
      render(<TileRack tiles={tiles} onTileSelect={onSelect} />)
      const tile = screen.getByTestId('tile-1A')
      fireEvent.click(tile)
      expect(onSelect).toHaveBeenCalledWith('1A')
    })

    it('calls onTileSelect when clicking a merger tile', () => {
      const tiles: RackTile[] = [{ coordinate: '2B', playability: 'merger' }]
      const onSelect = vi.fn()
      render(<TileRack tiles={tiles} onTileSelect={onSelect} />)
      const tile = screen.getByTestId('tile-2B')
      fireEvent.click(tile)
      expect(onSelect).toHaveBeenCalledWith('2B')
    })

    it('does not call onTileSelect when clicking temp_unplayable tile', () => {
      const tiles: RackTile[] = [{ coordinate: '1A', playability: 'temp_unplayable' }]
      const onSelect = vi.fn()
      render(<TileRack tiles={tiles} onTileSelect={onSelect} />)
      const tile = screen.getByTestId('tile-1A')
      fireEvent.click(tile)
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('does not call onTileSelect when clicking perm_unplayable tile', () => {
      const tiles: RackTile[] = [{ coordinate: '1A', playability: 'perm_unplayable' }]
      const onSelect = vi.fn()
      render(<TileRack tiles={tiles} onTileSelect={onSelect} />)
      const tile = screen.getByTestId('tile-1A')
      fireEvent.click(tile)
      expect(onSelect).not.toHaveBeenCalled()
    })
  })

  describe('disabled prop', () => {
    it('disables all tile interactions when disabled is true', () => {
      const tiles: RackTile[] = [
        { coordinate: '1A', playability: 'playable' },
        { coordinate: '2A', playability: 'merger' },
      ]
      const onSelect = vi.fn()
      render(<TileRack tiles={tiles} onTileSelect={onSelect} disabled />)

      fireEvent.click(screen.getByTestId('tile-1A'))
      fireEvent.click(screen.getByTestId('tile-2A'))
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('playable tiles still show their playability state when rack is disabled', () => {
      const tiles: RackTile[] = [{ coordinate: '1A', playability: 'playable' }]
      const onSelect = vi.fn()
      render(<TileRack tiles={tiles} onTileSelect={onSelect} disabled />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('default')
    })
  })

  describe('mixed playability', () => {
    it('renders tiles with mixed playability states correctly', () => {
      const tiles: RackTile[] = [
        { coordinate: '1A', playability: 'playable' },
        { coordinate: '2A', playability: 'merger' },
        { coordinate: '3A', playability: 'temp_unplayable' },
        { coordinate: '4A', playability: 'perm_unplayable' },
        { coordinate: '5A', playability: 'playable' },
        { coordinate: '6A', playability: 'playable' },
      ]
      const onSelect = vi.fn()
      render(<TileRack tiles={tiles} onTileSelect={onSelect} />)

      expect(screen.getByTestId('tile-1A').className).toContain('default')
      expect(screen.getByTestId('tile-2A').className).toContain('merger')
      expect(screen.getByTestId('tile-3A').className).toContain('disabled')
      expect(screen.getByTestId('tile-4A').className).toContain('dead')
      expect(screen.getByTestId('tile-5A').className).toContain('default')
      expect(screen.getByTestId('tile-6A').className).toContain('default')
    })

    it('only playable and merger tiles are clickable', () => {
      const tiles: RackTile[] = [
        { coordinate: '1A', playability: 'playable' },
        { coordinate: '2A', playability: 'merger' },
        { coordinate: '3A', playability: 'temp_unplayable' },
        { coordinate: '4A', playability: 'perm_unplayable' },
      ]
      const onSelect = vi.fn()
      render(<TileRack tiles={tiles} onTileSelect={onSelect} />)

      fireEvent.click(screen.getByTestId('tile-1A'))
      expect(onSelect).toHaveBeenCalledWith('1A')

      fireEvent.click(screen.getByTestId('tile-2A'))
      expect(onSelect).toHaveBeenCalledWith('2A')

      fireEvent.click(screen.getByTestId('tile-3A'))
      fireEvent.click(screen.getByTestId('tile-4A'))
      expect(onSelect).toHaveBeenCalledTimes(2)
    })
  })
})
