import { useEffect, useState, useRef } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import styles from './ReconnectionOverlay.module.css'

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting'

export interface ReconnectionOverlayProps {
  connectionStatus: ConnectionStatus
  playerName?: string
  onReconnect: () => Promise<boolean>
  onBackToLobby: () => void
  maxAttempts?: number
  retryDelayMs?: number
}

export function ReconnectionOverlay({
  connectionStatus,
  playerName = 'Player',
  onReconnect,
  onBackToLobby,
  maxAttempts = 3,
  retryDelayMs = 2000,
}: ReconnectionOverlayProps) {
  const [attempts, setAttempts] = useState(0)
  const [showManual, setShowManual] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const mountedRef = useRef(true)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Use key to reset component state when connection status changes
  const [resetKey, setResetKey] = useState(0)

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [])

  // Reset state when connection status changes to disconnected
  useEffect(() => {
    if (connectionStatus === 'disconnected') {
      setResetKey((k) => k + 1)
    }
  }, [connectionStatus])

  // The actual reconnection logic, triggered by resetKey or manual retry
  useEffect(() => {
    if (connectionStatus !== 'disconnected') return

    // Don't auto-reconnect if already showing manual or reconnecting
    if (showManual || isReconnecting) return
    // Don't auto-reconnect if we've hit max attempts
    if (attempts >= maxAttempts) {
      setShowManual(true)
      return
    }

    let cancelled = false

    const doReconnect = async () => {
      if (cancelled || !mountedRef.current) return

      setIsReconnecting(true)

      try {
        const success = await onReconnect()

        if (cancelled || !mountedRef.current) return

        if (success) {
          setAttempts(0)
          setShowManual(false)
        } else {
          setAttempts((a) => a + 1)
        }
      } catch {
        if (cancelled || !mountedRef.current) return
        setAttempts((a) => a + 1)
      } finally {
        if (!cancelled && mountedRef.current) {
          setIsReconnecting(false)
        }
      }
    }

    doReconnect()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, connectionStatus])

  // Handle retry after failed attempt
  useEffect(() => {
    if (connectionStatus !== 'disconnected') return
    if (isReconnecting || showManual) return
    if (attempts === 0 || attempts >= maxAttempts) {
      if (attempts >= maxAttempts) {
        setShowManual(true)
      }
      return
    }

    // Schedule retry
    reconnectTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        setResetKey((k) => k + 1)
      }
    }, retryDelayMs)

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [attempts, connectionStatus, isReconnecting, maxAttempts, retryDelayMs, showManual])

  const handleManualRejoin = async () => {
    setShowManual(false)
    setAttempts(0)
    setResetKey((k) => k + 1)
  }

  // Don't show anything when connected
  if (connectionStatus === 'connected') {
    return null
  }

  const isOpen = connectionStatus !== 'connected'
  const title = showManual ? 'CONNECTION LOST' : 'RECONNECTING...'

  return (
    <Modal
      open={isOpen}
      onClose={() => {}}
      title={title}
      dismissible={false}
    >
      {!showManual ? (
        <div className={styles.reconnecting} data-testid="reconnecting-status">
          <Spinner size="lg" />
          <p className={styles.message}>Re-establishing connection to room...</p>
          <p className={styles.attempts} data-testid="attempt-count">
            Attempt {Math.min(attempts + 1, maxAttempts)}/{maxAttempts}
          </p>
        </div>
      ) : (
        <div className={styles.manual} data-testid="manual-rejoin">
          <p className={styles.message}>Unable to reconnect automatically.</p>
          <p className={styles.subMessage}>Your game may still be in progress.</p>

          <div className={styles.actions}>
            <Button onClick={handleManualRejoin} data-testid="rejoin-button">
              REJOIN AS {playerName.toUpperCase()}
            </Button>

            <Button variant="secondary" onClick={onBackToLobby} data-testid="back-to-lobby-button">
              BACK TO LOBBY
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
