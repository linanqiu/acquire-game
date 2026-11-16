import { useEffect, useState } from 'react'
import type { ConnectionStatus } from '../store/gameStore'

/**
 * What the page shows around the socket's life: `hasConnected` (the reconnection overlay only
 * makes sense after a first connection) and `showReconnected` (a welcome-back card after the
 * connection came back: it goes by itself after a few seconds, or at once when tapped, or when
 * the connection drops again).
 */
const RECONNECTED_MS = 6000

export function useConnectionLifecycle(connectionStatus: ConnectionStatus) {
  const [hasConnected, setHasConnected] = useState(connectionStatus === 'connected')
  const [showReconnected, setShowReconnected] = useState(false)
  // Reacts to status changes during render (React's "adjust state when a prop changes").
  const [prevStatus, setPrevStatus] = useState(connectionStatus)
  if (connectionStatus !== prevStatus) {
    setPrevStatus(connectionStatus)
    if (connectionStatus === 'connected') {
      if (hasConnected) setShowReconnected(true)
      setHasConnected(true)
    } else {
      setShowReconnected(false)
    }
  }
  useEffect(() => {
    if (!showReconnected) return
    const timer = setTimeout(() => setShowReconnected(false), RECONNECTED_MS)
    return () => clearTimeout(timer)
  }, [showReconnected])
  return { hasConnected, showReconnected, dismissReconnected: () => setShowReconnected(false) }
}
