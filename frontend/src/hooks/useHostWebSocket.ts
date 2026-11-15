/**
 * Host WebSocket Hook
 * Manages WebSocket connection for spectator/host mode (no player credentials required).
 */

import { useEffect, useRef, useCallback } from 'react'
import { useGameStore } from '../store'
import type { WebSocketMessage } from '../types/api'
import { abandonSocket, watchNetwork } from '../lib/network'
import { NOT_FOUND_CLOSE_CODE, ROOM_NOT_FOUND } from '../lib/roomAvailability'

// Helper to build WebSocket URL for host mode
function getHostWebSocketUrl(roomCode: string): string {
  // If explicit WS URL is configured, use it
  if (import.meta.env.VITE_WS_URL) {
    return `${import.meta.env.VITE_WS_URL}/ws/host/${roomCode}`
  }
  // Otherwise, use relative URL (goes through Vite proxy in dev)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/host/${roomCode}`
}

interface UseHostWebSocketOptions {
  roomCode: string
  onError?: (error: string) => void
  onClose?: () => void
}

interface UseHostWebSocketReturn {
  disconnect: () => void
  /** Manually re-open the socket (resets the retry budget). Resolves true once connected. */
  reconnect: () => Promise<boolean>
  isConnected: boolean
}

export function useHostWebSocket({
  roomCode,
  onError,
  onClose,
}: UseHostWebSocketOptions): UseHostWebSocketReturn {
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

  const reconnect = useCallback((): Promise<boolean> => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    reconnectAttemptsRef.current = 0
    intentionalCloseRef.current = false
    connectRef.current?.()
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

      const wsUrl = getHostWebSocketUrl(roomCode)
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        setConnectionStatus('connected')
        reconnectAttemptsRef.current = 0
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
        setConnectionStatus('error', 'WebSocket connection error')
      }

      ws.onclose = (event) => {
        wsRef.current = null

        // The server says the room does not exist: retrying cannot help.
        if (event.code === NOT_FOUND_CLOSE_CODE) {
          intentionalCloseRef.current = true
          setConnectionStatus('error', event.reason || ROOM_NOT_FOUND)
          onClose?.()
          return
        }

        if (
          intentionalCloseRef.current ||
          event.wasClean ||
          reconnectAttemptsRef.current >= maxReconnectAttempts
        ) {
          setConnectionStatus('disconnected')
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
      intentionalCloseRef.current = true
      reconnectAttemptsRef.current = maxReconnectAttempts
      wsRef.current?.close()
    }
  }, [roomCode, setConnectionStatus, handleMessage, onError, onClose])

  return {
    disconnect,
    reconnect,
    isConnected: connectionStatus === 'connected',
  }
}
