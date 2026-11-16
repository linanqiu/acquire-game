import type { ReactNode } from 'react'
import styles from './StatusLine.module.css'

export interface StatusLineProps {
  /** What is needed: "Your move: buy shares", "Waiting for Lulu to dispose of their shares". */
  text: string
  /** Is it on me (accent tint)? */
  mine?: boolean
  /** Opens the decision tab; without it the line is plain text. */
  onOpen?: () => void
  /** Controls that act from the line itself (PLACE TILE, END GAME while placing a tile). */
  children?: ReactNode
}

/**
 * The one line under the board (wide) or in the phone dock (BL-011) that names what is needed
 * and jumps to the decision tab, where the decision and its context are.
 */
export function StatusLine({ text, mine = false, onOpen, children }: StatusLineProps) {
  return (
    <div className={styles.status} data-turn={mine ? 'mine' : 'other'} data-testid="status">
      {onOpen ? (
        <button type="button" className={styles.open} onClick={onOpen} data-testid="status-line">
          <span className={styles.text}>{text}</span>
          <span aria-hidden="true" className={styles.arrow}>
            →
          </span>
        </button>
      ) : (
        <span className={styles.text} data-testid="status-line">
          {text}
        </span>
      )}
      {children}
    </div>
  )
}
