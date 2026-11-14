import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AddAiControl } from './AddAiControl'
import { RemoveSeatButton } from './RemoveSeatButton'
import { SeatKindBadge } from './SeatKindBadge'
import { PlayerCard } from './PlayerCard'
import { HostPage } from '../../pages/HostPage'
import { ToastProvider } from '../ui/ToastProvider'
import { useGameStore } from '../../store/gameStore'
import { resolveSeatKind, isAiThinking } from '../../lib/agents'
import type { AgentCatalogEntry, GameStateMessage } from '../../types/api'

vi.mock('../../hooks/useHostWebSocket', () => ({
  useHostWebSocket: () => ({
    addBot: vi.fn(),
    startGame: vi.fn(),
    endGame: vi.fn(),
    disconnect: vi.fn(),
    isConnected: true,
  }),
}))

const CATALOG: AgentCatalogEntry[] = [
  {
    id: 'bot',
    kind: 'bot',
    label: 'Heuristic Bot',
    description: 'Fast rule-based',
    available: true,
  },
  { id: 'claude', kind: 'llm', label: 'Claude', description: 'LLM opponent', available: true },
  { id: 'gpt', kind: 'llm', label: 'GPT', description: 'Other LLM', available: false },
]

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  )
}

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>

function mockFetch(handler: FetchHandler) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init))
  vi.stubGlobal('fetch', fn)
  return fn
}

function renderControl(props: Partial<React.ComponentProps<typeof AddAiControl>> = {}) {
  return render(
    <ToastProvider>
      <AddAiControl room="ABCD" {...props} />
    </ToastProvider>
  )
}

describe('AddAiControl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists catalog entries and shows unavailable ones disabled with a reason', async () => {
    mockFetch((url) =>
      url === '/api/agents/catalog' ? jsonResponse(CATALOG) : jsonResponse({}, 404)
    )
    renderControl()

    fireEvent.click(await screen.findByTestId('add-ai-button'))

    expect(screen.getByTestId('ai-option-bot')).toBeEnabled()
    expect(screen.getByTestId('ai-option-claude')).toHaveTextContent('Claude')
    expect(screen.getByTestId('ai-option-claude')).toHaveTextContent('LLM opponent')
    const gpt = screen.getByTestId('ai-option-gpt')
    expect(gpt).toBeDisabled()
    expect(gpt).toHaveTextContent('not configured on this server')
    expect(screen.getByTestId('ai-option-claude')).not.toHaveTextContent('not configured')
  })

  it('posts add-seat with the chosen agent_id and closes the menu', async () => {
    const onAdded = vi.fn()
    const fetchMock = mockFetch((url) => {
      if (url === '/api/agents/catalog') return jsonResponse(CATALOG)
      if (url === '/api/room/ABCD/add-seat')
        return jsonResponse({ player_id: 'p9', name: 'Claude', kind: 'llm' })
      return jsonResponse({}, 404)
    })
    renderControl({ onAdded })

    fireEvent.click(await screen.findByTestId('add-ai-button'))
    fireEvent.click(screen.getByTestId('ai-option-claude'))

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('p9', 'Claude'))
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/add-seat'))!
    expect(call[1]?.method).toBe('POST')
    expect(JSON.parse(String(call[1]?.body))).toEqual({ agent_id: 'claude' })
    expect(screen.queryByTestId('ai-menu')).not.toBeInTheDocument()
  })

  it('does not call add-seat for an unavailable entry', async () => {
    const fetchMock = mockFetch((url) =>
      url === '/api/agents/catalog' ? jsonResponse(CATALOG) : jsonResponse({}, 404)
    )
    renderControl()
    fireEvent.click(await screen.findByTestId('add-ai-button'))
    fireEvent.click(screen.getByTestId('ai-option-gpt'))
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('add-seat'))).toBe(false)
  })

  it('falls back to the plain add-bot button when the catalog 404s', async () => {
    const onAdded = vi.fn()
    const fetchMock = mockFetch((url) => {
      if (url === '/api/agents/catalog') return jsonResponse({ detail: 'Not Found' }, 404)
      if (url === '/api/room/ABCD/add-bot') return jsonResponse({ bot_id: 'bot-1' })
      return jsonResponse({}, 404)
    })
    renderControl({ onAdded })

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => c[0] === '/api/agents/catalog')).toBe(true)
    )
    expect(screen.queryByTestId('add-ai-button')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ ADD BOT' }))
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('bot-1', undefined))
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/room/ABCD/add-bot')).toBe(true)
  })

  it('falls back when the catalog request throws (network error)', async () => {
    mockFetch((url) =>
      url === '/api/agents/catalog' ? Promise.reject(new Error('offline')) : jsonResponse({})
    )
    renderControl()
    expect(await screen.findByRole('button', { name: '+ ADD BOT' })).toBeInTheDocument()
    expect(screen.queryByTestId('add-ai-button')).not.toBeInTheDocument()
  })

  it('disables everything when told to (lobby full)', async () => {
    mockFetch((url) => (url === '/api/agents/catalog' ? jsonResponse(CATALOG) : jsonResponse({})))
    renderControl({ disabled: true })
    expect(await screen.findByTestId('add-ai-button')).toBeDisabled()
    expect(screen.getByRole('button', { name: '+ ADD BOT' })).toBeDisabled()
  })
})

