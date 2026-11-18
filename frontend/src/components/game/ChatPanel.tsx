import { useEffect, useMemo, useRef, useState } from 'react'
import { useGameStore } from '../../store/gameStore'
import { CHAT_MAX_CHARS, authorBadge, chatReaders, sendChat, type ChatSeat } from '../../lib/chat'
import type { ChatMessage, SeatKind } from '../../types/api'
import { SeatKindBadge } from './SeatKindBadge'
import styles from './ChatPanel.module.css'

export interface ChatPanelProps {
  room: string
  /** `spectator` (the host view) reads only. */
  mode?: 'player' | 'spectator'
  /**
   * In a game page's Chat tab: no card or title, fills the tab (the list grows). `active` is
   * whether the tab is shown; the list jumps to the newest line when it opens.
   */
  inTab?: boolean
  active?: boolean
}

/** Distance from the bottom (px) within which the page counts as "at the bottom". */
const STICK_PX = 32

/** The page is the chat's scroller (BL-019): no box with a scrollbar of its own. */
function pageAtBottom(): boolean {
  const root = document.documentElement
  return root.scrollHeight - window.scrollY - window.innerHeight <= STICK_PX
}

function toPageEnd() {
  if (typeof window.scrollTo === 'function')
    window.scrollTo(0, document.documentElement.scrollHeight)
}

/**
 * Public table chat. Messages arrive over the WebSocket (game store); sending is HTTP.
 * In a game it is the Chat tab (the unread count is on the tab, see `useGameTabs`); in the
 * lobby and on the game-over screen it is a card under the content. Text is rendered as text,
 * never as HTML.
 */
