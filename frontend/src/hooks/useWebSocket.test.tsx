/**
 * The player and host sockets: what reaches the store, what the page is told, and how the
 * connection recovers. The browser WebSocket is replaced by a fake the test drives; the
 * messages it delivers are real ones recorded from the server.
 */
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useWebSocket } from './useWebSocket'
import { useHostWebSocket } from './useHostWebSocket'
import { useGameStore } from '../store/gameStore'
import { snapshot } from '../../tests/unit/fixtures/wire'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((e: { wasClean: boolean; code: number; reason: string }) => void) | null = null
  sent: string[] = []
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED
  }
  // -- what the network does
  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
  receive(message: unknown) {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) })
  }
  drop(wasClean = false, code = 1006, reason = '') {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ wasClean, code, reason })
  }
}

const sockets = () => FakeWebSocket.instances
const latest = () => FakeWebSocket.instances.at(-1)!
const status = () => useGameStore.getState().connectionStatus

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.useFakeTimers()
  useGameStore.getState().reset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function player(extra = {}) {
  const onError = vi.fn()
  const onClose = vi.fn()
  const view = renderHook(() =>
    useWebSocket({ roomCode: 'ABCD', playerId: 'p1', onError, onClose, ...extra })
  )
  return { ...view, onError, onClose }
}

