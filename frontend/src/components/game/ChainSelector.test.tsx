import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChainSelector, type ChainSelectorProps } from './ChainSelector'
import type { ChainName } from '../../types/api'

describe('ChainSelector', () => {
  const allChains: ChainName[] = [
    'Luxor',
    'Tower',
    'American',
    'Festival',
    'Worldwide',
    'Continental',
    'Imperial',
  ]

  const defaultProps: ChainSelectorProps = {
    availableChains: allChains,
    onSelect: vi.fn(),
    stockAvailability: {},
  }

  describe('rendering', () => {
    it('renders all chains grouped by tier', () => {
      render(<ChainSelector {...defaultProps} />)

      expect(screen.getByText('BUDGET TIER')).toBeInTheDocument()
      expect(screen.getByText('STANDARD TIER')).toBeInTheDocument()
      expect(screen.getByText('PREMIUM TIER')).toBeInTheDocument()

      allChains.forEach((chain) => {
        expect(screen.getByTestId(`chain-button-${chain.toLowerCase()}`)).toBeInTheDocument()
      })
    })

    it('shows stock availability for available chains', () => {
      const stockAvailability = { Luxor: 20, Tower: 15 }

      render(
        <ChainSelector
          {...defaultProps}
          stockAvailability={stockAvailability as ChainSelectorProps['stockAvailability']}
        />
      )

      const luxorButton = screen.getByTestId('chain-button-luxor')
      expect(luxorButton).toHaveTextContent('20 stock avail')

      const towerButton = screen.getByTestId('chain-button-tower')
      expect(towerButton).toHaveTextContent('15 stock avail')
    })

    it('defaults to 25 stock when not specified', () => {
      render(<ChainSelector {...defaultProps} stockAvailability={{}} />)

      const luxorButton = screen.getByTestId('chain-button-luxor')
      expect(luxorButton).toHaveTextContent('25 stock avail')
    })

    it('shows ACTIVE for unavailable chains', () => {
      const availableChains: ChainName[] = ['Luxor', 'Tower']

      render(<ChainSelector {...defaultProps} availableChains={availableChains} />)

      const americanButton = screen.getByTestId('chain-button-american')
      expect(americanButton).toHaveTextContent('ACTIVE')
      expect(americanButton).toBeDisabled()
    })
  })

  describe('selection', () => {
    it('calls onSelect when available chain is clicked', () => {
      const onSelect = vi.fn()

      render(<ChainSelector {...defaultProps} onSelect={onSelect} />)

      fireEvent.click(screen.getByTestId('chain-button-luxor'))

      expect(onSelect).toHaveBeenCalledWith('Luxor')
    })

    it('does not call onSelect when unavailable chain is clicked', () => {
      const onSelect = vi.fn()
      const availableChains: ChainName[] = ['Luxor', 'Tower']

      render(
        <ChainSelector {...defaultProps} availableChains={availableChains} onSelect={onSelect} />
      )

      fireEvent.click(screen.getByTestId('chain-button-american'))

      expect(onSelect).not.toHaveBeenCalled()
    })

    it('shows selected state for selected chain', () => {
      render(<ChainSelector {...defaultProps} selectedChain="Luxor" />)

      const luxorButton = screen.getByTestId('chain-button-luxor')
      expect(luxorButton).toHaveAttribute('aria-checked', 'true')
      expect(luxorButton).toHaveAttribute('aria-pressed', 'true')
    })

    it('shows unselected state for non-selected chains', () => {
      render(<ChainSelector {...defaultProps} selectedChain="Luxor" />)

      const towerButton = screen.getByTestId('chain-button-tower')
      expect(towerButton).toHaveAttribute('aria-checked', 'false')
      expect(towerButton).toHaveAttribute('aria-pressed', 'false')
    })
  })

  describe('keyboard navigation', () => {
    it('moves focus right with ArrowRight', () => {
      render(<ChainSelector {...defaultProps} />)

      const luxorButton = screen.getByTestId('chain-button-luxor')
      const towerButton = screen.getByTestId('chain-button-tower')

      luxorButton.focus()
      fireEvent.keyDown(luxorButton, { key: 'ArrowRight' })

      expect(document.activeElement).toBe(towerButton)
    })

    it('moves focus left with ArrowLeft', () => {
      render(<ChainSelector {...defaultProps} />)

      const luxorButton = screen.getByTestId('chain-button-luxor')
      const towerButton = screen.getByTestId('chain-button-tower')

      towerButton.focus()
      fireEvent.keyDown(towerButton, { key: 'ArrowLeft' })

      expect(document.activeElement).toBe(luxorButton)
    })

    it('wraps around when at the end', () => {
      render(<ChainSelector {...defaultProps} />)

      const luxorButton = screen.getByTestId('chain-button-luxor')
      const imperialButton = screen.getByTestId('chain-button-imperial')

      imperialButton.focus()
      fireEvent.keyDown(imperialButton, { key: 'ArrowRight' })

      expect(document.activeElement).toBe(luxorButton)
    })

    it('wraps around when at the beginning', () => {
      render(<ChainSelector {...defaultProps} />)

      const luxorButton = screen.getByTestId('chain-button-luxor')
      const imperialButton = screen.getByTestId('chain-button-imperial')

      luxorButton.focus()
      fireEvent.keyDown(luxorButton, { key: 'ArrowLeft' })

      expect(document.activeElement).toBe(imperialButton)
    })

    it('selects chain with Enter key', () => {
      const onSelect = vi.fn()
      render(<ChainSelector {...defaultProps} onSelect={onSelect} />)

      const luxorButton = screen.getByTestId('chain-button-luxor')
      luxorButton.focus()
      fireEvent.keyDown(luxorButton, { key: 'Enter' })

      expect(onSelect).toHaveBeenCalledWith('Luxor')
    })

    it('selects chain with Space key', () => {
      const onSelect = vi.fn()
      render(<ChainSelector {...defaultProps} onSelect={onSelect} />)

      const luxorButton = screen.getByTestId('chain-button-luxor')
      luxorButton.focus()
      fireEvent.keyDown(luxorButton, { key: ' ' })

      expect(onSelect).toHaveBeenCalledWith('Luxor')
    })

    it('does not select unavailable chain with Enter key', () => {
      const onSelect = vi.fn()
      const availableChains: ChainName[] = ['Luxor', 'Tower']

      render(
        <ChainSelector {...defaultProps} availableChains={availableChains} onSelect={onSelect} />
      )

      const americanButton = screen.getByTestId('chain-button-american')
      americanButton.focus()
      fireEvent.keyDown(americanButton, { key: 'Enter' })

      expect(onSelect).not.toHaveBeenCalled()
    })
  })

  describe('accessibility', () => {
    it('has radiogroup role', () => {
      render(<ChainSelector {...defaultProps} />)

      expect(screen.getByTestId('chain-selector')).toHaveAttribute('role', 'radiogroup')
    })

    it('each chain button has radio role', () => {
      render(<ChainSelector {...defaultProps} />)

      allChains.forEach((chain) => {
        const button = screen.getByTestId(`chain-button-${chain.toLowerCase()}`)
        expect(button).toHaveAttribute('role', 'radio')
      })
    })

    it('has accessible labels for available chains', () => {
      const stockAvailability = { Luxor: 20 }

      render(
        <ChainSelector
          {...defaultProps}
          stockAvailability={stockAvailability as ChainSelectorProps['stockAvailability']}
        />
      )

      const luxorButton = screen.getByTestId('chain-button-luxor')
      expect(luxorButton).toHaveAttribute('aria-label', 'Luxor, 20 stock available')
    })

    it('has accessible labels for unavailable chains', () => {
      const availableChains: ChainName[] = ['Luxor', 'Tower']

      render(<ChainSelector {...defaultProps} availableChains={availableChains} />)

      const americanButton = screen.getByTestId('chain-button-american')
      expect(americanButton).toHaveAttribute('aria-label', 'American, already active')
    })
  })

  describe('edge cases', () => {
    it('works with 0 stock available (still selectable)', () => {
      const onSelect = vi.fn()
      const stockAvailability = { Luxor: 0 }

      render(
        <ChainSelector
          {...defaultProps}
          onSelect={onSelect}
          stockAvailability={stockAvailability as ChainSelectorProps['stockAvailability']}
        />
      )

      const luxorButton = screen.getByTestId('chain-button-luxor')
      expect(luxorButton).toHaveTextContent('0 stock avail')
      expect(luxorButton).not.toBeDisabled()

      fireEvent.click(luxorButton)
      expect(onSelect).toHaveBeenCalledWith('Luxor')
    })

    it('works with empty availableChains', () => {
      render(<ChainSelector {...defaultProps} availableChains={[]} />)

      allChains.forEach((chain) => {
        const button = screen.getByTestId(`chain-button-${chain.toLowerCase()}`)
        expect(button).toBeDisabled()
        expect(button).toHaveTextContent('ACTIVE')
      })
    })
  })
})
