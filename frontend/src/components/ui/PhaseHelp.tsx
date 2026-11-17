import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import styles from './PhaseHelp.module.css'

export interface PhaseHelpProps {
  /** What the "?" explains: the hint of the moment and how to read the table. */
  children: ReactNode
  /** Draw the "?" in the accent colour: there is something here the player has not read yet. */
  fresh?: boolean
}

/**
 * The "?" at the end of the phase bar (BL-014). Instructions and legends used to take a line
 * each on the Board tab of a phone; they live here now and cost no height. A tap opens a small
 * panel under the bar; a tap outside, Escape or the "?" again closes it.
 */
export function PhaseHelp({ children, fresh = false }: PhaseHelpProps) {
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

  return (
    <div ref={root} className={styles.help}>
      <button
        ref={button}
        type="button"
        className={styles.button}
        data-fresh={fresh && !open ? 'true' : undefined}
        aria-label="How this works"
        title="How this works"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-testid="phase-help"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.mark} aria-hidden="true">
          ?
        </span>
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="How this works"
          className={styles.panel}
          data-testid="phase-help-panel"
        >
          {children}
        </div>
      )}
    </div>
  )
}
