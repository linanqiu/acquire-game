import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CommentaryFinal, CommentaryLog, CommentaryStrip } from './Commentary'
import { mergeCommentary, useGameStore } from '../../store/gameStore'
import { buildReplay } from '../../lib/replay'
import { ToastProvider } from '../ui/ToastProvider'
import type { CommentaryLine } from '../../types/api'
import type { Transcript } from '../../types/transcripts'

function line(id: number, over: Partial<CommentaryLine> = {}): CommentaryLine {
  return {
    id,
    text: `line ${id}`,
    source: 'rules',
    turn: id,
    after_seq: id * 10,
    at: '2026-11-21T10:00:00Z',
    moments: ['chain_founded'],
    ...over,
  }
}

function history(lines: CommentaryLine[], enabled = true, mode: 'model' | 'rules' = 'rules') {
  act(() =>
    useGameStore.getState().handleMessage({ type: 'commentary_history', enabled, mode, lines })
  )
}

function say(l: CommentaryLine, mode: 'model' | 'rules' = 'rules') {
  act(() => useGameStore.getState().handleMessage({ type: 'commentary', line: l, mode }))
}

/** jsdom has no layout: say which width the page has. */
function screenWidth(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide && query.includes('min-width: 768px'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

const mount = (ui: React.ReactNode) => render(<ToastProvider>{ui}</ToastProvider>)

describe('commentary in the game store', () => {
  beforeEach(() => useGameStore.getState().reset())

  it('is unknown until the server says, then holds the setting, the mode and the lines', () => {
    expect(useGameStore.getState().commentary).toBeNull()
    history([line(1), line(2)], true, 'model')
    expect(useGameStore.getState().commentary).toEqual({
      enabled: true,
      mode: 'model',
      lines: [line(1), line(2)],
    })
  })

  it('appends each line once, in order, and follows the mode the server reports', () => {
    history([line(1)], true, 'model')
    say(line(3), 'model')
    say(line(2), 'model')
    say(line(3), 'rules')
    const c = useGameStore.getState().commentary!
    expect(c.lines.map((l) => l.id)).toEqual([1, 2, 3])
    expect(c.mode).toBe('rules')
  })

  it('a new history replaces the lines (a new game starts empty) and reset forgets them', () => {
    history([line(1), line(2)])
    history([], false)
    expect(useGameStore.getState().commentary).toEqual({ enabled: false, mode: 'rules', lines: [] })
    useGameStore.getState().reset()
    expect(useGameStore.getState().commentary).toBeNull()
    expect(mergeCommentary([line(2)], [line(1), line(2)]).map((l) => l.id)).toEqual([1, 2])
  })
})

describe('CommentaryStrip', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    useGameStore.getState().reset()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    screenWidth(true)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renders nothing while commentary is off or not yet known', () => {
    mount(<CommentaryStrip room="ABCD" />)
    expect(screen.queryByTestId('commentary-strip')).not.toBeInTheDocument()
    history([line(1)], false)
    expect(screen.queryByTestId('commentary-strip')).not.toBeInTheDocument()
  })

  it('before the first line it says so, quietly', () => {
    history([])
    mount(<CommentaryStrip room="ABCD" />)
    expect(screen.getByTestId('commentary-waiting')).toHaveTextContent(
      'The commentary starts with the first notable move.'
    )
    expect(screen.queryByTestId('commentary-line')).not.toBeInTheDocument()
  })

  it('wide: the latest line on top, the two before it under it, newest first; no more', () => {
    history([line(1), line(2), line(3), line(4)])
    mount(<CommentaryStrip room="ABCD" />)
    expect(screen.getByTestId('commentary-line')).toHaveTextContent('line 4')
    const earlier = within(screen.getByTestId('commentary-earlier')).getAllByRole('listitem')
    expect(earlier.map((li) => li.textContent)).toEqual(['line 3', 'line 2'])
    expect(screen.queryByText('line 1')).not.toBeInTheDocument()
  })

  it('a new line takes the top place by itself', () => {
    history([line(1), line(2)])
    mount(<CommentaryStrip room="ABCD" />)
    say(line(3, { text: 'Fitz takes the Sandpiper majority.' }))
    expect(screen.getByTestId('commentary-line')).toHaveTextContent(
      'Fitz takes the Sandpiper majority.'
    )
    const earlier = within(screen.getByTestId('commentary-earlier')).getAllByRole('listitem')
    expect(earlier.map((li) => li.textContent)).toEqual(['line 2', 'line 1'])
  })

  it('phones: only the latest line', () => {
    screenWidth(false)
    history([line(1), line(2), line(3)])
    mount(<CommentaryStrip room="ABCD" />)
    expect(screen.getByTestId('commentary-line')).toHaveTextContent('line 3')
    expect(screen.queryByTestId('commentary-earlier')).not.toBeInTheDocument()
  })

  it('says quietly whether the line is a model’s or templated', () => {
    history([line(1)], true, 'model')
    mount(<CommentaryStrip room="ABCD" />)
    // the line shown is templated even though the room has a model
    expect(screen.getByTestId('commentary-source')).toHaveTextContent('rules')
    say(line(2, { source: 'model' }), 'model')
    expect(screen.getByTestId('commentary-source')).toHaveTextContent('model')
    expect(screen.getByTestId('commentary-strip')).toHaveAttribute('data-source', 'model')
  })

  it('renders a line as text, never as HTML', () => {
    history([line(1, { text: '<img src=x onerror=alert(1)> wins' })])
    mount(<CommentaryStrip room="ABCD" />)
    expect(screen.getByTestId('commentary-line').textContent).toBe(
      '<img src=x onerror=alert(1)> wins'
    )
    expect(document.querySelector('img')).toBeNull()
  })

  it('OFF asks the server; the strip goes when the server says it is off', async () => {
    history([line(1)])
    mount(<CommentaryStrip room="ABCD" />)
    fireEvent.click(screen.getByTestId('commentary-off'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/room/ABCD/commentary')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ enabled: false })
    expect(screen.getByTestId('commentary-strip')).toBeInTheDocument()
    history([line(1)], false)
    expect(screen.queryByTestId('commentary-strip')).not.toBeInTheDocument()
  })

  it('a refused change is said and nothing changes', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    history([line(1)])
    mount(<CommentaryStrip room="ABCD" />)
    fireEvent.click(screen.getByTestId('commentary-off'))
    expect(await screen.findByText('Could not change the commentary setting')).toBeInTheDocument()
    expect(screen.getByTestId('commentary-strip')).toBeInTheDocument()
  })
})

