import { render, screen, act, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { PlayerPage } from './PlayerPage'
import { ToastProvider } from '../components/ui/ToastProvider'
import { useGameStore } from '../store/gameStore'
import type { GameStateMessage, TradeOffer } from '../types/api'

const ws = vi.hoisted(() => ({
  sendAction: vi.fn(() => true),
  reconnect: vi.fn(() => Promise.resolve(true)),
  onError: undefined as undefined | ((e: string) => void),
}))

vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: (opts: { onError?: (e: string) => void }) => {
    ws.onError = opts.onError
    return {
      sendAction: ws.sendAction,
      reconnect: ws.reconnect,
      disconnect: vi.fn(),
      isConnected: true,
    }
  },
}))

function gameState(overrides: Partial<GameStateMessage> = {}): GameStateMessage {
  return {
    type: 'game_state',
    board: { cells: {} },
    hotel: {
      chains: [
        { name: 'Luxor', size: 3, price: 300, stocks_available: 20 },
        { name: 'Tower', size: 3, price: 300, stocks_available: 20 },
      ],
      available_stocks: { Luxor: 20, Tower: 20 } as GameStateMessage['hotel']['available_stocks'],
      active_chains: ['Luxor', 'Tower'],
    },
    turn_order: ['me', 'bob', 'ai'],
    current_player: 'bob',
    phase: 'place_tile',
    players: {
      me: {
        name: 'Alice',
        money: 5000,
        stocks: { Luxor: 3 } as GameStateMessage['players'][string]['stocks'],
        hand_size: 6,
      },
      bob: {
        name: 'Bob',
        money: 4000,
        stocks: { Tower: 4 } as GameStateMessage['players'][string]['stocks'],
        hand_size: 6,
      },
      ai: {
        name: 'Robo',
        money: 4000,
        stocks: { Tower: 3 } as GameStateMessage['players'][string]['stocks'],
        hand_size: 6,
        is_bot: true,
        kind: 'llm',
        agent_label: 'AI',
      },
    },
    tiles_remaining: 80,
    your_hand: ['1A'],
    ...overrides,
  }
}

const incoming: TradeOffer = {
  trade_id: 't-in',
  from_player_id: 'ai',
  to_player_id: 'me',
  offering_stocks: { Tower: 2 },
  offering_money: 0,
  requesting_stocks: { Luxor: 1 },
  requesting_money: 100,
}

const outgoing: TradeOffer = {
  trade_id: 't-out',
  from_player_id: 'me',
  to_player_id: 'bob',
  offering_stocks: { Luxor: 2 },
  offering_money: 0,
  requesting_stocks: {},
  requesting_money: 500,
}

