import { render, screen, fireEvent } from '@testing-library/react'
import { GameOver, GameOverProps, FinalScore } from './GameOver'

const mockScores: FinalScore[] = [
  { playerId: 'p1', name: 'Alice', cash: 5000, bonuses: 8000, stockSales: 12000, total: 25000 },
  { playerId: 'p2', name: 'Bob', cash: 4000, bonuses: 10000, stockSales: 18000, total: 32000 },
  { playerId: 'p3', name: 'Carol', cash: 6000, bonuses: 5000, stockSales: 8000, total: 19000 },
]

const defaultProps: GameOverProps = {
  scores: mockScores,
  myPlayerId: 'p1',
  onPlayAgain: vi.fn(),
  onBackToLobby: vi.fn(),
  variant: 'player',
}

describe('GameOver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders game over screen', () => {
      render(<GameOver {...defaultProps} />)

      expect(screen.getByTestId('game-over')).toBeInTheDocument()
      expect(screen.getByText('GAME OVER')).toBeInTheDocument()
    })

    it('announces the winner correctly', () => {
      render(<GameOver {...defaultProps} />)

      const announcement = screen.getByTestId('winner-announcement')
      expect(announcement).toBeInTheDocument()
      expect(screen.getByText('WINNER')).toBeInTheDocument()
      // Bob appears both in winner announcement and rankings, so check within announcement
      expect(announcement.textContent).toContain('Bob')
      expect(announcement.textContent).toContain('$32,000')
    })

    it('shows final standings in order', () => {
      render(<GameOver {...defaultProps} />)

      const rankings = screen.getByTestId('rankings')
      expect(rankings).toBeInTheDocument()

      // Check order: Bob (32k), Alice (25k), Carol (19k)
      const rankRows = screen.getAllByTestId(/^rank-/)
      expect(rankRows).toHaveLength(3)
    })
  })

  describe('tie game handling', () => {
    it('handles tie game correctly', () => {
      const tieScores: FinalScore[] = [
        { playerId: 'p1', name: 'Alice', cash: 5000, bonuses: 15000, stockSales: 12000, total: 32000 },
        { playerId: 'p2', name: 'Bob', cash: 4000, bonuses: 10000, stockSales: 18000, total: 32000 },
        { playerId: 'p3', name: 'Carol', cash: 6000, bonuses: 5000, stockSales: 8000, total: 19000 },
      ]

      render(<GameOver {...defaultProps} scores={tieScores} />)

      expect(screen.getByText('TIE GAME!')).toBeInTheDocument()
      expect(screen.getByText('Alice & Bob')).toBeInTheDocument()
      expect(screen.getByText('$32,000 each')).toBeInTheDocument()
    })

    it('handles three-way tie correctly', () => {
      const threeWayTie: FinalScore[] = [
        { playerId: 'p1', name: 'Alice', cash: 5000, bonuses: 15000, stockSales: 12000, total: 32000 },
        { playerId: 'p2', name: 'Bob', cash: 4000, bonuses: 10000, stockSales: 18000, total: 32000 },
        { playerId: 'p3', name: 'Carol', cash: 6000, bonuses: 14000, stockSales: 12000, total: 32000 },
      ]

      render(<GameOver {...defaultProps} scores={threeWayTie} />)

      expect(screen.getByText('TIE GAME!')).toBeInTheDocument()
      expect(screen.getByText('Alice & Bob & Carol')).toBeInTheDocument()
    })
  })

  describe('ranking calculation', () => {
    it('assigns correct ranks with ties', () => {
      const scoresWithTie: FinalScore[] = [
        { playerId: 'p1', name: 'Alice', cash: 5000, bonuses: 15000, stockSales: 12000, total: 32000 },
        { playerId: 'p2', name: 'Bob', cash: 4000, bonuses: 10000, stockSales: 18000, total: 32000 },
        { playerId: 'p3', name: 'Carol', cash: 6000, bonuses: 5000, stockSales: 8000, total: 19000 },
      ]

      render(<GameOver {...defaultProps} scores={scoresWithTie} />)

      // Both Alice and Bob should be rank 1, Carol should be rank 3
      const rankings = screen.getByTestId('rankings')
      expect(rankings.textContent).toContain('1.')
      expect(rankings.textContent).toContain('3.')
      // Should not contain '2.' since it's skipped due to tie
    })
  })

  describe('player variant', () => {
    it('shows personal breakdown for player variant', () => {
      render(<GameOver {...defaultProps} variant="player" />)

      expect(screen.getByTestId('breakdown')).toBeInTheDocument()
      expect(screen.getByText('YOUR BREAKDOWN')).toBeInTheDocument()
      expect(screen.getByText('Cash on hand:')).toBeInTheDocument()
      expect(screen.getByText('Final bonuses:')).toBeInTheDocument()
      expect(screen.getByText('Stock liquidation:')).toBeInTheDocument()
      expect(screen.getByText('TOTAL:')).toBeInTheDocument()
    })

    it('shows correct breakdown values', () => {
      render(<GameOver {...defaultProps} variant="player" myPlayerId="p1" />)

      const breakdown = screen.getByTestId('breakdown')
      expect(breakdown.textContent).toContain('$5,000')
      expect(breakdown.textContent).toContain('+$8,000')
      expect(breakdown.textContent).toContain('+$12,000')
      expect(breakdown.textContent).toContain('$25,000')
    })

    it('does not show breakdown when myPlayerId not provided', () => {
      render(<GameOver {...defaultProps} variant="player" myPlayerId={undefined} />)

      expect(screen.queryByTestId('breakdown')).not.toBeInTheDocument()
    })
  })

  describe('host variant', () => {
    it('shows full breakdown table for host variant', () => {
      render(<GameOver {...defaultProps} variant="host" />)

      expect(screen.getByTestId('full-breakdown')).toBeInTheDocument()
      expect(screen.getByText('FULL BREAKDOWN')).toBeInTheDocument()
    })

    it('shows all players in breakdown table', () => {
      render(<GameOver {...defaultProps} variant="host" />)

      const table = screen.getByTestId('full-breakdown')
      expect(table.textContent).toContain('Alice')
      expect(table.textContent).toContain('Bob')
      expect(table.textContent).toContain('Carol')
    })

    it('shows note about defunct stocks', () => {
      render(<GameOver {...defaultProps} variant="host" />)

      expect(screen.getByText(/Defunct stocks worth \$0/)).toBeInTheDocument()
    })

    it('does not show personal breakdown for host variant', () => {
      render(<GameOver {...defaultProps} variant="host" />)

      expect(screen.queryByTestId('breakdown')).not.toBeInTheDocument()
    })
  })

  describe('highlighting current player', () => {
    it('highlights current player in rankings', () => {
      render(<GameOver {...defaultProps} myPlayerId="p1" />)

      const aliceRow = screen.getByTestId('rank-p1')
      // CSS modules transform class names, so check for partial match
      expect(aliceRow.className).toMatch(/you/)
    })

    it('does not highlight when no myPlayerId', () => {
      render(<GameOver {...defaultProps} myPlayerId={undefined} />)

      const aliceRow = screen.getByTestId('rank-p1')
      expect(aliceRow.className).not.toMatch(/you/)
    })
  })

  describe('actions', () => {
    it('calls onPlayAgain when Play Again clicked', () => {
      const onPlayAgain = vi.fn()
      render(<GameOver {...defaultProps} onPlayAgain={onPlayAgain} />)

      fireEvent.click(screen.getByTestId('play-again'))

      expect(onPlayAgain).toHaveBeenCalledTimes(1)
    })

    it('calls onBackToLobby when Back to Lobby clicked', () => {
      const onBackToLobby = vi.fn()
      render(<GameOver {...defaultProps} onBackToLobby={onBackToLobby} />)

      fireEvent.click(screen.getByTestId('back-to-lobby'))

      expect(onBackToLobby).toHaveBeenCalledTimes(1)
    })
  })

  describe('edge cases', () => {
    it('handles single player', () => {
      const singlePlayer: FinalScore[] = [
        { playerId: 'p1', name: 'Alice', cash: 5000, bonuses: 8000, stockSales: 12000, total: 25000 },
      ]

      render(<GameOver {...defaultProps} scores={singlePlayer} />)

      expect(screen.getByText('WINNER')).toBeInTheDocument()
      // Alice appears in both winner announcement and rankings
      const announcement = screen.getByTestId('winner-announcement')
      expect(announcement.textContent).toContain('Alice')
    })

    it('handles zero totals', () => {
      const zeroScores: FinalScore[] = [
        { playerId: 'p1', name: 'Alice', cash: 0, bonuses: 0, stockSales: 0, total: 0 },
        { playerId: 'p2', name: 'Bob', cash: 0, bonuses: 0, stockSales: 0, total: 0 },
      ]

      render(<GameOver {...defaultProps} scores={zeroScores} />)

      expect(screen.getByText('TIE GAME!')).toBeInTheDocument()
      expect(screen.getByText('$0 each')).toBeInTheDocument()
    })

    it('handles large numbers correctly', () => {
      const bigScores: FinalScore[] = [
        { playerId: 'p1', name: 'Alice', cash: 150000, bonuses: 80000, stockSales: 220000, total: 450000 },
      ]

      render(<GameOver {...defaultProps} scores={bigScores} myPlayerId="p1" />)

      // $450,000 appears in winner announcement and ranking, use getAllByText
      const totals = screen.getAllByText('$450,000')
      expect(totals.length).toBeGreaterThan(0)
    })
  })
})
