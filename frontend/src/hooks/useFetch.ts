import { useCallback, useEffect, useRef, useState } from 'react'
import { TranscriptApiError } from '../lib/transcripts'

export interface FetchState<T> {
  data: T | null
  error: TranscriptApiError | null
  loading: boolean
  reload: () => void
}

interface Inner<T> {
  data: T | null
  error: TranscriptApiError | null
  loading: boolean
}

/**
 * Load JSON with an AbortSignal. Re-runs when `key` changes or `reload()` is called;
 * a reload keeps the previous data on screen while it loads.
 */
export function useFetch<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  key: string
): FetchState<T> {
  const [state, setState] = useState<Inner<T>>({ data: null, error: null, loading: true })
  const [nonce, setNonce] = useState(0)
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    const ctrl = new AbortController()
    fetcherRef
      .current(ctrl.signal)
      .then((data) => {
        if (!ctrl.signal.aborted) setState({ data, error: null, loading: false })
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return
        const error =
          err instanceof TranscriptApiError
            ? err
            : new TranscriptApiError('server', err instanceof Error ? err.message : 'Unknown error')
        setState((s) => ({ data: s.data, error, loading: false }))
      })
    return () => ctrl.abort()
  }, [key, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { ...state, reload }
}
