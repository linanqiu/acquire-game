import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GamesPage } from '../../src/pages/GamesPage'
import { TranscriptPage } from '../../src/pages/TranscriptPage'
import { BenchPage } from '../../src/pages/BenchPage'
import { BenchSeriesPage } from '../../src/pages/BenchSeriesPage'
import { LobbyPage } from '../../src/pages/LobbyPage'
import { GameOver } from '../../src/components/game/GameOver'
import { ToastProvider } from '../../src/components/ui/ToastProvider'
import { buildReplay, normalizeEntries, parseStep } from '../../src/lib/replay'
import { describeEvents } from '../../src/lib/eventText'
import type { Transcript, DecisionEntry } from '../../src/types/transcripts'

const FX = join(__dirname, 'fixtures')
const load = <T,>(f: string): T => JSON.parse(readFileSync(join(FX, f), 'utf8')) as T
const full = load<Transcript>('transcript-full.json')
const redacted = load<Transcript>('transcript-redacted.json')
const gamesList = load<{ games: { game_id: string }[] }>('games-list.json')
const board = load<Record<string, unknown>>('leaderboard.json')
const boardEmpty = load<Record<string, unknown>>('leaderboard-empty.json')
const series = load<Record<string, unknown>>('series.json')

type Handler = (url: URL) => { status?: number; body?: unknown; contentType?: string } | Error

function mockApi(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    const r = handler(url)
    if (r instanceof Error) throw r
    const status = r.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => r.contentType ?? 'application/json' },
      json: async () => r.body,
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{loc.pathname + loc.search}</div>
}

function renderAt(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<LobbyPage />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/games/:gameId" element={<TranscriptPage />} />
          <Route path="/bench" element={<BenchPage />} />
          <Route path="/bench/series/:seriesId" element={<BenchSeriesPage />} />
        </Routes>
        <LocationProbe />
      </ToastProvider>
    </MemoryRouter>
  )
}

const decisions = full.entries.filter((e) => e.type === 'decision') as DecisionEntry[]
const stepWhere = (pred: (d: DecisionEntry) => boolean) => decisions.findIndex(pred) + 1

const transcriptApi =
  (t: Transcript = full): Handler =>
  (url) =>
    url.pathname.endsWith('/transcript') ? { body: t } : { status: 404, body: {} }

beforeEach(() => {
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn() } })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('replay building', () => {
  it('turns decisions into steps with events and states', () => {
    const replay = buildReplay(full)
    expect(replay.steps.length).toBe(decisions.length + 1)
    expect(replay.steps[0].decision).toBeNull()
    expect(replay.steps[1].decision?.index).toBe(decisions[0].index)
    expect(replay.steps.every((s) => s.state)).toBe(true)
    const last = replay.steps[replay.steps.length - 1]
    expect(last.events.some((e) => e.type === 'game_ended')).toBe(true)
  })

  it('accepts wrapped events and ignores junk entries', () => {
    const wrapped = normalizeEntries([
      { type: 'event', event: { seq: 0, type: 'game_started', player_id: null, private_to: null } },
      { type: 'weird' },
      null,
    ] as never)
    expect(wrapped).toHaveLength(1)
    expect(wrapped[0].kind).toBe('event')
  })

  it('clamps ?step values', () => {
    expect(parseStep(null, 10)).toBe(0)
    expect(parseStep('abc', 10)).toBe(0)
    expect(parseStep('99', 10)).toBe(10)
    expect(parseStep('-4', 10)).toBe(0)
    expect(parseStep('7', 10)).toBe(7)
  })

  it('describes known events as sentences and unknown ones generically', () => {
    const names = { p1: 'Dan' }
    const lines = describeEvents(
      [
        {
          seq: 1,
          type: 'tile_placed',
          player_id: 'p1',
          private_to: null,
          tile: '9D',
          outcome: 'expand',
          chains: ['Luxor'],
        },
        {
          seq: 2,
          type: 'chain_expanded',
          player_id: 'p1',
          private_to: null,
          tile: '9D',
          chain: 'Luxor',
          size: 4,
        },
        { seq: 3, type: 'martian_landing', player_id: 'p1', private_to: null, where: 'F5' },
      ],
      names
    )
    expect(lines[0].text).toBe('Dan placed 9D — Luxor grows to 4.')
    expect(lines).toHaveLength(2)
    expect(lines[1].text).toContain('martian landing')
    expect(lines[1].text).toContain('where=F5')
  })
})

