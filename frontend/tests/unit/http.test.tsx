import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { fetchWithRetry, isWaking, warmUpServer } from '../../src/lib/http'
import { fetchAgentCatalog } from '../../src/lib/agents'
import { LobbyPage } from '../../src/pages/LobbyPage'
import { ToastProvider } from '../../src/components/ui/ToastProvider'

function res(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
  } as unknown as Response
}

function script(...steps: (Response | Error)[]) {
  const fn = vi.fn(async () => {
    const step = steps.length > 1 ? steps.shift()! : steps[0]
    if (step instanceof Error) throw step
    return step
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('fetchWithRetry', () => {
  it('returns the first good response without waiting', async () => {
    const fn = script(res(200, { ok: 1 }))
    const r = await fetchWithRetry('/api/x')
    expect(r.status).toBe(200)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(isWaking()).toBe(false)
  })

  it('retries 502 and network errors with a growing backoff, then succeeds', async () => {
    const fn = script(res(502), new TypeError('Failed to fetch'), res(503), res(200))
    const p = fetchWithRetry('/api/x', {}, { baseDelayMs: 100 })
    await vi.advanceTimersByTimeAsync(0)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(isWaking()).toBe(true)
    await vi.advanceTimersByTimeAsync(100) // 1st backoff
    expect(fn).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(150) // 2nd backoff is 200 ms: not yet
    expect(fn).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(50)
    expect(fn).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(400)
    expect((await p).status).toBe(200)
    expect(fn).toHaveBeenCalledTimes(4)
    expect(isWaking()).toBe(false)
  })

  it('does not retry real answers such as 404 or 500', async () => {
    for (const status of [404, 500]) {
      const fn = script(res(status))
      expect((await fetchWithRetry('/api/x')).status).toBe(status)
      expect(fn).toHaveBeenCalledTimes(1)
    }
  })

  it('gives up after the retries: the last 502 is returned, a network error is thrown', async () => {
    const fn = script(res(502))
    const p = fetchWithRetry('/api/x', {}, { retries: 2, baseDelayMs: 10 })
    await vi.advanceTimersByTimeAsync(1000)
    expect((await p).status).toBe(502)
    expect(fn).toHaveBeenCalledTimes(3)
    expect(isWaking()).toBe(false)

    script(new TypeError('offline'))
    const q = fetchWithRetry('/api/x', {}, { retries: 1, baseDelayMs: 10 })
    const assertion = expect(q).rejects.toThrow('offline')
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(isWaking()).toBe(false)
  })

  it('stops when aborted', async () => {
    const fn = script(res(502))
    const ctrl = new AbortController()
    const p = fetchWithRetry('/api/x', {}, { signal: ctrl.signal, baseDelayMs: 1000 })
    const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(10)
    ctrl.abort()
    await assertion
    expect(fn).toHaveBeenCalledTimes(1)
    expect(isWaking()).toBe(false)
  })
})

describe('idempotent GETs use it', () => {
  it('the agent catalog survives a cold start but a 404 is final (older backend)', async () => {
    script(res(502), res(200, [{ id: 'bot', kind: 'bot', label: 'Bot' }]))
    const p = fetchAgentCatalog()
    await vi.advanceTimersByTimeAsync(600)
    expect(await p).toHaveLength(1)

    const fn = script(res(404))
    await expect(fetchAgentCatalog()).rejects.toThrow('404')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('warmUpServer reports whether the server ever answered', async () => {
    script(new TypeError('offline'), res(200))
    const p = warmUpServer(undefined, { baseDelayMs: 10 })
    await vi.advanceTimersByTimeAsync(100)
    expect(await p).toBe(true)

    script(res(502))
    const q = warmUpServer(undefined, { retries: 1, baseDelayMs: 10 })
    await vi.advanceTimersByTimeAsync(100)
    expect(await q).toBe(false)
  })
})

describe('home page', () => {
  function renderHome() {
    return render(
      <MemoryRouter>
        <ToastProvider>
          <LobbyPage />
        </ToastProvider>
      </MemoryRouter>
    )
  }

  it('says "waking the server" (not an error) while the first request is failing', async () => {
    script(res(502), res(502), res(200))
    renderHome()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(screen.getByTestId('waking-server')).toHaveTextContent('Waking the server')
    expect(screen.queryByTestId('server-down')).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(screen.queryByTestId('waking-server')).toBeNull()
    expect(screen.queryByTestId('server-down')).toBeNull()
    expect(screen.getByTestId('create-button')).toBeInTheDocument()
  })

  it('offers to try again when the server never comes up', async () => {
    script(new TypeError('offline'))
    renderHome()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(screen.getByTestId('server-down')).toHaveTextContent('not answering')
    expect(screen.queryByTestId('waking-server')).toBeNull()
    expect(screen.getByTestId('server-retry')).toBeInTheDocument()
  })
})
