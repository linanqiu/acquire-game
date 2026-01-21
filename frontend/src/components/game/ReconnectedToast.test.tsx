import { render, screen, fireEvent } from '@testing-library/react'
import { ReconnectedToast, ReconnectedToastProps } from './ReconnectedToast'

const defaultProps: ReconnectedToastProps = {
  playerName: 'Alice',
  currentTurn: 'Bob',
  phase: 'Buy Stocks',
  cash: 6500,
  stockCount: 12,
  tileCount: 5,
  onContinue: vi.fn(),
}

describe('ReconnectedToast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders reconnected toast', () => {
      render(<ReconnectedToast {...defaultProps} />)

      expect(screen.getByTestId('reconnected-toast')).toBeInTheDocument()
      expect(screen.getByText('RECONNECTED')).toBeInTheDocument()
    })

    it('shows welcome message with player name', () => {
      render(<ReconnectedToast {...defaultProps} playerName="Carol" />)

      expect(screen.getByText('Welcome back, Carol!')).toBeInTheDocument()
    })

    it('shows current turn and phase', () => {
      render(<ReconnectedToast {...defaultProps} />)

      expect(screen.getByText('Bob (Buy Stocks)')).toBeInTheDocument()
    })

    it('shows cash amount', () => {
      render(<ReconnectedToast {...defaultProps} cash={12500} />)

      expect(screen.getByText('$12,500')).toBeInTheDocument()
    })

    it('shows stock count', () => {
      render(<ReconnectedToast {...defaultProps} stockCount={15} />)

      expect(screen.getByText('15 total')).toBeInTheDocument()
    })

    it('shows tile count', () => {
      render(<ReconnectedToast {...defaultProps} tileCount={6} />)

      expect(screen.getByText('6 in hand')).toBeInTheDocument()
    })

    it('shows continue playing button', () => {
      render(<ReconnectedToast {...defaultProps} />)

      expect(screen.getByTestId('continue-playing')).toBeInTheDocument()
      expect(screen.getByText('CONTINUE PLAYING')).toBeInTheDocument()
    })
  })

  describe('interactions', () => {
    it('calls onContinue when continue button clicked', () => {
      const onContinue = vi.fn()
      render(<ReconnectedToast {...defaultProps} onContinue={onContinue} />)

      fireEvent.click(screen.getByTestId('continue-playing'))

      expect(onContinue).toHaveBeenCalledTimes(1)
    })
  })

  describe('formatting', () => {
    it('formats large cash amounts correctly', () => {
      render(<ReconnectedToast {...defaultProps} cash={1234567} />)

      expect(screen.getByText('$1,234,567')).toBeInTheDocument()
    })

    it('formats zero cash correctly', () => {
      render(<ReconnectedToast {...defaultProps} cash={0} />)

      expect(screen.getByText('$0')).toBeInTheDocument()
    })

    it('shows zero stocks correctly', () => {
      render(<ReconnectedToast {...defaultProps} stockCount={0} />)

      expect(screen.getByText('0 total')).toBeInTheDocument()
    })

    it('shows zero tiles correctly', () => {
      render(<ReconnectedToast {...defaultProps} tileCount={0} />)

      expect(screen.getByText('0 in hand')).toBeInTheDocument()
    })
  })

  describe('different phases', () => {
    it('shows Place Tile phase', () => {
      render(<ReconnectedToast {...defaultProps} phase="Place Tile" />)

      expect(screen.getByText('Bob (Place Tile)')).toBeInTheDocument()
    })

    it('shows Merger phase', () => {
      render(<ReconnectedToast {...defaultProps} phase="Merger Disposition" />)

      expect(screen.getByText('Bob (Merger Disposition)')).toBeInTheDocument()
    })
  })
})
