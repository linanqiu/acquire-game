/**
 * Tab state of the game pages (pure rules; `useGameTabs` holds the state). See BL-008 and
 * BL-011 (the decision tab and its automatic switch).
 */
import type { ChatMessage } from '../types/api'

export type GameTabId = 'board' | 'now' | 'players' | 'chains' | 'chat' | 'trades' | 'log'

/** The decision tab: what needs me / what is happening now (BL-011). */
export const NOW_TAB = 'now'

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

export interface EventSwitchInput {
  /** Events (decision or merger keys) not seen before on this page. */
  fresh: string[]
  selected: string
  /** Is the user typing in the chat (input focused or a draft written)? */
  typing: boolean
  /** Did the Board switch fire on this same update (my place-tile turn started)? */
  boardSwitch: boolean
}

/**
 * Something new needs me or is happening (a decision of mine, a trade offer for me, a merger
 * starting or resolving): go to the decision tab, once per event. Not while I am typing in the
 * chat, and not when my place-tile turn takes me to the Board at the same moment: a badge on
 * the decision tab instead. Nothing when the decision tab is already open.
 */
export function eventSwitch(s: EventSwitchInput): {
  target: typeof NOW_TAB | null
  badge: boolean
} {
  if (s.fresh.length === 0 || s.selected === NOW_TAB) return { target: null, badge: false }
  if (s.typing || s.boardSwitch) return { target: null, badge: true }
  return { target: NOW_TAB, badge: false }
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
