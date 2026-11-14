import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useWebSocket } from './useWebSocket'
import { useHostWebSocket } from './useHostWebSocket'
import { useGameStore } from '../store/gameStore'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((e: { wasClean: boolean }) => void) | null = null
  sent: string[] = []
  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {}
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

describe('WebSocket hooks: server error messages', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    useGameStore.getState().reset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('player socket passes {type:"error"} messages to onError and not to the store', () => {
    const onError = vi.fn()
    renderHook(() => useWebSocket({ roomCode: 'ABCD', playerId: 'p1', token: 't', onError }))
    const ws = FakeWebSocket.instances.at(-1)!
    ws.receive({ type: 'error', message: 'Cannot trade Festival stock during its merger' })
    expect(onError).toHaveBeenCalledWith('Cannot trade Festival stock during its merger')
  })

  it('host socket does the same', () => {
    const onError = vi.fn()
    renderHook(() => useHostWebSocket({ roomCode: 'ABCD', onError }))
    const ws = FakeWebSocket.instances.at(-1)!
    ws.receive({ type: 'error', message: 'Not enough players' })
    expect(onError).toHaveBeenCalledWith('Not enough players')
  })

  it('answers server pings with a pong', () => {
    renderHook(() => useWebSocket({ roomCode: 'ABCD', playerId: 'p1', token: 't' }))
    const ws = FakeWebSocket.instances.at(-1)!
    ws.receive({ type: 'ping' })
    expect(ws.sent).toEqual([JSON.stringify({ type: 'pong' })])
  })
})
