import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Portfolio, type StockHolding, type ChainPrices } from './Portfolio'
import type { ChainName } from '../../types/api'

describe('Portfolio', () => {
  const mockPrices: ChainPrices = {
    Luxor: 800,
    Tower: 700,
    American: 600,
    Festival: 500,
    Worldwide: 400,
    Continental: 1000,
    Imperial: 900,
  }

  describe('rendering', () => {
    it('renders empty state when no holdings', () => {
      render(<Portfolio holdings={[]} prices={mockPrices} />)

      expect(screen.getByTestId('portfolio-empty')).toHaveTextContent('No stocks owned')
    })

    it('renders empty state when all holdings have zero quantity', () => {
      const holdings: StockHolding[] = [
        { chain: 'Luxor', quantity: 0 },
        { chain: 'Tower', quantity: 0 },
      ]

      render(<Portfolio holdings={holdings} prices={mockPrices} />)

      expect(screen.getByTestId('portfolio-empty')).toHaveTextContent('No stocks owned')
    })

    it('renders holdings with chain markers', () => {
      const holdings: StockHolding[] = [
        { chain: 'Luxor', quantity: 5 },
        { chain: 'American', quantity: 3 },
      ]

      render(<Portfolio holdings={holdings} prices={mockPrices} />)

      expect(screen.getByTestId('portfolio-table')).toBeInTheDocument()
      expect(screen.getByTestId('portfolio-row-luxor')).toBeInTheDocument()
      expect(screen.getByTestId('portfolio-row-american')).toBeInTheDocument()
    })

    it('shows quantity, price, and total value per chain', () => {
      const holdings: StockHolding[] = [{ chain: 'Luxor', quantity: 5 }]

      render(<Portfolio holdings={holdings} prices={mockPrices} />)

      const row = screen.getByTestId('portfolio-row-luxor')
      // 5 shares × $800 = $4,000
      expect(row).toHaveTextContent('5')
      expect(row).toHaveTextContent('$800')
      expect(row).toHaveTextContent('$4,000')
    })

    it('filters out zero-quantity holdings', () => {
      const holdings: StockHolding[] = [
        { chain: 'Luxor', quantity: 5 },
        { chain: 'Tower', quantity: 0 },
        { chain: 'American', quantity: 3 },
      ]

      render(<Portfolio holdings={holdings} prices={mockPrices} />)

      expect(screen.getByTestId('portfolio-row-luxor')).toBeInTheDocument()
      expect(screen.getByTestId('portfolio-row-american')).toBeInTheDocument()
      expect(screen.queryByTestId('portfolio-row-tower')).not.toBeInTheDocument()
    })
  })

  describe('total calculation', () => {
    it('calculates total correctly', () => {
      const holdings: StockHolding[] = [
        { chain: 'Luxor', quantity: 5 }, // 5 × $800 = $4,000
        { chain: 'American', quantity: 3 }, // 3 × $600 = $1,800
        { chain: 'Continental', quantity: 8 }, // 8 × $1,000 = $8,000
      ]

      render(<Portfolio holdings={holdings} prices={mockPrices} />)

      expect(screen.getByTestId('portfolio-total')).toHaveTextContent('$13,800')
    })

    it('shows total by default', () => {
      const holdings: StockHolding[] = [{ chain: 'Luxor', quantity: 5 }]

      render(<Portfolio holdings={holdings} prices={mockPrices} />)

      expect(screen.getByTestId('portfolio-total')).toBeInTheDocument()
    })

    it('hides total when showTotal is false', () => {
      const holdings: StockHolding[] = [{ chain: 'Luxor', quantity: 5 }]

      render(<Portfolio holdings={holdings} prices={mockPrices} showTotal={false} />)

      expect(screen.queryByTestId('portfolio-total')).not.toBeInTheDocument()
    })
  })

  describe('edge cases', () => {
    it('handles chains with zero price', () => {
      const holdings: StockHolding[] = [{ chain: 'Luxor', quantity: 5 }]
      const pricesWithZero: ChainPrices = { Luxor: 0 }

      render(<Portfolio holdings={holdings} prices={pricesWithZero} />)

      const row = screen.getByTestId('portfolio-row-luxor')
      expect(row).toHaveTextContent('$0')
    })

    it('handles missing chain prices (defaults to 0)', () => {
      const holdings: StockHolding[] = [{ chain: 'Imperial', quantity: 5 }]
      const emptyPrices: ChainPrices = {}

      render(<Portfolio holdings={holdings} prices={emptyPrices} />)

      const row = screen.getByTestId('portfolio-row-imperial')
      expect(row).toHaveTextContent('$0')
    })

    it('formats large values with commas', () => {
      const holdings: StockHolding[] = [{ chain: 'Continental', quantity: 25 }]
      const highPrices: ChainPrices = { Continental: 1200 }

      render(<Portfolio holdings={holdings} prices={highPrices} />)

      const row = screen.getByTestId('portfolio-row-continental')
      // 25 × $1,200 = $30,000
      expect(row).toHaveTextContent('$30,000')
    })

    it('renders all seven chains correctly', () => {
      const allChains: ChainName[] = [
        'Luxor',
        'Tower',
        'American',
        'Festival',
        'Worldwide',
        'Continental',
        'Imperial',
      ]
      const holdings: StockHolding[] = allChains.map((chain) => ({
        chain,
        quantity: 1,
      }))

      render(<Portfolio holdings={holdings} prices={mockPrices} />)

      allChains.forEach((chain) => {
        expect(screen.getByTestId(`portfolio-row-${chain.toLowerCase()}`)).toBeInTheDocument()
      })
    })
  })
})
