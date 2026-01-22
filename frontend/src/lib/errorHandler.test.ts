import { describe, it, expect, vi } from 'vitest'
import { categorizeError, getToastType, logError, type GameError } from './errorHandler'

describe('errorHandler', () => {
  describe('categorizeError', () => {
    describe('game rule errors', () => {
      it('categorizes "not_your_turn" as game_rule', () => {
        const result = categorizeError('not_your_turn')
        expect(result.category).toBe('game_rule')
        expect(result.message).toBe("It's not your turn")
        expect(result.recoverable).toBe(true)
      })

      it('categorizes "invalid_tile" as game_rule', () => {
        const result = categorizeError('invalid_tile')
        expect(result.category).toBe('game_rule')
        expect(result.message).toBe('You cannot place a tile there')
      })

      it('categorizes "insufficient_funds" as game_rule', () => {
        const result = categorizeError('insufficient_funds')
        expect(result.category).toBe('game_rule')
        expect(result.message).toBe("You don't have enough cash")
      })

      it('categorizes "stock_unavailable" as game_rule', () => {
        const result = categorizeError('stock_unavailable')
        expect(result.category).toBe('game_rule')
        expect(result.message).toBe('No stock available for that chain')
      })
    })

    describe('connection errors', () => {
      it('categorizes connection errors', () => {
        const result = categorizeError('WebSocket connection failed')
        expect(result.category).toBe('connection')
        expect(result.message).toContain('Connection')
      })

      it('categorizes network errors', () => {
        const result = categorizeError('Network error occurred')
        expect(result.category).toBe('connection')
      })

      it('categorizes "connection_lost"', () => {
        const result = categorizeError('connection_lost')
        expect(result.category).toBe('connection')
        expect(result.message).toBe('Connection lost. Attempting to reconnect...')
      })
    })

    describe('room/lobby errors', () => {
      it('categorizes "room_not_found"', () => {
        const result = categorizeError('room_not_found')
        expect(result.message).toBe('Game room not found')
      })

      it('categorizes "name_taken"', () => {
        const result = categorizeError('name_taken')
        expect(result.message).toBe('That name is already taken in this game')
      })

      it('categorizes "game_full"', () => {
        const result = categorizeError('game_full')
        expect(result.message).toBe('The game is full (max 6 players)')
      })

      it('categorizes "game_started"', () => {
        const result = categorizeError('game_started')
        expect(result.message).toBe('The game has already started')
      })
    })

    describe('auth errors', () => {
      it('categorizes "invalid_token"', () => {
        const result = categorizeError('invalid_token')
        expect(result.message).toContain('session has expired')
      })

      it('categorizes "unauthorized"', () => {
        const result = categorizeError('unauthorized')
        expect(result.message).toBe('You are not authorized to do that')
      })
    })

    describe('timeout errors', () => {
      it('categorizes timeout errors', () => {
        const result = categorizeError('Request timed out')
        expect(result.category).toBe('timeout')
        expect(result.message).toContain('timed out')
      })
    })

    describe('server errors', () => {
      it('categorizes server errors', () => {
        const result = categorizeError('Internal server error')
        expect(result.category).toBe('server')
        expect(result.message).toContain('Server error')
      })
    })

    describe('unknown errors', () => {
      it('handles unknown string errors', () => {
        const result = categorizeError('some_unknown_error_code')
        expect(result.category).toBe('unknown')
        expect(result.recoverable).toBe(true)
      })

      it('handles Error objects', () => {
        const result = categorizeError(new Error('not_your_turn'))
        expect(result.category).toBe('game_rule')
        expect(result.message).toBe("It's not your turn")
      })

      it('handles objects with message property', () => {
        const result = categorizeError({ message: 'insufficient_funds' })
        expect(result.message).toBe("You don't have enough cash")
      })

      it('handles null/undefined', () => {
        const result = categorizeError(null)
        expect(result.category).toBe('unknown')
        expect(result.message).toBe('An unexpected error occurred')
        expect(result.recoverable).toBe(false)
      })
    })

    describe('preserves original error', () => {
      it('stores original error string', () => {
        const result = categorizeError('not_your_turn')
        expect(result.originalError).toBe('not_your_turn')
      })
    })
  })

  describe('getToastType', () => {
    it('returns warning for game_rule errors', () => {
      expect(getToastType('game_rule')).toBe('warning')
    })

    it('returns warning for validation errors', () => {
      expect(getToastType('validation')).toBe('warning')
    })

    it('returns error for connection errors', () => {
      expect(getToastType('connection')).toBe('error')
    })

    it('returns error for server errors', () => {
      expect(getToastType('server')).toBe('error')
    })

    it('returns error for timeout errors', () => {
      expect(getToastType('timeout')).toBe('error')
    })

    it('returns error for unknown errors', () => {
      expect(getToastType('unknown')).toBe('error')
    })
  })

  describe('logError', () => {
    it('logs error to console', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const error: GameError = {
        category: 'game_rule',
        message: "It's not your turn",
        recoverable: true,
        originalError: 'not_your_turn',
      }

      logError(error)

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Game Error]',
        expect.objectContaining({
          category: 'game_rule',
          message: "It's not your turn",
          originalError: 'not_your_turn',
          recoverable: true,
        })
      )

      consoleSpy.mockRestore()
    })

    it('includes context in log', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const error: GameError = {
        category: 'connection',
        message: 'Connection lost',
        recoverable: true,
      }

      logError(error, { playerId: 'test-player', room: 'ABCD' })

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Game Error]',
        expect.objectContaining({
          playerId: 'test-player',
          room: 'ABCD',
        })
      )

      consoleSpy.mockRestore()
    })
  })
})
