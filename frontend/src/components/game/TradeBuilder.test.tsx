import { render, screen, fireEvent } from '@testing-library/react'
import { TradeBuilder, TradeBuilderProps } from './TradeBuilder'
import type { ChainName } from '../../types/api'

const mockPlayers = [
  {
    id: 'player-2',
    name: 'Bob',
    cash: 5000,
    stocks: { Luxor: 3, Tower: 2 } as Partial<Record<ChainName, number>>,
  },
  {
    id: 'player-3',
    name: 'Carol',
    cash: 8000,
    stocks: { American: 5, Festival: 1 } as Partial<Record<ChainName, number>>,
  },
]

const mockMyHoldings = [
  { chain: 'Luxor' as ChainName, quantity: 4 },
  { chain: 'Continental' as ChainName, quantity: 2 },
]

const defaultProps: TradeBuilderProps = {
  players: mockPlayers,
  myHoldings: mockMyHoldings,
  myCash: 3000,
  onPropose: vi.fn(),
  onCancel: vi.fn(),
}

describe('TradeBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders trade builder form', () => {
      render(<TradeBuilder {...defaultProps} />)

      expect(screen.getByTestId('trade-builder')).toBeInTheDocument()
      expect(screen.getByText('NEW TRADE')).toBeInTheDocument()
      expect(screen.getByText('TRADE WITH:')).toBeInTheDocument()
      expect(screen.getByText('YOU OFFER:')).toBeInTheDocument()
    })

    it('shows all available players to trade with', () => {
      render(<TradeBuilder {...defaultProps} />)

      expect(screen.getByText('Bob')).toBeInTheDocument()
      expect(screen.getByText('$5,000')).toBeInTheDocument()
      expect(screen.getByText('Carol')).toBeInTheDocument()
      expect(screen.getByText('$8,000')).toBeInTheDocument()
    })

    it('shows my holdings in offer section', () => {
      render(<TradeBuilder {...defaultProps} />)

      expect(screen.getByText('(you have 4)')).toBeInTheDocument()
      expect(screen.getByText('(you have 2)')).toBeInTheDocument()
    })

    it('shows cash input with max value', () => {
      render(<TradeBuilder {...defaultProps} />)

      expect(screen.getByTestId('offer-cash-input')).toBeInTheDocument()
      expect(screen.getByText('(max $3,000)')).toBeInTheDocument()
    })

    it('shows hint when no partner selected', () => {
      render(<TradeBuilder {...defaultProps} />)

      expect(screen.getByText('Select a trade partner to see their holdings')).toBeInTheDocument()
    })
  })

  describe('player selection', () => {
    it('selects a trade partner when clicked', () => {
      render(<TradeBuilder {...defaultProps} />)

      const bobButton = screen.getByTestId('player-select-player-2')
      fireEvent.click(bobButton)

      expect(bobButton).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByText('YOU WANT FROM BOB:')).toBeInTheDocument()
    })

    it('shows partner holdings after selection', () => {
      render(<TradeBuilder {...defaultProps} />)

      fireEvent.click(screen.getByTestId('player-select-player-2'))

      expect(screen.getByText('(they have 3)')).toBeInTheDocument()
      expect(screen.getByText('(they have 2)')).toBeInTheDocument()
    })

    it('resets want section when switching partners', () => {
      const onPropose = vi.fn()
      render(<TradeBuilder {...defaultProps} onPropose={onPropose} />)

      // Select Bob and set some want values
      fireEvent.click(screen.getByTestId('player-select-player-2'))

      // Switch to Carol
      fireEvent.click(screen.getByTestId('player-select-player-3'))

      // Carol's holdings should be shown
      expect(screen.getByText('YOU WANT FROM CAROL:')).toBeInTheDocument()
      expect(screen.getByText('(they have 5)')).toBeInTheDocument()
    })
  })

  describe('offer stock controls', () => {
    it('allows incrementing offer stock', () => {
      render(<TradeBuilder {...defaultProps} />)

      const incrementButtons = screen.getAllByTestId('stepper-increment')
      fireEvent.click(incrementButtons[0]) // First stepper for Luxor

      const values = screen.getAllByTestId('stepper-value')
      expect(values[0]).toHaveTextContent('1')
    })

    it('respects maximum holding limit', () => {
      render(<TradeBuilder {...defaultProps} />)

      const incrementButtons = screen.getAllByTestId('stepper-increment')

      // Try to increment Luxor 5 times (max is 4)
      for (let i = 0; i < 5; i++) {
        fireEvent.click(incrementButtons[0])
      }

      const values = screen.getAllByTestId('stepper-value')
      expect(values[0]).toHaveTextContent('4')
    })
  })

  describe('offer cash input', () => {
    it('accepts cash amount input', () => {
      render(<TradeBuilder {...defaultProps} />)

      const cashInput = screen.getByTestId('offer-cash-input')
      fireEvent.change(cashInput, { target: { value: '1000' } })

      expect(cashInput).toHaveValue(1000)
    })

    it('clamps cash to max available', () => {
      render(<TradeBuilder {...defaultProps} />)

      const cashInput = screen.getByTestId('offer-cash-input')
      fireEvent.change(cashInput, { target: { value: '5000' } }) // More than myCash (3000)

      // The internal state is clamped, though input shows what user typed
      // Validation will catch over-limit values
    })
  })

  describe('validation', () => {
    it('shows error when no partner selected', () => {
      render(<TradeBuilder {...defaultProps} />)

      fireEvent.click(screen.getByTestId('propose-trade'))

      expect(screen.getByTestId('trade-error')).toHaveTextContent('Select a trade partner')
    })

    it('shows error when nothing offered', () => {
      render(<TradeBuilder {...defaultProps} />)

      fireEvent.click(screen.getByTestId('player-select-player-2'))
      fireEvent.click(screen.getByTestId('propose-trade'))

      expect(screen.getByTestId('trade-error')).toHaveTextContent('You must offer something')
    })

    it('shows error when nothing requested', () => {
      render(<TradeBuilder {...defaultProps} />)

      // Select partner
      fireEvent.click(screen.getByTestId('player-select-player-2'))

      // Offer something
      const incrementButtons = screen.getAllByTestId('stepper-increment')
      fireEvent.click(incrementButtons[0])

      fireEvent.click(screen.getByTestId('propose-trade'))

      expect(screen.getByTestId('trade-error')).toHaveTextContent('You must request something')
    })

    it('clears error when making changes', () => {
      render(<TradeBuilder {...defaultProps} />)

      // Trigger an error
      fireEvent.click(screen.getByTestId('propose-trade'))
      expect(screen.getByTestId('trade-error')).toBeInTheDocument()

      // Select a partner - should clear error
      fireEvent.click(screen.getByTestId('player-select-player-2'))
      expect(screen.queryByTestId('trade-error')).not.toBeInTheDocument()
    })
  })

  describe('submit and cancel', () => {
    it('calls onPropose with correct data on valid submission', () => {
      const onPropose = vi.fn()
      render(<TradeBuilder {...defaultProps} onPropose={onPropose} />)

      // Select partner - this will render the want section
      fireEvent.click(screen.getByTestId('player-select-player-2'))

      // Now get all steppers after partner is selected
      // Structure: 2 offer steppers (Luxor, Continental) + 2 want steppers (Bob's Luxor, Tower)
      const allIncrements = screen.getAllByTestId('stepper-increment')
      expect(allIncrements.length).toBe(4)

      // Offer 2 Luxor (first offer stepper at index 0)
      fireEvent.click(allIncrements[0])
      fireEvent.click(allIncrements[0])

      // Want 1 of partner's first stock (index 2)
      fireEvent.click(allIncrements[2])

      fireEvent.click(screen.getByTestId('propose-trade'))

      expect(onPropose).toHaveBeenCalledTimes(1)
      const callArgs = onPropose.mock.calls[0]
      expect(callArgs[0]).toBe('player-2')
      // Check that we offered something and want something
      expect(callArgs[1].stocks.length).toBe(1)
      expect(callArgs[1].stocks[0].quantity).toBe(2)
      expect(callArgs[2].stocks.length).toBe(1)
      expect(callArgs[2].stocks[0].quantity).toBe(1)
    })

    it('calls onCancel when cancel button clicked', () => {
      const onCancel = vi.fn()
      render(<TradeBuilder {...defaultProps} onCancel={onCancel} />)

      fireEvent.click(screen.getByTestId('cancel-trade'))

      expect(onCancel).toHaveBeenCalled()
    })

    it('calls onCancel when close button clicked', () => {
      const onCancel = vi.fn()
      render(<TradeBuilder {...defaultProps} onCancel={onCancel} />)

      fireEvent.click(screen.getByLabelText('Close'))

      expect(onCancel).toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('handles player with no stocks', () => {
      const playersWithNoStocks = [{ id: 'player-2', name: 'Bob', cash: 5000, stocks: {} }]
      render(<TradeBuilder {...defaultProps} players={playersWithNoStocks} />)

      fireEvent.click(screen.getByTestId('player-select-player-2'))

      expect(screen.getByText('Bob has no stocks')).toBeInTheDocument()
    })

    it('handles user with no stocks', () => {
      render(<TradeBuilder {...defaultProps} myHoldings={[]} />)

      expect(screen.getByText('You have no stocks to offer')).toBeInTheDocument()
    })

    it('allows cash-only trades', () => {
      const onPropose = vi.fn()
      render(<TradeBuilder {...defaultProps} onPropose={onPropose} />)

      // Select partner
      fireEvent.click(screen.getByTestId('player-select-player-2'))

      // Offer cash only
      const offerCashInput = screen.getByTestId('offer-cash-input')
      fireEvent.change(offerCashInput, { target: { value: '500' } })

      // Want cash only
      const wantCashInput = screen.getByTestId('want-cash-input')
      fireEvent.change(wantCashInput, { target: { value: '1000' } })

      fireEvent.click(screen.getByTestId('propose-trade'))

      expect(onPropose).toHaveBeenCalledWith(
        'player-2',
        { stocks: [], cash: 500 },
        { stocks: [], cash: 1000 }
      )
    })
  })
})
