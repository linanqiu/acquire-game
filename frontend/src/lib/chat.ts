/**
 * Table chat helpers: the send route (HTTP; messages arrive over the WebSocket) and who
 * at the table reads the chat. See docs/architecture/seat-contract.md, "Table chat".
 */

import type { ChatMessage, SeatKind } from '../types/api'

/** Server-side cap on a message (longer ones are refused). */
export const CHAT_MAX_CHARS = 280

export interface ChatSeat {
  id: string
  name: string
  kind: SeatKind
  /** Catalog label of an AI seat (the model), for the author's seat badge. */
  agentLabel?: string | null
}

/**
 * Post a message as a human seat. Resolves to null on success, or the reason it was
 * refused (shown under the input). Not retried: a retried POST could post twice.
 */
export async function sendChat(
  room: string,
  playerId: string,
  text: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `/api/room/${encodeURIComponent(room)}/chat/${encodeURIComponent(playerId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }
    )
    if (res.ok) return null
    let detail = ''
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // not JSON
    }
    if (res.status === 429) return detail || 'You are sending messages too fast; wait a moment'
    return detail || `Message not sent (HTTP ${res.status})`
  } catch {
    return 'Message not sent: no connection to the server'
  }
}

/** Seats whose AI reads the table chat and may answer (LLM seats; rules-based bots do not). */
export function chatReaders(seats: ChatSeat[]): ChatSeat[] {
  return seats.filter((s) => s.kind === 'llm')
}

/**
 * Short text badge for a message's author: "YOU" for my own lines, else nothing (an AI author
 * gets the seat badge icon instead, BL-020).
 */
export function authorBadge(m: Pick<ChatMessage, 'kind' | 'player_id'>, myId?: string): string {
  if (myId && m.player_id === myId) return 'YOU'
  return ''
}