describe('GamesPage', () => {
  it('lists games with seats, winner, turns and links', async () => {
    mockApi(() => ({ body: gamesList }))
    renderAt('/games')
    const list = await screen.findByTestId('games-list')
    expect(within(list).getAllByRole('listitem').length).toBe(gamesList.games.length)
    const row = screen.getByTestId('game-row-g_20261114_k3f9xq')
    expect(within(row).getByText('claude-sonnet-4-5')).toBeInTheDocument()
    expect(within(row).getByTestId('game-winner')).toHaveTextContent('Winner: Dan')
    expect(within(row).getByText('52 turns')).toBeInTheDocument()
    expect(within(row).getByRole('link')).toHaveAttribute('href', '/games/g_20261114_k3f9xq')
  })

  it('filters live / finished client-side and benchmark via the server', async () => {
    const fetchMock = mockApi((url) => ({
      body: {
        games: gamesList.games.filter(
          (g) => url.searchParams.get('source') !== 'bench' || g.game_id.startsWith('b_')
        ),
      },
    }))
    renderAt('/games')
    await screen.findByTestId('games-list')
    fireEvent.click(screen.getByTestId('filter-live'))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByTestId('game-row-g_20261114_n7a2lp')).toHaveTextContent('In progress')
    fireEvent.click(screen.getByTestId('filter-finished'))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    fireEvent.click(screen.getByTestId('filter-benchmark'))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('source=bench'))).toBe(true)
    )
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
  })

  it('shows an empty state', async () => {
    mockApi(() => ({ body: { games: [] } }))
    renderAt('/games')
    expect(await screen.findByTestId('games-empty')).toBeInTheDocument()
  })

  it('says "not available" for a 404 from an older backend', async () => {
    mockApi(() => ({ status: 404, body: { detail: 'Not Found' } }))
    renderAt('/games')
    expect(await screen.findByTestId('error-not-found')).toHaveTextContent(
      'not available on this server'
    )
  })

  it('shows a network error with retry', async () => {
    mockApi(() => new Error('offline'))
    renderAt('/games')
    expect(await screen.findByTestId('error-network')).toBeInTheDocument()
    expect(screen.getByTestId('retry-button')).toBeInTheDocument()
  })

  it('is linked from the home page', async () => {
    mockApi(() => ({ body: gamesList }))
    renderAt('/')
    expect(screen.getByTestId('games-link')).toHaveAttribute('href', '/games')
    expect(screen.getByTestId('bench-link')).toHaveAttribute('href', '/bench')
  })
})

