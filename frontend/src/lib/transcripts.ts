/**
 * HTTP client for game transcripts and Acquire Bench
 * (docs/architecture/seat-contract.md, "Game transcripts and Acquire Bench").
 * Same-origin `/api/...` calls; the Vite proxy strips the `/api` prefix.
 */

import type {
  GameDetail,
  GamesResponse,
  Leaderboard,
  SeriesDetail,
  Transcript,
} from '../types/transcripts'

export type TranscriptErrorKind =
  /** 404 (unknown id, or an older backend that has no such route). */
  | 'not_found'
  /** The server could not be reached. */
  | 'network'
  /** Anything else (5xx, malformed body). */
  | 'server'

export class TranscriptApiError extends Error {
  readonly kind: TranscriptErrorKind
  readonly status?: number

  constructor(kind: TranscriptErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'TranscriptApiError'
    this.kind = kind
    this.status = status
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, { signal, headers: { Accept: 'application/json' } })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new TranscriptApiError('network', 'Could not reach the server')
  }
  if (res.status === 404) {
    throw new TranscriptApiError('not_found', 'Not found', 404)
  }
  if (!res.ok) {
    throw new TranscriptApiError('server', `Server error (${res.status})`, res.status)
  }
  const type = res.headers?.get?.('content-type') ?? 'application/json'
  if (!type.includes('json')) {
    // e.g. an old server answering with its HTML shell for an unknown route
    throw new TranscriptApiError('not_found', 'Not available on this server', res.status)
  }
  try {
    return (await res.json()) as T
  } catch {
    throw new TranscriptApiError('server', 'The server sent an unreadable response', res.status)
  }
}

export interface ListGamesOptions {
  source?: 'live' | 'bench'
  limit?: number
  before?: string
}

export function fetchGames(opts: ListGamesOptions = {}, signal?: AbortSignal) {
  const q = new URLSearchParams()
  if (opts.source) q.set('source', opts.source)
  q.set('limit', String(opts.limit ?? 50))
  if (opts.before) q.set('before', opts.before)
  return getJson<GamesResponse>(`/games?${q.toString()}`, signal)
}

export function fetchGame(gameId: string, signal?: AbortSignal) {
  return getJson<GameDetail>(`/games/${encodeURIComponent(gameId)}`, signal)
}

export function fetchTranscript(gameId: string, signal?: AbortSignal) {
  return getJson<Transcript>(`/games/${encodeURIComponent(gameId)}/transcript`, signal)
}

export function transcriptDownloadUrl(gameId: string) {
  return `/api/games/${encodeURIComponent(gameId)}/transcript`
}

export function fetchLeaderboard(protocol?: string, signal?: AbortSignal) {
  const q = protocol ? `?protocol=${encodeURIComponent(protocol)}` : ''
  return getJson<Leaderboard>(`/bench/leaderboard${q}`, signal)
}

export function fetchSeries(seriesId: string, signal?: AbortSignal) {
  return getJson<SeriesDetail>(`/bench/series/${encodeURIComponent(seriesId)}`, signal)
}
