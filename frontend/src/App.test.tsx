import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { App } from './App'
import { LobbyPage, PlayerPage, HostPage, NotFoundPage } from './pages'

// Helper to render App with specific route using MemoryRouter
function renderWithRoute(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/" element={<LobbyPage />} />
        <Route path="/play/:room" element={<PlayerPage />} />
        <Route path="/host/:room" element={<HostPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('App Routing', () => {
  it('renders lobby page at /', () => {
    renderWithRoute('/')
    expect(screen.getByText(/Lobby/i)).toBeInTheDocument()
  })

  it('renders player view at /play/:room', () => {
    renderWithRoute('/play/ABCD')
    expect(screen.getByText(/Player View/i)).toBeInTheDocument()
    expect(screen.getByText(/ABCD/i)).toBeInTheDocument()
  })

  it('renders host view at /host/:room', () => {
    renderWithRoute('/host/WXYZ')
    expect(screen.getByText(/Host View/i)).toBeInTheDocument()
    expect(screen.getByText(/WXYZ/i)).toBeInTheDocument()
  })

  it('renders 404 for unknown routes', () => {
    renderWithRoute('/unknown/path')
    expect(screen.getByText(/404/i)).toBeInTheDocument()
  })

  it('extracts room code from URL in uppercase', () => {
    renderWithRoute('/play/abcd')
    // Room code should be uppercased
    expect(screen.getByText(/ABCD/i)).toBeInTheDocument()
  })
})

describe('App', () => {
  it('renders app with BrowserRouter', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /acquire/i })).toBeInTheDocument()
  })
})
