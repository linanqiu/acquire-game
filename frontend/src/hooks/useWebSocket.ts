/**
 * WebSocket Hook
 * Manages WebSocket connection to the game server.
 */

import { useEffect, useRef, useCallback } from 'react'
import { useGameStore } from '../store'
import type { GameAction, WebSocketMessage } from '../types/api'
import { abandonSocket, watchNetwork } from '../lib/network'
import { NOT_FOUND_CLOSE_CODE, ROOM_NOT_FOUND } from '../lib/roomAvailability'

// Player id used when this browser has no credentials: the server answers "Player not
// found" (or "Room not found"), which the page turns into a clear message.
const NO_PLAYER = '-'

// Helper to build WebSocket URL
// Use relative path to go through Vite proxy in dev, works in prod too
function getWebSocketUrl(roomCode: string, playerId: string, token: string): string {
  // If explicit WS URL is configured, use it (bypasses Vite proxy)
  if (import.meta.env.VITE_WS_URL) {
    return `${import.meta.env.VITE_WS_URL}/ws/player/${roomCode}/${playerId || NO_PLAYER}?token=${token}`
  }
  // Otherwise, use relative URL (goes through Vite proxy in dev)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/player/${roomCode}/${playerId || NO_PLAYER}?token=${token}`
}

interface UseWebSocketOptions {
  roomCode: string
  playerId: string
  token: string
  onError?: (error: string) => void
  onClose?: () => void
}

interface UseWebSocketReturn {
  /** Returns false (and sends nothing) when the socket is not open. */
  sendAction: (action: GameAction) => boolean
  disconnect: () => void
  /** Manually re-open the socket (resets the retry budget). Resolves true once connected. */
  reconnect: () => Promise<boolean>
  isConnected: boolean
}

export function useWebSocket({
  roomCode,
  playerId,
  token,
  onError,
  onClose,
}: UseWebSocketOptions): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const intentionalCloseRef = useRef(false)
  const maxReconnectAttempts = 5
  const connectRef = useRef<(() => void) | null>(null)

  const { connectionStatus, setConnectionStatus, handleMessage } = useGameStore()

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    intentionalCloseRef.current = true
    reconnectAttemptsRef.current = maxReconnectAttempts // Prevent reconnect
    wsRef.current?.close()
    wsRef.current = null
    setConnectionStatus('disconnected')
  }, [setConnectionStatus])

  const sendAction = useCallback((action: GameAction): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(action))
      return true
    }
    console.error('WebSocket is not connected')
    return false
  }, [])

  const reconnect = useCallback((): Promise<boolean> => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
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

      const wsUrl = getWebSocketUrl(roomCode, playerId, token)
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        setConnectionStatus('connected')
        reconnectAttemptsRef.current = 0
        intentionalCloseRef.current = false
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage
          // Respond to server keepalive pings with pong
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
        // Don't show error toast for transient errors - wait for reconnection to fail
        setConnectionStatus('error', 'WebSocket connection error')
      }

      ws.onclose = (event) => {
        // Only handle close if this is still the current WebSocket
        // (prevents race condition with React StrictMode double-mount)
        if (wsRef.current !== ws) {
          return
        }

        wsRef.current = null

        // The server refused the room or seat: retrying cannot help.
        if (event.code === NOT_FOUND_CLOSE_CODE) {
          intentionalCloseRef.current = true
          setConnectionStatus('error', event.reason || ROOM_NOT_FOUND)
          onClose?.()
          return
        }

        // Don't reconnect if it was intentional, clean close, or we've exceeded attempts
        if (
          intentionalCloseRef.current ||
          event.wasClean ||
          reconnectAttemptsRef.current >= maxReconnectAttempts
        ) {
          setConnectionStatus('disconnected')
          // Only show error if we exhausted all reconnection attempts (not intentional or clean close)
          if (
            !intentionalCloseRef.current &&
            !event.wasClean &&
            reconnectAttemptsRef.current >= maxReconnectAttempts
          ) {
            onError?.('Connection failed after multiple attempts')
          }
          onClose?.()
          return
        }

        // Exponential backoff reconnect
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
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
          reconnectTimeoutRef.current = null
        }
        setConnectionStatus('connecting')
      },
      () => {
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
          reconnectTimeoutRef.current = null
        }
        reconnectAttemptsRef.current = 0
        intentionalCloseRef.current = false
        connect()
      }
    )

    return () => {
      stopWatchingNetwork()
      connectRef.current = null
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      // Mark as intentional close to prevent error toast on unmount
      intentionalCloseRef.current = true
      reconnectAttemptsRef.current = maxReconnectAttempts
      wsRef.current?.close()
    }
  }, [roomCode, playerId, token, setConnectionStatus, handleMessage, onError, onClose])

  return {
    sendAction,
    disconnect,
    reconnect,
    isConnected: connectionStatus === 'connected',
  }
}
