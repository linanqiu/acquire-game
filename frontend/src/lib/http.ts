/**
 * Resilient GETs for a host that sleeps when idle: the first request after a quiet period
 * may fail with a 502/503/504 or a network error while the server starts. Idempotent
 * GETs are retried a few times with a short backoff, and while that happens a shared
 * "waking the server" flag is raised so the UI can say so instead of showing an error.
 *
 * Only use this for idempotent reads (catalog, games list, transcripts, leaderboard).
 * Never for POSTs: a retried "create game" could create two.
 */

import { useSyncExternalStore } from 'react'

export interface RetryOptions {
  /** Extra attempts after the first (default 5). */
  retries?: number
  /** First backoff in ms; doubles each retry (default 500). */
  baseDelayMs?: number
  /** Longest single wait in ms (default 4000). */
  maxDelayMs?: number
  signal?: AbortSignal
}

const TRANSIENT_STATUS = new Set([502, 503, 504])

export function isTransientStatus(status: number): boolean {
  return TRANSIENT_STATUS.has(status)
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

// -- "waking the server" flag -------------------------------------------------------

let wakingCount = 0
const listeners = new Set<() => void>()

function setWaking(delta: 1 | -1) {
  wakingCount += delta
  listeners.forEach((l) => l())
}

/** True while at least one GET is being retried after a transient failure. */
export function isWaking(): boolean {
  return wakingCount > 0
}

export function subscribeWaking(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useServerWaking(): boolean {
  return useSyncExternalStore(subscribeWaking, isWaking, () => false)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const onAbort = () => {
      clearTimeout(id)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * `fetch` that retries network errors and 502/503/504 responses. Any other response
 * (including 404 and 500) is returned as is. After the last attempt the final response
 * is returned, or the network error is thrown.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  opts: RetryOptions = {}
): Promise<Response> {
  const { retries = 5, baseDelayMs = 500, maxDelayMs = 4000, signal } = opts
  let waking = false
  try {
    for (let attempt = 0; ; attempt++) {
      let res: Response | undefined
      let failure: unknown
      try {
        res = await fetch(input, { ...init, signal: signal ?? init.signal })
      } catch (err) {
        if (isAbort(err)) throw err
        failure = err
      }
      if (res && !isTransientStatus(res.status)) return res
      if (attempt >= retries) {
        if (res) return res
        throw failure
      }
      if (!waking) {
        waking = true
        setWaking(1)
      }
      await sleep(Math.min(maxDelayMs, baseDelayMs * 2 ** attempt), signal)
    }
  } finally {
    if (waking) setWaking(-1)
  }
}

/** Wake-up call for the home page: resolves true once the server answers, false if it never does. */
export async function warmUpServer(
  signal?: AbortSignal,
  opts: RetryOptions = {}
): Promise<boolean> {
  try {
    const res = await fetchWithRetry(
      '/api/health',
      { headers: { Accept: 'application/json' } },
      { ...opts, signal }
    )
    return res.ok
  } catch (err) {
    if (isAbort(err)) return true
    return false
  }
}
