/**
 * The transcript and benchmark API client: what it asks for, and what each kind of failure
 * becomes (the pages show a different message for "not there", "can't reach" and "broken").
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  TranscriptApiError,
  fetchGames,
  fetchLeaderboard,
  fetchSeries,
  fetchTranscript,
  transcriptDownloadUrl,
} from './transcripts'
import games from '../../tests/unit/fixtures/games-list.json'
import board from '../../tests/unit/fixtures/leaderboard.json'

afterEach(() => vi.unstubAllGlobals())

function answer(body: unknown, init: ResponseInit = {}) {
  const fn = vi.fn(
    async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        ...init,
      })
  )
  vi.stubGlobal('fetch', fn)
  return fn
}
const called = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls[0] as unknown as [string, RequestInit]

describe('what is asked for', () => {
  it('the games list: 50 by default, with the source filter and the server cursor when given', async () => {
    const fn = answer(games)
    expect(await fetchGames()).toEqual(games)
    expect(called(fn)[0]).toBe('/api/games?limit=50')
    expect(called(fn)[1].headers).toEqual({ Accept: 'application/json' })
    await fetchGames({ source: 'bench', limit: 3, before: 'abc 1' })
    expect(fn.mock.calls[1][0]).toBe('/api/games?source=bench&limit=3&before=abc+1')
    await fetchGames({ limit: 0 })
    expect(fn.mock.calls[2][0]).toBe('/api/games?limit=0')
  })

  it('a transcript is fetched by its id (escaped), and the download link is the same address', async () => {
    const fn = answer({ header: {}, entries: [] })
    await fetchTranscript('2026/11 x')
    expect(called(fn)[0]).toBe('/api/games/2026%2F11%20x/transcript')
    expect(transcriptDownloadUrl('2026/11 x')).toBe('/api/games/2026%2F11%20x/transcript')
  })

  it('the leaderboard: no filters means a bare path; "all" tracks mean no track filter', async () => {
    const fn = answer(board)
    expect(await fetchLeaderboard()).toEqual(board)
    expect(called(fn)[0]).toBe('/api/bench/leaderboard')
    await fetchLeaderboard({ track: 'all' })
    expect(fn.mock.calls[1][0]).toBe('/api/bench/leaderboard')
    await fetchLeaderboard({ protocol: 'p1', promptVersion: 'v2', track: 'vs-baseline' })
    expect(fn.mock.calls[2][0]).toBe(
      '/api/bench/leaderboard?protocol=p1&prompt_version=v2&track=vs-baseline'
    )
  })

  it('a series is fetched by its id (escaped)', async () => {
    const fn = answer({})
    await fetchSeries('a b')
    expect(called(fn)[0]).toBe('/api/bench/series/a%20b')
  })
})

describe('what a failure becomes', () => {
  const failure = async (p: Promise<unknown>) => {
    try {
      await p
    } catch (e) {
      return e as TranscriptApiError
    }
    throw new Error('expected a failure')
  }

  it('404 is "not found" (an unknown id, or an older server with no such route)', async () => {
    answer({}, { status: 404 })
    const e = await failure(fetchTranscript('x'))
    expect(e).toBeInstanceOf(TranscriptApiError)
    expect(e).toMatchObject({ kind: 'not_found', status: 404, name: 'TranscriptApiError' })
  })

  it('other error statuses are server errors with the status; the server is not retried for 500', async () => {
    const fn = answer({}, { status: 500 })
    const e = await failure(fetchGames())
    expect(e).toMatchObject({ kind: 'server', status: 500, message: 'Server error (500)' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('an HTML page instead of JSON (an old server\'s shell) counts as "not available"', async () => {
    answer('<html></html>', { headers: { 'Content-Type': 'text/html' } })
    const e = await failure(fetchGames())
    expect(e).toMatchObject({ kind: 'not_found', message: 'Not available on this server' })
  })

  it('a body that is not JSON is a server error', async () => {
    answer('{oops', { headers: { 'Content-Type': 'application/json' } })
    const e = await failure(fetchGames())
    expect(e).toMatchObject({ kind: 'server', message: 'The server sent an unreadable response' })
  })

  it('an unreachable server is a network error; an abort is passed through untouched', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline')))
    )
    const pending = failure(fetchGames())
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({ kind: 'network', message: 'Could not reach the server' })
    vi.useRealTimers()

    const ctrl = new AbortController()
    ctrl.abort()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('Aborted', 'AbortError')
      })
    )
    const aborted = await failure(fetchGames({}, ctrl.signal))
    expect(aborted).not.toBeInstanceOf(TranscriptApiError)
    expect(aborted.name).toBe('AbortError')
  })
})
