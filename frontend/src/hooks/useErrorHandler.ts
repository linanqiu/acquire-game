/**
 * Error Handler Hook
 * Provides error handling utilities integrated with the toast system.
 */

import { useCallback } from 'react'
import { useToast } from '../components/ui/useToast'
import { categorizeError, getToastType, logError, type GameError } from '../lib/errorHandler'
import { useRuleset } from '../ruleset/useRules'

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
  const ruleset = useRuleset()

  const handleError = useCallback(
    (error: unknown, context?: Record<string, unknown>): GameError => {
      const gameError = categorizeError(error, ruleset)
      const toastType = getToastType(gameError.category)

      // Show toast to user
      toast(gameError.message, toastType)

      // Log for debugging
      logError(gameError, context)

      return gameError
    },
    [toast, ruleset]
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