describe('CommentaryLog (the host Log tab)', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    useGameStore.getState().reset()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    screenWidth(true)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('off: one line and the switch to turn it on', async () => {
    history([], false)
    mount(<CommentaryLog room="ABCD" />)
    expect(screen.getByTestId('commentary-log')).toHaveTextContent('Off for this room.')
    fireEvent.click(screen.getByTestId('commentary-on'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ enabled: true })
  })

  it('on: only the lines that are no longer in the strip, newest first (each line once)', () => {
    history([line(1), line(2), line(3), line(4), line(5)])
    mount(
      <>
        <CommentaryStrip room="ABCD" />
        <CommentaryLog room="ABCD" />
      </>
    )
    const log = within(screen.getByTestId('commentary-log')).getAllByTestId('commentary-log-line')
    expect(log.map((li) => li.textContent)).toEqual(['T2line 2', 'T1line 1'])
    for (const n of [1, 2, 3, 4, 5]) expect(screen.getAllByText(`line ${n}`)).toHaveLength(1)
  })

  it('on with nothing older than the strip: nothing at all', () => {
    history([line(1), line(2)])
    const { container } = mount(<CommentaryLog room="ABCD" />)
    expect(container.querySelector('[data-testid="commentary-log"]')).toBeNull()
  })

  it('phones: the strip holds one line, the log the rest', () => {
    screenWidth(false)
    history([line(1), line(2), line(3)])
    mount(<CommentaryLog room="ABCD" />)
    const log = screen.getAllByTestId('commentary-log-line')
    expect(log.map((li) => li.textContent)).toEqual(['T2line 2', 'T1line 1'])
  })
})

describe('CommentaryFinal (over the final standings)', () => {
  beforeEach(() => useGameStore.getState().reset())

  it('shows the line about the result, once it is there, and nothing when commentary is off', () => {
    const { rerender } = render(<CommentaryFinal />)
    expect(screen.queryByTestId('commentary-final')).not.toBeInTheDocument()
    // the game is over but the result has not been said yet: the line before it is not shown
    history([line(1), line(2, { text: 'The end can be called from here.' })])
    rerender(<CommentaryFinal />)
    expect(screen.queryByTestId('commentary-final')).not.toBeInTheDocument()
    say(line(3, { text: 'Max wins with $48,500.', source: 'model', moments: ['game_ended'] }))
    rerender(<CommentaryFinal />)
    expect(screen.getByTestId('commentary-final')).toHaveTextContent('Max wins with $48,500.')
    history([line(3, { moments: ['game_ended'] })], false)
    rerender(<CommentaryFinal />)
    expect(screen.queryByTestId('commentary-final')).not.toBeInTheDocument()
  })
})

describe('commentary in a transcript replay', () => {
  it('a line belongs to the step it followed; a call that said nothing is not a line', () => {
    const decision = (index: number) => ({
      type: 'decision',
      index,
      after_seq: index,
      player_id: 'p1',
      kind: 'place_tile',
      action: { action: 'place_tile', tile: '1A' },
      source: 'bot',
    })
    const commentary = (id: number | null, text: string | null) => ({
      type: 'commentary',
      id,
      text,
      source: text ? 'rules' : null,
      after_seq: 1,
      moments: ['chain_founded'],
      outcome: text ? 'rules' : 'silent',
      llm: null,
    })
    const transcript = {
      header: {},
      entries: [
        decision(0),
        commentary(1, 'Ann founds Sandpiper.'),
        commentary(null, null),
        decision(1),
        commentary(2, 'Bob takes the majority.'),
      ],
      footer: null,
    } as unknown as Transcript
    const replay = buildReplay(transcript)
    expect(replay.steps.map((s) => s.commentary.map((c) => c.text))).toEqual([
      [],
      ['Ann founds Sandpiper.'],
      ['Bob takes the majority.'],
    ])
  })
})