describe('TranscriptPage replay', () => {
  it('steps forward and back, changing the board and the event text', async () => {
    mockApi(transcriptApi())
    renderAt('/games/g1')
    await screen.findByTestId('transcript-viewer')
    expect(screen.getByTestId('step-counter')).toHaveTextContent(`Step 0 / ${decisions.length}`)
    expect(screen.getByTestId('event-log')).toHaveTextContent('Game started')
    const startCash = screen.getByTestId('cash-p1').textContent

    const replay = buildReplay(full)
    // first step on which p1's cash changes
    const names = { p1: 'Dan', p2: 'Sonnet', p3: 'Haiku', p4: 'Robo' }
    const target = replay.steps.findIndex(
      (s, i) => i > 0 && s.state?.players[0].money !== replay.steps[i - 1].state?.players[0].money
    )
    for (let i = 0; i < target; i++) fireEvent.click(screen.getByTestId('step-next'))
    expect(screen.getByTestId('step-counter')).toHaveTextContent(`Step ${target} /`)
    expect(screen.getByTestId('cash-p1').textContent).not.toBe(startCash)
    const sentence = describeEvents(replay.steps[target].events, names)[0].text
    expect(screen.getByTestId('event-log')).toHaveTextContent(sentence)
    expect(screen.getByTestId('decision-panel')).toHaveTextContent(`STEP ${target}`)

    fireEvent.click(screen.getByTestId('step-prev'))
    expect(screen.getByTestId('step-counter')).toHaveTextContent(`Step ${target - 1} /`)
    expect(screen.getByTestId('loc')).toHaveTextContent(`step=${target - 1}`)
  })

  it('supports keyboard arrows, End and Home', async () => {
    mockApi(transcriptApi())
    renderAt('/games/g1')
    await screen.findByTestId('transcript-viewer')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByTestId('step-counter')).toHaveTextContent('Step 2 /')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByTestId('step-counter')).toHaveTextContent('Step 1 /')
    fireEvent.keyDown(window, { key: 'End' })
    expect(screen.getByTestId('step-counter')).toHaveTextContent(
      `Step ${decisions.length} / ${decisions.length}`
    )
    expect(screen.getByTestId('event-log')).toHaveTextContent('Game over')
    fireEvent.keyDown(window, { key: 'Home' })
    expect(screen.getByTestId('step-counter')).toHaveTextContent('Step 0 /')
  })

  it('scrubs with the slider and plays automatically', async () => {
    mockApi(transcriptApi())
    renderAt('/games/g1')
    await screen.findByTestId('transcript-viewer')
    fireEvent.change(screen.getByTestId('scrubber'), { target: { value: '10' } })
    expect(screen.getByTestId('step-counter')).toHaveTextContent('Step 10 /')
    vi.useFakeTimers()
    fireEvent.click(screen.getByTestId('play-pause'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300)
    })
    expect(screen.getByTestId('step-counter')).toHaveTextContent('Step 11 /')
    fireEvent.click(screen.getByTestId('play-pause'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(screen.getByTestId('step-counter')).toHaveTextContent('Step 11 /')
  })

  it('opens at the step given in ?step= (deep link)', async () => {
    mockApi(transcriptApi())
    const n = stepWhere((d) => d.kind === 'stock_disposition')
    renderAt(`/games/g1?step=${n}`)
    await screen.findByTestId('transcript-viewer')
    expect(screen.getByTestId('step-counter')).toHaveTextContent(`Step ${n} /`)
    expect(await screen.findByTestId('timeline-step-' + n)).toHaveAttribute('aria-current', 'step')
    expect(screen.getByTestId('chosen-action')).toHaveTextContent('sell')
  })

  it('shows the seat summary with standings, fallbacks and unknown cost', async () => {
    mockApi(transcriptApi())
    renderAt('/games/g1')
    await screen.findByTestId('seat-summary')
    expect(screen.getByTestId('score-p1')).toHaveTextContent('$34,000')
    expect(screen.getByTestId('fallbacks-p3')).toHaveTextContent('2')
    expect(screen.getByTestId('cost-p3')).toHaveTextContent('unknown')
    expect(screen.getByTestId('cost-p2')).toHaveTextContent('$0.6678')
    expect(screen.getByTestId('download-transcript')).toHaveAttribute(
      'href',
      '/api/games/g_20261114_k3f9xq/transcript'
    )
  })

  it('only keeps a window of the timeline in the DOM', async () => {
    mockApi(transcriptApi())
    renderAt('/games/g1')
    await screen.findByTestId('timeline')
    const rendered = document.querySelectorAll('[data-testid^="timeline-step-"]').length
    expect(rendered).toBeGreaterThan(5)
    expect(rendered).toBeLessThan(decisions.length / 2)
  })
})

