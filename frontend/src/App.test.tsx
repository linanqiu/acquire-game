import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Ruleset } from './types/ruleset'
import { CLASSIC, VALLEY, classicLeaks } from '../tests/unit/fixtures/rulesets'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { App } from './App'
import { LobbyPage, PlayerPage, HostPage, NotFoundPage } from './pages'
import { ToastProvider } from './components/ui/ToastProvider'
import { useGameStore } from './store/gameStore'

// Mock useWebSocket to prevent it from changing connectionStatus during tests
vi.mock('./hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    sendAction: vi.fn(),
    disconnect: vi.fn(),
    isConnected: true,
  }),
}))

// Helper to render App with specific route using MemoryRouter
function renderWithRoute(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<LobbyPage />} />
          <Route path="/play/:room" element={<PlayerPage />} />
          <Route path="/host/:room" element={<HostPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  )
}

describe('App Routing', () => {
  beforeEach(() => {
    // Reset the store and set connected state before each test
    useGameStore.getState().reset()
    useGameStore.setState({ connectionStatus: 'connected' })
  })

  it('renders lobby page at /', () => {
    renderWithRoute('/')
    expect(screen.getByRole('heading', { name: /ACQUIRE/i })).toBeInTheDocument()
  })

  it('renders player view at /play/:room', () => {
    renderWithRoute('/play/ABCD')
    // Player page shows "WAITING FOR PLAYERS" in lobby state and room code
    expect(screen.getByText(/WAITING FOR PLAYERS/i)).toBeInTheDocument()
    expect(screen.getByText('ABCD')).toBeInTheDocument()
  })

  it('renders host view at /host/:room', () => {
    renderWithRoute('/host/WXYZ')
    // Host page shows ACQUIRE title and room code in lobby state
    expect(screen.getByText('ACQUIRE')).toBeInTheDocument()
    expect(screen.getByText('WXYZ')).toBeInTheDocument()
  })

  it('renders 404 for unknown routes', () => {
    renderWithRoute('/unknown/path')
    expect(screen.getByText(/404/i)).toBeInTheDocument()
  })

  it('extracts room code from URL in uppercase', () => {
    renderWithRoute('/play/abcd')
    // Room code should be uppercased - check the specific room code element
    expect(screen.getByText('ABCD')).toBeInTheDocument()
  })
})

describe('App', () => {
  afterEach(() => vi.unstubAllGlobals())

  function serveRuleset(rs: Ruleset) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) =>
        String(url).includes('/api/config/game')
          ? new Response(JSON.stringify(rs), { status: 200 })
          : new Response('{}', { status: 200 })
      )
    )
  }

  it("loads the server's ruleset first, then renders the home page with its title", async () => {
    serveRuleset(CLASSIC)
    render(<App />)
    expect(screen.getByTestId('ruleset-loading')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'ACQUIRE' })).toBeInTheDocument()
    expect(document.title).toBe('Acquire')
  })

  it("shows another ruleset's name everywhere, never the classic one", async () => {
    serveRuleset(VALLEY)
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'ACQUIHIRE' })).toBeInTheDocument()
    expect(document.title).toBe('Acquihire')
    expect(classicLeaks(document.body.textContent ?? '')).toEqual([])
  })

  it('offers a retry when the configuration cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 }))
    )
    render(<App />)
    expect(await screen.findByTestId('ruleset-error')).toBeInTheDocument()
    expect(screen.getByTestId('ruleset-retry')).toBeInTheDocument()
  })
})
