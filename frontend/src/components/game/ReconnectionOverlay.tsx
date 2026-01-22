import { useEffect, useReducer, useRef, useCallback } from 'react'
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

// State machine for reconnection flow
type ReconnectionState = {
  phase: 'idle' | 'attempting' | 'waiting' | 'manual'
  attempts: number
}

type ReconnectionAction =
  | { type: 'START_ATTEMPT' }
  | { type: 'ATTEMPT_SUCCESS' }
  | { type: 'ATTEMPT_FAILED'; maxAttempts: number }
  | { type: 'SCHEDULE_RETRY' }
  | { type: 'RESET' }
  | { type: 'MANUAL_RETRY' }

function reconnectionReducer(
  state: ReconnectionState,
  action: ReconnectionAction
): ReconnectionState {
  switch (action.type) {
    case 'START_ATTEMPT':
      return { ...state, phase: 'attempting' }

    case 'ATTEMPT_SUCCESS':
      return { phase: 'idle', attempts: 0 }

    case 'ATTEMPT_FAILED': {
      const newAttempts = state.attempts + 1
      if (newAttempts >= action.maxAttempts) {
        return { phase: 'manual', attempts: newAttempts }
      }
      return { phase: 'waiting', attempts: newAttempts }
    }

    case 'SCHEDULE_RETRY':
      // Transition from waiting to idle to trigger next attempt
      return { ...state, phase: 'idle' }

    case 'RESET':
      return { phase: 'idle', attempts: 0 }

    case 'MANUAL_RETRY':
      return { phase: 'idle', attempts: 0 }

    default:
      return state
  }
}

export function ReconnectionOverlay({
  connectionStatus,
  playerName = 'Player',
  onReconnect,
  onBackToLobby,
  maxAttempts = 3,
  retryDelayMs = 2000,
}: ReconnectionOverlayProps) {
  const [state, dispatch] = useReducer(reconnectionReducer, {
    phase: 'idle',
    attempts: 0,
  })

  const mountedRef = useRef(true)
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear timeout helper
  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearRetryTimeout()
    }
  }, [clearRetryTimeout])

  // Reset when connection status changes to disconnected
  useEffect(() => {
    if (connectionStatus === 'disconnected') {
      clearRetryTimeout()
      dispatch({ type: 'RESET' })
    }
  }, [connectionStatus, clearRetryTimeout])

  // Handle the reconnection attempt
  useEffect(() => {
    if (connectionStatus !== 'disconnected') return
    if (state.phase !== 'idle') return
    if (state.attempts >= maxAttempts) {
      dispatch({ type: 'ATTEMPT_FAILED', maxAttempts })
      return
    }

    let cancelled = false

    const doReconnect = async () => {
      if (cancelled || !mountedRef.current) return

      dispatch({ type: 'START_ATTEMPT' })

      try {
        const success = await onReconnect()

        if (cancelled || !mountedRef.current) return

        if (success) {
          dispatch({ type: 'ATTEMPT_SUCCESS' })
        } else {
          dispatch({ type: 'ATTEMPT_FAILED', maxAttempts })
        }
      } catch {
        if (cancelled || !mountedRef.current) return
        dispatch({ type: 'ATTEMPT_FAILED', maxAttempts })
      }
    }

    doReconnect()

    return () => {
      cancelled = true
    }
  }, [connectionStatus, state.phase, state.attempts, maxAttempts, onReconnect])

  // Handle retry scheduling
  useEffect(() => {
    if (connectionStatus !== 'disconnected') return
    if (state.phase !== 'waiting') return

    retryTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        dispatch({ type: 'SCHEDULE_RETRY' })
      }
    }, retryDelayMs)

    return clearRetryTimeout
  }, [connectionStatus, state.phase, retryDelayMs, clearRetryTimeout])

  const handleManualRejoin = useCallback(() => {
    clearRetryTimeout()
    dispatch({ type: 'MANUAL_RETRY' })
  }, [clearRetryTimeout])

  // Don't show anything when connected
  if (connectionStatus === 'connected') {
    return null
  }

  const showManual = state.phase === 'manual'
  const title = showManual ? 'CONNECTION LOST' : 'RECONNECTING...'
  const displayAttempt = Math.min(state.attempts + 1, maxAttempts)

  return (
    <Modal open={true} onClose={() => {}} title={title} dismissible={false}>
      {!showManual ? (
        <div className={styles.reconnecting} data-testid="reconnecting-status">
          <Spinner size="lg" />
          <p className={styles.message}>Re-establishing connection to room...</p>
          <p className={styles.attempts} data-testid="attempt-count">
            Attempt {displayAttempt}/{maxAttempts}
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
