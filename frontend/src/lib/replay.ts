/**
 * Turn a transcript's flat entry list into replay steps.
 *
 * Step 0 is the start of the game. Step k (k >= 1) is "the k-th decision has been
 * applied": it carries that decision, the engine events it produced, and the public
 * state recorded right after it.
 */

import type { TileState } from '../types/game'
import type {
  ChatEntry,
  CommentaryEntry,
  DecisionEntry,
  EngineEvent,
  PublicState,
  StateEntry,
  Transcript,
  TranscriptEntry,
} from '../types/transcripts'

export interface ReplayStep {
  step: number
  decision: DecisionEntry | null
  events: EngineEvent[]
  /** Table chat written after this step's decision (step 0: lobby and opening chat). */
  chat: ChatEntry[]
  /** Commentary lines said after this step (only when someone watched the game live). */
  commentary: CommentaryEntry[]
  state: PublicState | null
  /** 1-based turn number (turns advance on `turn_ended`). */
  turn: number
  /** Whose turn it was when the decision was made (may differ from the decider for trades). */
  turnPlayerId: string | null
}

export interface TurnGroup {
  turn: number
  playerId: string | null
  steps: ReplayStep[]
}

export interface Replay {
  steps: ReplayStep[]
  groups: TurnGroup[]
}

type Normalized =
  | { kind: 'decision'; entry: DecisionEntry }
  | { kind: 'state'; entry: StateEntry }
  | { kind: 'event'; entry: EngineEvent }
  | { kind: 'chat'; entry: ChatEntry }
  | { kind: 'commentary'; entry: CommentaryEntry }

/**
 * Entries are `{type:"event", event:{...}}`, `decision` and `state` lines in file order
 * (`decision -> the events it produced -> state`). Anything else is dropped.
 */
export function normalizeEntries(entries: TranscriptEntry[]): Normalized[] {
  const out: Normalized[] = []
  for (const raw of entries ?? []) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as unknown as Record<string, unknown>
    if (e.type === 'decision') out.push({ kind: 'decision', entry: raw as DecisionEntry })
    else if (e.type === 'state') out.push({ kind: 'state', entry: raw as StateEntry })
    else if (e.type === 'chat' && typeof e.text === 'string')
      out.push({ kind: 'chat', entry: raw as ChatEntry })
    else if (e.type === 'commentary' && typeof e.text === 'string')
      out.push({ kind: 'commentary', entry: raw as CommentaryEntry })
    else if (e.type === 'event' && e.event && typeof e.event === 'object')
      out.push({ kind: 'event', entry: e.event as EngineEvent })
  }
  return out
}

export function buildReplay(transcript: Transcript): Replay {
  const items = normalizeEntries(transcript.entries)
  const steps: ReplayStep[] = [
    {
      step: 0,
      decision: null,
      events: [],
      chat: [],
      commentary: [],
      state: null,
      turn: 1,
      turnPlayerId: null,
    },
  ]
  let cur = steps[0]
  let turnsEnded = 0
  for (const it of items) {
    if (it.kind === 'decision') {
      const prev = cur
      cur = {
        step: steps.length,
        decision: it.entry,
        events: [],
        chat: [],
        commentary: [],
        state: null,
        turn: turnsEnded + 1,
        turnPlayerId: prev.state?.current_player ?? it.entry.player_id,
      }
      steps.push(cur)
    } else if (it.kind === 'chat') {
      cur.chat.push(it.entry)
    } else if (it.kind === 'commentary') {
      cur.commentary.push(it.entry)
    } else if (it.kind === 'event') {
      cur.events.push(it.entry)
      if (it.entry.type === 'turn_ended') turnsEnded += 1
    } else {
      cur.state = it.entry.public
    }
  }
  // Steps without their own state (a live transcript cut mid-step) reuse the last one.
  for (let i = 1; i < steps.length; i++) {
    if (!steps[i].state) steps[i].state = steps[i - 1].state
  }
  const groups: TurnGroup[] = []
  for (const s of steps.slice(1)) {
    const last = groups[groups.length - 1]
    if (last && last.turn === s.turn) last.steps.push(s)
    else groups.push({ turn: s.turn, playerId: s.turnPlayerId, steps: [s] })
  }
  return { steps, groups }
}

/** Clamp a `?step=` query value to a valid step index. */
export function parseStep(raw: string | null, max: number): number {
  if (raw === null || raw.trim() === '') return 0
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(max, n))
}

export interface SeatStats {
  decisions: number
  llmCalls: number
  retries: number
  fallbacks: number
  inputTokens: number
  outputTokens: number
}

/** Per-seat counters derived from the decisions themselves (used when no footer exists yet). */
export function computeSeatStats(replay: Replay): Record<string, SeatStats> {
  const out: Record<string, SeatStats> = {}
  for (const s of replay.steps) {
    const d = s.decision
    if (!d) continue
    const st = (out[d.player_id] ??= {
      decisions: 0,
      llmCalls: 0,
      retries: 0,
      fallbacks: 0,
      inputTokens: 0,
      outputTokens: 0,
    })
    st.decisions += 1
    if (d.source === 'fallback') st.fallbacks += 1
    if (d.llm) {
      st.llmCalls += d.llm.attempts.length
      st.retries += d.llm.attempts.filter((a) => a.error).length
      for (const a of d.llm.attempts) {
        st.inputTokens += a.input_tokens ?? 0
        st.outputTokens += a.output_tokens ?? 0
      }
    }
  }
  return out
}

/** Public-state board cells to the Board component's tile states. */
export function toTileStates(state: PublicState): Record<string, TileState> {
  const out: Record<string, TileState> = {}
  for (const [coord, cell] of Object.entries(state.board?.cells ?? {})) {
    if (cell.state === 'in_chain' && cell.chain) out[coord] = { state: 'chain', chain: cell.chain }
    else out[coord] = { state: 'orphan' }
  }
  return out
}
