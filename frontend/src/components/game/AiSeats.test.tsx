import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AddAiControl } from './AddAiControl'
import { RemoveSeatButton } from './RemoveSeatButton'
import { SeatKindBadge } from './SeatKindBadge'
import { HostPage } from '../../pages/HostPage'
import { ToastProvider } from '../ui/ToastProvider'
import { useGameStore } from '../../store/gameStore'
import type { AgentCatalogEntry, GameStateMessage } from '../../types/api'
import { snapshot, wireCatalog } from '../../../tests/unit/fixtures/wire'

vi.mock('../../hooks/useHostWebSocket', () => ({
  useHostWebSocket: () => ({ reconnect: vi.fn() }),
}))

// The catalog exactly as the server serves it (some LLM entries are not configured here).
const CATALOG: AgentCatalogEntry[] = wireCatalog()
const AVAILABLE_LLM = CATALOG.find((e) => e.kind === 'llm' && e.available)!
const UNAVAILABLE_LLM = CATALOG.find((e) => e.kind === 'llm' && !e.available)!

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
    const ok = screen.getByTestId(`ai-option-${AVAILABLE_LLM.id}`)
    expect(ok).toHaveTextContent(AVAILABLE_LLM.label)
    expect(ok).toHaveTextContent(AVAILABLE_LLM.description)
    expect(ok).not.toHaveTextContent('not configured')
    const off = screen.getByTestId(`ai-option-${UNAVAILABLE_LLM.id}`)
    expect(off).toBeDisabled()
    expect(off).toHaveTextContent('not configured on this server')
  })

  it('posts add-seat with the chosen agent_id and closes the menu', async () => {
    const onAdded = vi.fn()
    const fetchMock = mockFetch((url) => {
      if (url === '/api/agents/catalog') return jsonResponse(CATALOG)
      if (url === '/api/room/ABCD/add-seat')
        return jsonResponse({ player_id: 'p9', name: AVAILABLE_LLM.label, kind: 'llm' })
      return jsonResponse({}, 404)
    })
    renderControl({ onAdded })

    fireEvent.click(await screen.findByTestId('add-ai-button'))
    fireEvent.click(screen.getByTestId(`ai-option-${AVAILABLE_LLM.id}`))

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('p9', AVAILABLE_LLM.label))
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/add-seat'))!
    expect(call[1]?.method).toBe('POST')
    expect(JSON.parse(String(call[1]?.body))).toEqual({ agent_id: AVAILABLE_LLM.id })
    expect(screen.queryByTestId('ai-menu')).not.toBeInTheDocument()
  })

  it('does not call add-seat for an unavailable entry', async () => {
    const fetchMock = mockFetch((url) =>
      url === '/api/agents/catalog' ? jsonResponse(CATALOG) : jsonResponse({}, 404)
    )
    renderControl()
    fireEvent.click(await screen.findByTestId('add-ai-button'))
    fireEvent.click(screen.getByTestId(`ai-option-${UNAVAILABLE_LLM.id}`))
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
})

/** A real spectator state (recorded from the server) with seat p2 turned into an LLM seat. */
function gameState(awaiting: GameStateMessage['awaiting']): GameStateMessage {
  const state = snapshot('three-player-midgame').host
  const [first, second, third] = Object.keys(state.players)
  const rename = { [first]: 'p1', [second]: 'p2', [third]: 'p3' }
  const players = Object.fromEntries(
    Object.entries(state.players).map(([id, p]) => [rename[id], p])
  )
  players.p1 = { ...players.p1, name: 'Alice', kind: 'human', is_bot: false }
  players.p2 = { ...players.p2, name: 'Claude', kind: 'llm', is_bot: true, agent_label: 'Claude' }
  return {
    ...state,
    players,
    turn_order: ['p1', 'p2', 'p3'],
    current_player: 'p2',
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
    expect(screen.getByTestId('seat-kind-p2')).toHaveTextContent('Claude')
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
    expect(screen.getByTestId('seat-kind-p2')).toHaveTextContent('Claude')
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
})
