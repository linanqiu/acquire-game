import type { ReactNode } from 'react'
import { Header } from './Header'
import styles from './PageShell.module.css'

interface PageShellProps {
  phase?: string
  footer?: ReactNode
  children: ReactNode
  header?: ReactNode
  roomCode?: string
  cash?: number
  playerName?: string
  tilePool?: number | 'EMPTY'
}

export function PageShell({
  phase,
  footer,
  children,
  header,
  roomCode,
  cash,
  playerName,
  tilePool,
}: PageShellProps) {
  return (
    <div className={styles.shell}>
      {header !== undefined ? (
        header
      ) : (
        <Header roomCode={roomCode} cash={cash} playerName={playerName} tilePool={tilePool} />
      )}
      {phase && (
        <div
          className={styles.phase}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="game-phase"
        >
          {phase}
        </div>
      )}
      <main className={styles.main}>{children}</main>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </div>
  )
}
