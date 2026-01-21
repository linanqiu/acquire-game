import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ChainMarker } from './ChainMarker'
import type { ChainName } from '../../types/api'

describe('ChainMarker', () => {
  describe('icon variant', () => {
    it('renders 16x16 colored square with first letter', () => {
      render(<ChainMarker chain="Luxor" variant="icon" />)
      const marker = screen.getByTestId('chain-marker-luxor')
      expect(marker).toBeInTheDocument()
      expect(marker).toHaveTextContent('L')
      expect(marker.className).toContain('luxor')
    })

    it('shows full name as title attribute', () => {
      render(<ChainMarker chain="American" variant="icon" />)
      const marker = screen.getByTestId('chain-marker-american')
      expect(marker).toHaveAttribute('title', 'AMERICAN')
    })
  })

  describe('compact variant (default)', () => {
    it('renders icon + abbreviation', () => {
      render(<ChainMarker chain="American" />)
      const marker = screen.getByTestId('chain-marker-american')
      expect(marker).toBeInTheDocument()
      expect(screen.getByText('AME')).toBeInTheDocument()
      expect(screen.getByText('A')).toBeInTheDocument()
    })

    it('shows SAFE badge when safe is true', () => {
      render(<ChainMarker chain="Tower" safe />)
      expect(screen.getByText('SAFE')).toBeInTheDocument()
    })

    it('does not show SAFE badge when safe is false', () => {
      render(<ChainMarker chain="Tower" safe={false} />)
      expect(screen.queryByText('SAFE')).not.toBeInTheDocument()
    })
  })

  describe('full variant', () => {
    it('renders icon + full name', () => {
      render(<ChainMarker chain="Continental" variant="full" />)
      expect(screen.getByText('CONTINENTAL')).toBeInTheDocument()
      expect(screen.getByText('C')).toBeInTheDocument()
    })

    it('shows size when provided', () => {
      render(<ChainMarker chain="Luxor" variant="full" size={5} />)
      expect(screen.getByText('5 tiles')).toBeInTheDocument()
    })

    it('shows price when provided', () => {
      render(<ChainMarker chain="Luxor" variant="full" price={300} />)
      expect(screen.getByText('$300/share')).toBeInTheDocument()
    })

    it('formats large prices with commas', () => {
      render(<ChainMarker chain="Imperial" variant="full" price={1200} />)
      expect(screen.getByText('$1,200/share')).toBeInTheDocument()
    })

    it('shows available stocks count', () => {
      render(<ChainMarker chain="Festival" variant="full" available={15} />)
      expect(screen.getByText('[15]')).toBeInTheDocument()
    })

    it('shows SAFE badge when safe is true', () => {
      render(<ChainMarker chain="Worldwide" variant="full" size={12} safe />)
      expect(screen.getByText('SAFE')).toBeInTheDocument()
    })

    it('shows all info together', () => {
      render(
        <ChainMarker
          chain="American"
          variant="full"
          size={8}
          price={700}
          available={20}
          safe={false}
        />
      )
      expect(screen.getByText('AMERICAN')).toBeInTheDocument()
      expect(screen.getByText('8 tiles')).toBeInTheDocument()
      expect(screen.getByText('$700/share')).toBeInTheDocument()
      expect(screen.getByText('[20]')).toBeInTheDocument()
    })
  })

  describe('chain colors', () => {
    const chains: ChainName[] = [
      'Luxor',
      'Tower',
      'American',
      'Festival',
      'Worldwide',
      'Continental',
      'Imperial',
    ]

    chains.forEach((chain) => {
      it(`applies correct color class for ${chain}`, () => {
        const cssClass = chain.toLowerCase()
        render(<ChainMarker chain={chain} variant="icon" />)
        const marker = screen.getByTestId(`chain-marker-${cssClass}`)
        expect(marker.className).toContain(cssClass)
      })
    })
  })

  describe('abbreviations', () => {
    const expectedAbbreviations: Record<ChainName, string> = {
      Luxor: 'LUX',
      Tower: 'TWR',
      American: 'AME',
      Festival: 'FES',
      Worldwide: 'WOR',
      Continental: 'CON',
      Imperial: 'IMP',
    }

    Object.entries(expectedAbbreviations).forEach(([chain, abbrev]) => {
      it(`shows ${abbrev} for ${chain}`, () => {
        render(<ChainMarker chain={chain as ChainName} variant="compact" />)
        expect(screen.getByText(abbrev)).toBeInTheDocument()
      })
    })
  })
})
