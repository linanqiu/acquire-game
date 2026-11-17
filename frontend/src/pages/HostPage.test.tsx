/**
 * The host / spectator page, from real server messages (recorded from the backend, see
 * tests/unit/fixtures/generate_wire_messages.py): the lobby, a running game as the spectator's
 * game_state shows it, a merger, pending trades, game over, and the connection overlay.
 */
import { render, screen, act, within, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { HostPage } from './HostPage'
import { ToastProvider } from '../components/ui/ToastProvider'
import { useGameStore } from '../store/gameStore'
import { playedGame, serverRuleset, snapshot } from '../../tests/unit/fixtures/wire'
import { DEFAULT_RS } from '../../tests/unit/fixtures/rulesets'

vi.mock('../hooks/useHostWebSocket', () => ({
  useHostWebSocket: () => ({
    reconnect: vi.fn(() => Promise.resolve(true)),
  }),
}))

function renderHostPage(room = 'TEST') {
  return render(
    <MemoryRouter initialEntries={[`/host/${room}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/host/:room" element={<HostPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  )
}

const deliver = (msg: Record<string, unknown>) =>
  act(() => useGameStore.getState().handleMessage(msg as never))
const money = (n: number) => `$${n.toLocaleString('en-US')}`
const lobby = () => playedGame('default').lobby

beforeEach(() => {
  useGameStore.getState().reset()
  useGameStore.setState({ connectionStatus: 'connected' })
})

describe('host lobby', () => {
  it('shows the game title, room code, join link and every seat; AI seats are marked and removable', () => {
    deliver(lobby())
    renderHostPage('WXYZ')
    expect(screen.getByTestId('host-title')).toHaveTextContent('BUYOUT')
    expect(screen.getByText('WXYZ')).toBeInTheDocument()
    expect(screen.getByText(`${window.location.origin}/play/WXYZ`)).toBeInTheDocument()
    const [human, bot, scripted] = lobby().players
    expect(screen.getByText('PLAYERS (3/6)')).toBeInTheDocument()
    expect(screen.getByText(human.name)).toBeInTheDocument()
    expect(screen.queryByTestId(`seat-kind-${human.player_id}`)).not.toBeInTheDocument()
    expect(screen.queryByTestId(`remove-seat-${human.player_id}`)).not.toBeInTheDocument()
    expect(screen.getByTestId(`seat-kind-${bot.player_id}`)).toHaveAccessibleName('Rules-based bot')
    expect(screen.getByTestId(`remove-seat-${bot.player_id}`)).toBeInTheDocument()
    expect(screen.getByTestId(`remove-seat-${scripted.player_id}`)).toBeInTheDocument()
  })

  it('START GAME follows the server (can_start), and the hint says how many seats are missing', () => {
    deliver({ ...lobby(), players: lobby().players.slice(0, 1), can_start: false })
    const { unmount } = renderHostPage()
    expect(screen.getByText('START GAME')).toBeDisabled()
    expect(screen.getByText('Need 2 more players to start')).toBeInTheDocument()
    unmount()
    useGameStore.getState().reset()
    deliver(lobby())
    renderHostPage()
    expect(screen.getByText('START GAME')).toBeEnabled()
    // An enabled START GAME needs no caption saying it is ready (BL-017).
    expect(screen.queryByTestId('start-hint')).not.toBeInTheDocument()
    expect(screen.queryByText(/Ready to start/)).not.toBeInTheDocument()
  })

  it("the brand on top, then the server ruleset's theme and seat limit: Acquihire 3/6, Harborline 3/5", () => {
    serverRuleset('valley')
    deliver(lobby())
    const { unmount } = renderHostPage()
    expect(screen.getByTestId('host-title')).toHaveTextContent('BUYOUT')
    expect(screen.getByTestId('host-theme')).toHaveTextContent('Acquihire')
    unmount()
    serverRuleset('mini')
    deliver(lobby())
    renderHostPage()
    expect(screen.getByTestId('host-title')).toHaveTextContent('BUYOUT')
    expect(screen.getByTestId('host-theme')).toHaveTextContent('Harborline')
    expect(screen.getByText('PLAYERS (3/5)')).toBeInTheDocument()
  })

  it('shows the connecting spinner and the error with a REFRESH button', () => {
    useGameStore.setState({ connectionStatus: 'connecting' })
    const { unmount } = renderHostPage()
    expect(screen.getByText('Connecting to game...')).toBeInTheDocument()
    unmount()
    useGameStore.setState({ connectionStatus: 'error' })
    renderHostPage()
    expect(screen.getByText('Connection error. Please refresh the page.')).toBeInTheDocument()
    expect(screen.getByText('REFRESH')).toBeInTheDocument()
  })
})

describe('host view of a running game', () => {
  it('shows the board, every player with the cash the server reports, and whose turn it is', () => {
    const view = snapshot('three-player-midgame')
    deliver(view.host)
    renderHostPage()
    expect(screen.getByTestId('board')).toBeInTheDocument()
    const rows = within(screen.getByTestId('scoreboard')).getAllByTestId('player-card')
    expect(rows).toHaveLength(Object.keys(view.host.players).length)
    for (const [id, p] of Object.entries(view.host.players)) {
      const card = rows.find((r) => r.textContent!.includes(p.name))!
      expect(card, p.name).toHaveTextContent(money(p.money))
      const turn = within(card).queryByTestId('turn-marker')
      if (id === view.host.current_player) expect(turn).toBeInTheDocument()
      else expect(turn).not.toBeInTheDocument()
    }
    expect(screen.getByTestId('game-phase')).toHaveTextContent(/TURN - PLACE TILE$/)
    // Whose turn: the calm "other" tone (never the viewer's accent; the host has no move).
    expect(screen.getByTestId('game-phase')).toHaveAttribute('data-turn', 'other')
  })

  it('the chains panel lists the active chains with size, price and shares left; the rest are not listed', () => {
    const view = snapshot('buy-phase-multi-chain')
    deliver(view.host)
    renderHostPage()
    const panel = screen.getByTestId('chain-list')
    for (const [name, info] of Object.entries(view.expect.active_chains) as [string, any][]) {
      const id = name.toLowerCase()
      const marker = within(panel).getByTestId(`chain-marker-${id}`)
      // Three labelled columns: tiles, price, bank.
      expect(within(panel).getByTestId(`chain-size-${id}`)).toHaveTextContent(`${info.size} tiles`)
      expect(within(panel).getByTestId(`chain-price-${id}`)).toHaveTextContent(money(info.price))
      expect(within(panel).getByTestId(`chain-bank-${id}`)).toHaveTextContent(
        `${info.available} left in the bank`
      )
      if (info.safe) expect(marker).toHaveTextContent(/safe/i)
    }
    const inactive = DEFAULT_RS.chains.find((c) => !(c.id in view.expect.active_chains))!.id
    expect(within(panel).queryByTestId(`chain-marker-${inactive}`)).not.toBeInTheDocument()
  })

  it('before any chain exists it says so', () => {
    const state = playedGame('default').states['place_tile/place_tile']
    deliver(state)
    renderHostPage()
    expect(screen.getByText(/No hotel chains on the board yet/)).toBeInTheDocument()
  })

  it('during a merger the banner names whom the table waits for', () => {
    const view = snapshot('disposition-waiting-on-other')
    deliver(view.host)
    renderHostPage()
    const awaited = view.host.players[view.host.awaiting.player_id].name
    expect(screen.getByTestId('game-phase').textContent).toContain(awaited)
  })

  it('lists the pending trades for everyone to see, by name', () => {
    const view = snapshot('trade-outgoing-pending')
    deliver(view.host)
    renderHostPage()
    const [trade] = view.host.pending_trades
    const item = within(screen.getByTestId('pending-trades')).getByTestId(
      `pending-trade-${trade.trade_id}`
    )
    expect(item).toHaveTextContent(view.host.players[trade.from_player_id].name)
    expect(item).toHaveTextContent(view.host.players[trade.to_player_id].name)
  })

  it('has no pending-trades list when nothing is pending', () => {
    deliver(snapshot('three-player-midgame').host)
    renderHostPage()
    expect(screen.queryByTestId('pending-trades')).not.toBeInTheDocument()
  })

  it('an AI seat that has to think is shown thinking; a human on turn is not', () => {
    const state = snapshot('three-player-midgame').host
    const [, ai] = Object.keys(state.players)
    deliver({ ...state, awaiting: { player_id: ai, kind: 'scripted', decision: 'place_tile' } })
    renderHostPage()
    expect(screen.getAllByTestId('ai-thinking')).toHaveLength(1)
  })
})

describe('host view details', () => {
  it('the chains panel lists the chains in the ruleset order (the same everywhere), and marks as safe exactly the chains of the ruleset safe size or more', () => {
    const view = snapshot('disposition-human-first')
    deliver(view.host)
    renderHostPage()
    const markers = within(screen.getByTestId('chain-list')).getAllByTestId(/^chain-marker-/)
    const order = DEFAULT_RS.chains.map((c) => c.id)
    const sizes = Object.entries(view.expect.active_chains)
      .map(([name, c]: [string, any]) => ({ name, size: c.size, safe: c.safe }))
      .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
    expect(sizes.length).toBeGreaterThan(1)
    expect(markers.map((m) => m.getAttribute('data-testid'))).toEqual(
      sizes.map((c) => `chain-marker-${c.name.toLowerCase()}`)
    )
    expect(sizes.some((c) => c.safe)).toBe(true)
    expect(sizes.some((c) => !c.safe)).toBe(true)
    for (const c of sizes) {
      const marker = screen
        .getByTestId(`chain-list`)
        .querySelector(`[data-testid="chain-marker-${c.name.toLowerCase()}"]`)!
      expect(/safe/i.test(marker.textContent!), c.name).toBe(c.safe)
    }
  })

  it("the scoreboard shows each player's shares for the chains they hold and none for the rest", () => {
    const view = snapshot('buy-phase-multi-chain')
    deliver(view.host)
    renderHostPage()
    const cards = within(screen.getByTestId('scoreboard')).getAllByTestId('player-card')
    for (const [id, p] of Object.entries<any>(view.host.players)) {
      const card = cards.find((c) => c.textContent!.includes(p.name))!
      const held = Object.entries<number>(p.stocks).filter(([, q]) => q > 0)
      expect(held.length).toBeGreaterThan(0)
      for (const [chain, qty] of held) {
        expect(within(card).getByTestId(`player-stock-${id}-${chain}`)).toHaveTextContent(
          new RegExp(`^${qty}$`)
        )
      }
      expect(within(card).getAllByTestId(/^player-stock-/)).toHaveLength(held.length)
      // One cell per chain of the ruleset, in the ruleset's order, for every player.
      expect(
        within(card)
          .getAllByTestId(/^matrix-cell-/)
          .map((c) => c.getAttribute('data-testid'))
      ).toEqual(DEFAULT_RS.chains.map((c) => `matrix-cell-${id}-${c.id}`))
      // Net worth and rank, as the server computed them.
      expect(within(card).getByTestId(`player-networth-${id}`)).toHaveTextContent(
        money(p.net_worth)
      )
      expect(within(card).getByTestId(`player-rank-${id}`)).toHaveTextContent(String(p.rank))
    }
  })

  it('shows the transcript link at the end only when the game has an id', () => {
    const view = snapshot('game-over')
    deliver({ ...view.host, game_id: 'g-42' })
    renderHostPage()
    expect(screen.getByTestId('view-transcript-link')).toHaveAttribute('href', '/games/g-42')
  })

  it('an unknown room (refused by the server) says so and offers a way home', () => {
    useGameStore.setState({ connectionStatus: 'error', connectionError: 'Room not found' })
    renderHostPage('QZQZ')
    expect(screen.getByTestId('room-unavailable')).toHaveTextContent('QZQZ')
    expect(screen.getByText('BACK TO HOME')).toBeInTheDocument()
  })
})

describe('starting the game from the host screen', () => {
  afterEach(() => vi.unstubAllGlobals())

  const answer = (status: number) => {
    const fn = vi.fn(async () => new Response('{}', { status }))
    vi.stubGlobal('fetch', fn)
    return fn
  }

  it('START GAME posts to the room', async () => {
    const fn = answer(200)
    deliver(lobby())
    renderHostPage('WXYZ')
    fireEvent.click(screen.getByText('START GAME'))
    await waitFor(() =>
      expect(fn.mock.calls.some((c) => String(c[0]).endsWith('/start'))).toBe(true)
    )
    const call = fn.mock.calls.find((c) => String(c[0]).endsWith('/start'))!
    expect(String(call[0])).toBe('/api/room/WXYZ/start')
    expect((call as unknown as [string, RequestInit])[1].method).toBe('POST')
  })

  it('a refusal says so and START GAME works again', async () => {
    answer(400)
    deliver(lobby())
    renderHostPage()
    fireEvent.click(screen.getByText('START GAME'))
    await waitFor(() => expect(screen.getByText('Failed to start game')).toBeInTheDocument())
    expect(screen.getByText('START GAME')).toBeEnabled()
  })
})

describe('host view of the end of the game', () => {
  it('shows the final standings with the full breakdown, and one way out', () => {
    const view = snapshot('game-over')
    deliver(view.host)
    deliver(view.player.find((m) => m.type === 'game_over')!)
    renderHostPage()
    expect(screen.getByTestId('game-over')).toBeInTheDocument()
    const table = screen.getByTestId('full-breakdown')
    for (const p of Object.values(view.host.players)) {
      expect(table).toHaveTextContent(p.name)
      expect(table).toHaveTextContent(money(p.money))
    }
    // PLAY AGAIN goes home; a second button to the same place is not offered (BL-017).
    expect(screen.getByTestId('play-again')).toBeInTheDocument()
    expect(screen.queryByTestId('back-to-lobby')).not.toBeInTheDocument()
  })
})

describe('host connection and housekeeping', () => {
  it('overlays the game while the socket is down and lifts the overlay when it is back', () => {
    deliver(snapshot('three-player-midgame').host)
    renderHostPage()
    act(() => useGameStore.setState({ connectionStatus: 'connecting' }))
    expect(screen.getByText('RECONNECTING...')).toBeInTheDocument()
    act(() => useGameStore.setState({ connectionStatus: 'connected' }))
    expect(screen.queryByText('RECONNECTING...')).not.toBeInTheDocument()
  })

  it('leaving the room clears the lobby, so the next room does not show the old seats', () => {
    deliver(lobby())
    const { unmount } = renderHostPage('OLDR')
    unmount()
    expect(useGameStore.getState().lobbyPlayers).toEqual([])
    expect(useGameStore.getState().canStart).toBe(false)
  })
})
