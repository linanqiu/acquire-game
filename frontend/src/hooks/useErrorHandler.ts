/**
 * Error Handler Hook
 * Provides error handling utilities integrated with the toast system.
 */

import { useCallback } from 'react'
import { useToast } from '../components/ui/useToast'
import { categorizeError, getToastType, logError, type GameError } from '../lib/errorHandler'

interface UseErrorHandlerReturn {
  /**
   * Handle any error - categorizes it, shows toast, and logs
   */
  handleError: (error: unknown, context?: Record<string, unknown>) => GameError

  /**
   * Handle a server error message (from WebSocket)
   */
  handleServerError: (message: string) => GameError

  /**
   * Handle a connection error
   */
  handleConnectionError: (error?: string) => GameError
}

export function useErrorHandler(): UseErrorHandlerReturn {
  const { toast } = useToast()

  const handleError = useCallback(
    (error: unknown, context?: Record<string, unknown>): GameError => {
      const gameError = categorizeError(error)
      const toastType = getToastType(gameError.category)

      // Show toast to user
      toast(gameError.message, toastType)

      // Log for debugging
      logError(gameError, context)

      return gameError
    },
    [toast]
  )

  const handleServerError = useCallback(
    (message: string): GameError => {
      return handleError(message, { source: 'server' })
    },
    [handleError]
  )

  const handleConnectionError = useCallback(
    (error?: string): GameError => {
      const errorMessage = error || 'connection_lost'
      return handleError(errorMessage, { source: 'connection' })
    },
    [handleError]
  )

  return {
    handleError,
    handleServerError,
    handleConnectionError,
  }
}
