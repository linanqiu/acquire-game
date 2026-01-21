/**
 * WebSocket Hook
 * Manages WebSocket connection to the game server.
 */

import { useEffect, useRef, useCallback } from 'react'
import { useGameStore } from '../store'
import type { GameAction, WebSocketMessage } from '../types/api'

const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000'

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
  const maxReconnectAttempts = 5

  const { connectionStatus, setConnectionStatus, handleMessage } = useGameStore()

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
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

      const wsUrl = `${WS_BASE_URL}/ws/player/${roomCode}/${playerId}?token=${token}`
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        setConnectionStatus('connected')
        reconnectAttemptsRef.current = 0
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
        setConnectionStatus('error', 'WebSocket connection error')
        onError?.('Connection error')
      }

      ws.onclose = (event) => {
        wsRef.current = null

        // Don't reconnect if it was a clean close or we've exceeded attempts
        if (event.wasClean || reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setConnectionStatus('disconnected')
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
      // Clean close on unmount
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