describe('LLM panel', () => {
  it('shows attempts, rejection reasons and renders prompts lazily', async () => {
    mockApi(transcriptApi())
    const n = stepWhere((d) => d.llm?.attempts.length === 3)
    const d = decisions[n - 1]
    renderAt(`/games/g1?step=${n}`)
    const panel = await screen.findByTestId('llm-panel')
    expect(within(panel).getByTestId('llm-why')).toHaveTextContent(d.llm!.why!)
    expect(within(panel).getByTestId('llm-note')).toBeInTheDocument()
    expect(within(panel).getByTestId('attempt-0-error')).toHaveTextContent('13Z')
    expect(within(panel).getByTestId('attempt-1-error')).toHaveTextContent('0A')
    expect(within(panel).getByTestId('attempt-2')).toHaveAttribute('data-outcome', 'accepted')
    // nothing heavy in the DOM until opened
    expect(within(panel).queryByTestId(`body-user-prompt-${d.index}`)).toBeNull()
    expect(panel.textContent).not.toContain('# Your seat')
    fireEvent.click(within(panel).getByTestId(`toggle-user-prompt-${d.index}`))
    expect(within(panel).getByTestId(`body-user-prompt-${d.index}`)).toHaveTextContent(
      '# Your seat'
    )
    fireEvent.click(within(panel).getByTestId(`toggle-system-prompt-${d.index}`))
    expect(within(panel).getByTestId(`body-system-prompt-${d.index}`).textContent).toBe(
      full.header.system_prompts[d.llm!.system_prompt_id]
    )
    fireEvent.click(within(panel).getByTestId(`toggle-attempt-${d.index}-0-raw`))
    expect(within(panel).getByTestId(`body-attempt-${d.index}-0-raw`)).toHaveTextContent('13Z')
    fireEvent.click(within(panel).getByTestId(`toggle-attempt-${d.index}-0-retry`))
    expect(within(panel).getByTestId(`body-attempt-${d.index}-0-retry`)).toHaveTextContent(
      'rejected'
    )
    fireEvent.click(within(panel).getByTestId(`copy-user-prompt-${d.index}`))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(d.llm!.user_prompt)
  })

  it('flags a fallback prominently with its reason', async () => {
    mockApi(transcriptApi())
    const n = stepWhere((d) => d.source === 'fallback' && d.fallback?.reason === 'illegal')
    renderAt(`/games/g1?step=${n}`)
    const banner = await screen.findByTestId('fallback-banner')
    expect(banner).toHaveTextContent('rules-based player stepped in')
    expect(banner).toHaveTextContent('illegal')
    expect(screen.getByTestId('decision-panel')).toContainElement(
      screen.getByTestId('source-fallback')
    )
    expect(await screen.findByTestId('timeline-step-' + n)).toHaveAttribute(
      'data-source',
      'fallback'
    )
  })

  it('handles a fallback with no model answer at all (timeout)', async () => {
    mockApi(transcriptApi())
    const n = stepWhere((d) => d.fallback?.reason === 'timeout')
    renderAt(`/games/g1?step=${n}`)
    expect(await screen.findByTestId('fallback-banner')).toHaveTextContent('timeout')
    expect(screen.getByTestId('llm-no-attempts')).toBeInTheDocument()
  })

  it('does not show an LLM panel for human or bot decisions', async () => {
    mockApi(transcriptApi())
    renderAt('/games/g1?step=1')
    await screen.findByTestId('decision-panel')
    expect(screen.getByTestId('source-human')).toBeInTheDocument()
    expect(screen.queryByTestId('llm-panel')).toBeNull()
  })
})

describe('redacted transcripts', () => {
  it('says what is hidden, offers refresh and withholds prompts', async () => {
    const api = mockApi(transcriptApi(redacted))
    const n =
      redacted.entries
        .filter((e) => e.type === 'decision')
        .findIndex((e) => (e as DecisionEntry).llm) + 1
    renderAt(`/games/g1?step=${n}`)
    expect(await screen.findByTestId('redacted-banner')).toHaveTextContent(
      'unlock when the game ends'
    )
    expect(screen.getByTestId('live-bar')).toBeInTheDocument()
    expect(screen.getByTestId('llm-locked')).toBeInTheDocument()
    expect(screen.queryByTestId('llm-why')).toBeNull()
    expect(screen.queryByText(/User prompt/)).toBeNull()
    expect(screen.queryByTestId('event-log')?.textContent).not.toContain('dealt')
    const before = api.mock.calls.length
    fireEvent.click(screen.getByTestId('refresh-transcript'))
    await waitFor(() => expect(api.mock.calls.length).toBe(before + 1))
  })

  it('polls while the game is live', async () => {
    const api = mockApi(transcriptApi(redacted))
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderAt('/games/g1')
    await screen.findByTestId('redacted-banner')
    const before = api.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5200)
    })
    expect(api.mock.calls.length).toBeGreaterThan(before)
  })

  it('shows an empty-moves note for a brand new game', async () => {
    mockApi(transcriptApi({ ...redacted, entries: [], footer: null }))
    renderAt('/games/g1')
    expect(await screen.findByTestId('no-decisions')).toBeInTheDocument()
  })
})