export function ChatPanel({ room, mode = 'player', inTab = false, active = true }: ChatPanelProps) {
  const messages = useGameStore((s) => s.chatMessages)
  const currentPlayer = useGameStore((s) => s.currentPlayer)
  const lobbyPlayers = useGameStore((s) => s.lobbyPlayers)
  const players = useGameStore((s) => s.gameState?.players)
  const myId = mode === 'player' ? currentPlayer?.id : undefined
  const canWrite = mode === 'player' && !!myId

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newBelow, setNewBelow] = useState(false)
  const [about, setAbout] = useState(false)
  /** Was the reader at the foot of the page before the newest message came in? */
  const atBottom = useRef(true)
  const seen = useRef(0)

  const seats: ChatSeat[] = useMemo(() => {
    if (players) {
      return Object.entries(players).map(([id, p]) => ({
        id,
        name: p.name,
        kind: (p.kind ?? (p.is_bot ? 'bot' : 'human')) as SeatKind,
        agentLabel: p.agent_label,
      }))
    }
    return lobbyPlayers.map((p) => ({
      id: p.player_id,
      name: p.name,
      kind: (p.kind ?? (p.is_bot ? 'bot' : 'human')) as SeatKind,
      agentLabel: p.agent_label,
    }))
  }, [players, lobbyPlayers])
  const readers = chatReaders(seats)

  const lastId = messages[messages.length - 1]?.id ?? 0

  // The list is part of the page, which scrolls (BL-019): the newest line is at the foot, next
  // to the input. Where the reader is, is read from the page.
  useEffect(() => {
    atBottom.current = pageAtBottom()
    const onScroll = () => {
      atBottom.current = pageAtBottom()
      if (atBottom.current) setNewBelow(false)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // The Chat tab opens at its foot: the newest line and the input. (A plain effect: it runs
  // after the layout's own "show the top of a tab that opens".)
  useEffect(() => {
    if (!inTab || !active) return
    seen.current = lastId
    toPageEnd()
    atBottom.current = true
    setNewBelow(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the tab opens
  }, [inTab, active])

  // Follow new messages when the reader is at the foot; otherwise say there are more.
  useEffect(() => {
    if (!active || lastId === seen.current) return
    const first = seen.current === 0 && !inTab
    seen.current = lastId
    if (first) return
    if (atBottom.current) {
      toPageEnd()
      setNewBelow(false)
    } else {
      setNewBelow(true)
    }
  }, [lastId, active, inTab])

  const jumpToEnd = () => {
    toPageEnd()
    atBottom.current = true
    setNewBelow(false)
  }

  const send = async () => {
    const text = draft.trim()
    if (!text || !myId || sending) return
    setSending(true)
    setError(null)
    const refused = await sendChat(room, myId, text)
    setSending(false)
    if (refused) {
      setError(refused)
    } else {
      setDraft('')
      atBottom.current = true
    }
  }

  return (
    <section
      className={`${styles.panel} ${inTab ? styles.inTab : ''}`}
      aria-label="Table chat"
      data-testid="chat-panel"
    >
      {!inTab && <h4 className={styles.title}>TABLE CHAT</h4>}
      <div className={styles.body}>
        {/* Who reads the chat at this table; what is true at every table is behind the "?". */}
        <div className={styles.readersRow}>
          <p className={styles.readers} data-testid="chat-readers">
            {readers.length > 0
              ? `${readers.map((r) => r.name).join(', ')} (AI) read${readers.length === 1 ? 's' : ''} the chat and may answer.`
              : 'No AI at this table reads the chat.'}
          </p>
          <button
            type="button"
            className={styles.about}
            onClick={() => setAbout((open) => !open)}
            aria-expanded={about}
            aria-label="About the chat"
            title="About the chat"
            data-testid="chat-about-button"
          >
            ?
          </button>
          {about && (
            <p className={styles.aboutText} data-testid="chat-about">
              The chat is public to the table. Talk is not binding: deals happen through trade
              offers. Rules-based bots never read or write chat.
            </p>
          )}
        </div>

        <div
          className={styles.list}
          role="log"
          aria-live="polite"
          aria-label="Chat messages"
          data-testid="chat-list"
        >
          {messages.length === 0 ? (
            <p className={styles.empty}>No messages yet.</p>
          ) : (
            messages.map((m) => (
              <ChatLine
                key={m.id}
                m={m}
                myId={myId}
                agentLabel={seats.find((s) => s.id === m.player_id)?.agentLabel}
              />
            ))
          )}
        </div>
        {newBelow && (
          <button
            type="button"
            className={styles.newBelow}
            onClick={jumpToEnd}
            data-testid="chat-new-below"
          >
            New messages ↓
          </button>
        )}

        {canWrite ? (
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <input
              className={styles.input}
              value={draft}
              maxLength={CHAT_MAX_CHARS}
              onChange={(e) => {
                setDraft(e.target.value)
                if (error) setError(null)
              }}
              placeholder="Say something to the table"
              aria-label="Chat message"
              data-testid="chat-input"
              disabled={sending}
            />
            <button
              type="submit"
              className={styles.send}
              disabled={sending || !draft.trim()}
              data-testid="chat-send"
            >
              SEND
            </button>
          </form>
        ) : (
          <p className={styles.readOnly} data-testid="chat-read-only">
            {mode === 'spectator'
              ? 'Spectators can read the chat but not write.'
              : 'Join the game to chat.'}
          </p>
        )}
        {draft.length > CHAT_MAX_CHARS - 40 && (
          <p className={styles.count} data-testid="chat-count">
            {draft.length}/{CHAT_MAX_CHARS}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert" data-testid="chat-error">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}

function ChatLine({
  m,
  myId,
  agentLabel,
}: {
  m: ChatMessage
  myId?: string
  agentLabel?: string | null
}) {
  const badge = authorBadge(m, myId)
  return (
    <div
      className={`${styles.message} ${m.player_id === myId ? styles.mine : ''} ${m.kind === 'llm' ? styles.ai : ''}`}
      data-testid="chat-message"
      data-kind={m.kind}
      data-source={m.source}
      data-player-id={m.player_id}
    >
      <span className={styles.author}>
        {m.name}
        {badge && <span className={styles.badge}>{badge}</span>}
        {m.kind !== 'human' && (
          <SeatKindBadge
            playerId={m.player_id}
            kind={m.kind}
            agentLabel={agentLabel}
            playerName={m.name}
          />
        )}
      </span>
      <span className={styles.text}>{m.text}</span>
    </div>
  )
}
