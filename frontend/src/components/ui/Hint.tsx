import { useState, type ReactNode } from 'react'
import { hintSeen } from '../../lib/hints'
import styles from './Hint.module.css'

export interface HintProps {
  /** Stable id: `markHintSeen(id)` (called when the player has done the thing) retires it. */
  id: string
  /** Once seen, show nothing at all (for an instruction nobody needs twice). */
  retire?: boolean
  children: ReactNode
}

/**
 * An instruction that is only worth reading once (BL-013). Shown in full until the player has
 * done what it explains (`markHintSeen`, remembered in this browser); after that it is a small
 * "?" button that brings the text back, so the words are out of the way but never lost.
 */
export function Hint({ id, retire = false, children }: HintProps) {
  const [open, setOpen] = useState(() => !hintSeen(id))
  if (!open && retire) return null
  if (!open) {
    return (
      <button
        type="button"
        className={styles.button}
        onClick={() => setOpen(true)}
        aria-expanded={false}
        aria-label="How this works"
        title="How this works"
        data-testid={`hint-button-${id}`}
      >
        ?
      </button>
    )
  }
  return (
    <p className={styles.hint} data-testid={`hint-${id}`}>
      {children}
    </p>
  )
}