describe('transcript errors', () => {
  it('unknown game id', async () => {
    mockApi(() => ({ status: 404, body: { detail: 'Not Found' } }))
    renderAt('/games/nope')
    expect(await screen.findByTestId('error-not-found')).toHaveTextContent(
      "couldn't find that game"
    )
  })

  it('server unreachable', async () => {
    mockApi(() => new Error('down'))
    renderAt('/games/x')
    expect(await screen.findByTestId('error-network')).toBeInTheDocument()
  })

  it('server error', async () => {
    mockApi(() => ({ status: 500, body: {} }))
    renderAt('/games/x')
    expect(await screen.findByTestId('error-server')).toBeInTheDocument()
  })

  it('HTML shell instead of JSON counts as not available', async () => {
    mockApi(() => ({ body: '<html/>', contentType: 'text/html' }))
    renderAt('/games/x')
    expect(await screen.findByTestId('error-not-found')).toBeInTheDocument()
  })
})

describe('Acquire Bench', () => {
  it('renders the ranked table with interval bars and unknown cost', async () => {
    mockApi(() => ({ body: board }))
    renderAt('/bench')
    const table = await screen.findByTestId('leaderboard-table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Claude Sonnet')
    expect(
      screen.getByTestId('winrate-sonnet'.replace('sonnet', 'llm:claude-sonnet'))
    ).toHaveTextContent('46% [28%–65%]')
    expect(screen.getByTestId('winrate-bar-llm:claude-sonnet')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('interval 28% to 65%')
    )
    expect(screen.getByTestId('cost-llm:claude-haiku')).toHaveTextContent('unknown')
    expect(screen.getByTestId('bench-sample-size')).toHaveTextContent('24 games per model')
    expect(screen.getByTestId('bench-protocol')).toHaveTextContent('acquire-bench-v1')
    expect(screen.getByTestId('series-link-acquire-bench-v1-20261114')).toHaveAttribute(
      'href',
      '/bench/series/acquire-bench-v1-20261114'
    )
  })

  it('explains how results are produced when empty', async () => {
    mockApi(() => ({ body: boardEmpty }))
    renderAt('/bench')
    const empty = await screen.findByTestId('bench-empty')
    expect(empty).toHaveTextContent('python -m bench')
    expect(screen.queryByTestId('leaderboard-table')).toBeNull()
    expect(screen.getByTestId('series-empty')).toBeInTheDocument()
  })

  it('passes ?protocol= to the API', async () => {
    const api = mockApi(() => ({ body: board }))
    renderAt('/bench?protocol=acquire-bench-v1')
    await screen.findByTestId('leaderboard-table')
    expect(String(api.mock.calls[0][0])).toContain('protocol=acquire-bench-v1')
  })

  it('older backend: not available', async () => {
    mockApi(() => ({ status: 404, body: {} }))
    renderAt('/bench')
    expect(await screen.findByTestId('error-not-found')).toHaveTextContent('not available')
  })

  it('series page lists games with standings and links to transcripts', async () => {
    mockApi(() => ({ body: series }))
    renderAt('/bench/series/acquire-bench-v1-20261114')
    const list = await screen.findByTestId('series-games')
    expect(within(list).getAllByRole('listitem', { name: '' }).length).toBeGreaterThan(5)
    expect(screen.getByTestId('series-view-b_acq1_s1_0001')).toHaveAttribute(
      'href',
      '/games/b_acq1_s1_0001'
    )
    expect(screen.getByTestId('series-game-b_acq1_s1_0001')).toHaveTextContent('Seed')
  })

  it('series page: unknown series', async () => {
    mockApi(() => ({ status: 404, body: {} }))
    renderAt('/bench/series/zzz')
    expect(await screen.findByTestId('error-not-found')).toBeInTheDocument()
  })
})

describe('game-over entry point', () => {
  const scores = [{ playerId: 'p1', name: 'Dan', cash: 1, bonuses: 0, stockSales: 0, total: 1 }]
  it('links to the transcript when a game id is known', () => {
    render(
      <MemoryRouter>
        <GameOver scores={scores} onPlayAgain={() => {}} onBackToLobby={() => {}} gameId="g_1" />
      </MemoryRouter>
    )
    expect(screen.getByTestId('view-transcript-link')).toHaveAttribute('href', '/games/g_1')
  })

  it('omits the link without a game id', () => {
    render(<GameOver scores={scores} onPlayAgain={() => {}} onBackToLobby={() => {}} />)
    expect(screen.queryByTestId('view-transcript-link')).toBeNull()
  })
})
