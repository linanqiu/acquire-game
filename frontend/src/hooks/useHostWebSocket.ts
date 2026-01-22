/**
 * Host WebSocket Hook
 * Manages WebSocket connection for spectator/host mode (no player credentials required).
 */

import { useEffect, useRef, useCallback } from 'react'
import { useGameStore } from '../store'
import type { WebSocketMessage } from '../types/api'

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
  addBot: () => void
  startGame: () => void
  endGame: () => void
  disconnect: () => void
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

  const sendMessage = useCallback((message: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    } else {
      console.error('Host WebSocket is not connected')
    }
  }, [])

  const addBot = useCallback(() => {
    sendMessage({ action: 'add_bot' })
  }, [sendMessage])

  const startGame = useCallback(() => {
    sendMessage({ action: 'start_game' })
  }, [sendMessage])

  const endGame = useCallback(() => {
    sendMessage({ action: 'end_game' })
  }, [sendMessage])

  // Connect on mount, reconnect with exponential backoff
  useEffect(() => {
    const connect = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
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

    connect()

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      intentionalCloseRef.current = true
      reconnectAttemptsRef.current = maxReconnectAttempts
      wsRef.current?.close()
    }
  }, [roomCode, setConnectionStatus, handleMessage, onError, onClose])

  return {
    addBot,
    startGame,
    endGame,
    disconnect,
    isConnected: connectionStatus === 'connected',
  }
}
