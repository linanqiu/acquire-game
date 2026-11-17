/**
 * The table panel (BL-011, BL-013): which view it shows and the events that bring it into
 * view. Pure functions over what the server sent.
 */
import type { GamePhase, MergerRecord } from '../types/api'

export type DecisionView =
  | 'survivor' // my survivor choice (tied merger)
  | 'disposition' // my sell / trade / keep inside the merger view
  | 'merger' // a merger in progress, someone else deciding (read-only)
  | 'found' // my founding choice
  | 'buy' // my buy
  | 'place' // my tile to place
  | 'waiting' // someone else's move (and a merger that just ended, until play moves on)

export interface DecisionState {
  phase: GamePhase | string
  isMyTurn: boolean
  survivorChoice: boolean
  disposition: boolean
  foundChoice: boolean
  mergerInProgress: boolean
}

/** What the table panel shows: the decision on me first, else what is happening. */
export function decisionView(s: DecisionState): DecisionView {
  if (s.survivorChoice) return 'survivor'
  if (s.disposition) return 'disposition'
  if (s.mergerInProgress) return 'merger'
  if (s.isMyTurn && s.phase === 'found_chain' && s.foundChoice) return 'found'
  if (s.isMyTurn && s.phase === 'buy_stocks') return 'buy'
  if (s.isMyTurn && s.phase === 'place_tile') return 'place'
  return 'waiting'
}

export interface EventInput {
  /** Identifies the turn: whose turn it is and how many tiles are on the board. */
  turnKey: string
  view: DecisionView
  /** The merger my disposition belongs to, and the defunct chain. */
  disposition?: { seq: number; chain: string } | null
  incomingTradeIds?: string[]
  mergers?: MergerRecord[]
  /** Mergers seen in progress or arriving on this page (`useMergerResult().live`). */
  live?: number[]
}

/**
 * Keys of what needs me or is happening now. A key the page has not seen takes it to the
 * decision tab once (`useGameTabs`): my survivor / founding / buy / disposition decision, a
 * trade offer for me, the latest merger starting and resolving.
 */
export function decisionEvents(i: EventInput): string[] {
  const out: string[] = []
  if (i.view === 'survivor') out.push(`survivor:${i.turnKey}`)
  if (i.view === 'found') out.push(`found:${i.turnKey}`)
  if (i.view === 'buy') out.push(`buy:${i.turnKey}`)
  if (i.disposition) out.push(`disposition:${i.disposition.seq}:${i.disposition.chain}`)
  for (const id of i.incomingTradeIds ?? []) out.push(`trade:${id}`)
  const last = i.mergers?.[i.mergers.length - 1]
  if (last && (i.live ?? []).includes(last.seq)) {
    out.push(`merger:${last.seq}`)
    if (last.complete) out.push(`merger-done:${last.seq}`)
  }
  return out
}

/** "p2:31": whose turn and how many tiles are on the board (one placement per turn). */
export function turnKey(currentPlayer: string | undefined, boardCells: number): string {
  return `${currentPlayer ?? '-'}:${boardCells}`
}
