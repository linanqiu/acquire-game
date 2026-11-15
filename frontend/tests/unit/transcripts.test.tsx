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
import { buildReplay } from '../../src/lib/replay'
import { describeEvents } from '../../src/lib/eventText'
import { ToastProvider } from '../../src/components/ui/ToastProvider'
import { DEFAULT_RS } from './fixtures/rulesets'
import type {
  Transcript,
  DecisionEntry,
  Leaderboard,
  SeriesDetail,
} from '../../src/types/transcripts'

const FX = join(__dirname, 'fixtures')
const load = <T,>(f: string): T => JSON.parse(readFileSync(join(FX, f), 'utf8')) as T
const full = load<Transcript>('transcript-full.json')
const redacted = load<Transcript>('transcript-redacted.json')
// Every fixture is the body of a real HTTP response from the real backend
// (regenerate with fixtures/generate_transcripts.py).
interface Row {
  game_id: string
  source: string
  status: string
  turns: number
  winners: string[]
  seats: { player_id: string; name: string; agent_label: string | null }[]
}
const gamesList = load<{ games: Row[]; next: string | null }>('games-list.json')
const gamesPage2 = load<{ games: Row[]; next: string | null }>('games-list-page2.json')
const summary = load<{ standings: unknown }>('game-summary.json')
const summaryLive = load<Row>('game-summary-live.json')
const board = load<Leaderboard>('leaderboard.json')
const boardEmpty = load<Leaderboard>('leaderboard-empty.json')
const series = load<SeriesDetail>('series.json')
const GAME = full.header.game_id
const llm = full.header.seats.find((s) => s.kind === 'llm')!

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

describe('GamesPage', () => {
  it('lists games with seats, winner, turns and links', async () => {
    mockApi(() => ({ body: gamesList }))
    renderAt('/games')
    const list = await screen.findByTestId('games-list')
    expect(within(list).getAllByRole('listitem').length).toBe(gamesList.games.length)
    const mine = gamesList.games.find((g) => g.game_id === GAME)!
    const row = screen.getByTestId(`game-row-${GAME}`)
    expect(within(row).getByText('Fake LLM (test)')).toBeInTheDocument()
    const winner = mine.seats.find((s) => s.player_id === mine.winners[0])!.name
    expect(within(row).getByTestId('game-winner')).toHaveTextContent(`Winner: ${winner}`)
    expect(within(row).getByText(`${mine.turns} turns`)).toBeInTheDocument()
    expect(within(row).getByRole('link')).toHaveAttribute('href', `/games/${GAME}`)
    // a benchmark game is marked
    const bench = gamesList.games.find((g) => g.source === 'bench')!
    expect(screen.getByTestId(`game-row-${bench.game_id}`)).toHaveTextContent('BENCH')
  })

  it('loads more with the server cursor, not a page-size guess', async () => {
    expect(gamesList.next).toBeTruthy()
    const api = mockApi((url) => ({
      body: url.searchParams.get('before') === gamesList.next ? gamesPage2 : gamesList,
    }))
    renderAt('/games')
    await screen.findByTestId('games-list')
    // fewer rows than the page size, yet there is more: the cursor says so
    fireEvent.click(screen.getByTestId('load-more'))
    await waitFor(() =>
      expect(screen.getAllByRole('listitem')).toHaveLength(
        gamesList.games.length + gamesPage2.games.length
      )
    )
    expect(api.mock.calls.some((c) => String(c[0]).includes(`before=${gamesList.next}`))).toBe(true)
    expect(gamesPage2.next).toBeNull()
    expect(screen.queryByTestId('load-more')).toBeNull()
  })
  it('filters live / finished client-side and benchmark via the server', async () => {
    // the real list plus the real summary row of a game that was still running
    const rows = [summaryLive, ...gamesList.games]
    const fetchMock = mockApi((url) => ({
      body: {
        games: rows.filter(
          (g) => url.searchParams.get('source') !== 'bench' || g.source === 'bench'
        ),
        next: null,
      },
    }))
    renderAt('/games')
    await screen.findByTestId('games-list')
    fireEvent.click(screen.getByTestId('filter-live'))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByTestId(`game-row-${summaryLive.game_id}`)).toHaveTextContent('In progress')
    fireEvent.click(screen.getByTestId('filter-finished'))
    expect(screen.getAllByRole('listitem')).toHaveLength(gamesList.games.length)
    fireEvent.click(screen.getByTestId('filter-benchmark'))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('source=bench'))).toBe(true)
    )
    await waitFor(() =>
      expect(screen.getAllByRole('listitem')).toHaveLength(
        gamesList.games.filter((g) => g.source === 'bench').length
      )
    )
  })
  it('shows an empty state', async () => {
    mockApi(() => ({ body: { games: [], next: null } }))
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

  it('shows a network error with retry once the retries are used up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const api = mockApi(() => new Error('offline'))
    renderAt('/games')
    // while retrying it says the server is waking up, not that something broke
    expect(await screen.findByTestId('waking-server')).toBeInTheDocument()
    expect(screen.queryByTestId('error-network')).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(await screen.findByTestId('error-network')).toBeInTheDocument()
    expect(screen.queryByTestId('waking-server')).toBeNull()
    expect(screen.getByTestId('retry-button')).toBeInTheDocument()
    expect(api.mock.calls.length).toBeGreaterThan(3)
  })

  it('survives a 502 while the host wakes up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let calls = 0
    mockApi(() => (++calls <= 2 ? { status: 502, body: {} } : { body: gamesList }))
    renderAt('/games')
    expect(await screen.findByTestId('waking-server')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(await screen.findByTestId('games-list')).toBeInTheDocument()
    expect(screen.queryByTestId('waking-server')).toBeNull()
    expect(screen.queryByTestId('error-server')).toBeNull()
  })

  it('is linked from the home page', async () => {
    mockApi(() => ({ body: gamesList }))
    renderAt('/')
    expect(screen.getByTestId('games-link')).toHaveAttribute('href', '/games')
    expect(screen.getByTestId('bench-link')).toHaveAttribute('href', '/bench')
  })
})

