import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Tile } from './Tile'

describe('Tile', () => {
  describe('rendering', () => {
    it('renders coordinate label by default', () => {
      render(<Tile coordinate="3B" />)
      expect(screen.getByText('3B')).toBeInTheDocument()
    })

    it('hides label when showLabel is false', () => {
      render(<Tile coordinate="3B" showLabel={false} />)
      expect(screen.queryByText('3B')).not.toBeInTheDocument()
    })

    it('renders with data-testid', () => {
      render(<Tile coordinate="12I" />)
      expect(screen.getByTestId('tile-12I')).toBeInTheDocument()
    })
  })

  describe('size variants', () => {
    it('applies sm class for small size', () => {
      render(<Tile coordinate="1A" size="sm" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('sm')
    })

    it('applies md class for medium size (default)', () => {
      render(<Tile coordinate="1A" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('md')
    })

    it('applies lg class for large size', () => {
      render(<Tile coordinate="1A" size="lg" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('lg')
    })
  })

  describe('chain colors', () => {
    it('renders empty tile with neutral background', () => {
      render(<Tile coordinate="1A" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('empty')
    })

    it('renders orphan tile with distinct color', () => {
      render(<Tile coordinate="1A" chain="orphan" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('orphan')
    })

    it('renders Luxor chain tile', () => {
      render(<Tile coordinate="1A" chain="Luxor" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('luxor')
    })

    it('renders Tower chain tile', () => {
      render(<Tile coordinate="1A" chain="Tower" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('tower')
    })

    it('renders American chain tile', () => {
      render(<Tile coordinate="1A" chain="American" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('american')
    })

    it('renders Festival chain tile', () => {
      render(<Tile coordinate="1A" chain="Festival" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('festival')
    })

    it('renders Worldwide chain tile', () => {
      render(<Tile coordinate="1A" chain="Worldwide" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('worldwide')
    })

    it('renders Continental chain tile', () => {
      render(<Tile coordinate="1A" chain="Continental" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('continental')
    })

    it('renders Imperial chain tile', () => {
      render(<Tile coordinate="1A" chain="Imperial" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('imperial')
    })
  })

  describe('visual states', () => {
    it('applies default state by default', () => {
      render(<Tile coordinate="1A" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('default')
    })

    it('applies selected state with elevated appearance', () => {
      render(<Tile coordinate="1A" state="selected" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('selected')
    })

    it('applies disabled state with dimmed appearance', () => {
      render(<Tile coordinate="1A" state="disabled" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('disabled')
      expect(screen.getByText('🔒')).toBeInTheDocument()
    })

    it('applies merger state with warning indicator', () => {
      render(<Tile coordinate="1A" state="merger" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('merger')
      expect(screen.getByText('!!')).toBeInTheDocument()
    })

    it('applies dead state with crossed out appearance', () => {
      render(<Tile coordinate="1A" state="dead" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('dead')
      expect(screen.getByText('✕')).toBeInTheDocument()
    })

    it('applies highlighted state with glow', () => {
      render(<Tile coordinate="1A" highlighted />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('highlighted')
    })
  })

  describe('interactivity', () => {
    it('calls onClick when clicked', () => {
      const handleClick = vi.fn()
      render(<Tile coordinate="1A" onClick={handleClick} />)
      const tile = screen.getByTestId('tile-1A')
      fireEvent.click(tile)
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('applies interactive class when onClick is provided', () => {
      const handleClick = vi.fn()
      render(<Tile coordinate="1A" onClick={handleClick} />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.className).toContain('interactive')
    })

    it('has button role when interactive', () => {
      const handleClick = vi.fn()
      render(<Tile coordinate="1A" onClick={handleClick} />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.getAttribute('role')).toBe('button')
    })

    it('is focusable when interactive', () => {
      const handleClick = vi.fn()
      render(<Tile coordinate="1A" onClick={handleClick} />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.getAttribute('tabIndex')).toBe('0')
    })

    it('does not call onClick when disabled', () => {
      const handleClick = vi.fn()
      render(<Tile coordinate="1A" onClick={handleClick} state="disabled" />)
      const tile = screen.getByTestId('tile-1A')
      fireEvent.click(tile)
      expect(handleClick).not.toHaveBeenCalled()
    })

    it('is not focusable when disabled', () => {
      const handleClick = vi.fn()
      render(<Tile coordinate="1A" onClick={handleClick} state="disabled" />)
      const tile = screen.getByTestId('tile-1A')
      expect(tile.getAttribute('tabIndex')).toBeNull()
    })

    it('triggers onClick on Enter key', () => {
      const handleClick = vi.fn()
      render(<Tile coordinate="1A" onClick={handleClick} />)
      const tile = screen.getByTestId('tile-1A')
      fireEvent.keyDown(tile, { key: 'Enter' })
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('triggers onClick on Space key', () => {
      const handleClick = vi.fn()
      render(<Tile coordinate="1A" onClick={handleClick} />)
      const tile = screen.getByTestId('tile-1A')
      fireEvent.keyDown(tile, { key: ' ' })
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('does not trigger onClick on other keys', () => {
      const handleClick = vi.fn()
      render(<Tile coordinate="1A" onClick={handleClick} />)
      const tile = screen.getByTestId('tile-1A')
      fireEvent.keyDown(tile, { key: 'Tab' })
      expect(handleClick).not.toHaveBeenCalled()
    })
  })
})
