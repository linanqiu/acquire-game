/**
 * Error Handler Hook
 * Shows a server refusal (a WebSocket {type:"error"} message) to the player as a toast.
 */

import { useCallback } from 'react'
import { useToast } from '../components/ui/useToast'
import { categorizeError, logError, type GameError } from '../lib/errorHandler'

interface UseErrorHandlerReturn {
  /** Handle a server error message (from WebSocket): categorize it, toast it, log it. */
  handleServerError: (message: string) => GameError
}

export function useErrorHandler(): UseErrorHandlerReturn {
  const { toast } = useToast()

  const handleServerError = useCallback(
    (message: string): GameError => {
      const gameError = categorizeError(message)
      toast(gameError.message, 'error')
      logError(gameError, { source: 'server' })
      return gameError
    },
    [toast]
  )

  return { handleServerError }
}
