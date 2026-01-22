import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { HostPage } from './HostPage'
import { ToastProvider } from '../components/ui/ToastProvider'
import { useGameStore } from '../store/gameStore'
import type { GameStateMessage } from '../types/api'

// Mock useWebSocket to prevent it from changing connectionStatus during tests
vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    sendAction: vi.fn(),
    disconnect: vi.fn(),
    isConnected: true,
  }),
}))

// Helper to render HostPage with routing
function renderHostPage(room = 'TEST') {
  return render(
    <MemoryRouter initialEntries={[`/host/${room}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/host/:room" element={<HostPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  )
}

describe('HostPage', () => {
  beforeEach(() => {
    // Reset the store before each test
    useGameStore.getState().reset()
    // Set default connected state for most tests
    useGameStore.setState({ connectionStatus: 'connected' })
  })

  describe('Lobby state', () => {
    it('renders ACQUIRE title in lobby', () => {
      renderHostPage('WXYZ')
      expect(screen.getByText('ACQUIRE')).toBeInTheDocument()
    })

    it('shows room code', () => {
      renderHostPage('WXYZ')
      expect(screen.getByText('WXYZ')).toBeInTheDocument()
    })

    it('shows player count heading', () => {
      useGameStore.setState({
        lobbyPlayers: [
          { player_id: '1', name: 'Player 1', is_bot: false },
          { player_id: '2', name: 'Player 2', is_bot: true },
        ],
      })
      renderHostPage()
      expect(screen.getByText('PLAYERS (2/6)')).toBeInTheDocument()
    })

    it('shows lobby players', () => {
      useGameStore.setState({
        lobbyPlayers: [
          { player_id: '1', name: 'Alice', is_bot: false },
          { player_id: '2', name: 'Bot1', is_bot: true },
        ],
      })
      renderHostPage()
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Bot1')).toBeInTheDocument()
    })

    it('shows add bot and start game buttons', () => {
      renderHostPage()
      expect(screen.getByText('+ ADD BOT')).toBeInTheDocument()
      expect(screen.getByText('START GAME')).toBeInTheDocument()
    })

    it('disables start game button when canStart is false', () => {
      useGameStore.setState({ canStart: false, lobbyPlayers: [] })
      renderHostPage()
      const startButton = screen.getByText('START GAME')
      expect(startButton).toBeDisabled()
    })

    it('enables start game button when canStart is true', () => {
      useGameStore.setState({
        canStart: true,
        lobbyPlayers: [
          { player_id: '1', name: 'P1', is_bot: false },
          { player_id: '2', name: 'P2', is_bot: false },
          { player_id: '3', name: 'P3', is_bot: false },
        ],
      })
      renderHostPage()
      const startButton = screen.getByText('START GAME')
      expect(startButton).not.toBeDisabled()
    })

    it('shows need more players message', () => {
      useGameStore.setState({
        lobbyPlayers: [{ player_id: '1', name: 'P1', is_bot: false }],
      })
      renderHostPage()
      expect(screen.getByText('Need 2 more players to start')).toBeInTheDocument()
    })

    it('shows ready to start message when enough players', () => {
      useGameStore.setState({
        canStart: true,
        lobbyPlayers: [
          { player_id: '1', name: 'P1', is_bot: false },
          { player_id: '2', name: 'P2', is_bot: false },
          { player_id: '3', name: 'P3', is_bot: false },
        ],
      })
      renderHostPage()
      expect(screen.getByText('Ready to start!')).toBeInTheDocument()
    })
  })

  describe('Connection states', () => {
    it('shows connecting spinner', () => {
      useGameStore.setState({ connectionStatus: 'connecting' })
      renderHostPage()
      expect(screen.getByText('Connecting to game...')).toBeInTheDocument()
    })

    it('shows error state with refresh button', () => {
      useGameStore.setState({ connectionStatus: 'error' })
      renderHostPage()
      expect(screen.getByText('Connection error. Please refresh the page.')).toBeInTheDocument()
      expect(screen.getByText('REFRESH')).toBeInTheDocument()
    })
  })

  describe('Game state', () => {
    const mockGameState: GameStateMessage = {
      type: 'game_state',
      board: { cells: {} },
      hotel: {
        chains: [
          { name: 'Luxor', size: 5, price: 400, stocks_available: 20 },
          { name: 'Tower', size: 3, price: 300, stocks_available: 25 },
        ],
        available_stocks: { Luxor: 20, Tower: 25 } as any,
        active_chains: ['Luxor'],
      },
      turn_order: ['player1', 'player2'],
      current_player: 'player1',
      phase: 'place_tile',
      players: {
        player1: { name: 'Alice', money: 6000, stocks: { Luxor: 2 } as any, hand_size: 6 },
        player2: { name: 'Bob', money: 5000, stocks: {} as any, hand_size: 6 },
      },
      tiles_remaining: 100,
    }

    it('shows game layout with board', () => {
      useGameStore.setState({ gameState: mockGameState })
      renderHostPage()
      expect(screen.getByTestId('board')).toBeInTheDocument()
    })

    it('shows phase indicator with current player', () => {
      useGameStore.setState({ gameState: mockGameState })
      renderHostPage()
      expect(screen.getByText("Alice's TURN - PLACE TILE")).toBeInTheDocument()
    })

    it('shows chains panel', () => {
      useGameStore.setState({ gameState: mockGameState })
      renderHostPage()
      expect(screen.getByText('CHAINS')).toBeInTheDocument()
    })

    it('shows scoreboard panel', () => {
      useGameStore.setState({ gameState: mockGameState })
      renderHostPage()
      expect(screen.getByText('SCOREBOARD')).toBeInTheDocument()
    })

    it('shows all players in scoreboard', () => {
      useGameStore.setState({ gameState: mockGameState })
      renderHostPage()
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Bob')).toBeInTheDocument()
    })

    it('shows active chains with info', () => {
      useGameStore.setState({ gameState: mockGameState })
      renderHostPage()
      // There may be multiple chain markers (in chains panel and scoreboard), so use getAllBy
      const luxorMarkers = screen.getAllByTestId('chain-marker-luxor')
      expect(luxorMarkers.length).toBeGreaterThan(0)
    })

    it('shows activity log', () => {
      useGameStore.setState({ gameState: mockGameState })
      renderHostPage()
      expect(screen.getByText('ACTIVITY:')).toBeInTheDocument()
    })

    it('shows header with room code during game', () => {
      useGameStore.setState({ gameState: mockGameState })
      renderHostPage('GAME')
      expect(screen.getByText('GAME')).toBeInTheDocument()
    })
  })

  describe('Game over state', () => {
    it('shows game over screen', () => {
      const gameOverState: GameStateMessage = {
        type: 'game_state',
        board: { cells: {} },
        hotel: {
          chains: [],
          available_stocks: {} as any,
          active_chains: [],
        },
        turn_order: ['player1', 'player2'],
        current_player: 'player1',
        phase: 'game_over',
        players: {
          player1: { name: 'Alice', money: 15000, stocks: {} as any, hand_size: 0 },
          player2: { name: 'Bob', money: 10000, stocks: {} as any, hand_size: 0 },
        },
        tiles_remaining: 0,
      }

      useGameStore.setState({ gameState: gameOverState })
      renderHostPage()
      expect(screen.getByTestId('game-over')).toBeInTheDocument()
      // "GAME OVER" appears in phase indicator and game over card, so use getAllBy
      const gameOverTexts = screen.getAllByText('GAME OVER')
      expect(gameOverTexts.length).toBeGreaterThan(0)
    })

    it('shows play again and back to lobby buttons', () => {
      const gameOverState: GameStateMessage = {
        type: 'game_state',
        board: { cells: {} },
        hotel: {
          chains: [],
          available_stocks: {} as any,
          active_chains: [],
        },
        turn_order: ['player1'],
        current_player: 'player1',
        phase: 'game_over',
        players: {
          player1: { name: 'Alice', money: 15000, stocks: {} as any, hand_size: 0 },
        },
        tiles_remaining: 0,
      }

      useGameStore.setState({ gameState: gameOverState })
      renderHostPage()
      expect(screen.getByTestId('play-again')).toBeInTheDocument()
      expect(screen.getByTestId('back-to-lobby')).toBeInTheDocument()
    })
  })
})
