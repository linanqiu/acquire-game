import { render, screen, act, within } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { HostPage } from './HostPage'
import { ToastProvider } from '../components/ui/ToastProvider'
import { useGameStore } from '../store/gameStore'
import type { GameStateMessage } from '../types/api'

vi.mock('../hooks/useHostWebSocket', () => ({
  useHostWebSocket: () => ({
    addBot: vi.fn(),
    startGame: vi.fn(),
    endGame: vi.fn(),
    disconnect: vi.fn(),
    reconnect: vi.fn(() => Promise.resolve(true)),
    isConnected: true,
  }),
}))

const state: GameStateMessage = {
  type: 'game_state',
  board: { cells: {} },
  hotel: { chains: [], available_stocks: {} as never, active_chains: [] },
  turn_order: ['a', 'b'],
  current_player: 'a',
  phase: 'buy_stocks',
  players: {
    a: { name: 'Alice', money: 6000, stocks: {} as never, hand_size: 6 },
    b: { name: 'Bob', money: 6000, stocks: {} as never, hand_size: 6 },
  },
  tiles_remaining: 90,
  pending_trades: [
    {
      trade_id: 't1',
      from_player_id: 'a',
      to_player_id: 'b',
      offering_stocks: { Luxor: 2 },
      offering_money: 0,
      requesting_stocks: {},
      requesting_money: 300,
    },
  ],
}

function renderHost() {
  return render(
    <MemoryRouter initialEntries={['/host/TEST']}>
      <ToastProvider>
        <Routes>
          <Route path="/host/:room" element={<HostPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  )
}

describe('HostPage pending trades', () => {
  beforeEach(() => {
    useGameStore.getState().reset()
    useGameStore.setState({ connectionStatus: 'connected' })
  })

  it('lists pending trades publicly when the public state has them', () => {
    renderHost()
    act(() => useGameStore.getState().handleMessage(state))
    const list = screen.getByTestId('pending-trades')
    expect(within(list).getByText('Alice')).toBeInTheDocument()
    expect(within(list).getByText('Bob')).toBeInTheDocument()
    expect(within(list).getByText('2 LUX for $300')).toBeInTheDocument()
  })

  it('omits the list when nothing is pending', () => {
    renderHost()
    act(() => useGameStore.getState().handleMessage({ ...state, pending_trades: [] }))
    expect(screen.queryByTestId('pending-trades')).not.toBeInTheDocument()
  })

  it('shows the reconnect overlay after a drop', () => {
    renderHost()
    act(() => useGameStore.getState().handleMessage(state))
    act(() => useGameStore.setState({ connectionStatus: 'connecting' }))
    expect(screen.getByText('RECONNECTING...')).toBeInTheDocument()
    act(() => useGameStore.setState({ connectionStatus: 'connected' }))
    expect(screen.queryByText('RECONNECTING...')).not.toBeInTheDocument()
  })
})
