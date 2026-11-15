/**
 * AI opponent helpers: seat-kind resolution and HTTP calls for the agent
 * catalog / add-seat / remove-seat routes (see docs/architecture/seat-contract.md).
 */

import { fetchWithRetry } from './http'
import type {
  AddSeatResponse,
  AgentCatalogEntry,
  AwaitingDecision,
  FallbackReason,
  SeatFallbacks,
  SeatKind,
} from '../types/api'

interface SeatLike {
  kind?: SeatKind
  is_bot?: boolean
  agent_label?: string | null
}

/** A seat's kind; from `is_bot` when `kind` is missing (transcripts written before it existed). */
export function resolveSeatKind(seat: SeatLike): SeatKind {
  if (seat.kind) return seat.kind
  return seat.is_bot ? 'bot' : 'human'
}

/** Short human-readable label for a seat's kind badge. */
export function seatKindLabel(seat: SeatLike): string {
  const kind = resolveSeatKind(seat)
  if (seat.agent_label) return seat.agent_label
  switch (kind) {
    case 'llm':
      return 'AI'
    case 'bot':
      return 'BOT'
    case 'scripted':
      return 'SCRIPTED'
    default:
      return 'HUMAN'
  }
}

const FALLBACK_REASON_TEXT: Record<FallbackReason, string> = {
  timeout: 'timed out',
  error: 'provider error',
  illegal: 'kept answering illegally',
  cap: 'hit the per-turn action limit',
}

/** Tooltip text for a seat's fallback marker. */
export function describeFallbacks(f: SeatFallbacks): string {
  const times = f.count === 1 ? '1 time' : `${f.count} times`
  const last = f.last_reason
    ? ` (last: ${FALLBACK_REASON_TEXT[f.last_reason] ?? f.last_reason})`
    : ''
  return `Rules-based player moved for this seat ${times}${last}`
}

/** True when the engine is currently waiting on this player and that seat is an AI. */
export function isAiThinking(awaiting: AwaitingDecision | null | undefined, playerId: string) {
  return !!awaiting && awaiting.player_id === playerId && awaiting.kind !== 'human'
}

/** Fetch the AI opponents the server offers. Throws on any failure (old backend: 404). */
export async function fetchAgentCatalog(signal?: AbortSignal): Promise<AgentCatalogEntry[]> {
  const res = await fetchWithRetry('/api/agents/catalog', {}, { signal })
  if (!res.ok) throw new Error(`Catalog request failed (${res.status})`)
  const data: unknown = await res.json()
  if (!Array.isArray(data)) throw new Error('Unexpected catalog response')
  return data as AgentCatalogEntry[]
}

export async function addSeat(room: string, agentId: string): Promise<AddSeatResponse> {
  const res = await fetch(`/api/room/${room}/add-seat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: agentId }),
  })
  if (!res.ok) throw new Error('Failed to add AI opponent')
  return (await res.json()) as AddSeatResponse
}

export async function removeSeat(room: string, playerId: string): Promise<void> {
  const res = await fetch(`/api/room/${room}/remove-seat/${playerId}`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to remove AI opponent')
}
