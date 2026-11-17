import type { ReactNode } from 'react'
import styles from './StatusLine.module.css'

export interface StatusLineProps {
  /** What the controls act on: "Place 6C?", "The game can end now". */
  text: string
  /** Is it on me (accent tint)? */
  mine?: boolean
  /** Controls that act from the line itself (PLACE TILE, END GAME while placing a tile). */
  children?: ReactNode
}

/**
 * The line over the rack (under the board on wide screens) that carries PLACE TILE and END GAME
 * while I place a tile. It is not a status display: what the game waits for is said once, in
 * the phase bar, which is also the way back to the board from another tab (BL-017).
 */
export function StatusLine({ text, mine = false, children }: StatusLineProps) {
  return (
    <div className={styles.status} data-turn={mine ? 'mine' : 'other'} data-testid="status">
      <span className={styles.text} data-testid="status-line">
        {text}
      </span>
      {children}
    </div>
  )
}
