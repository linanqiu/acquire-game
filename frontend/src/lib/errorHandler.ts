/**
 * Error Handler
 * Categorizes and formats errors for user display and logging.
 */

import type { Ruleset } from '../types/ruleset'
import { CLASSIC_RULESET } from '../ruleset/classic'

export type ErrorCategory =
  | 'connection'
  | 'validation'
  | 'game_rule'
  | 'server'
  | 'timeout'
  | 'unknown'

export interface GameError {
  category: ErrorCategory
  message: string
  recoverable: boolean
  originalError?: string
}

// Map backend error codes to user-friendly messages, worded and numbered from the ruleset
function errorMessages(rs: Ruleset): Record<string, string> {
  const t = rs.theme
  return {
    // Tile placement errors
    invalid_tile: 'You cannot place a tile there',
    not_your_tile: 'That tile is not in your hand',
    tile_creates_illegal_merger: `This tile would create an illegal ${t.merger_noun}`,
    tile_permanently_unplayable: 'This tile can never be played',

    // Turn errors
    not_your_turn: "It's not your turn",
    invalid_phase: 'You cannot do that right now',
    action_not_allowed: 'That action is not allowed in this phase',

    // Stock errors
    insufficient_funds: "You don't have enough cash",
    stock_unavailable: `No ${t.share_noun_plural} left for that ${t.chain_noun}`,
    max_stocks_exceeded: `You can only buy up to ${rs.max_stock_purchases_per_turn} ${t.share_noun_plural} per turn`,
    invalid_stock_quantity: `Invalid number of ${t.share_noun_plural}`,

    // Chain errors
    chain_not_available: `That ${t.chain_noun} is not available to found`,
    chain_already_active: `That ${t.chain_noun} is already on the board`,
    invalid_chain: `Invalid ${t.chain_noun}`,

    // Merger errors
    invalid_disposition: `Invalid ${t.share_noun} disposition`,
    trade_not_even: `Trades must be ${rs.merger_trade_ratio}-for-1`,
    insufficient_stock_to_trade: `You don't have enough ${t.share_noun_plural} to trade`,

    // Room/lobby errors
    room_not_found: 'Game room not found',
    name_taken: 'That name is already taken in this game',
    game_full: `The game is full (max ${rs.max_players} players)`,
    game_started: 'The game has already started',
    game_not_started: 'The game has not started yet',
    not_host: 'Only the host can do that',
    min_players: `Need at least ${rs.min_players} players to start`,

    // Auth errors
    invalid_token: 'Your session has expired. Please rejoin the game.',
    unauthorized: 'You are not authorized to do that',

    // Trade errors
    trade_not_found: 'Trade offer not found',
    cannot_trade_with_self: 'You cannot trade with yourself',
    trade_expired: 'This trade offer has expired',

    // Connection errors
    connection_failed: 'Failed to connect to the game server',
    connection_lost: 'Connection lost. Attempting to reconnect...',
    reconnection_failed: 'Could not reconnect after multiple attempts',
  }
}

/**
 * Categorize an error based on its content
 */
export function categorizeError(error: unknown, rs: Ruleset = CLASSIC_RULESET): GameError {
  const ERROR_MESSAGE_MAP = errorMessages(rs)
  // Handle string errors (most common from backend)
  if (typeof error === 'string') {
    const lowerError = error.toLowerCase()

    // Check for known error patterns
    const userMessage = ERROR_MESSAGE_MAP[error] || ERROR_MESSAGE_MAP[lowerError]
    if (userMessage) {
      return {
        category: getErrorCategoryFromKey(error),
        message: userMessage,
        recoverable: true,
        originalError: error,
      }
    }

    // Connection-related
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

    // Timeout
    if (lowerError.includes('timeout') || lowerError.includes('timed out')) {
      return {
        category: 'timeout',
        message: 'Request timed out. Please try again.',
        recoverable: true,
        originalError: error,
      }
    }

    // Server error
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

// Map known error keys to their categories
const ERROR_CATEGORY_MAP: Record<string, ErrorCategory> = {
  // Game rule errors
  invalid_tile: 'game_rule',
  not_your_tile: 'game_rule',
  tile_creates_illegal_merger: 'game_rule',
  tile_permanently_unplayable: 'game_rule',
  not_your_turn: 'game_rule',
  invalid_phase: 'game_rule',
  action_not_allowed: 'game_rule',
  insufficient_funds: 'game_rule',
  stock_unavailable: 'game_rule',
  max_stocks_exceeded: 'game_rule',
  invalid_stock_quantity: 'game_rule',
  chain_not_available: 'game_rule',
  chain_already_active: 'game_rule',
  invalid_chain: 'game_rule',
  invalid_disposition: 'game_rule',
  trade_not_even: 'game_rule',
  insufficient_stock_to_trade: 'game_rule',
  trade_not_found: 'game_rule',
  cannot_trade_with_self: 'game_rule',
  trade_expired: 'game_rule',

  // Validation errors
  room_not_found: 'validation',
  name_taken: 'validation',
  game_full: 'validation',
  game_started: 'validation',
  game_not_started: 'validation',
  not_host: 'validation',
  min_players: 'validation',

  // Auth errors
  invalid_token: 'validation',
  unauthorized: 'validation',

  // Connection errors
  connection_failed: 'connection',
  connection_lost: 'connection',
  reconnection_failed: 'connection',
}

/**
 * Get error category for a known error key
 */
function getErrorCategoryFromKey(error: string): ErrorCategory {
  const lowerError = error.toLowerCase()
  return (
    ERROR_CATEGORY_MAP[error] ||
    ERROR_CATEGORY_MAP[lowerError] ||
    getErrorCategoryFromContent(error)
  )
}

/**
 * Determine error category from error string content (fallback)
 */
function getErrorCategoryFromContent(error: string): ErrorCategory {
  const lowerError = error.toLowerCase()

  // Game rule violations
  if (
    lowerError.includes('turn') ||
    lowerError.includes('tile') ||
    lowerError.includes('stock') ||
    lowerError.includes('chain') ||
    lowerError.includes('merger') ||
    lowerError.includes('disposition') ||
    lowerError.includes('trade')
  ) {
    return 'game_rule'
  }

  // Validation errors
  if (
    lowerError.includes('invalid') ||
    lowerError.includes('required') ||
    lowerError.includes('must be')
  ) {
    return 'validation'
  }

  // Connection errors
  if (
    lowerError.includes('connection') ||
    lowerError.includes('websocket') ||
    lowerError.includes('network')
  ) {
    return 'connection'
  }

  // Server errors
  if (lowerError.includes('server') || lowerError.includes('internal')) {
    return 'server'
  }

  return 'unknown'
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
 * Get toast type based on error category
 */
export function getToastType(category: ErrorCategory): 'error' | 'warning' {
  switch (category) {
    case 'game_rule':
    case 'validation':
      return 'warning'
    case 'connection':
    case 'server':
    case 'timeout':
    case 'unknown':
    default:
      return 'error'
  }
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