describe('TranscriptPage replay', () => {
  it('shows an AI seat by its character name, the model only in its badge', async () => {
    mockApi(transcriptApi())
    renderAt('/games/g1?step=1')
    await screen.findByTestId('transcript-viewer')
    const card = screen.getByTestId(`replay-player-${llm.player_id}`)
    expect(llm.name).not.toBe(llm.agent_label)
    expect(within(card).getAllByText(llm.name)).toHaveLength(1)
    expect(card).not.toHaveTextContent(llm.agent_label!)
    expect(within(card).getByTestId(`seat-kind-${llm.player_id}`)).toHaveAccessibleName(
      `AI player, ${llm.agent_label}`
    )
  })

  it('steps forward and back, changing the board and the event text', async () => {
    mockApi(transcriptApi())
    renderAt('/games/g1')
    await screen.findByTestId('transcript-viewer')
    expect(screen.getByTestId('step-counter')).toHaveTextContent(`Step 0 / ${decisions.length}`)
    expect(screen.getByTestId('event-log')).toHaveTextContent('Game started')
    const replay = buildReplay(full)
    const names = Object.fromEntries(full.header.seats.map((s) => [s.player_id, s.name]))
    const money = (i: number, pid: string) =>
      replay.steps[i].state?.players.find((p) => p.player_id === pid)?.money
    // first step on which anybody's cash changes (a stock purchase)
    const target = replay.steps.findIndex((_, i) =>
      i > 0
        ? full.header.seats.some((s) => money(i, s.player_id) !== money(i - 1, s.player_id))
        : false
    )
    expect(target).toBeGreaterThan(0)
    const who = full.header.seats.find(
      (s) => money(target, s.player_id) !== money(target - 1, s.player_id)
    )!
    const cash = () => screen.getByTestId(`cash-${who.player_id}`).textContent
    const startCash = cash()
    for (let i = 0; i < target; i++) fireEvent.click(screen.getByTestId('step-next'))
    expect(screen.getByTestId('step-counter')).toHaveTextContent(`Step ${target} /`)
    expect(cash()).not.toBe(startCash)
    const sentence = describeEvents(replay.steps[target].events, names, DEFAULT_RS)[0].text
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

  it('shows the seat summary with standings, fallbacks and cost', async () => {
    mockApi(transcriptApi())
    renderAt('/games/g1')
    await screen.findByTestId('seat-summary')
    const standings = full.footer!.standings
    for (const st of standings) {
      expect(screen.getByTestId(`score-${st.player_id}`)).toHaveTextContent(
        `$${st.score.toLocaleString('en-US')}`
      )
    }
    const totals = full.footer!.totals[llm.player_id]
    expect(totals.fallbacks).toBeGreaterThan(0)
    expect(screen.getByTestId(`fallbacks-${llm.player_id}`)).toHaveTextContent(
      String(totals.fallbacks)
    )
    expect(screen.getByTestId(`cost-${llm.player_id}`)).toHaveTextContent('$0.0000')
    expect(screen.getByTestId('download-transcript')).toHaveAttribute(
      'href',
      `/api/games/${GAME}/transcript`
    )
    const rank1 = standings.find((s) => s.rank === 1)!
    expect(screen.getByTestId(`seat-row-${rank1.player_id}`)).toHaveTextContent(rank1.name)
    // the game summary route reports the same standings
    expect(summary.standings).toEqual(standings)
  })

  it('shows an unknown price as "unknown", never as $0', async () => {
    const t = structuredClone(full)
    t.footer!.totals[llm.player_id].cost_usd = null
    mockApi(transcriptApi(t))
    renderAt('/games/g1')
    await screen.findByTestId('seat-summary')
    expect(screen.getByTestId(`cost-${llm.player_id}`)).toHaveTextContent('unknown')
  })

  it('flags a transcript loaded from a snapshot', async () => {
    const t = structuredClone(full)
    t.header.loaded_from_snapshot = true
    mockApi(transcriptApi(t))
    renderAt('/games/g1')
    expect(await screen.findByTestId('snapshot-banner')).toHaveTextContent('loaded from a saved')
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
    // retries = attempts with an error
    expect(d.llm!.attempts.filter((a) => a.error)).toHaveLength(2)
    renderAt(`/games/g1?step=${n}`)
    const panel = await screen.findByTestId('llm-panel')
    expect(within(panel).getByTestId('llm-why')).toHaveTextContent(d.llm!.why!)
    expect(within(panel).getByTestId('llm-note')).toBeInTheDocument()
    expect(within(panel).getByTestId('attempt-0-error')).toHaveTextContent(
      d.llm!.attempts[0].error!
    )
    expect(within(panel).getByTestId('attempt-0')).toHaveAttribute('data-outcome', 'rejected')
    expect(within(panel).getByTestId('attempt-1')).toHaveAttribute('data-outcome', 'rejected')
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
    expect(within(panel).getByTestId(`body-attempt-${d.index}-0-raw`)).toHaveTextContent(
      'found_chain'
    )
    fireEvent.click(within(panel).getByTestId(`toggle-attempt-${d.index}-1-retry`))
    expect(within(panel).getByTestId(`body-attempt-${d.index}-1-retry`)).toHaveTextContent(
      'Rejected because'
    )
    fireEvent.click(within(panel).getByTestId(`copy-user-prompt-${d.index}`))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(d.llm!.user_prompt)
  })
  it('flags a fallback prominently with its reason', async () => {
    mockApi(transcriptApi())
    const n = stepWhere((d) => d.source === 'fallback' && d.fallback?.reason === 'illegal')
    expect(n).toBeGreaterThan(0)
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
    // every attempt of the failed decision is listed
    const d = decisions[n - 1]
    expect(screen.getAllByTestId(/^attempt-\d+$/)).toHaveLength(d.llm!.attempts.length)
  })
  it('handles a fallback with no model answer at all (timeout)', async () => {
    // Real fallback decision re-shaped to the contract's timeout form (raw null).
    const t = structuredClone(full)
    const n = stepWhere((d) => d.source === 'fallback')
    const d = t.entries.filter((e) => e.type === 'decision')[n - 1] as DecisionEntry
    d.fallback = { reason: 'timeout', message: 'The model did not answer in time.' }
    d.llm!.attempts = [{ ...d.llm!.attempts[0], raw: null, parsed: null, error: 'timed out' }]
    mockApi(transcriptApi(t))
    renderAt(`/games/g1?step=${n}`)
    expect(await screen.findByTestId('fallback-banner')).toHaveTextContent('timeout')
    expect(screen.getByTestId('attempt-0')).toHaveTextContent('cut off')
  })

  it('shows a human decision without a latency and an out-of-turn action without options', async () => {
    const t = structuredClone(full)
    const n = stepWhere((d) => d.source === 'human')
    const d = t.entries.filter((e) => e.type === 'decision')[n - 1] as DecisionEntry
    expect(d.latency_s).toBeNull() // the real backend records no latency for humans
    d.legal = null // trade proposals/cancels outside a decision
    mockApi(transcriptApi(t))
    renderAt(`/games/g1?step=${n}`)
    expect(await screen.findByTestId('decision-panel')).toHaveTextContent('out-of-turn')
    expect(screen.queryByTestId('legal-options')).toBeNull()
    expect(screen.getByTestId('decision-panel')).not.toHaveTextContent('NaN')
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
        .findIndex((e) => (e as DecisionEntry).llm?.attempts.length === 3) + 1
    expect(n).toBeGreaterThan(0)
    renderAt(`/games/g1?step=${n}`)
    expect(await screen.findByTestId('redacted-banner')).toHaveTextContent(
      'unlock when the game ends'
    )
    expect(screen.getByTestId('live-bar')).toBeInTheDocument()
    expect(screen.getByTestId('llm-locked')).toBeInTheDocument()
    expect(screen.queryByTestId('llm-why')).toBeNull()
    expect(screen.queryByText(/User prompt/)).toBeNull()
    // rejected attempts show the generic text, never the reason
    expect(screen.getByTestId('attempt-0')).toHaveAttribute('data-outcome', 'rejected')
    expect(screen.getByTestId('attempt-0-error')).toHaveTextContent('details are shown when')
    expect(screen.getByTestId('attempt-2')).toHaveAttribute('data-outcome', 'accepted')
    expect(screen.queryByTestId('event-log')?.textContent).not.toContain('dealt')
    const before = api.mock.calls.length
    fireEvent.click(screen.getByTestId('refresh-transcript'))
    await waitFor(() => expect(api.mock.calls.length).toBe(before + 1))
  })

  it('uses the server live totals while the game is unfinished', async () => {
    expect(redacted.live_totals).toBeTruthy()
    mockApi(transcriptApi(redacted))
    renderAt('/games/g1')
    const row = await screen.findByTestId(`seat-row-${llm.player_id}`)
    const t = redacted.live_totals![llm.player_id]
    expect(t.retries).toBeGreaterThan(0)
    expect(row).toHaveTextContent(String(t.decisions))
    expect(screen.getByTestId(`fallbacks-${llm.player_id}`)).toHaveTextContent(String(t.fallbacks))
  })

  it('does not contain what the contract says to hide', () => {
    const text = JSON.stringify(redacted.entries)
    expect(redacted.header.seed).toBeNull()
    expect(redacted.header.tile_order).toBeNull()
    expect(text).not.toContain('# Your seat')
    expect(text).not.toContain('tiles_dealt')
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
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockApi(() => new Error('down'))
    renderAt('/games/x')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
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

describe('Buyout Bench', () => {
  it('renders the ranked table with interval bars, the anchor and the protocol', async () => {
    mockApi(() => ({ body: board }))
    renderAt('/bench')
    const table = await screen.findByTestId('leaderboard-table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(board.agents.length)
    const model = board.agents.find((a) => !a.is_anchor)!
    const anchor = board.agents.find((a) => a.is_anchor)!
    // protocol, prompt version and track are prominent
    expect(screen.getByTestId('bench-protocol-id')).toHaveTextContent(board.protocol.id)
    expect(screen.getByTestId('bench-prompt-version')).toHaveTextContent(board.prompt_version!)
    expect(screen.getByTestId('bench-track')).toHaveTextContent('all')
    // the anchor is marked
    const anchorRow = screen.getByTestId(`leaderboard-row-${anchor.agent_id}`)
    expect(anchorRow).toHaveAttribute('data-anchor', 'true')
    expect(anchorRow).toHaveTextContent('ANCHOR')
    expect(screen.getByTestId(`leaderboard-row-${model.agent_id}`)).not.toHaveAttribute(
      'data-anchor'
    )
    const pct = (v: number) => `${(v * 100).toFixed(0)}%`
    expect(screen.getByTestId(`winrate-${model.agent_id}`)).toHaveTextContent(
      `${pct(model.win_rate)} [${pct(model.ci_low)}–${pct(model.ci_high)}]`
    )
    expect(screen.getByTestId(`winrate-bar-${model.agent_id}`)).toHaveAttribute(
      'aria-label',
      expect.stringContaining(`interval ${pct(model.ci_low)} to ${pct(model.ci_high)}`)
    )
    // seat-games are shown where they differ from games (the bot holds three seats)
    expect(anchorRow).toHaveTextContent(`${anchor.seat_games} seat-games`)
    expect(screen.getByTestId('bench-sample-size')).toHaveTextContent(`${board.games} games`)
    // series: planned vs played, partial run
    const s = board.series[0]
    const link = screen.getByTestId(`series-link-${s.series_id}`)
    expect(link).toHaveAttribute('href', `/bench/series/${s.series_id}`)
    expect(link).toHaveTextContent(`${s.games} of ${s.planned} games played`)
    expect(link).toHaveTextContent('PARTIAL RUN')
    expect(link).toHaveTextContent(s.track!)
  })

  it('shows unknown cost as unknown and warnings verbatim', async () => {
    const b = structuredClone(board)
    b.agents[1].cost_per_game = null
    b.warnings = ['2 game(s) stalled and are excluded']
    mockApi(() => ({ body: b }))
    renderAt('/bench')
    await screen.findByTestId('leaderboard-table')
    expect(screen.getByTestId(`cost-${b.agents[1].agent_id}`)).toHaveTextContent('unknown')
    expect(screen.getByTestId(`cost-${b.agents[0].agent_id}`)).toHaveTextContent('$0.00')
    expect(screen.getByTestId('bench-warnings')).toHaveTextContent(
      '2 game(s) stalled and are excluded'
    )
  })

  it('switches track and prompt version through the API', async () => {
    const api = mockApi(() => ({
      body: { ...board, available: { ...board.available, prompt_versions: ['v1-a', 'v1-b'] } },
    }))
    renderAt('/bench')
    await screen.findByTestId('leaderboard-table')
    fireEvent.click(screen.getByTestId('track-vs-baseline'))
    await waitFor(() =>
      expect(api.mock.calls.some((c) => String(c[0]).includes('track=vs-baseline'))).toBe(true)
    )
    fireEvent.change(await screen.findByTestId('prompt-version-select'), {
      target: { value: 'v1-b' },
    })
    await waitFor(() =>
      expect(api.mock.calls.some((c) => String(c[0]).includes('prompt_version=v1-b'))).toBe(true)
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
    renderAt('/bench?protocol=bench-v1')
    await screen.findByTestId('leaderboard-table')
    expect(String(api.mock.calls[0][0])).toContain('protocol=bench-v1')
  })

  it('older backend: not available', async () => {
    mockApi(() => ({ status: 404, body: {} }))
    renderAt('/bench')
    expect(await screen.findByTestId('error-not-found')).toHaveTextContent('not available')
  })

  it('series page lists games with standings and links to transcripts', async () => {
    mockApi(() => ({ body: series }))
    renderAt(`/bench/series/${series.series_id}`)
    const list = await screen.findByTestId('series-games')
    expect(within(list).getAllByRole('listitem', { name: '' }).length).toBeGreaterThan(
      series.games.length
    )
    const g = series.games[0]
    expect(screen.getByTestId(`series-view-${g.game_id}`)).toHaveAttribute(
      'href',
      `/games/${g.game_id}`
    )
    expect(screen.getByTestId(`series-game-${g.game_id}`)).toHaveTextContent(`Seed ${g.seed}`)
    expect(screen.getByTestId(`series-game-${g.game_id}`)).toHaveTextContent(
      `seats: ${g.seat_order!.join(', ')}`
    )
    expect(screen.getByTestId('series-played')).toHaveTextContent(String(series.games.length))
    expect(screen.getByText(/games played/)).toHaveTextContent(`of ${series.planned}`)
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
