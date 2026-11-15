import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { describeFallbacks, describeSeat, resolveSeatKind } from '../../lib/agents'
import styles from './SeatKindBadge.module.css'
import type { SeatFallbacks, SeatKind } from '../../types/api'

export interface SeatKindBadgeProps {
  playerId: string
  kind?: SeatKind
  isBot?: boolean
  agentLabel?: string | null
  /** When `count > 0` a small marker shows the rules-based bot played for this seat. */
  fallbacks?: SeatFallbacks
  /** The seat's name, shown as the popover's title. */
  playerName?: string
  /**
   * `false` inside another control (the trade builder's partner buttons, a link): a plain icon
   * with the same accessible name, no popover (a button cannot hold a button).
   */
  interactive?: boolean
}

/** Small inline icons (no icon library): a robot head for the bot, a spark for an LLM. */
export function SeatKindIcon({ kind }: { kind: SeatKind }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    'aria-hidden': true,
    focusable: false,
    className: styles.icon,
  } as const
  if (kind === 'llm') {
    return (
      <svg {...common}>
        <path d="M8 1.5 9.5 6.5 14.5 8 9.5 9.5 8 14.5 6.5 9.5 1.5 8 6.5 6.5Z" fill="currentColor" />
        <circle cx="13" cy="3" r="1.3" fill="currentColor" />
      </svg>
    )
  }
  if (kind === 'scripted') {
    return (
      <svg {...common}>
        <path
          d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M8 1.2v2.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="1.6" r="1.1" fill="currentColor" />
      <rect x="2.5" y="4.2" width="11" height="9" rx="2.4" fill="currentColor" />
      <circle cx="5.9" cy="8.3" r="1.3" className={styles.eye} />
      <circle cx="10.1" cy="8.3" r="1.3" className={styles.eye} />
      <path d="M6 11.2h4" stroke="var(--bg-primary)" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

const GAP = 6
const MARGIN = 8

interface Pos {
  top: number
  left: number
  placement: 'below' | 'above'
}

/**
 * The kind of an AI seat as one small icon button. Clicking, tapping, Enter or Space opens a
 * popover saying what the seat is ("AI player · Claude Haiku 5.5", "Reads the table chat";
 * "Rules-based bot · does not chat"); click outside or Escape closes it. The popover is rendered
 * into `document.body` with fixed positioning, clamped to the viewport, so the tab panels and the
 * phone's fixed bottom bar never clip it. Renders nothing for human seats. The "BOT ASSIST xN"
 * fallback marker stays a separate element next to it.
 */
export function SeatKindBadge({
  playerId,
  kind,
  isBot,
  agentLabel,
  fallbacks,
  playerName,
  interactive = true,
}: SeatKindBadgeProps) {
  const seat = { kind, is_bot: isBot, agent_label: agentLabel }
  const resolved = resolveSeatKind(seat)
  const fallbackCount = fallbacks?.count ?? 0
  if (resolved === 'human') return null
  const info = describeSeat(seat)
  return (
    <>
      {interactive ? (
        <SeatBadgeButton playerId={playerId} info={info} playerName={playerName} />
      ) : (
        <span
          className={`${styles.badge} ${styles[resolved]} ${styles.static}`}
          data-testid={`seat-kind-${playerId}`}
          data-kind={resolved}
          role="img"
          aria-label={info.label}
          title={[info.headline, info.detail].filter(Boolean).join('. ')}
        >
          <SeatKindIcon kind={resolved} />
        </span>
      )}
      {fallbacks && fallbackCount > 0 && (
        <span
          className={styles.fallback}
          data-testid={`seat-fallback-${playerId}`}
          data-count={fallbackCount}
          title={describeFallbacks(fallbacks)}
          aria-label={describeFallbacks(fallbacks)}
          role="img"
        >
          BOT ASSIST &times;{fallbackCount}
        </span>
      )}
    </>
  )
}

function SeatBadgeButton({
  playerId,
  info,
  playerName,
}: {
  playerId: string
  info: ReturnType<typeof describeSeat>
  playerName?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const popId = useId()

  const place = useCallback(() => {
    const b = buttonRef.current
    const p = popRef.current
    if (!b || !p) return
    const r = b.getBoundingClientRect()
    const vw = document.documentElement.clientWidth || window.innerWidth
    const vh = window.innerHeight
    const w = p.offsetWidth
    const h = p.offsetHeight
    const left = Math.min(Math.max(MARGIN, r.left + r.width / 2 - w / 2), vw - w - MARGIN)
    const below = r.bottom + GAP
    const fitsBelow = below + h <= vh - MARGIN
    const above = r.top - GAP - h
    const placement = fitsBelow || above < MARGIN ? 'below' : 'above'
    const top = placement === 'below' ? Math.min(below, Math.max(MARGIN, vh - h - MARGIN)) : above
    setPos({ top, left: Math.max(MARGIN, left), placement })
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setPos(null)
  }, [])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent | MouseEvent) => {
      const t = e.target as Node | null
      if (t && (buttonRef.current?.contains(t) || popRef.current?.contains(t))) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
        buttonRef.current?.focus()
      }
    }
    const onMove = () => place()
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, place, close])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.badge} ${styles[info.kind]}`}
        data-testid={`seat-kind-${playerId}`}
        data-kind={info.kind}
        aria-label={info.label}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? popId : undefined}
        onClick={(e) => {
          e.stopPropagation()
          if (open) close()
          else setOpen(true)
        }}
      >
        <span className={styles.face}>
          <SeatKindIcon kind={info.kind} />
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            id={popId}
            role="dialog"
            aria-label={playerName ? `About ${playerName}` : 'About this seat'}
            className={styles.popover}
            data-testid={`seat-popover-${playerId}`}
            data-placement={pos?.placement}
            style={
              pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }
            }
          >
            {playerName && <p className={styles.popName}>{playerName}</p>}
            <p className={styles.popHeadline}>{info.headline}</p>
            {info.detail && <p className={styles.popDetail}>{info.detail}</p>}
          </div>,
          document.body
        )}
    </>
  )
}
