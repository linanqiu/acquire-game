import { Children, useState, type ReactNode } from 'react'
import styles from './ChatSlot.module.css'

/**
 * The place reserved for the table chat (ChatPanel, built on another branch). Wide screens: its
 * children show as a card in the side column. Phones: they fold behind a CHAT button in the page
 * flow (never floating over the board or the tile rack). Renders nothing while empty.
 */
export function ChatSlot({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  if (Children.count(children) === 0) return null
  return (
    <section className={`${styles.slot} ${open ? styles.open : ''}`} aria-label="Chat">
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? 'CHAT ▲' : 'CHAT ▼'}
      </button>
      <div className={styles.body}>{children}</div>
    </section>
  )
}