describe('RemoveSeatButton', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts remove-seat for the given player', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ success: true }))
    render(
      <ToastProvider>
        <RemoveSeatButton room="ABCD" playerId="bot-1" playerName="Botty" />
      </ToastProvider>
    )
    fireEvent.click(screen.getByTestId('remove-seat-bot-1'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/room/ABCD/remove-seat/bot-1')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
  })

  it('stays usable after a failed removal', async () => {
    mockFetch(() => jsonResponse({ detail: 'nope' }, 400))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ToastProvider>
        <RemoveSeatButton room="ABCD" playerId="bot-1" playerName="Botty" />
      </ToastProvider>
    )
    fireEvent.click(screen.getByTestId('remove-seat-bot-1'))
    await waitFor(() => expect(screen.getByTestId('remove-seat-bot-1')).toBeEnabled())
  })
})

describe('SeatKindBadge', () => {
  it('shows the agent label for llm seats and distinguishes kinds', () => {
    render(
      <>
        <SeatKindBadge playerId="a" kind="llm" agentLabel="Claude" />
        <SeatKindBadge playerId="b" kind="bot" />
      </>
    )
    expect(screen.getByTestId('seat-kind-a')).toHaveTextContent('Claude')
    expect(screen.getByTestId('seat-kind-a')).toHaveAttribute('data-kind', 'llm')
    expect(screen.getByTestId('seat-kind-b')).toHaveTextContent('BOT')
    expect(screen.getByTestId('seat-kind-b')).toHaveAttribute('data-kind', 'bot')
  })

  it('derives bot from is_bot when kind is absent, and hides for humans', () => {
    render(
      <>
        <SeatKindBadge playerId="old-bot" isBot />
        <SeatKindBadge playerId="human" isBot={false} kind="human" />
      </>
    )
    expect(screen.getByTestId('seat-kind-old-bot')).toHaveAttribute('data-kind', 'bot')
    expect(screen.queryByTestId('seat-kind-human')).not.toBeInTheDocument()
  })
})

describe('agent helpers', () => {
  it('resolveSeatKind prefers kind and falls back to is_bot', () => {
    expect(resolveSeatKind({ kind: 'llm', is_bot: true })).toBe('llm')
    expect(resolveSeatKind({ is_bot: true })).toBe('bot')
    expect(resolveSeatKind({})).toBe('human')
  })

  it('isAiThinking only for non-human awaited seats', () => {
    const aw = { player_id: 'p1', kind: 'llm' as const, decision: 'place_tile' }
    expect(isAiThinking(aw, 'p1')).toBe(true)
    expect(isAiThinking(aw, 'p2')).toBe(false)
    expect(isAiThinking({ ...aw, kind: 'human' }, 'p1')).toBe(false)
    expect(isAiThinking(null, 'p1')).toBe(false)
    expect(isAiThinking(undefined, 'p1')).toBe(false)
  })
})

