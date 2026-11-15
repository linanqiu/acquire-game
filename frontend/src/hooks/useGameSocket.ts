/**
 * The game WebSocket shared by the player and host pages: feeds server messages to the game
 * store, answers keepalive pings, hands `{type:'error'}` refusals to the page, and recovers
 * from drops (doubling back-off, a manual reconnect, and the browser's offline/online events).
 */

import { useEffect, useRef, useCallback } from 'react'
import { useGameStore } from '../store'
import type { WebSocketMessage } from '../types/api'
import { abandonSocket, watchNetwork } from '../lib/network'
import { NOT_FOUND_CLOSE_CODE, ROOM_NOT_FOUND } from '../lib/roomAvailability'

const MAX_RECONNECT_ATTEMPTS = 5

/** `ws(s)://<this host><path>`: same origin, so the Vite proxy forwards it in dev. */
function socketUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${path}`
}

type TimerRef = { current: ReturnType<typeof setTimeout> | null }

function clearTimer(timer: TimerRef) {
  if (timer.current) {
    clearTimeout(timer.current)
    timer.current = null
  }
}

export interface GameSocketOptions {
  onError?: (error: string) => void
  onClose?: () => void
}

export interface GameSocket {
  /** Sends a JSON message; false (and nothing sent) when the socket is not open. */
  send: (message: unknown) => boolean
  /** Re-open the socket now (resets the retry budget). Resolves true once connected. */
  reconnect: () => Promise<boolean>
}

export function useGameSocket(path: string, { onError, onClose }: GameSocketOptions): GameSocket {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const intentionalCloseRef = useRef(false)
  const connectRef = useRef<(() => void) | null>(null)

  const setConnectionStatus = useGameStore((s) => s.setConnectionStatus)
  const handleMessage = useGameStore((s) => s.handleMessage)

  const send = useCallback((message: unknown): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
      return true
    }
    console.error('WebSocket is not connected')
    return false
  }, [])

  const reconnect = useCallback((): Promise<boolean> => {
    clearTimer(reconnectTimeoutRef)
    reconnectAttemptsRef.current = 0
    intentionalCloseRef.current = false
    connectRef.current?.()
    // Resolve once the store reports a connection (the server then pushes fresh state),
    // or give up after a few seconds.
    return new Promise((resolve) => {
      const started = Date.now()
      const poll = () => {
        const status = useGameStore.getState().connectionStatus
        if (status === 'connected') resolve(true)
        else if (Date.now() - started > 4000) resolve(false)
        else setTimeout(poll, 100)
      }
      poll()
    })
  }, [])

  // Connect on mount, reconnect with exponential backoff
  useEffect(() => {
    const connect = () => {
      if (
        wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING
      ) {
        return
      }

      setConnectionStatus('connecting')
      const ws = new WebSocket(socketUrl(path))

      ws.onopen = () => {
        setConnectionStatus('connected')
        reconnectAttemptsRef.current = 0
        intentionalCloseRef.current = false
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage
          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }))
            return
          }
          // Server refusals (illegal action, bad trade, ...) arrive as {type:'error'}.
          if (message.type === 'error') {
            onError?.(message.message)
            return
          }
          handleMessage(message)
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error)
        }
      }

      ws.onerror = () => {
        // No toast for a transient error: only when reconnecting has failed.
        setConnectionStatus('error', 'WebSocket connection error')
      }

      ws.onclose = (event) => {
        // A socket replaced since (StrictMode double mount, manual reconnect) is ignored.
        if (wsRef.current !== ws) return
        wsRef.current = null

        // The server refused the room or seat: retrying cannot help.
        if (event.code === NOT_FOUND_CLOSE_CODE) {
          intentionalCloseRef.current = true
          setConnectionStatus('error', event.reason || ROOM_NOT_FOUND)
          onClose?.()
          return
        }

        const exhausted = reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS
        if (intentionalCloseRef.current || event.wasClean || exhausted) {
          setConnectionStatus('disconnected')
          if (!intentionalCloseRef.current && !event.wasClean) {
            onError?.('Connection failed after multiple attempts')
          }
          onClose?.()
          return
        }

        reconnectAttemptsRef.current++
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000)
        setConnectionStatus('connecting')
        reconnectTimeoutRef.current = setTimeout(connect, delay)
      }

      wsRef.current = ws
    }

    connectRef.current = connect
    connect()

    // Network lost: the socket may still look open for minutes, so drop it now (the
    // page shows the reconnection overlay) and reconnect as soon as we are back online.
    const stopWatchingNetwork = watchNetwork(
      () => {
        const ws = wsRef.current
        if (!ws) return
        wsRef.current = null
        abandonSocket(ws)
        clearTimer(reconnectTimeoutRef)
        setConnectionStatus('connecting')
      },
      () => {
        clearTimer(reconnectTimeoutRef)
        reconnectAttemptsRef.current = 0
        intentionalCloseRef.current = false
        connect()
      }
    )

    return () => {
      stopWatchingNetwork()
      connectRef.current = null
      clearTimer(reconnectTimeoutRef)
      // Leaving the page is not a failure: no error toast.
      intentionalCloseRef.current = true
      reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS
      wsRef.current?.close()
    }
  }, [path, setConnectionStatus, handleMessage, onError, onClose])

  return { send, reconnect }
}
