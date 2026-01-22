import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
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
  it('renders app with BrowserRouter', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /acquire/i })).toBeInTheDocument()
  })
})
