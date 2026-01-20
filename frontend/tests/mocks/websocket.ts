import { vi } from 'vitest'

export class MockWebSocket {
  static instances: MockWebSocket[] = []

  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: ((error: Event) => void) | null = null
  readyState = WebSocket.CONNECTING

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
  }

  send = vi.fn()
  close = vi.fn()

  // Test helpers
  simulateOpen() {
    this.readyState = WebSocket.OPEN
    this.onopen?.()
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateClose() {
    this.readyState = WebSocket.CLOSED
    this.onclose?.()
  }

  simulateError(error: Event) {
    this.onerror?.(error)
  }

  static reset() {
    MockWebSocket.instances = []
  }
}

// Mock global WebSocket
vi.stubGlobal('WebSocket', MockWebSocket)
