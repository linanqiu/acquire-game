import { useEffect, useState } from 'react'
import { useGameStore } from '../store/gameStore'
import type { MergerRecord } from '../types/api'
import {
  autoSwitchTarget,
  isTypingInChat,
  readTab,
  storageKey,
  unreadCount,
  visibleTab,
  writeTab,
} from '../lib/gameTabs'

function readNumber(key: string): number | null {
  const raw = readTab(key)
  const n = raw === null ? NaN : Number(raw)
  return Number.isFinite(n) ? n : null
}

export interface GameTabsOptions {
  room: string
  /** `player` or `host`: each page remembers its own tab. */
  scope: string
  /** Tab ids present on this layout (phones add `board`). */
  available: string[]
  /** Tab shown when nothing was chosen yet (or the chosen one is not on this layout). */
  fallback: string
  /** Is it my turn to place a tile? (player page) */
  myPlaceTurn?: boolean
  /** The viewer's player id: their own chat lines never count as unread. */
  myId?: string
  mergers?: MergerRecord[]
  /** The tab that holds the merger log (it gets the "merger result arrived" dot). */
  logTab: string
  /** Injected for tests; default: looks at the chat input on the page. */
  isTyping?: () => boolean
}

/**
 * Which tab is open on a game page, and the badges of the others: unread chat, a new merger,
 * my tile to place while the Board is hidden. The choice is remembered per room for the
 * session. The only automatic switch is to the Board when my place-tile turn starts on a
 * phone, and never while I am typing in the chat.
 */
export function useGameTabs({
  room,
  scope,
  available,
  fallback,
  myPlaceTurn = false,
  myId,
  mergers,
  logTab,
  isTyping = isTypingInChat,
}: GameTabsOptions) {
  const key = storageKey(scope, room)
  const [chosen, setChosen] = useState<string | null>(() => readTab(key))
  const selected = visibleTab(chosen, available, fallback)
  const hasBoardTab = available.includes('board')

  useEffect(() => {
    if (chosen !== null) writeTab(key, chosen)
  }, [key, chosen])

  // Auto-switch on the start of my place-tile turn ("adjust state when a prop changes").
  const [wasMyPlaceTurn, setWasMyPlaceTurn] = useState(myPlaceTurn)
  if (wasMyPlaceTurn !== myPlaceTurn) {
    setWasMyPlaceTurn(myPlaceTurn)
    const target = autoSwitchTarget({
      wasMyPlaceTurn,
      isMyPlaceTurn: myPlaceTurn,
      selected,
      hasBoardTab,
      typing: isTyping(),
    })
    if (target) setChosen(target)
  }

  // Unread chat: lines from others after the last one seen on the Chat tab.
  const messages = useGameStore((s) => s.chatMessages)
  const lastId = messages[messages.length - 1]?.id ?? 0
  const seenKey = `chat-seen:${scope}:${room}`
  const [seenId, setSeenId] = useState(() => readNumber(seenKey) ?? 0)
  if (selected === 'chat' && seenId < lastId) setSeenId(lastId)
  useEffect(() => writeTab(seenKey, String(seenId)), [seenKey, seenId])
  const chatUnread = selected === 'chat' ? 0 : unreadCount(messages, seenId, myId)

  // A merger result arrived that the viewer has not looked at in the log yet. Mergers that
  // were there when the page first opened count as seen.
  const maxSeq = mergers?.length ? Math.max(...mergers.map((m) => m.seq)) : 0
  const mergerKey = `merger-seen:${scope}:${room}`
  const [mergerSeen, setMergerSeen] = useState<number | null>(() => readNumber(mergerKey))
  if (mergers && (mergerSeen === null || (selected === logTab && mergerSeen < maxSeq))) {
    setMergerSeen(maxSeq)
  }
  useEffect(() => {
    if (mergerSeen !== null) writeTab(mergerKey, String(mergerSeen))
  }, [mergerKey, mergerSeen])
  const newMerger = mergerSeen !== null && maxSeq > mergerSeen && selected !== logTab

  return {
    selected,
    select: setChosen as (id: string) => void,
    chatUnread,
    newMerger,
    /** My tile to place while the Board tab is not open (phones). */
    boardMarker: hasBoardTab && myPlaceTurn && selected !== 'board',
  }
}
