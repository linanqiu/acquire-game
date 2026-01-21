import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { PlayerPage } from './PlayerPage'
import { ToastProvider } from '../components/ui/ToastProvider'
import { useGameStore } from '../store/gameStore'
import type { GameStateMessage } from '../types/api'

// Helper to render PlayerPage with routing
function renderPlayerPage(room = 'TEST') {
  return render(
    <MemoryRouter initialEntries={[`/play/${room}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/play/:room" element={<PlayerPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  )
}

describe('PlayerPage', () => {
  beforeEach(() => {
    // Reset the store before each test
    useGameStore.getState().reset()
  })

  describe('Lobby state', () => {
    it('renders lobby content when in lobby phase', () => {
      renderPlayerPage('ABCD')
      expect(screen.getByText('WAITING FOR PLAYERS')).toBeInTheDocument()
      expect(screen.getByText('ABCD')).toBeInTheDocument()
    })

    it('shows player count', () => {
      useGameStore.setState({
        lobbyPlayers: [
          { player_id: '1', name: 'Player 1', is_bot: false },
          { player_id: '2', name: 'Player 2', is_bot: true },
        ],
      })
      renderPlayerPage()
      expect(screen.getByText('2/6 players')).toBeInTheDocument()
    })

    it('shows lobby players', () => {
      useGameStore.setState({
        lobbyPlayers: [
          { player_id: '1', name: 'Alice', is_bot: false },
          { player_id: '2', name: 'Bot1', is_bot: true },
        ],
      })
      renderPlayerPage()
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Bot1')).toBeInTheDocument()
      expect(screen.getByText('BOT')).toBeInTheDocument()
    })

    it('shows host controls when is_host query param is set', () => {
      render(
        <MemoryRouter initialEntries={['/play/TEST?is_host=1']}>
          <ToastProvider>
            <Routes>
              <Route path="/play/:room" element={<PlayerPage />} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      )
      expect(screen.getByText('+ ADD BOT')).toBeInTheDocument()
      expect(screen.getByText('START GAME')).toBeInTheDocument()
    })

    it('shows waiting text for non-host', () => {
      renderPlayerPage()
      expect(screen.getByText('Waiting for host to start...')).toBeInTheDocument()
    })

    it('disables start game button when canStart is false', () => {
      useGameStore.setState({ canStart: false })
      render(
        <MemoryRouter initialEntries={['/play/TEST?is_host=1']}>
          <ToastProvider>
            <Routes>
              <Route path="/play/:room" element={<PlayerPage />} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      )
      const startButton = screen.getByText('START GAME')
      expect(startButton).toBeDisabled()
    })
  })

  describe('Connection states', () => {
    it('shows connecting spinner', () => {
      useGameStore.setState({ connectionStatus: 'connecting' })
      renderPlayerPage()
      expect(screen.getByText('Connecting to game...')).toBeInTheDocument()
    })

    it('shows error state with refresh button', () => {
      useGameStore.setState({ connectionStatus: 'error' })
      renderPlayerPage()
      expect(screen.getByText('Connection error. Please refresh the page.')).toBeInTheDocument()
      expect(screen.getByText('REFRESH')).toBeInTheDocument()
    })
  })

  describe('Game state phases', () => {
    const mockGameState: GameStateMessage = {
      type: 'game_state',
      board: { cells: {} },
      hotel: {
        chains: [
          { name: 'Luxor', size: 0, price: 0, stocks_available: 25 },
          { name: 'Tower', size: 0, price: 0, stocks_available: 25 },
        ],
        available_stocks: { Luxor: 25, Tower: 25 } as any,
        active_chains: [],
      },
      turn_order: ['player1', 'player2'],
      current_player: 'player1',
      phase: 'place_tile',
      players: {
        player1: { name: 'Alice', money: 6000, stocks: {} as any, hand_size: 6 },
        player2: { name: 'Bob', money: 6000, stocks: {} as any, hand_size: 6 },
      },
      tiles_remaining: 100,
      your_hand: ['1A', '2B', '3C'],
    }

    it('shows phase indicator for place_tile', () => {
      useGameStore.setState({
        gameState: mockGameState,
        currentPlayer: { id: 'player1', name: 'Alice', token: 'tok', isHost: true },
        yourHand: ['1A', '2B', '3C'],
      })
      renderPlayerPage()
      expect(screen.getByText('PLACE A TILE')).toBeInTheDocument()
    })

    it('shows waiting message when not your turn', () => {
      useGameStore.setState({
        gameState: mockGameState,
        currentPlayer: { id: 'player2', name: 'Bob', token: 'tok', isHost: false },
        yourHand: [],
      })
      renderPlayerPage()
      expect(screen.getByText(/Waiting for Alice/i)).toBeInTheDocument()
    })

    it('shows tile rack during game phases', () => {
      useGameStore.setState({
        gameState: mockGameState,
        currentPlayer: { id: 'player1', name: 'Alice', token: 'tok', isHost: true },
        yourHand: ['1A', '2B', '3C'],
      })
      renderPlayerPage()
      expect(screen.getByTestId('tile-rack')).toBeInTheDocument()
    })

    it('shows buy stocks phase', () => {
      useGameStore.setState({
        gameState: {
          ...mockGameState,
          phase: 'buy_stocks',
          hotel: {
            ...mockGameState.hotel,
            active_chains: ['Luxor'],
            chains: [
              { name: 'Luxor', size: 3, price: 300, stocks_available: 22 },
            ],
          },
        },
        currentPlayer: { id: 'player1', name: 'Alice', token: 'tok', isHost: true },
        yourHand: ['1A'],
      })
      renderPlayerPage()
      // "BUY STOCKS" may appear in phase indicator and card title
      const buyStocksTexts = screen.getAllByText('BUY STOCKS')
      expect(buyStocksTexts.length).toBeGreaterThan(0)
      expect(screen.getByText('PROPOSE TRADE')).toBeInTheDocument()
    })

    it('shows founding content when pendingChainChoice is set', () => {
      useGameStore.setState({
        gameState: { ...mockGameState, phase: 'found_chain' },
        currentPlayer: { id: 'player1', name: 'Alice', token: 'tok', isHost: true },
        yourHand: ['1A'],
        pendingChainChoice: ['Luxor', 'Tower'],
      })
      renderPlayerPage()
      expect(screen.getByText('FOUND A NEW CHAIN')).toBeInTheDocument()
      expect(screen.getByTestId('chain-selector')).toBeInTheDocument()
    })
  })

  describe('Portfolio display', () => {
    it('shows portfolio during game', () => {
      const mockGameState: GameStateMessage = {
        type: 'game_state',
        board: { cells: {} },
        hotel: {
          chains: [{ name: 'Luxor', size: 3, price: 300, stocks_available: 22 }],
          available_stocks: { Luxor: 22 } as any,
          active_chains: ['Luxor'],
        },
        turn_order: ['player1'],
        current_player: 'player1',
        phase: 'place_tile',
        players: {
          player1: {
            name: 'Alice',
            money: 5700,
            stocks: { Luxor: 3 } as any,
            hand_size: 6,
          },
        },
        tiles_remaining: 100,
      }

      useGameStore.setState({
        gameState: mockGameState,
        currentPlayer: { id: 'player1', name: 'Alice', token: 'tok', isHost: true },
        yourHand: ['1A'],
      })

      renderPlayerPage()
      // Portfolio should be visible
      expect(screen.getByTestId('portfolio-table')).toBeInTheDocument()
    })
  })
})
