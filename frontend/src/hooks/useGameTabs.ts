import { useEffect, useState } from 'react'
import { useGameStore } from '../store/gameStore'
import {
  NOW_TAB,
  autoSwitchTarget,
  eventSwitch,
  isBusyTrading,
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
  /** The tab that holds decisions (`board` on phones, `now` on wide screens); null: none. */
  decisionTab?: string | null
  /** Is it my turn to place a tile? (player page) */
  myPlaceTurn?: boolean
  /** The viewer's player id: their own chat lines never count as unread. */
  myId?: string
  /**
   * Keys of what needs me or is happening now (my decisions, offers for me, a merger starting
   * or resolving). A key not seen before takes the page to the decision tab (once), or puts a
   * badge on it (see `eventSwitch`).
   */
  events?: string[]
  /** Injected for tests; default: looks at the chat input on the page. */
  isTyping?: () => boolean
  /**
   * Injected for tests; default: `isBusyTrading` (an offer is being composed, or the Trades tab
   * is open and scrolled). Like typing in the chat: no automatic switch, a badge instead.
   */
  isBusy?: (selected: string) => boolean
}

/**
 * Which tab is open on a game page, and the badges of the others: unread chat, something new
 * in the decision tab, my tile to place while the Board is hidden. The choice is remembered per
 * room for the session. Automatic switches (never while I am typing in the chat, composing a
 * trade or reading down the Trades tab, BL-021): to the Board when my place-tile turn starts on
 * a phone, and to the decision tab once per new event.
 */
export function useGameTabs({
  room,
  scope,
  available,
  fallback,
  decisionTab = NOW_TAB,
  myPlaceTurn = false,
  myId,
  events = [],
  isTyping = isTypingInChat,
  isBusy = isBusyTrading,
}: GameTabsOptions) {
  const key = storageKey(scope, room)
  const [chosen, setChosen] = useState<string | null>(() => readTab(key))
  // A tab remembered from before a reload: what is pending now is not news (badge only).
  const [restored] = useState(() => readTab(key) !== null)
  const selected = visibleTab(chosen, available, fallback)
  const hasBoardTab = available.includes('board')

  useEffect(() => {
    if (chosen !== null) writeTab(key, chosen)
  }, [key, chosen])

  // Auto-switch on the start of my place-tile turn ("adjust state when a prop changes").
  const [wasMyPlaceTurn, setWasMyPlaceTurn] = useState(myPlaceTurn)
  let boardSwitch = false
  if (wasMyPlaceTurn !== myPlaceTurn) {
    setWasMyPlaceTurn(myPlaceTurn)
    const target = autoSwitchTarget({
      wasMyPlaceTurn,
      isMyPlaceTurn: myPlaceTurn,
      selected,
      hasBoardTab,
      typing: isTyping() || isBusy(selected),
    })
    if (target) setChosen(target)
    boardSwitch = target !== null
  }

  // New events: to the decision tab once each, or a badge on it.
  const signature = events.join('|')
  const [prevSignature, setPrevSignature] = useState<string | null>(null)
  const [seen, setSeen] = useState<string[] | null>(null)
  const [nowBadge, setNowBadge] = useState(false)
  if (signature !== prevSignature) {
    setPrevSignature(signature)
    const first = seen === null
    const known = new Set(seen ?? (restored ? events : []))
    const fresh = events.filter((e) => !known.has(e))
    setSeen([...known, ...fresh].slice(-200))
    if (decisionTab !== null) {
      const result = eventSwitch({
        fresh,
        selected,
        typing: isTyping() || isBusy(selected),
        boardSwitch,
        decisionTab,
      })
      if (result.target) setChosen(result.target)
      if (result.badge || (first && restored && events.length > 0 && selected !== decisionTab))
        setNowBadge(true)
    }
  }
  if (nowBadge && selected === decisionTab) setNowBadge(false)

  // Unread chat: lines from others after the last one seen on the Chat tab.
  const messages = useGameStore((s) => s.chatMessages)
  const lastId = messages[messages.length - 1]?.id ?? 0
  const seenKey = `chat-seen:${scope}:${room}`
  // A first visit counts the history sent on connect as read; a reload keeps its own mark (so
  // lines said while the page was away count).
  const historyId = useGameStore((s) => s.chatHistoryId)
  const [stored] = useState(() => readNumber(seenKey))
  const [seenId, setSeenId] = useState(stored ?? 0)
  const floor = stored === null ? Math.max(seenId, historyId) : seenId
  if (selected === 'chat' && seenId < lastId) setSeenId(lastId)
  useEffect(() => writeTab(seenKey, String(floor)), [seenKey, floor])
  const chatUnread = selected === 'chat' ? 0 : unreadCount(messages, floor, myId)

  return {
    selected,
    select: setChosen as (id: string) => void,
    chatUnread,
    /** Something new in the decision tab that I have not looked at. */
    nowBadge: nowBadge && selected !== decisionTab,
    /** My tile to place while the Board tab is not open (phones). */
    boardMarker: hasBoardTab && myPlaceTurn && selected !== 'board',
  }
}