function setup(state: GameStateMessage = gameState()) {
  useGameStore.getState().reset()
  sessionStorage.setItem('player_id', 'me')
  sessionStorage.setItem('player_name', 'Alice')
  sessionStorage.setItem('session_token', 'tok')
  useGameStore.setState({
    connectionStatus: 'connected',
    gameState: state,
    yourHand: ['1A'],
    currentPlayer: { id: 'me', name: 'Alice', token: 'tok', isHost: false },
  })
  return render(
    <MemoryRouter initialEntries={['/play/TEST']}>
      <ToastProvider>
        <Routes>
          <Route path="/play/:room" element={<PlayerPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  )
}

describe('PlayerPage trade offers', () => {
  beforeEach(() => {
    ws.sendAction.mockClear()
    ws.sendAction.mockReturnValue(true)
    ws.reconnect.mockClear()
  })

  it('renders incoming and outgoing offers from per-player state', () => {
    setup(gameState({ incoming_trades: [incoming], outgoing_trades: [outgoing] }))
    // game_state fields are applied through the store, like the real socket does
    act(() => {
      useGameStore
        .getState()
        .handleMessage(gameState({ incoming_trades: [incoming], outgoing_trades: [outgoing] }))
    })
    expect(screen.getByTestId('trade-offers')).toBeInTheDocument()
    const offer = screen.getByTestId('trade-offer-t-in')
    expect(within(offer).getByText('Robo')).toBeInTheDocument()
    expect(within(offer).getByTestId('seat-kind-ai')).toBeInTheDocument()
    expect(within(offer).getByText('×2')).toBeInTheDocument()
    expect(within(offer).getByText('$100')).toBeInTheDocument()
    const out = screen.getByTestId('trade-outgoing-t-out')
    expect(within(out).getByText('Bob')).toBeInTheDocument()
    expect(within(out).getByText('$500')).toBeInTheDocument()
  })

  it('accept, reject and cancel send the matching action', () => {
    setup()
    act(() => {
      useGameStore.getState().handleMessage({ type: 'trade_proposed', trade: incoming })
      useGameStore.getState().handleMessage({ type: 'trade_proposed', trade: outgoing })
    })
    fireEvent.click(screen.getByTestId('trade-accept-t-in'))
    expect(ws.sendAction).toHaveBeenLastCalledWith({ action: 'accept_trade', trade_id: 't-in' })
    fireEvent.click(screen.getByTestId('trade-cancel-t-out'))
    expect(ws.sendAction).toHaveBeenLastCalledWith({ action: 'cancel_trade', trade_id: 't-out' })
  })

  it('reject sends reject_trade', () => {
    setup()
    act(() => {
      useGameStore.getState().handleMessage({ type: 'trade_proposed', trade: incoming })
    })
    fireEvent.click(screen.getByTestId('trade-reject-t-in'))
    expect(ws.sendAction).toHaveBeenLastCalledWith({ action: 'reject_trade', trade_id: 't-in' })
  })

  it('disables Accept with a reason when the player cannot fulfil the offer', () => {
    setup()
    const expensive = { ...incoming, requesting_stocks: { Luxor: 9 }, requesting_money: 0 }
    act(() => {
      useGameStore.getState().handleMessage({ type: 'trade_proposed', trade: expensive })
    })
    expect(screen.getByTestId('trade-accept-t-in')).toBeDisabled()
    expect(screen.getByTestId('trade-reason-t-in')).toHaveTextContent('You only have 3 Luxor')
    // Reject stays available
    expect(screen.getByTestId('trade-reject-t-in')).toBeEnabled()
  })

  it('toasts when an offer arrives and when one of mine is accepted or rejected', () => {
    setup()
    act(() => {
      useGameStore.getState().handleMessage({ type: 'trade_proposed', trade: incoming })
    })
    expect(screen.getByText('Robo sent you a trade offer')).toBeInTheDocument()

    act(() => {
      useGameStore.getState().handleMessage({ type: 'trade_proposed', trade: outgoing })
    })
    act(() => {
      useGameStore.getState().handleMessage({
        type: 'trade_accepted',
        trade_id: 't-out',
        from_player: 'me',
        to_player: 'bob',
      })
    })
    expect(screen.getByText('Bob accepted your offer')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-outgoing-t-out')).not.toBeInTheDocument()

    const second = { ...outgoing, trade_id: 't-out2' }
    act(() => {
      useGameStore.getState().handleMessage({ type: 'trade_proposed', trade: second })
    })
    act(() => {
      useGameStore
        .getState()
        .handleMessage({ type: 'trade_rejected', trade_id: 't-out2', rejected_by: 'bob' })
    })
    expect(screen.getByText('Bob rejected your offer')).toBeInTheDocument()
  })

  it('keeps the offers panel visible during stock disposition', () => {
    setup(gameState({ phase: 'stock_disposition', current_player: 'bob' }))
    act(() => {
      useGameStore.setState({
        pendingStockDisposition: {
          defunctChain: 'Tower',
          survivingChain: 'Luxor',
          stockCount: 2,
          availableToTrade: 5,
        },
      })
      useGameStore.getState().handleMessage({ type: 'trade_proposed', trade: incoming })
    })
    expect(screen.getByTestId('trade-offers')).toBeInTheDocument()
    expect(screen.getByTestId('trade-offer-t-in')).toBeInTheDocument()
  })

  it('keeps the offers panel visible while choosing a chain', () => {
    setup(gameState({ phase: 'found_chain', current_player: 'me' }))
    act(() => {
      useGameStore.setState({ pendingChainChoice: ['Luxor', 'Tower'] })
    })
    expect(screen.getByTestId('trade-offers')).toBeInTheDocument()
  })

  it('shows a server refusal inside the trade builder and keeps it open', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'PROPOSE TRADE' }))
    fireEvent.click(screen.getByTestId('player-select-bob'))
    fireEvent.change(screen.getByTestId('offer-cash-input'), { target: { value: '100' } })
    fireEvent.change(screen.getByTestId('want-cash-input'), { target: { value: '50' } })
    fireEvent.click(screen.getByTestId('propose-trade'))
    expect(ws.sendAction).toHaveBeenLastCalledWith({
      action: 'propose_trade',
      to_player_id: 'bob',
      offering_stocks: {},
      offering_money: 100,
      requesting_stocks: {},
      requesting_money: 50,
    })
    act(() => {
      ws.onError?.('Maximum of 5 pending trades per player')
    })
    expect(screen.getByTestId('trade-error')).toHaveTextContent('Maximum of 5 pending trades')
    expect(screen.getByTestId('trade-builder')).toBeInTheDocument()
  })

  it('closes the builder once the server confirms the proposal', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'PROPOSE TRADE' }))
    // an AI seat can be selected like any human
    fireEvent.click(screen.getByTestId('player-select-ai'))
    fireEvent.change(screen.getByTestId('offer-cash-input'), { target: { value: '100' } })
    fireEvent.change(screen.getByTestId('want-cash-input'), { target: { value: '50' } })
    fireEvent.click(screen.getByTestId('propose-trade'))
    expect(ws.sendAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'propose_trade', to_player_id: 'ai' })
    )
    act(() => {
      useGameStore.getState().handleMessage({
        type: 'trade_proposed',
        trade: { ...outgoing, trade_id: 'new', to_player_id: 'ai' },
      })
    })
    expect(screen.queryByTestId('trade-builder')).not.toBeInTheDocument()
    expect(screen.getByTestId('trade-outgoing-new')).toBeInTheDocument()
  })
})

