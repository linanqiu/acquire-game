import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useErrorHandler } from './useErrorHandler'
import { ToastProvider } from '../components/ui/ToastProvider'

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>
}

describe('useErrorHandler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  it('categorizes and returns a game error for server rejections', () => {
    const { result } = renderHook(() => useErrorHandler(), { wrapper })

    let gameError
    act(() => {
      gameError = result.current.handleServerError('not_your_turn')
    })

    expect(gameError).toMatchObject({
      category: 'game_rule',
      message: "It's not your turn",
    })
  })

  it('handles arbitrary errors', () => {
    const { result } = renderHook(() => useErrorHandler(), { wrapper })

    let gameError
    act(() => {
      gameError = result.current.handleError(new Error('boom'))
    })

    expect(gameError).toMatchObject({ message: expect.any(String) })
  })

  it('handles connection errors with a default message', () => {
    const { result } = renderHook(() => useErrorHandler(), { wrapper })

    let gameError
    act(() => {
      gameError = result.current.handleConnectionError()
    })

    expect(gameError).toMatchObject({ category: 'connection' })
  })
})
