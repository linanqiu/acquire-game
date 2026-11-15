/**
 * Replay stepping on a REAL finished game (tests/unit/fixtures/transcript-full.json, written by
 * the backend: a human, an LLM seat that was refused and retried, and a bot), checked against
 * what the transcript itself says (its events, states and the footer's own totals).
 */
import { describe, it, expect } from 'vitest'
import { buildReplay, computeSeatStats, normalizeEntries, parseStep, toTileStates } from './replay'
import full from '../../tests/unit/fixtures/transcript-full.json'
import redacted from '../../tests/unit/fixtures/transcript-redacted.json'
import type { Transcript } from '../types/transcripts'

const transcript = full as unknown as Transcript
const live = redacted as unknown as Transcript
const entries = transcript.entries as Array<Record<string, any>>
const decisions = entries.filter((e) => e.type === 'decision')

describe('buildReplay', () => {
  // Built inside each test (not once at collection) so each test is the one that exercises it.
  const build = () => buildReplay(transcript)

  it('step 0 is the start of the game; step k is the k-th decision applied', () => {
    const replay = build()
    expect(replay.steps).toHaveLength(decisions.length + 1)
    expect(replay.steps[0]).toMatchObject({ step: 0, decision: null, turn: 1, turnPlayerId: null })
    // What happened before the first decision (the deal) belongs to the opening step.
    expect(replay.steps[0].events[0].type).toBe('game_started')
    replay.steps.slice(1).forEach((s, i) => {
      expect(s.step).toBe(i + 1)
      expect(s.decision).toBe(decisions[i])
    })
  })

  it('each step carries the engine events its decision produced, in order, and nothing else', () => {
    const replay = build()
    // Every event after the k-th decision (and before the next) belongs to step k.
    const bySeq = new Map<number, number>()
    let step = 0
    for (const e of entries) {
      if (e.type === 'decision') step++
      else if (e.type === 'event') bySeq.set(e.event.seq, step)
    }
    for (const s of replay.steps) {
      expect(s.events.map((e) => e.seq)).toEqual(
        [...bySeq].filter(([, k]) => k === s.step).map(([seq]) => seq)
      )
    }
    const all = replay.steps.flatMap((s) => s.events)
    expect(all).toHaveLength(entries.filter((e) => e.type === 'event').length)
  })

  it('each step shows the public state recorded right after its decision', () => {
    const replay = build()
    const states = entries.filter((e) => e.type === 'state').map((e) => e.public)
    // The recording has one state per decision plus the opening one.
    expect(states).toHaveLength(replay.steps.length)
    const first = replay.steps[1]
    expect(first.state).toBe(states[1])
    expect(replay.steps.at(-1)!.state).toBe(states.at(-1))
  })

  it('turns advance on turn_ended, and the turn player is who was to move when the decision was made', () => {
    const replay = build()
    const ended = (upTo: number) =>
      replay.steps
        .slice(0, upTo)
        .flatMap((s) => s.events)
        .filter((e) => e.type === 'turn_ended').length
    for (const s of replay.steps.slice(1)) {
      expect(s.turn, `step ${s.step}`).toBe(ended(s.step) + 1)
      expect(s.turnPlayerId).toBe(
        replay.steps[s.step - 1].state?.current_player ?? s.decision!.player_id
      )
    }
    expect(replay.steps.at(-1)!.turn).toBeGreaterThan(20)
  })

  it('groups are the steps of one turn each, in order, covering every step but the opening', () => {
    const replay = build()
    expect(replay.groups.flatMap((g) => g.steps)).toEqual(replay.steps.slice(1))
    replay.groups.forEach((g, i) => {
      expect(new Set(g.steps.map((s) => s.turn))).toEqual(new Set([g.turn]))
      expect(g.playerId).toBe(g.steps[0].turnPlayerId)
      if (i > 0) expect(g.turn).toBeGreaterThan(replay.groups[i - 1].turn)
    })
  })

  it('a live transcript cut mid-step still replays: steps without a state show the last known one', () => {
    const cut = { ...live, entries: live.entries.slice(0, -1) } as Transcript
    const r = buildReplay(cut)
    expect(r.steps.every((s) => s.step === 0 || s.state !== null)).toBe(true)
    expect(r.steps.at(-1)!.state).toBe(r.steps.at(-2)!.state)
  })

  it('a transcript with no entries is just the opening step', () => {
    const r = buildReplay({ ...transcript, entries: [] } as Transcript)
    expect(r.steps).toHaveLength(1)
    expect(r.groups).toEqual([])
  })
})

describe('normalizeEntries', () => {
  it('keeps decisions, states and events in file order, and drops everything else', () => {
    const out = normalizeEntries([
      null,
      'junk',
      { type: 'decision', index: 0 },
      { type: 'event', event: { seq: 1, type: 'x' } },
      { type: 'event' },
      { type: 'event', event: 'not an object' },
      { type: 'state', public: {} },
      { type: 'footer' },
    ] as never)
    expect(out.map((o) => o.kind)).toEqual(['decision', 'event', 'state'])
    expect(normalizeEntries(undefined as never)).toEqual([])
  })
})

describe('computeSeatStats', () => {
  it("matches the footer's own per-seat totals, which the backend counted independently", () => {
    const stats = computeSeatStats(buildReplay(transcript))
    const totals = (transcript.footer as any).totals
    expect(Object.keys(stats).sort()).toEqual(Object.keys(totals).sort())
    for (const [seat, t] of Object.entries<any>(totals)) {
      expect(stats[seat], seat).toEqual({
        decisions: t.decisions,
        llmCalls: t.llm_calls,
        retries: t.retries,
        fallbacks: t.fallbacks,
        inputTokens: t.input_tokens,
        outputTokens: t.output_tokens,
      })
    }
    // The LLM seat really exercised retries and the fallback.
    const llm = Object.values(stats).find((s) => s.llmCalls > 0)!
    expect(llm.retries).toBeGreaterThan(0)
    expect(llm.fallbacks).toBeGreaterThan(0)
  })
})

describe('parseStep', () => {
  it('reads ?step= and clamps it into the game', () => {
    expect(parseStep('7', 100)).toBe(7)
    expect(parseStep('999', 100)).toBe(100)
    expect(parseStep('-4', 100)).toBe(0)
    expect(parseStep('100', 100)).toBe(100)
  })

  it('a missing or garbled value means the start', () => {
    for (const raw of [null, '', '   ', 'abc', 'NaN'])
      expect(parseStep(raw, 100), String(raw)).toBe(0)
  })
})

describe('toTileStates', () => {
  it('turns a recorded board into chain and orphan squares', () => {
    const state = (transcript.entries as any[]).filter((e) => e.type === 'state').at(-1).public
    const tiles = toTileStates(state)
    const cells = Object.entries<any>(state.board.cells)
    expect(Object.keys(tiles)).toHaveLength(cells.length)
    for (const [coord, cell] of cells) {
      expect(tiles[coord]).toEqual(
        cell.state === 'in_chain' && cell.chain
          ? { state: 'chain', chain: cell.chain }
          : { state: 'orphan' }
      )
    }
    expect(cells.some(([, c]) => c.state === 'in_chain')).toBe(true)
    expect(toTileStates({} as never)).toEqual({})
  })
})