describe('PlayerPage reconnection', () => {
  it('shows the overlay on disconnect and hides it (with a welcome-back card) after reconnect', () => {
    setup()
    expect(screen.queryByText('RECONNECTING...')).not.toBeInTheDocument()

    act(() => {
      useGameStore.setState({ connectionStatus: 'connecting' })
    })
    expect(screen.getByText('RECONNECTING...')).toBeInTheDocument()
    // the game stays rendered underneath instead of collapsing into a spinner
    expect(screen.getByTestId('trade-offers')).toBeInTheDocument()

    act(() => {
      useGameStore.setState({ connectionStatus: 'connected' })
    })
    expect(screen.queryByText('RECONNECTING...')).not.toBeInTheDocument()
    expect(screen.getByTestId('reconnected-toast')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('continue-playing'))
    expect(screen.queryByTestId('reconnected-toast')).not.toBeInTheDocument()
  })

  it('does not show the overlay during the initial connection', () => {
    useGameStore.getState().reset()
    useGameStore.setState({ connectionStatus: 'connecting' })
    render(
      <MemoryRouter initialEntries={['/play/TEST']}>
        <ToastProvider>
          <Routes>
            <Route path="/play/:room" element={<PlayerPage />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    )
    expect(screen.queryByText('RECONNECTING...')).not.toBeInTheDocument()
    expect(screen.getByText('Connecting to game...')).toBeInTheDocument()
  })
})
