import { render, screen } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { Ruleset } from './types/ruleset'
import { DEFAULT_RS, VALLEY, defaultLeaks } from '../tests/unit/fixtures/rulesets'
import { App } from './App'
import { useGameStore } from './store/gameStore'

// The socket is not under test here; keep it from changing the connection status.
vi.mock('./hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    sendAction: vi.fn(),
    disconnect: vi.fn(),
    reconnect: vi.fn(),
    isConnected: true,
  }),
}))
vi.mock('./hooks/useHostWebSocket', () => ({
  useHostWebSocket: () => ({ disconnect: vi.fn(), reconnect: vi.fn(), isConnected: true }),
}))

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

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

describe('App', () => {
  it("loads the server's ruleset first, then renders the home page with its title", async () => {
    serveRuleset(DEFAULT_RS)
    render(<App />)
    expect(screen.getByTestId('ruleset-loading')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'BUYOUT' })).toBeInTheDocument()
    expect(document.title).toBe('Buyout')
  })

  it("shows another ruleset's theme under the brand, never the default theme", async () => {
    serveRuleset(VALLEY)
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'BUYOUT' })).toBeInTheDocument()
    expect(screen.getByTestId('home-theme')).toHaveTextContent('Acquihire')
    expect(document.title).toBe('Buyout')
    expect(defaultLeaks(document.body.textContent ?? '')).toEqual([])
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

  it('the real routes: a typed room code opens that room upper-cased, host and unknown URLs have pages', async () => {
    serveRuleset(DEFAULT_RS)
    useGameStore.setState({ connectionStatus: 'connected' })
    window.history.pushState({}, '', '/play/abcd')
    const { unmount } = render(<App />)
    expect(await screen.findByText('WAITING FOR PLAYERS')).toBeInTheDocument()
    expect(screen.getByText('ABCD')).toBeInTheDocument()
    unmount()

    useGameStore.setState({ connectionStatus: 'connected' })
    window.history.pushState({}, '', '/host/wxyz')
    const host = render(<App />)
    expect(await screen.findByTestId('host-title')).toBeInTheDocument()
    expect(screen.getByText('WXYZ')).toBeInTheDocument()
    host.unmount()

    window.history.pushState({}, '', '/no/such/page')
    render(<App />)
    expect(await screen.findByText('404')).toBeInTheDocument()
    expect(screen.getByText('Back to Lobby')).toBeInTheDocument()
  })
})