describe('player socket', () => {
  it('connects to the player route with its id (no token: the server uses none), and is "connected" once the socket opens', () => {
    player()
    expect(latest().url).toMatch(/^wss?:\/\/.+\/ws\/player\/ABCD\/p1$/)
    expect(status()).toBe('connecting')
    act(() => latest().open())
    expect(status()).toBe('connected')
  })

  it('a browser without credentials still connects (the server answers "Player not found")', () => {
    renderHook(() => useWebSocket({ roomCode: 'ABCD', playerId: '' }))
    expect(latest().url).toMatch(/\/ws\/player\/ABCD\/-$/)
  })

  it('real server messages reach the store: the game state with my hand, and the prompt that goes with it', () => {
    player()
    act(() => latest().open())
    const view = snapshot('found-chain-choice')
    for (const m of view.player) act(() => latest().receive(m))
    const store = useGameStore.getState()
    expect(store.gameState?.phase).toBe('found_chain')
    expect(store.yourHand).toEqual(view.expect.human.hand)
    expect(store.pendingChainChoice).toEqual(
      view.player.find((m) => m.type === 'choose_chain')!.available_chains
    )
  })

  it('answers the server keepalive ping with a pong, and does not treat it as game news', () => {
    player()
    act(() => latest().open())
    act(() => latest().receive({ type: 'ping' }))
    expect(latest().sent).toEqual([JSON.stringify({ type: 'pong' })])
    expect(useGameStore.getState().gameState).toBeNull()
  })

  it('an {type:"error"} message goes to the page, not the store', () => {
    const { onError } = player()
    act(() => latest().open())
    act(() =>
      latest().receive({ type: 'error', message: 'Cannot trade juniper stock during its merger' })
    )
    expect(onError).toHaveBeenCalledWith('Cannot trade juniper stock during its merger')
    expect(useGameStore.getState().gameState).toBeNull()
  })

  it('a garbled message is ignored; the next good one still arrives', () => {
    player()
    act(() => latest().open())
    act(() => latest().receive('{not json'))
    act(() => latest().receive({ type: 'lobby_update', players: [], can_start: true }))
    expect(useGameStore.getState().canStart).toBe(true)
  })

  it('sendAction sends JSON while open, and says false (sending nothing) when not', () => {
    const { result } = player()
    expect(result.current.sendAction({ action: 'end_turn' })).toBe(false)
    act(() => latest().open())
    expect(result.current.sendAction({ action: 'end_turn' })).toBe(true)
    expect(latest().sent).toEqual([JSON.stringify({ action: 'end_turn' })])
  })

  it('a dropped connection reconnects with a doubling delay (2 s, 4 s, ...) and shows "connecting" meanwhile', () => {
    player()
    act(() => latest().open())
    act(() => latest().drop())
    expect(status()).toBe('connecting')
    expect(sockets()).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1999))
    expect(sockets()).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1))
    expect(sockets()).toHaveLength(2)
    act(() => latest().drop())
    act(() => vi.advanceTimersByTime(3999))
    expect(sockets()).toHaveLength(2)
    act(() => vi.advanceTimersByTime(1))
    expect(sockets()).toHaveLength(3)
  })

  it('a successful reconnect starts the budget over', () => {
    player()
    act(() => latest().open())
    for (let round = 0; round < 8; round++) {
      act(() => latest().drop())
      act(() => vi.advanceTimersByTime(2001))
      act(() => latest().open())
    }
    // After many drops each followed by success the delay is still the first one: 2 s.
    expect(status()).toBe('connected')
    act(() => latest().drop())
    act(() => vi.advanceTimersByTime(2001))
    expect(status()).toBe('connecting')
    expect(sockets()).toHaveLength(10)
  })

  it('gives up after five failed attempts: "disconnected", the page is told, and no more sockets', () => {
    const { onError, onClose } = player()
    act(() => latest().drop())
    for (let i = 0; i < 5; i++) {
      act(() => vi.advanceTimersByTime(60_000))
      act(() => latest().drop())
    }
    expect(status()).toBe('disconnected')
    expect(onError).toHaveBeenCalledWith('Connection failed after multiple attempts')
    expect(onClose).toHaveBeenCalled()
    const n = sockets().length
    act(() => vi.advanceTimersByTime(120_000))
    expect(sockets()).toHaveLength(n)
  })

  it('a clean close (the server ended the session) is final: no retry, no error', () => {
    const { onError, onClose } = player()
    act(() => latest().open())
    act(() => latest().drop(true, 1000))
    expect(status()).toBe('disconnected')
    expect(onClose).toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(60_000))
    expect(sockets()).toHaveLength(1)
  })

  it('a refused room (close code 4004) is reported with the server reason and never retried', () => {
    const { onClose } = player()
    act(() => latest().drop(true, 4004, 'Player not found'))
    expect(status()).toBe('error')
    expect(useGameStore.getState().connectionError).toBe('Player not found')
    expect(onClose).toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(60_000))
    expect(sockets()).toHaveLength(1)
  })

  it('a refusal without a reason is "Room not found"', () => {
    player()
    act(() => latest().drop(true, 4004, ''))
    expect(useGameStore.getState().connectionError).toBe('Room not found')
  })

  it('leaving the page closes the socket and cancels a pending reconnect', () => {
    const { unmount } = player()
    const first = latest()
    act(() => first.open())
    act(() => first.drop())
    unmount()
    act(() => vi.advanceTimersByTime(60_000))
    expect(sockets()).toHaveLength(1)
    const second = renderHook(() => useWebSocket({ roomCode: 'ABCD', playerId: 'p1' }))
    act(() => latest().open())
    const open = latest()
    second.unmount()
    expect(open.readyState).toBe(FakeWebSocket.CLOSED)
  })

  it('when the device goes offline the socket is dropped at once, and it reconnects the moment it is back online', () => {
    player()
    act(() => latest().open())
    const first = latest()
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(status()).toBe('connecting')
    expect(first.readyState).toBe(FakeWebSocket.CLOSED)
    expect(sockets()).toHaveLength(1)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(sockets()).toHaveLength(2)
    act(() => latest().open())
    expect(status()).toBe('connected')
  })

  it('reconnect() opens a new socket now and resolves true once connected', async () => {
    const { result } = player()
    act(() => latest().open())
    act(() => latest().drop(false, 1006))
    act(() => vi.advanceTimersByTime(0))
    let resolved: boolean | undefined
    act(() => {
      void result.current.reconnect().then((ok) => (resolved = ok))
    })
    expect(sockets()).toHaveLength(2)
    act(() => latest().open())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(resolved).toBe(true)
  })

  it('reconnect() gives up and resolves false after a few seconds without a connection', async () => {
    const { result } = player()
    let resolved: boolean | undefined
    act(() => {
      void result.current.reconnect().then((ok) => (resolved = ok))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(resolved).toBe(false)
  })

  it('works without any callbacks: an error message, a final close and a refusal do not throw', () => {
    renderHook(() => useWebSocket({ roomCode: 'ABCD', playerId: 'p1' }))
    act(() => latest().open())
    act(() => latest().receive({ type: 'error', message: 'Not allowed' }))
    act(() => latest().drop(true, 1000))
    expect(status()).toBe('disconnected')
    renderHook(() => useWebSocket({ roomCode: 'ABCD', playerId: 'p1' }))
    act(() => latest().drop(true, 4004, 'Room not found'))
    expect(status()).toBe('error')
    renderHook(() => useWebSocket({ roomCode: 'ABCD', playerId: 'p1' }))
    for (let i = 0; i < 6; i++) {
      act(() => latest().drop())
      act(() => vi.advanceTimersByTime(60_000))
    }
    expect(status()).toBe('disconnected')
  })

  it('reconnect() while the connection is fine does not open a second socket', () => {
    const { result } = player()
    act(() => latest().open())
    act(() => {
      void result.current.reconnect()
    })
    expect(sockets()).toHaveLength(1)
    act(() => vi.advanceTimersByTime(5000))
  })

  it('reconnect() in the middle of a back-off opens the socket now, and the old timer does not open another', () => {
    const { result } = player()
    act(() => latest().open())
    act(() => latest().drop())
    expect(sockets()).toHaveLength(1)
    act(() => {
      void result.current.reconnect()
    })
    expect(sockets()).toHaveLength(2)
    act(() => latest().open())
    act(() => vi.advanceTimersByTime(60_000))
    expect(sockets()).toHaveLength(2)
  })

  it('going online in the middle of a back-off connects now, and the pending timer does not add a socket', () => {
    player()
    act(() => latest().open())
    act(() => latest().drop())
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(sockets()).toHaveLength(2)
    act(() => latest().open())
    act(() => vi.advanceTimersByTime(60_000))
    expect(sockets()).toHaveLength(2)
  })

  it('offline with no socket open (the connection had already ended) does nothing', () => {
    player()
    act(() => latest().drop(true, 1000))
    expect(status()).toBe('disconnected')
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(status()).toBe('disconnected')
  })

  it('a back-off that is still pending when the page is left never fires', () => {
    const { unmount } = player()
    act(() => latest().open())
    act(() => latest().drop())
    unmount()
    act(() => vi.advanceTimersByTime(60_000))
    expect(sockets()).toHaveLength(1)
  })
})

describe('host (spectator) socket', () => {
  function host() {
    const onError = vi.fn()
    const view = renderHook(() => useHostWebSocket({ roomCode: 'WXYZ', onError }))
    return { ...view, onError }
  }

  it('connects to the host route, and the spectator state reaches the store', () => {
    host()
    expect(latest().url).toMatch(/\/ws\/host\/WXYZ$/)
    act(() => latest().open())
    expect(status()).toBe('connected')
    const view = snapshot('three-player-midgame')
    act(() => latest().receive(view.host))
    expect(useGameStore.getState().gameState?.current_player).toBe(view.host.current_player)
    expect(useGameStore.getState().publicTrades).toEqual(view.host.pending_trades)
  })

  it('reconnect() opens a new socket and resolves true once connected', async () => {
    const { result } = host()
    act(() => latest().open())
    act(() => latest().drop())
    let resolved: boolean | undefined
    act(() => {
      void result.current.reconnect().then((ok) => (resolved = ok))
    })
    expect(sockets()).toHaveLength(2)
    act(() => latest().open())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(resolved).toBe(true)
  })
})
