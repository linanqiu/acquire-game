import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SeatKindBadge } from './SeatKindBadge'
import { PlayerCard } from './PlayerCard'
import { HostPage } from '../../pages/HostPage'
import { ToastProvider } from '../ui/ToastProvider'
import { useFallbackToasts } from '../../hooks/useFallbackToasts'
import { useGameStore } from '../../store/gameStore'
import type { AgentFallbackMessage, GameStateMessage, SeatFallbacks } from '../../types/api'
import { snapshot } from '../../../tests/unit/fixtures/wire'

vi.mock('../../hooks/useHostWebSocket', () => ({
  useHostWebSocket: () => ({ reconnect: vi.fn() }),
}))

const FALLBACK: AgentFallbackMessage = {
  type: 'agent_fallback',
  player_id: 'p2',
  player_name: 'Claude Haiku 5.5',
  agent_label: 'Claude Haiku 5.5',
  reason: 'timeout',
  decision: 'place_tile',
  message: 'Claude Haiku 5.5 timed out after 130 s — the rules-based player made this move.',
}

function ToastListener() {
  useFallbackToasts()
  return null
}

describe('agent_fallback toast', () => {
  beforeEach(() => useGameStore.getState().reset())

  it('toasts the server message when agent_fallback arrives', () => {
    render(
      <ToastProvider>
        <ToastListener />
      </ToastProvider>
    )
    expect(screen.queryByText(/rules-based player made this move/)).not.toBeInTheDocument()
    act(() => useGameStore.getState().handleMessage(FALLBACK))
    expect(screen.getByText(FALLBACK.message)).toBeInTheDocument()
  })

  it('toasts each fallback once, including a second one for the same seat', () => {
    render(
      <ToastProvider>
        <ToastListener />
      </ToastProvider>
    )
    act(() => useGameStore.getState().handleMessage(FALLBACK))
    act(() =>
      useGameStore.getState().handleMessage({ ...FALLBACK, message: 'Second fallback happened.' })
    )
    expect(screen.getAllByText(/rules-based player made this move/)).toHaveLength(1)
    expect(screen.getByText('Second fallback happened.')).toBeInTheDocument()
  })
})

describe('fallback marker', () => {
  const two: SeatFallbacks = { count: 2, last_reason: 'timeout' }

  it('shows count and last reason on the badge', () => {
    render(<SeatKindBadge playerId="p2" kind="llm" agentLabel="Claude" fallbacks={two} />)
    const marker = screen.getByTestId('seat-fallback-p2')
    expect(marker).toHaveTextContent('2')
    expect(marker).toHaveAttribute('title', expect.stringContaining('2 times'))
    expect(marker).toHaveAttribute('title', expect.stringContaining('timed out'))
  })

  it('shows on the player card', () => {
    render(
      <PlayerCard name="Claude" cash={1} stocks={[]} playerId="p2" kind="llm" fallbacks={two} />
    )
    expect(screen.getByTestId('seat-fallback-p2')).toBeInTheDocument()
  })

  it('shows nothing for zero, missing or human-seat fallbacks', () => {
    const { rerender } = render(
      <SeatKindBadge playerId="p2" kind="llm" fallbacks={{ count: 0, last_reason: null }} />
    )
    expect(screen.queryByTestId('seat-fallback-p2')).not.toBeInTheDocument()
    rerender(<SeatKindBadge playerId="p2" kind="llm" />)
    expect(screen.queryByTestId('seat-fallback-p2')).not.toBeInTheDocument()
    rerender(<SeatKindBadge playerId="p2" kind="human" fallbacks={two} />)
    expect(screen.queryByTestId('seat-fallback-p2')).not.toBeInTheDocument()
  })
})

/** A real spectator state (recorded from the server) in which seat `p2` is an LLM seat. */
const LLM_SEAT = 'p2'
function gameState(fallbacks?: SeatFallbacks): GameStateMessage {
  const state = snapshot('three-player-midgame').host
  const ids = Object.keys(state.players)
  const llm = ids[1]
  state.players[llm] = {
    ...state.players[llm],
    name: 'Claude',
    kind: 'llm',
    is_bot: true,
    agent_label: 'Claude',
    fallbacks,
  }
  // Keep the seat ids stable for the assertions below.
  const renamed = Object.fromEntries(
    Object.entries(state.players).map(([id, p]) => [
      id === llm ? LLM_SEAT : id === ids[0] ? 'p1' : id,
      p,
    ])
  )
  return { ...state, players: renamed, turn_order: ['p1', LLM_SEAT, ids[2]], current_player: 'p1' }
}

describe('HostPage fallback marker', () => {
  beforeEach(() => {
    useGameStore.getState().reset()
    useGameStore.setState({ connectionStatus: 'connected' })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 404 })))
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  function renderHost() {
    return render(
      <MemoryRouter initialEntries={['/host/ABCD']}>
        <ToastProvider>
          <Routes>
            <Route path="/host/:room" element={<HostPage />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    )
  }

  it('appears from game_state.fallbacks (survives a reload)', () => {
    useGameStore.setState({ gameState: gameState({ count: 3, last_reason: 'illegal' }) })
    renderHost()
    expect(screen.getByTestId('seat-fallback-p2')).toHaveAttribute('data-count', '3')
  })

  it('is absent for seats with zero fallbacks', () => {
    useGameStore.setState({ gameState: gameState({ count: 0, last_reason: null }) })
    renderHost()
    expect(screen.queryByTestId('seat-fallback-p2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('seat-fallback-p1')).not.toBeInTheDocument()
  })

  it('toasts when agent_fallback arrives on the host page', () => {
    useGameStore.setState({ gameState: gameState() })
    renderHost()
    act(() => useGameStore.getState().handleMessage(FALLBACK))
    expect(screen.getByText(FALLBACK.message)).toBeInTheDocument()
  })
})
