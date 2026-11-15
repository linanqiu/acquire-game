import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

/** Distance from the bottom (px) within which the list counts as "at the bottom". */
const STICK_PX = 32

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
  const listRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

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
  const hasBots = seats.some((s) => s.kind === 'bot')

  const lastId = messages[messages.length - 1]?.id ?? 0

  // Follow new messages when the reader is at the bottom; otherwise say there are more.
  // (Syncing React state with the DOM scroll position is what a layout effect is for.)
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el || !active) return
    if (atBottom.current) {
      el.scrollTop = el.scrollHeight
      // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM scroll sync
      setNewBelow(false)
    } else {
      setNewBelow(true)
    }
  }, [lastId, active])

  const onScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX
    if (atBottom.current) setNewBelow(false)
  }, [])

  const jumpToEnd = () => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
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
        <p className={styles.readers} data-testid="chat-readers">
          {readers.length > 0
            ? `AI that reads chat and may answer: ${readers.map((r) => r.name).join(', ')}.`
            : 'No AI at this table reads the chat.'}
          {hasBots ? ' Rules-based bots do not chat.' : ''} Talk is not binding; deals happen
          through trade offers.
        </p>

        <div
          ref={listRef}
          className={styles.list}
          onScroll={onScroll}
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
