import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { PlayerPage } from './PlayerPage'
import { ToastProvider } from '../components/ui/ToastProvider'
import { useGameStore } from '../store/gameStore'
import type { GameStateMessage } from '../types/api'

// Mock useWebSocket to prevent it from changing connectionStatus during tests
const { sendAction } = vi.hoisted(() => ({ sendAction: vi.fn((_action: unknown) => true) }))

vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    sendAction,
    reconnect: vi.fn(() => Promise.resolve(true)),
    disconnect: vi.fn(),
    isConnected: true,
  }),
}))

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
    sendAction.mockClear()
    // Reset the store before each test
    useGameStore.getState().reset()
    // Set default connected state for most tests
    useGameStore.setState({ connectionStatus: 'connected' })
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

    it('does not let the board select a tile the engine says is unplayable', () => {
      useGameStore.setState({
        gameState: mockGameState,
        currentPlayer: { id: 'player1', name: 'Alice', token: 'tok', isHost: true },
        yourHand: ['1A', '2B'],
        tilePlayability: {
          '1A': { playable: true, reason: null, permanent: null, would_trigger_merger: false },
          '2B': {
            playable: false,
            reason: 'would_create_eighth_chain',
            permanent: true,
            would_trigger_merger: false,
          },
        },
      })
      renderPlayerPage()
      // The rack explains why 2B is blocked.
      expect(screen.getByTestId('rack-note-2B')).toHaveTextContent(/8th hotel chain/)
      const board = screen.getByTestId('board')
      // Clicking the blocked tile's square does nothing; the playable one selects.
      fireEvent.click(board.querySelector('[data-testid="tile-2B"]')!)
      expect(screen.queryByTestId('place-tile-button')).not.toBeInTheDocument()
      fireEvent.click(board.querySelector('[data-testid="tile-1A"]')!)
      expect(screen.getByTestId('place-tile-button')).toBeInTheDocument()
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
            chains: [{ name: 'Luxor', size: 3, price: 300, stocks_available: 22 }],
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

    it('clears the survivor prompt once the answer is sent (phase stays merger)', () => {
      useGameStore.setState({
        gameState: { ...mockGameState, phase: 'merger' },
        currentPlayer: { id: 'player1', name: 'Alice', token: 'tok', isHost: true },
        yourHand: ['1A'],
        pendingMergerChoice: ['Luxor', 'Tower'],
      })
      renderPlayerPage()
      expect(screen.getByTestId('chain-selector')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('chain-button-tower'))
      // Without this the selector would stay on screen over the disposition that follows.
      expect(useGameStore.getState().pendingMergerChoice).toBeNull()
      expect(screen.queryByTestId('chain-selector')).not.toBeInTheDocument()
    })

    it('clears the disposition prompt once it is confirmed', () => {
      useGameStore.setState({
        gameState: { ...mockGameState, phase: 'merger' },
        currentPlayer: { id: 'player1', name: 'Alice', token: 'tok', isHost: true },
        yourHand: ['1A'],
        pendingStockDisposition: {
          defunctChain: 'Luxor',
          survivingChain: 'Tower',
          stockCount: 3,
          availableToTrade: 5,
        },
      })
      renderPlayerPage()
      fireEvent.click(screen.getByTestId('confirm-disposition'))
      expect(useGameStore.getState().pendingStockDisposition).toBeNull()
      expect(screen.queryByTestId('merger-disposition')).not.toBeInTheDocument()
    })

    describe('ending the buy phase', () => {
      const buyState = () =>
        useGameStore.setState({
          gameState: {
            ...mockGameState,
            phase: 'buy_stocks',
            hotel: {
              ...mockGameState.hotel,
              active_chains: ['Luxor'],
              chains: [{ name: 'Luxor', size: 3, price: 300, stocks_available: 22 }],
              available_stocks: { Luxor: 22 } as any,
            },
          },
          currentPlayer: { id: 'player1', name: 'Alice', token: 'tok', isHost: true },
          yourHand: ['1A'],
        })

      it('skipping sends end_turn, not an empty buy', () => {
        buyState()
        renderPlayerPage()
        fireEvent.click(screen.getByTestId('end-turn-button'))
        expect(sendAction).toHaveBeenCalledWith({ action: 'end_turn' })
      })

      it('buying sends the purchases', () => {
        buyState()
        renderPlayerPage()
        fireEvent.click(screen.getByTestId('stepper-increment'))
        fireEvent.click(screen.getByTestId('end-turn-button'))
        expect(sendAction).toHaveBeenCalledWith({
          action: 'buy_stocks',
          purchases: { Luxor: 1 },
        })
      })

      it('shows price and size per chain and caps the stepper by cash', () => {
        buyState()
        useGameStore.setState({
          gameState: {
            ...useGameStore.getState().gameState!,
            players: {
              ...mockGameState.players,
              player1: { name: 'Alice', money: 700, stocks: {} as any, hand_size: 6 },
            },
          },
        })
        renderPlayerPage()
        expect(screen.getByTestId('buy-price')).toHaveTextContent('$300')
        expect(screen.getByTestId('buy-size')).toHaveTextContent('3 tiles')
        fireEvent.click(screen.getByTestId('stepper-increment'))
        fireEvent.click(screen.getByTestId('stepper-increment'))
        // $700 pays for two $300 shares, not three.
        expect(screen.getByTestId('stepper-value')).toHaveTextContent('2')
        expect(screen.getByTestId('stepper-increment')).toBeDisabled()
      })
    })

    it('shows founding content when pendingChainChoice is set', () => {
      useGameStore.setState({
        gameState: { ...mockGameState, phase: 'found_chain' },
        currentPlayer: { id: 'player1', name: 'Alice', token: 'tok', isHost: true },
        yourHand: ['1A'],
        pendingChainChoice: ['Luxor', 'Tower'],
      })
      renderPlayerPage()
      expect(screen.getByText('Found a hotel chain')).toBeInTheDocument()
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

  describe('Leaving the room', () => {
    it('resets the game store on unmount so the next room does not open on the old game', () => {
      useGameStore.setState({
        gameState: {
          type: 'game_state',
          board: { cells: {} },
          hotel: { chains: [], available_stocks: {}, active_chains: [] },
          turn_order: ['p1'],
          current_player: 'p1',
          phase: 'game_over',
          players: { p1: { name: 'Alice', money: 9000, stocks: {}, hand_size: 0 } },
          tiles_remaining: 0,
        } as unknown as GameStateMessage,
        lobbyPlayers: [{ player_id: '1', name: 'Alice', is_bot: false }],
        yourHand: ['1A'],
      })
      const { unmount } = renderPlayerPage('OLDR')
      expect(screen.getByTestId('game-over')).toBeInTheDocument()
      unmount()
      const state = useGameStore.getState()
      expect(state.gameState).toBeNull()
      expect(state.lobbyPlayers).toEqual([])
      expect(state.yourHand).toEqual([])
    })
  })

  describe('Room unavailable', () => {
    it('says the game was not found when the server refuses the room', () => {
      useGameStore.setState({ connectionStatus: 'error', connectionError: 'Room not found' })
      renderPlayerPage('QZQZ')
      expect(screen.getByTestId('room-unavailable')).toHaveTextContent('Game QZQZ was not found')
      expect(screen.getByText('BACK TO HOME')).toBeInTheDocument()
    })

    it('says you are not a player when the server refuses the seat', () => {
      useGameStore.setState({ connectionStatus: 'error', connectionError: 'Player not found' })
      renderPlayerPage('ABCD')
      expect(screen.getByTestId('room-unavailable')).toHaveTextContent(
        'You are not a player in game ABCD'
      )
    })

    it('keeps the generic connection error for other failures', () => {
      useGameStore.setState({ connectionStatus: 'error', connectionError: 'boom' })
      renderPlayerPage()
      expect(screen.queryByTestId('room-unavailable')).toBeNull()
      expect(screen.getByText('Connection error. Please refresh the page.')).toBeInTheDocument()
    })
  })

  describe('Start hint', () => {
    it('tells the host how many more seats are needed', () => {
      useGameStore.setState({
        lobbyPlayers: [{ player_id: '1', name: 'Alice', is_bot: false }],
      })
      render(
        <MemoryRouter initialEntries={['/play/TEST?is_host=1']}>
          <ToastProvider>
            <Routes>
              <Route path="/play/:room" element={<PlayerPage />} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      )
      expect(screen.getByTestId('start-hint')).toHaveTextContent('Need 2 more players to start')
    })
  })
})
