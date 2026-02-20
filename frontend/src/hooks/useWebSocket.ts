/**
 * WebSocket Hook
 * Manages WebSocket connection to the game server.
 */

import { useEffect, useRef, useCallback } from 'react'
import { useGameStore } from '../store'
import type { GameAction, WebSocketMessage } from '../types/api'

// Helper to build WebSocket URL
// Use relative path to go through Vite proxy in dev, works in prod too
function getWebSocketUrl(roomCode: string, playerId: string, token: string): string {
  // If explicit WS URL is configured, use it (bypasses Vite proxy)
  if (import.meta.env.VITE_WS_URL) {
    return `${import.meta.env.VITE_WS_URL}/ws/player/${roomCode}/${playerId}?token=${token}`
  }
  // Otherwise, use relative URL (goes through Vite proxy in dev)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/player/${roomCode}/${playerId}?token=${token}`
}

interface UseWebSocketOptions {
  roomCode: string
  playerId: string
  token: string
  onError?: (error: string) => void
  onClose?: () => void
}

interface UseWebSocketReturn {
  sendAction: (action: GameAction) => void
  disconnect: () => void
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

  const sendAction = useCallback((action: GameAction) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(action))
    } else {
      console.error('WebSocket is not connected')
    }
  }, [])

  // Connect on mount, reconnect with exponential backoff
  useEffect(() => {
    const connect = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
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

    connect()

    return () => {
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
    isConnected: connectionStatus === 'connected',
  }
}
