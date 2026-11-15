/**
 * Error Handler
 * Turns what the server (or the connection) reports into one message for the player.
 *
 * The server refuses an action with a plain sentence ("Tile not in hand", "Action not allowed
 * now (waiting for place_tile)"), not an error code, so a readable sentence is shown as the
 * server wrote it; only connection/timeout/server problems and unreadable technical text are
 * replaced by a fixed message.
 */

export type ErrorCategory = 'connection' | 'server' | 'timeout' | 'unknown'

export interface GameError {
  category: ErrorCategory
  message: string
  recoverable: boolean
  originalError?: string
}

/**
 * Categorize an error based on its content
 */
export function categorizeError(error: unknown): GameError {
  if (typeof error === 'string') {
    const lowerError = error.toLowerCase()

    if (
      lowerError.includes('connection') ||
      lowerError.includes('websocket') ||
      lowerError.includes('network')
    ) {
      return {
        category: 'connection',
        message: 'Connection issue. Please check your network.',
        recoverable: true,
        originalError: error,
      }
    }

    if (lowerError.includes('timeout') || lowerError.includes('timed out')) {
      return {
        category: 'timeout',
        message: 'Request timed out. Please try again.',
        recoverable: true,
        originalError: error,
      }
    }

    if (
      lowerError.includes('server') ||
      lowerError.includes('500') ||
      lowerError.includes('internal')
    ) {
      return {
        category: 'server',
        message: 'Server error. Please try again later.',
        recoverable: true,
        originalError: error,
      }
    }

    // Default: use the error message directly if it's readable
    return {
      category: 'unknown',
      message: isReadableError(error) ? error : 'An unexpected error occurred',
      recoverable: true,
      originalError: error,
    }
  }

  // Handle Error objects
  if (error instanceof Error) {
    return categorizeError(error.message)
  }

  // Handle objects with message property
  if (error && typeof error === 'object' && 'message' in error) {
    return categorizeError((error as { message: string }).message)
  }

  // Unknown error type
  return {
    category: 'unknown',
    message: 'An unexpected error occurred',
    recoverable: false,
    originalError: String(error),
  }
}

/**
 * Check if an error message is readable enough to show to users
 */
function isReadableError(error: string): boolean {
  // Reject technical errors
  if (error.includes('Error:') || error.includes('Exception')) return false
  if (error.includes('undefined') || error.includes('null')) return false
  if (error.match(/^[A-Z_]+$/)) return false // All caps constants
  if (error.length > 100) return false // Too long
  if (error.length < 3) return false // Too short

  return true
}

/**
 * Log error with context for debugging
 */
export function logError(error: GameError, context?: Record<string, unknown>): void {
  console.error('[Game Error]', {
    category: error.category,
    message: error.message,
    originalError: error.originalError,
    recoverable: error.recoverable,
    ...context,
  })
}