describe('PlayerCard AI affordances', () => {
  it('shows kind badge and thinking only when thinking', () => {
    const { rerender } = render(
      <PlayerCard name="Claude" cash={6000} stocks={[]} playerId="p1" kind="llm" thinking />
    )
    expect(screen.getByTestId('seat-kind-p1')).toBeInTheDocument()
    expect(screen.getByTestId('ai-thinking')).toBeInTheDocument()
    rerender(<PlayerCard name="Claude" cash={6000} stocks={[]} playerId="p1" kind="llm" />)
    expect(screen.queryByTestId('ai-thinking')).not.toBeInTheDocument()
  })
})

function gameState(awaiting: GameStateMessage['awaiting'], withKinds = true): GameStateMessage {
  const players: GameStateMessage['players'] = {
    p1: { name: 'Alice', money: 6000, stocks: {} as never, hand_size: 6 },
    p2: {
      name: 'Claude',
      money: 6000,
      stocks: {} as never,
      hand_size: 6,
      ...(withKinds ? { kind: 'llm', is_bot: true, agent_label: 'Claude' } : { is_bot: true }),
    },
  }
  if (withKinds) players.p1.kind = 'human'
  return {
    type: 'game_state',
    board: { cells: {} },
    hotel: { chains: [], available_stocks: {} as never, active_chains: [] },
    turn_order: ['p1', 'p2'],
    current_player: 'p2',
    phase: 'place_tile',
    players,
    tiles_remaining: 80,
    awaiting,
  }
}

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

describe('HostPage AI seats', () => {
  beforeEach(() => {
    useGameStore.getState().reset()
    useGameStore.setState({ connectionStatus: 'connected' })
    mockFetch(() => jsonResponse({}, 404))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows kind badges and remove buttons for AI seats in the lobby', async () => {
    useGameStore.setState({
      lobbyPlayers: [
        { player_id: 'p1', name: 'Alice', is_bot: false, kind: 'human' },
        { player_id: 'p2', name: 'Claude', is_bot: true, kind: 'llm', agent_label: 'Claude' },
        { player_id: 'p3', name: 'Botty', is_bot: true },
      ],
    })
    renderHost()
    expect(screen.getByTestId('seat-kind-p2')).toHaveTextContent('AI')
    expect(screen.getByTestId('seat-kind-p3')).toHaveAttribute('data-kind', 'bot')
    expect(screen.queryByTestId('seat-kind-p1')).not.toBeInTheDocument()
    expect(screen.getByTestId('remove-seat-p2')).toBeInTheDocument()
    expect(screen.getByTestId('remove-seat-p3')).toBeInTheDocument()
    expect(screen.queryByTestId('remove-seat-p1')).not.toBeInTheDocument()
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
  })

  it('shows the thinking indicator while an AI seat is awaited', async () => {
    useGameStore.setState({
      gameState: gameState({ player_id: 'p2', kind: 'llm', decision: 'place_tile' }),
    })
    renderHost()
    expect(screen.getByTestId('ai-thinking')).toBeInTheDocument()
    // The seat is named after its agent: the badge shows the kind, not the same word twice
    expect(screen.getByTestId('seat-kind-p2')).toHaveTextContent('AI')
    await waitFor(() => expect(globalThis.fetch).not.toHaveBeenCalled())
  })

  it('hides the thinking indicator when a human or nobody is awaited', () => {
    useGameStore.setState({
      gameState: gameState({ player_id: 'p1', kind: 'human', decision: 'place_tile' }),
    })
    const { unmount } = renderHost()
    expect(screen.queryByTestId('ai-thinking')).not.toBeInTheDocument()
    unmount()
    useGameStore.setState({ gameState: gameState(null) })
    renderHost()
    expect(screen.queryByTestId('ai-thinking')).not.toBeInTheDocument()
  })

  it('works against a backend that omits kind/awaiting (derives bot from is_bot)', () => {
    useGameStore.setState({ gameState: gameState(undefined, false) })
    renderHost()
    expect(screen.getByTestId('seat-kind-p2')).toHaveAttribute('data-kind', 'bot')
    expect(screen.queryByTestId('ai-thinking')).not.toBeInTheDocument()
  })
})
