/**
 * Tab state of the game pages (pure rules; `useGameTabs` holds the state). See BL-008.
 */
import type { ChatMessage } from '../types/api'

export type GameTabId = 'board' | 'players' | 'chains' | 'chat' | 'trades' | 'log'

/** Wide screens (tablets and up): board on the left, a tabbed sidebar on the right. */
export const WIDE_QUERY = '(min-width: 768px)'

export function storageKey(scope: string, room: string): string {
  return `tab:${scope}:${room}`
}

export function readTab(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeTab(key: string, id: string): void {
  try {
    sessionStorage.setItem(key, id)
  } catch {
    // Storage unavailable (private window): the choice lasts until the page is left.
  }
}

/** The tab to show: the chosen one when it exists on this layout, else the default. */
export function visibleTab<T extends string>(
  chosen: string | null,
  available: T[],
  fallback: T
): T {
  return chosen !== null && (available as string[]).includes(chosen) ? (chosen as T) : fallback
}

export interface AutoSwitchInput {
  /** Was it my turn to place a tile on the previous render? */
  wasMyPlaceTurn: boolean
  /** Is it now? */
  isMyPlaceTurn: boolean
  selected: string
  /** Does this layout have a Board tab (phones)? */
  hasBoardTab: boolean
  /** Is the user typing in the chat (input focused or a draft written)? */
  typing: boolean
}

/**
 * The only automatic switch: to the Board when my place-tile turn starts on a phone, unless I
 * am typing in the chat. Returns the tab to switch to, or null to stay.
 */
export function autoSwitchTarget(s: AutoSwitchInput): GameTabId | null {
  if (!s.hasBoardTab || s.typing) return null
  if (s.isMyPlaceTurn && !s.wasMyPlaceTurn && s.selected !== 'board') return 'board'
  return null
}

/** Chat messages from others newer than `seenId`. */
export function unreadCount(messages: ChatMessage[], seenId: number, myId?: string): number {
  return messages.filter((m) => m.id > seenId && m.player_id !== myId).length
}

/** True while the chat input on the page has focus or holds a draft. */
export function isTypingInChat(): boolean {
  if (typeof document === 'undefined') return false
  const input = document.querySelector<HTMLInputElement>('[data-testid="chat-input"]')
  return !!input && (document.activeElement === input || input.value.trim() !== '')
}

/** Short tab label from the ruleset's plural chain noun: "hotel chains" -> "Chains". */
export function shortLabel(plural: string): string {
  const word = plural.trim().split(/\s+/).pop() ?? plural
  return word.charAt(0).toUpperCase() + word.slice(1)
}
