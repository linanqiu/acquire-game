import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PlayerCard } from './PlayerCard'
import type { StockHolding } from './PlayerCard'

describe('PlayerCard', () => {
  const defaultProps = {
    name: 'Alice',
    cash: 6000,
    stocks: [] as StockHolding[],
  }

  // Rendering tests
  it('renders player name prominently', () => {
    render(<PlayerCard {...defaultProps} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('formats cash with $ and commas', () => {
    render(<PlayerCard {...defaultProps} cash={1234567} />)
    expect(screen.getByTestId('player-cash')).toHaveTextContent('$1,234,567')
  })

  it('renders with full variant by default', () => {
    render(<PlayerCard {...defaultProps} />)
    expect(screen.getByTestId('player-card')).toBeInTheDocument()
  })

  // Stock holdings tests
  it('displays stock holdings with chain abbreviation and count', () => {
    const stocks: StockHolding[] = [
      { chain: 'Luxor', quantity: 5 },
      { chain: 'Tower', quantity: 3 },
    ]
    render(<PlayerCard {...defaultProps} stocks={stocks} />)
    const stocksArea = screen.getByTestId('player-stocks')
    expect(stocksArea).toBeInTheDocument()
    expect(screen.getByText(':5')).toBeInTheDocument()
    expect(screen.getByText(':3')).toBeInTheDocument()
  })

  it('filters out stocks with zero quantity', () => {
    const stocks: StockHolding[] = [
      { chain: 'Luxor', quantity: 5 },
      { chain: 'Tower', quantity: 0 },
    ]
    render(<PlayerCard {...defaultProps} stocks={stocks} />)
    expect(screen.getByText(':5')).toBeInTheDocument()
    expect(screen.queryByText(':0')).not.toBeInTheDocument()
  })

  it('does not render stocks section when no stocks', () => {
    render(<PlayerCard {...defaultProps} stocks={[]} />)
    expect(screen.queryByTestId('player-stocks')).not.toBeInTheDocument()
  })

  it('does not render stocks section when all stocks have zero quantity', () => {
    const stocks: StockHolding[] = [
      { chain: 'Luxor', quantity: 0 },
      { chain: 'Tower', quantity: 0 },
    ]
    render(<PlayerCard {...defaultProps} stocks={stocks} />)
    expect(screen.queryByTestId('player-stocks')).not.toBeInTheDocument()
  })

  // Current turn indicator tests
  it('shows turn marker when isCurrentTurn is true', () => {
    render(<PlayerCard {...defaultProps} isCurrentTurn />)
    expect(screen.getByTestId('turn-marker')).toHaveTextContent('>')
  })

  it('does not show turn marker when isCurrentTurn is false', () => {
    render(<PlayerCard {...defaultProps} isCurrentTurn={false} />)
    expect(screen.queryByTestId('turn-marker')).not.toBeInTheDocument()
  })

  it('applies active style when isCurrentTurn is true', () => {
    render(<PlayerCard {...defaultProps} isCurrentTurn />)
    expect(screen.getByTestId('player-card').className).toContain('active')
  })

  // Badge tests
  it('shows HOST badge when isHost is true', () => {
    render(<PlayerCard {...defaultProps} isHost />)
    expect(screen.getByText('HOST')).toBeInTheDocument()
  })

  it('does not show HOST badge when isHost is false', () => {
    render(<PlayerCard {...defaultProps} isHost={false} />)
    expect(screen.queryByText('HOST')).not.toBeInTheDocument()
  })

  it('shows BOT badge when isBot is true', () => {
    render(<PlayerCard {...defaultProps} isBot />)
    expect(screen.getByText('BOT')).toBeInTheDocument()
  })

  it('does not show BOT badge when isBot is false', () => {
    render(<PlayerCard {...defaultProps} isBot={false} />)
    expect(screen.queryByText('BOT')).not.toBeInTheDocument()
  })

  it('shows both HOST and BOT badges when both are true', () => {
    render(<PlayerCard {...defaultProps} isHost isBot />)
    expect(screen.getByText('HOST')).toBeInTheDocument()
    expect(screen.getByText('BOT')).toBeInTheDocument()
  })

  // Compact variant tests
  describe('compact variant', () => {
    it('renders compact variant when specified', () => {
      render(<PlayerCard {...defaultProps} variant="compact" />)
      expect(screen.getByTestId('player-card-compact')).toBeInTheDocument()
    })

    it('displays player name in compact variant', () => {
      render(<PlayerCard {...defaultProps} variant="compact" />)
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })

    it('displays cash in compact variant', () => {
      render(<PlayerCard {...defaultProps} cash={5000} variant="compact" />)
      expect(screen.getByText('$5,000')).toBeInTheDocument()
    })

    it('displays stocks in compact variant', () => {
      const stocks: StockHolding[] = [{ chain: 'American', quantity: 10 }]
      render(<PlayerCard {...defaultProps} stocks={stocks} variant="compact" />)
      expect(screen.getByText('10')).toBeInTheDocument()
    })

    it('filters zero quantity stocks in compact variant', () => {
      const stocks: StockHolding[] = [
        { chain: 'American', quantity: 10 },
        { chain: 'Festival', quantity: 0 },
      ]
      render(<PlayerCard {...defaultProps} stocks={stocks} variant="compact" />)
      expect(screen.getByText('10')).toBeInTheDocument()
    })
  })

  // Edge cases
  it('handles zero cash', () => {
    render(<PlayerCard {...defaultProps} cash={0} />)
    expect(screen.getByTestId('player-cash')).toHaveTextContent('$0')
  })

  it('handles large cash values', () => {
    render(<PlayerCard {...defaultProps} cash={999999999} />)
    expect(screen.getByTestId('player-cash')).toHaveTextContent('$999,999,999')
  })

  it('handles all chain types', () => {
    const stocks: StockHolding[] = [
      { chain: 'Luxor', quantity: 1 },
      { chain: 'Tower', quantity: 2 },
      { chain: 'American', quantity: 3 },
      { chain: 'Festival', quantity: 4 },
      { chain: 'Worldwide', quantity: 5 },
      { chain: 'Continental', quantity: 6 },
      { chain: 'Imperial', quantity: 7 },
    ]
    render(<PlayerCard {...defaultProps} stocks={stocks} />)
    expect(screen.getByTestId('player-stocks')).toBeInTheDocument()
    expect(screen.getByText(':1')).toBeInTheDocument()
    expect(screen.getByText(':2')).toBeInTheDocument()
    expect(screen.getByText(':3')).toBeInTheDocument()
    expect(screen.getByText(':4')).toBeInTheDocument()
    expect(screen.getByText(':5')).toBeInTheDocument()
    expect(screen.getByText(':6')).toBeInTheDocument()
    expect(screen.getByText(':7')).toBeInTheDocument()
  })

  it('renders with all props combined', () => {
    const stocks: StockHolding[] = [
      { chain: 'Luxor', quantity: 5 },
      { chain: 'Tower', quantity: 3 },
    ]
    render(
      <PlayerCard
        name="Bob"
        cash={10000}
        stocks={stocks}
        isCurrentTurn
        isHost
        isBot
        variant="full"
      />
    )
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByTestId('player-cash')).toHaveTextContent('$10,000')
    expect(screen.getByTestId('turn-marker')).toBeInTheDocument()
    expect(screen.getByText('HOST')).toBeInTheDocument()
    expect(screen.getByText('BOT')).toBeInTheDocument()
    expect(screen.getByTestId('player-stocks')).toBeInTheDocument()
  })
})
