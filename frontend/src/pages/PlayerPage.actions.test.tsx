/**
 * What the player page does around the decisions (real recorded states, recorded socket):
 * the buy form's order and buttons, the end-game button, the board fold, the players panel,
 * and starting the game as host.
 */
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { PlayerPage } from './PlayerPage'
import { ToastProvider } from '../components/ui/ToastProvider'
import { useGameStore } from '../store/gameStore'
import { CLASSIC } from '../../tests/unit/fixtures/rulesets'
import { deliver, loadSnapshotAsPlayer, playedGame, snapshot } from '../../tests/unit/fixtures/wire'

const { sendAction, socket } = vi.hoisted(() => ({
  sendAction: vi.fn((_action: unknown) => true),
  socket: { opts: undefined as undefined | Record<string, unknown> },
}))
vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: (opts: Record<string, unknown>) => {
    socket.opts = opts
    return {
      sendAction,
      reconnect: vi.fn(() => Promise.resolve(true)),
      disconnect: vi.fn(),
      isConnected: true,
    }
  },
}))

function renderPage(query = '') {
  return render(
    <MemoryRouter initialEntries={[`/play/TEST${query}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/play/:room" element={<PlayerPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  )
}

const lastAction = () => sendAction.mock.calls.at(-1)?.[0]
const stateOf = (view: ReturnType<typeof snapshot>) =>
  view.player.find((m) => m.type === 'game_state')!
const rackTile = (coord: string) =>
  within(screen.getByTestId('tile-rack')).getByTestId(`tile-${coord}`)
const row = (chain: string) => screen.getByTestId(`buy-row-${chain.toLowerCase()}`)

beforeEach(() => {
  sendAction.mockClear()
  sessionStorage.clear()
  useGameStore.getState().reset()
})
afterEach(() => vi.unstubAllGlobals())

describe('the buy form', () => {
  it('rows are in the ruleset order, whatever order the server lists the chains in', () => {
    const view = snapshot('buy-phase-multi-chain')
    const state = stateOf(view)
    state.hotel.chains = [...state.hotel.chains].reverse()
    deliver([state], view.human)
    renderPage()
    const ids = screen
      .getAllByTestId(/^buy-row-/)
      .map((r) => r.getAttribute('data-testid')!.slice('buy-row-'.length))
    const order = CLASSIC.chains.map((c) => c.id.toLowerCase())
    expect(ids).toEqual(order.filter((id) => ids.includes(id)))
    expect(ids.length).toBeGreaterThan(2)
  })

  it('only chains that are on the board are offered', () => {
    const view = loadSnapshotAsPlayer('buy-phase-multi-chain')
    renderPage()
    expect(screen.getAllByTestId(/^buy-row-/)).toHaveLength(
      Object.keys(view.expect.active_chains).length
    )
    expect(screen.queryByTestId('buy-row-worldwide')).not.toBeInTheDocument()
  })

  it('the button says SKIP when nothing is chosen and BUY once something is', () => {
    loadSnapshotAsPlayer('buy-phase-multi-chain')
    renderPage()
    expect(screen.getByTestId('end-turn-button')).toHaveTextContent('SKIP & END TURN')
    fireEvent.click(within(row('imperial')).getByTestId('stepper-increment'))
    expect(screen.getByTestId('end-turn-button')).toHaveTextContent('BUY & END TURN')
    fireEvent.click(within(row('imperial')).getByTestId('stepper-decrement'))
    expect(screen.getByTestId('end-turn-button')).toHaveTextContent('SKIP & END TURN')
  })

  it('END GAME shows only when the server allows it, and sends declare_end_game', () => {
    loadSnapshotAsPlayer('buy-phase-multi-chain')
    const first = renderPage()
    expect(screen.queryByTestId('end-game-button')).not.toBeInTheDocument()
    first.unmount()
    useGameStore.getState().reset()
    loadSnapshotAsPlayer('last-turn-before-game-over')
    renderPage()
    fireEvent.click(screen.getByTestId('end-game-button'))
    expect(lastAction()).toEqual({ action: 'declare_end_game' })
  })

  it('what I hold is in the portfolio strip, and what I do not hold is not', () => {
    const view = loadSnapshotAsPlayer('buy-phase-multi-chain')
    renderPage()
    const mine = stateOf(view).players[view.human].stocks as Record<string, number>
    expect(Object.values(mine).some((q) => q > 0)).toBe(true)
    for (const [chain, qty] of Object.entries(mine)) {
      const tableRow = screen.queryByTestId(`portfolio-row-${chain.toLowerCase()}`)
      if (qty > 0) expect(tableRow).toHaveTextContent(String(qty))
      else expect(tableRow).not.toBeInTheDocument()
    }
  })
})

describe('placing a tile', () => {
  it('the pick is named, and PLACE TILE sends it and clears the pick', () => {
    const view = loadSnapshotAsPlayer('opening-place-tile')
    renderPage()
    const tile = view.expect.human.hand[1]
    fireEvent.click(rackTile(tile))
    expect(screen.getByText(tile, { selector: 'strong' })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('place-tile-button'))
    expect(lastAction()).toEqual({ action: 'place_tile', tile })
    expect(screen.queryByText(tile, { selector: 'strong' })).not.toBeInTheDocument()
  })

  it('on my turn the page says to pick a tile; when I am only waiting it does not', () => {
    loadSnapshotAsPlayer('opening-place-tile')
    const mine = renderPage()
    expect(screen.getByText(/Pick a tile from your rack/)).toBeInTheDocument()
    mine.unmount()
    useGameStore.getState().reset()
    loadSnapshotAsPlayer('trade-incoming-not-my-turn')
    renderPage()
    expect(screen.queryByText(/Pick a tile from your rack/)).not.toBeInTheDocument()
  })

  it('the rack is locked outside my turn', () => {
    const view = loadSnapshotAsPlayer('trade-incoming-not-my-turn')
    renderPage()
    fireEvent.click(rackTile(view.expect.human.hand[0]))
    expect(screen.queryByText(/Selected:/)).not.toBeInTheDocument()
  })
})

describe('the board', () => {
  it('folds away while a decision panel needs the room, and comes back on request', () => {
    loadSnapshotAsPlayer('found-chain-choice')
    renderPage()
    const pane = screen.getByTestId('board-pane')
    expect(pane).toHaveAttribute('data-folded', 'true')
    expect(screen.getByTestId('board-toggle')).toHaveTextContent('SHOW BOARD')
    fireEvent.click(screen.getByTestId('board-toggle'))
    expect(pane).not.toHaveAttribute('data-folded')
    expect(screen.getByTestId('board-toggle')).toHaveTextContent('HIDE BOARD')
  })

  it('is open when the player is only placing a tile', () => {
    loadSnapshotAsPlayer('opening-place-tile')
    renderPage()
    expect(screen.getByTestId('board-pane')).not.toHaveAttribute('data-folded')
  })
})

describe('the players panel', () => {
  it('marks me, the player on turn, and shows what each player holds', () => {
    const view = loadSnapshotAsPlayer('buy-phase-multi-chain')
    renderPage()
    const state = stateOf(view)
    const rows = screen.getAllByTestId('player-row')
    expect(rows).toHaveLength(Object.keys(state.players).length)
    for (const r of rows) {
      const id = r.getAttribute('data-player-id')!
      expect(r.textContent!.includes('YOU'), id).toBe(id === view.human)
      expect(r.getAttribute('data-current-turn') === 'true', id).toBe(id === state.current_player)
      for (const [chain, qty] of Object.entries(state.players[id].stocks) as [string, number][]) {
        const badge = screen.queryByTestId(`player-stock-${id}-${chain}`)
        if (qty > 0) expect(badge).toHaveTextContent(String(qty))
        else expect(badge).not.toBeInTheDocument()
      }
    }
  })
})

describe('the page and the socket', () => {
  it('connects with the credentials this browser holds for the room', () => {
    sessionStorage.setItem('player_id', 'p-1')
    sessionStorage.setItem('session_token', 'tok-1')
    renderPage()
    expect(socket.opts).toMatchObject({ roomCode: 'TEST', playerId: 'p-1', token: 'tok-1' })
  })

  it('a browser with no credentials connects without them (the server then says "Player not found")', () => {
    renderPage()
    expect(socket.opts).toMatchObject({ roomCode: 'TEST', playerId: '', token: '' })
  })
})

describe('starting the game as host', () => {
  const lobby = () => playedGame('classic').lobby
  const answer = (status: number) => {
    const fn = vi.fn(async () => new Response('{}', { status }))
    vi.stubGlobal('fetch', fn)
    return fn
  }

  it('START GAME posts to the room with the host token, and says so', async () => {
    sessionStorage.setItem('session_token', 'tok-1')
    const fn = answer(200)
    useGameStore.getState().handleMessage(lobby())
    useGameStore.setState({ connectionStatus: 'connected' })
    renderPage('?is_host=1')
    fireEvent.click(screen.getByText('START GAME'))
    await waitFor(() => expect(screen.getByText('Game started!')).toBeInTheDocument())
    const call = fn.mock.calls.find((c) => String(c[0]).endsWith('/start'))!
    const [url, init] = call as unknown as [string, RequestInit]
    expect(url).toBe('/api/room/TEST/start')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok-1' })
  })

  it('a refusal shows "Failed to start game" and the button works again', async () => {
    answer(400)
    useGameStore.getState().handleMessage(lobby())
    useGameStore.setState({ connectionStatus: 'connected' })
    renderPage('?is_host=1')
    fireEvent.click(screen.getByText('START GAME'))
    await waitFor(() => expect(screen.getByText('Failed to start game')).toBeInTheDocument())
    expect(screen.getByText('START GAME')).toBeEnabled()
  })

  it('the host can remove AI seats but not human ones, and adding is off when the room is full', () => {
    const players = lobby().players
    useGameStore.getState().handleMessage(lobby())
    useGameStore.setState({ connectionStatus: 'connected' })
    const first = renderPage('?is_host=1')
    expect(screen.queryByTestId(`remove-seat-${players[0].player_id}`)).not.toBeInTheDocument()
    expect(screen.getByTestId(`remove-seat-${players[1].player_id}`)).toBeInTheDocument()
    first.unmount()
    // Six seats fill a classic room.
    const six = Array.from({ length: 6 }, (_, i) => ({
      ...players[1],
      player_id: `bot_${i}`,
      name: `Bot ${i}`,
    }))
    useGameStore.getState().handleMessage({ ...lobby(), players: six })
    useGameStore.setState({ connectionStatus: 'connected' })
    renderPage('?is_host=1')
    expect(screen.getByRole('button', { name: '+ ADD BOT' })).toBeDisabled()
  })

  it('a guest sees no remove buttons', () => {
    const players = lobby().players
    useGameStore.getState().handleMessage(lobby())
    useGameStore.setState({ connectionStatus: 'connected' })
    renderPage()
    expect(screen.queryByTestId(`remove-seat-${players[1].player_id}`)).not.toBeInTheDocument()
  })
})
