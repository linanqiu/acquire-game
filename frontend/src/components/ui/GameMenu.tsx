import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShareRoom } from '../game/ShareRoom'
import { ThemeToggle } from './ThemeToggle'
import { useBrand, useRules } from '../../ruleset/useRules'
import styles from './GameMenu.module.css'

export interface GameMenuProps {
  /** The room: its code and the invite link are in the menu. */
  room?: string
}

/**
 * The in-game menu (BL-019): what a player needs now and then, out of the header so the header
 * carries only what changes. The button replaces the wordmark on phones (on wide screens the
 * wordmark is its label). It opens a small panel under the header: the room code and Invite,
 * the theme switch, the rules in brief, and the way home. A tap outside, Escape or the button
 * again closes it; nothing in normal play opens it.
 */
export function GameMenu({ room }: GameMenuProps) {
  const brand = useBrand()
  const rules = useRules()
  const { rs, theme } = rules
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent | MouseEvent) => {
      if (root.current?.contains(e.target as Node | null)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const chains = theme.chain_noun_plural
  const shares = theme.share_noun_plural

  return (
    <div ref={root} className={styles.menu}>
      <button
        ref={button}
        type="button"
        className={styles.button}
        aria-label="Menu"
        title="Menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        data-testid="header-menu-button"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M4 7h16M4 12h16M4 17h16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <span className={styles.brand} data-testid="header-title">
          {brand.toUpperCase()}
        </span>
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Menu"
          className={styles.panel}
          data-testid="header-menu"
        >
          {room && (
            <div className={styles.section}>
              <ShareRoom room={room} testIdPrefix="menu" />
            </div>
          )}
          <div className={`${styles.section} ${styles.row}`}>
            <span>Theme</span>
            <ThemeToggle testId="menu-theme-toggle" />
          </div>
          <details className={styles.section} data-testid="menu-rules">
            <summary className={styles.summary}>Rules in brief</summary>
            <ul className={styles.rules}>
              <li>
                Place a tile, then buy up to {rs.max_stock_purchases_per_turn} {shares} of {chains}{' '}
                on the board.
              </li>
              <li>
                Founding a {theme.chain_noun} gives {rs.founder_bonus_shares} free{' '}
                {rs.founder_bonus_shares === 1 ? theme.share_noun : shares}.
              </li>
              <li>
                In a {theme.merger_noun} the larger {theme.chain_noun} takes over; holders of the
                smaller are paid bonuses (1st and 2nd most {shares}), then sell, trade{' '}
                {rs.merger_trade_ratio}:1 or keep.
              </li>
              <li>
                A {theme.chain_noun} of {rs.safe_chain_size} tiles is {theme.safe_phrase}: it cannot
                be taken over.
              </li>
              <li>
                The game can be ended when a {theme.chain_noun} reaches {rs.end_game_chain_size}{' '}
                tiles or every {theme.chain_noun} is {theme.safe_phrase}. Most money wins.
              </li>
            </ul>
          </details>
          <Link to="/" className={`${styles.section} ${styles.leave}`} data-testid="menu-leave">
            Leave to the home page
            <span className={styles.note}>Your seat stays in the game: Back returns to it.</span>
          </Link>
        </div>
      )}
    </div>
  )
}
