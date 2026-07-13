/**
 * Tests for the player WebSocket hook, including the RT-004 optimistic
 * update reconciliation paths: server confirmation (game_state) and
 * server rejection (error → rollback + onServerError callback).
 */

import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useWebSocket } from './useWebSocket'
import { useGameStore } from '../store/gameStore'
import type { ChainName, GameStateMessage } from '../types/api'

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: MockWebSocket[] = []

  url: string
  readyState = MockWebSocket.CONNECTING
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { wasClean: boolean }) => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  simulateMessage(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  simulateClose(wasClean: boolean) {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ wasClean })
  }
}

function makeGameState(overrides: Partial<GameStateMessage> = {}): GameStateMessage {
  return {
    type: 'game_state',
    board: { cells: {} },
    hotel: {
      chains: [],
      available_stocks: {} as Record<ChainName, number>,
      active_chains: [],
    },
    turn_order: ['p1'],
    current_player: 'p1',
    phase: 'place_tile',
    players: {},
    tiles_remaining: 90,
    your_hand: ['1A', '2B'],
    ...overrides,
  }
}

const defaultOptions = {
  roomCode: 'TEST',
  playerId: 'p1',
  token: 'token-123',
}

describe('useWebSocket', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    useGameStore.getState().reset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('connects to the player WebSocket URL and reports connected on open', () => {
    const { result } = renderHook(() => useWebSocket(defaultOptions))

    expect(MockWebSocket.instances).toHaveLength(1)
    const ws = MockWebSocket.instances[0]
    expect(ws.url).toContain('/ws/player/TEST/p1')
    expect(ws.url).toContain('token=token-123')
    expect(result.current.isConnected).toBe(false)

    act(() => ws.simulateOpen())

    expect(result.current.isConnected).toBe(true)
    expect(useGameStore.getState().connectionStatus).toBe('connected')
  })

  it('sends actions as JSON when connected', () => {
    const { result } = renderHook(() => useWebSocket(defaultOptions))
    const ws = MockWebSocket.instances[0]
    act(() => ws.simulateOpen())

    act(() => result.current.sendAction({ action: 'place_tile', tile: '1A' }))

    expect(ws.sent).toContain(JSON.stringify({ action: 'place_tile', tile: '1A' }))
  })

  it('does not send when the socket is not open', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useWebSocket(defaultOptions))
    const ws = MockWebSocket.instances[0]

    act(() => result.current.sendAction({ action: 'end_turn' }))

    expect(ws.sent).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalledWith('WebSocket is not connected')
    errorSpy.mockRestore()
  })

  it('replies to server pings with pong without touching the store', () => {
    renderHook(() => useWebSocket(defaultOptions))
    const ws = MockWebSocket.instances[0]
    act(() => ws.simulateOpen())

    act(() => ws.simulateMessage({ type: 'ping' }))

    expect(ws.sent).toContain(JSON.stringify({ type: 'pong' }))
    expect(useGameStore.getState().gameState).toBeNull()
  })

  it('routes game_state messages into the store (server confirmation)', () => {
    renderHook(() => useWebSocket(defaultOptions))
    const ws = MockWebSocket.instances[0]
    act(() => ws.simulateOpen())

    act(() => ws.simulateMessage(makeGameState({ tiles_remaining: 42 })))

    expect(useGameStore.getState().gameState?.tiles_remaining).toBe(42)
    expect(useGameStore.getState().yourHand).toEqual(['1A', '2B'])
  })

  it('confirms pending optimistic actions when game_state arrives', () => {
    renderHook(() => useWebSocket(defaultOptions))
    const ws = MockWebSocket.instances[0]
    act(() => ws.simulateOpen())
    act(() => ws.simulateMessage(makeGameState()))

    act(() => {
      useGameStore.getState().beginOptimisticAction('place_tile', { yourHand: ['2B'] })
    })
    expect(useGameStore.getState().pendingActions).toHaveLength(1)

    act(() => ws.simulateMessage(makeGameState({ your_hand: ['2B', '9I'] })))

    expect(useGameStore.getState().pendingActions).toEqual([])
    expect(useGameStore.getState().yourHand).toEqual(['2B', '9I'])
  })

  it('rolls back optimistic actions and calls onServerError on server rejection', () => {
    const onServerError = vi.fn()
    renderHook(() => useWebSocket({ ...defaultOptions, onServerError }))
    const ws = MockWebSocket.instances[0]
    act(() => ws.simulateOpen())
    act(() => ws.simulateMessage(makeGameState()))

    act(() => {
      useGameStore.getState().beginOptimisticAction('place_tile', { yourHand: ['2B'] })
    })
    expect(useGameStore.getState().yourHand).toEqual(['2B'])

    act(() => ws.simulateMessage({ type: 'error', message: 'Invalid tile' }))

    // Rollback happened...
    expect(useGameStore.getState().yourHand).toEqual(['1A', '2B'])
    expect(useGameStore.getState().pendingActions).toEqual([])
    // ...and the page was notified so it can show a toast
    expect(onServerError).toHaveBeenCalledWith('Invalid tile')
  })

  it('ignores malformed JSON messages', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderHook(() => useWebSocket(defaultOptions))
    const ws = MockWebSocket.instances[0]
    act(() => ws.simulateOpen())

    act(() => ws.onmessage?.({ data: 'not-json{' }))

    expect(errorSpy).toHaveBeenCalled()
    expect(useGameStore.getState().gameState).toBeNull()
    errorSpy.mockRestore()
  })

  it('sets connection status to error on socket error', () => {
    renderHook(() => useWebSocket(defaultOptions))
    const ws = MockWebSocket.instances[0]

    act(() => ws.onerror?.())

    expect(useGameStore.getState().connectionStatus).toBe('error')
  })

  it('reports disconnected on clean close without reconnecting', () => {
    const onClose = vi.fn()
    renderHook(() => useWebSocket({ ...defaultOptions, onClose }))
    const ws = MockWebSocket.instances[0]
    act(() => ws.simulateOpen())

    act(() => ws.simulateClose(true))

    expect(useGameStore.getState().connectionStatus).toBe('disconnected')
    expect(onClose).toHaveBeenCalled()
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('reconnects with backoff after an unclean close', () => {
    vi.useFakeTimers()
    renderHook(() => useWebSocket(defaultOptions))
    const ws = MockWebSocket.instances[0]
    act(() => ws.simulateOpen())

    act(() => ws.simulateClose(false))
    expect(useGameStore.getState().connectionStatus).toBe('connecting')

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('disconnect() closes the socket and prevents reconnection', () => {
    const { result } = renderHook(() => useWebSocket(defaultOptions))
    const ws = MockWebSocket.instances[0]
    act(() => ws.simulateOpen())

    act(() => result.current.disconnect())

    expect(ws.readyState).toBe(MockWebSocket.CLOSED)
    expect(useGameStore.getState().connectionStatus).toBe('disconnected')
    expect(result.current.isConnected).toBe(false)
  })

  it('closes the socket on unmount', () => {
    const { unmount } = renderHook(() => useWebSocket(defaultOptions))
    const ws = MockWebSocket.instances[0]
    act(() => ws.simulateOpen())

    unmount()

    expect(ws.readyState).toBe(MockWebSocket.CLOSED)
  })
})
