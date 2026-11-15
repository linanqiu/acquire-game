/**
 * What the player is told when something goes wrong. The refusals are real: each sentence was
 * recorded from the server when a player tried something it does not allow
 * (tests/unit/fixtures/generate_wire_messages.py).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { categorizeError, logError } from './errorHandler'
import { useErrorHandler } from '../hooks/useErrorHandler'
import { ToastProvider } from '../components/ui/ToastProvider'
import { wireRefusals } from '../../tests/unit/fixtures/wire'

afterEach(() => vi.restoreAllMocks())

describe('categorizeError', () => {
  it('shows the sentences the server really sends exactly as the server wrote them', () => {
    const refusals = wireRefusals()
    expect(refusals).toEqual(
      expect.arrayContaining([
        'Tile not in hand',
        'Action not allowed now (waiting for place_tile)',
        'Trade not found',
      ])
    )
    for (const sentence of refusals.filter((s) => !s.startsWith('Invalid JSON'))) {
      expect(categorizeError(sentence), sentence).toMatchObject({
        message: sentence,
        category: 'unknown',
        recoverable: true,
        originalError: sentence,
      })
    }
  })

  it('shows a short technical refusal (invalid JSON) rather than hiding it', () => {
    const json = wireRefusals().find((s) => s.startsWith('Invalid JSON'))!
    expect(json.length).toBeLessThan(100)
    expect(categorizeError(json).message).toBe(json)
  })

  it('replaces unreadable text (stack-trace words, constants, very long or empty text)', () => {
    for (const bad of [
      'TypeError: x is not a function',
      'java.lang.NullPointerException Exception',
      "Cannot read properties of undefined (reading 'id')",
      'result was null',
      'ILLEGAL_MOVE',
      'x'.repeat(101),
      'ab',
    ]) {
      expect(categorizeError(bad).message, bad).toBe('An unexpected error occurred')
    }
    expect(categorizeError('x'.repeat(100)).message).toBe('x'.repeat(100))
  })

  it.each([
    [
      'Connection failed after multiple attempts',
      'connection',
      'Connection issue. Please check your network.',
    ],
    ['WebSocket closed', 'connection', 'Connection issue. Please check your network.'],
    ['Network is down', 'connection', 'Connection issue. Please check your network.'],
    ['The request timed out', 'timeout', 'Request timed out. Please try again.'],
    ['Timeout waiting for the bot', 'timeout', 'Request timed out. Please try again.'],
    ['Internal failure', 'server', 'Server error. Please try again later.'],
    ['HTTP 500', 'server', 'Server error. Please try again later.'],
  ])('%s is a %s problem and is worded for the player', (text, category, message) => {
    expect(categorizeError(text)).toMatchObject({ category, message, recoverable: true })
  })

  it('reads the text of Error objects and of objects with a message', () => {
    expect(categorizeError(new Error('Tile not in hand')).message).toBe('Tile not in hand')
    expect(categorizeError({ message: 'Trade not found' }).message).toBe('Trade not found')
    expect(categorizeError(new Error('socket timeout')).category).toBe('timeout')
  })

  it('anything else is an unexpected, unrecoverable error', () => {
    for (const odd of [null, undefined, 42, {}]) {
      expect(categorizeError(odd)).toMatchObject({
        category: 'unknown',
        message: 'An unexpected error occurred',
        recoverable: false,
      })
    }
    expect(categorizeError(undefined).originalError).toBe('undefined')
  })
})

describe('logError', () => {
  it('logs the error with the context the caller adds', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError(categorizeError('Tile not in hand'), { room: 'ABCD' })
    expect(spy).toHaveBeenCalledWith(
      '[Game Error]',
      expect.objectContaining({
        category: 'unknown',
        message: 'Tile not in hand',
        originalError: 'Tile not in hand',
        recoverable: true,
        room: 'ABCD',
      })
    )
  })
})

describe('useErrorHandler', () => {
  function Probe({ message }: { message: string }) {
    const { handleServerError } = useErrorHandler()
    return <button onClick={() => handleServerError(message)}>go</button>
  }

  it("a refusal from the server appears to the player as a toast with the server's words", () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ToastProvider>
        <Probe message="Action not allowed now (waiting for place_tile)" />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('go'))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Action not allowed now (waiting for place_tile)'
    )
  })

  it('a technical failure is toasted in plain words', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ToastProvider>
        <Probe message="Connection failed after multiple attempts" />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('go'))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Connection issue. Please check your network.'
    )
  })
})
