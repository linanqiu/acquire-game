/**
 * The player page outside a running game: the lobby (from a real lobby_update), the connection
 * states, and the page's housekeeping. The game screens are in PlayerPage.screens.test.tsx.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { PlayerPage } from './PlayerPage'
import { ToastProvider } from '../components/ui/ToastProvider'
import { useGameStore } from '../store/gameStore'
import { playedGame, loadSnapshotAsPlayer, serverRuleset } from '../../tests/unit/fixtures/wire'

vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    sendAction: vi.fn(() => true),
    reconnect: vi.fn(() => Promise.resolve(true)),
  }),
}))

function renderPlayerPage(room = 'TEST', query = '') {
  return render(
    <MemoryRouter initialEntries={[`/play/${room}${query}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/play/:room" element={<PlayerPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  )
}

/** The lobby the server sent to a player joining a room with a bot and a scripted seat. */
const lobby = () => playedGame('default').lobby

describe('PlayerPage lobby', () => {
  beforeEach(() => {
    useGameStore.getState().reset()
    useGameStore.setState({ connectionStatus: 'connected' })
  })

  it('shows the room code, every seat (AI seats marked) and how many seats are left', () => {
    useGameStore.getState().handleMessage(lobby())
    renderPlayerPage('ABCD')
    // One statement of what the room waits for: the phase bar (no second heading).
    expect(screen.getByTestId('game-phase')).toHaveTextContent('WAITING FOR THE HOST TO START')
    expect(screen.queryByText('WAITING FOR PLAYERS')).not.toBeInTheDocument()
    expect(screen.getByText('ABCD')).toBeInTheDocument()
    for (const p of lobby().players) {
      expect(screen.getByTestId(`lobby-player-${p.player_id}`)).toHaveTextContent(p.name)
    }
    expect(screen.getByTestId(`seat-kind-${lobby().players[1].player_id}`)).toHaveAccessibleName(
      'Rules-based bot'
    )
    expect(
      screen.queryByTestId(`seat-kind-${lobby().players[0].player_id}`)
    ).not.toBeInTheDocument()
    // The list shows the three seats taken; the line under it adds the seats left of six.
    expect(screen.getByTestId('seats-free')).toHaveTextContent('3 seats free')
  })

  it("the maximum is the server ruleset's: 2 of 5 seats left on the small ruleset", () => {
    serverRuleset('mini')
    useGameStore.getState().handleMessage(lobby())
    renderPlayerPage()
    expect(screen.getByTestId('seats-free')).toHaveTextContent('2 seats free')
  })

  it('a guest waits for the host and cannot start or add seats', () => {
    useGameStore.getState().handleMessage(lobby())
    renderPlayerPage()
    expect(screen.getByTestId('game-phase')).toHaveTextContent('WAITING FOR THE HOST TO START')
    // Said once: no second line under the list.
    expect(screen.queryByText(/Waiting for host/i)).not.toBeInTheDocument()
    expect(screen.queryByText('START GAME')).not.toBeInTheDocument()
    expect(screen.queryByText('+ ADD BOT')).not.toBeInTheDocument()
    expect(screen.queryByTestId('start-hint')).not.toBeInTheDocument()
  })

  it('the host can start once the server says there are enough seats', () => {
    useGameStore.getState().handleMessage(lobby())
    renderPlayerPage('TEST', '?is_host=1')
    expect(screen.getByText('START GAME')).toBeEnabled()
    // The enabled button says it can start; the phase bar says whose move that is.
    expect(screen.getByTestId('game-phase')).toHaveTextContent('START WHEN EVERYONE IS IN')
    expect(screen.queryByText(/Ready to start/)).not.toBeInTheDocument()
  })

  it('the host sees why START is off: how many more players are needed (3 in default, 2 in mini)', () => {
    const one = { ...lobby(), players: lobby().players.slice(0, 1), can_start: false }
    useGameStore.getState().handleMessage(one)
    const { unmount } = renderPlayerPage('TEST', '?is_host=1')
    expect(screen.getByText('START GAME')).toBeDisabled()
    expect(screen.getByTestId('game-phase')).toHaveTextContent('NEED 2 MORE PLAYERS TO START')
    expect(screen.getByText('START GAME').closest('button')).toHaveAttribute(
      'title',
      'Need 2 more players to start'
    )
    unmount()
    serverRuleset('mini')
    useGameStore.getState().handleMessage(one)
    renderPlayerPage('TEST', '?is_host=1')
    expect(screen.getByTestId('game-phase')).toHaveTextContent('NEED 1 MORE PLAYER TO START')
  })
})

describe('PlayerPage connection', () => {
  beforeEach(() => {
    useGameStore.getState().reset()
  })

  it('says it is connecting while the socket opens', () => {
    useGameStore.setState({ connectionStatus: 'connecting' })
    renderPlayerPage()
    expect(screen.getByText('Connecting to game...')).toBeInTheDocument()
  })

  it('a socket error shows a message with a REFRESH button', () => {
    useGameStore.setState({ connectionStatus: 'error', connectionError: 'boom' })
    renderPlayerPage()
    expect(screen.queryByTestId('room-unavailable')).toBeNull()
    expect(screen.getByText('Connection error. Please refresh the page.')).toBeInTheDocument()
    expect(screen.getByText('REFRESH')).toBeInTheDocument()
  })

  it('says the game was not found when the server refuses the room', () => {
    useGameStore.setState({ connectionStatus: 'error', connectionError: 'Room not found' })
    renderPlayerPage('QZQZ')
    expect(screen.getByTestId('room-unavailable')).toHaveTextContent('Game QZQZ was not found')
    expect(screen.getByText('BACK TO HOME')).toBeInTheDocument()
  })

  it('says you are not a player when the server refuses the seat', () => {
    useGameStore.setState({ connectionStatus: 'error', connectionError: 'Player not found' })
    renderPlayerPage('ABCD')
    expect(screen.getByTestId('room-unavailable')).toHaveTextContent(
      'You are not a player in game ABCD'
    )
  })

  it('leaving the room clears the game, so the next room does not open on the old one', () => {
    loadSnapshotAsPlayer('game-over')
    useGameStore.getState().handleMessage(lobby())
    const { unmount } = renderPlayerPage('OLDR')
    expect(screen.getByTestId('game-over')).toBeInTheDocument()
    unmount()
    const state = useGameStore.getState()
    expect(state.gameState).toBeNull()
    expect(state.gameOver).toBeNull()
    expect(state.lobbyPlayers).toEqual([])
    expect(state.yourHand).toEqual([])
  })
})
