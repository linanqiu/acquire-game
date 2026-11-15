import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useFetch } from './useFetch'
import { useDocumentTitle } from './useDocumentTitle'
import { TranscriptApiError } from '../lib/transcripts'
import { serverRuleset } from '../../tests/unit/fixtures/wire'

describe('useFetch', () => {
  it('is loading, then has the data', async () => {
    const { result } = renderHook(() => useFetch(async () => ({ games: 3 }), 'k'))
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ games: 3 })
    expect(result.current.error).toBeNull()
  })

  it('a failure keeps the error kind the API reported (for "not found" pages)', async () => {
    const { result } = renderHook(() =>
      useFetch(async () => {
        throw new TranscriptApiError('not_found', 'No such game', 404)
      }, 'k')
    )
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toMatchObject({ kind: 'not_found', status: 404 })
    expect(result.current.loading).toBe(false)
  })

  it('any other failure becomes a server error with its message', async () => {
    const { result } = renderHook(() =>
      useFetch(async () => {
        throw new Error('socket hang up')
      }, 'k')
    )
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toMatchObject({ kind: 'server', message: 'socket hang up' })
  })

  it('a new key loads again; reload() loads again while keeping the old data on screen', async () => {
    let n = 0
    const fetcher = vi.fn(async () => ++n)
    const { result, rerender } = renderHook(({ key }) => useFetch(fetcher, key), {
      initialProps: { key: 'a' },
    })
    await waitFor(() => expect(result.current.data).toBe(1))
    act(() => result.current.reload())
    expect(result.current.data).toBe(1)
    await waitFor(() => expect(result.current.data).toBe(2))
    rerender({ key: 'b' })
    await waitFor(() => expect(result.current.data).toBe(3))
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('an answer that arrives after the page moved on is ignored, and the request is aborted', async () => {
    let resolveFirst: (v: string) => void = () => {}
    const signals: AbortSignal[] = []
    const fetcher = vi.fn((signal: AbortSignal) => {
      signals.push(signal)
      return signals.length === 1
        ? new Promise<string>((r) => (resolveFirst = r))
        : Promise.resolve('second')
    })
    const { result, rerender } = renderHook(({ key }) => useFetch(fetcher, key), {
      initialProps: { key: 'a' },
    })
    rerender({ key: 'b' })
    await waitFor(() => expect(result.current.data).toBe('second'))
    expect(signals[0].aborted).toBe(true)
    await act(async () => resolveFirst('late'))
    expect(result.current.data).toBe('second')
  })
})

describe('useDocumentTitle', () => {
  it('sets the page title while mounted and puts the brand back after', () => {
    serverRuleset('valley')
    const { unmount } = renderHook(() => useDocumentTitle('Buyout Bench'))
    expect(document.title).toBe('Buyout Bench')
    unmount()
    expect(document.title).toBe('Buyout')
  })
})
