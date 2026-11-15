import type { ReactNode } from 'react'
import { Header } from './Header'
import styles from './PageShell.module.css'

interface PageShellProps {
  phase?: string
  /**
   * Whose move the phase line announces: `mine` (the table waits on the viewer: accent tint),
   * `other` (someone else's turn: calm, with a turn marker), or none (lobby, game over).
   * The text always says it too; the tint never carries the meaning alone.
   */
  turn?: 'mine' | 'other'
  /** In-game layout: the shell fills the screen and the page never scrolls (panels scroll). */
  fill?: boolean
  children: ReactNode
  header?: ReactNode
  roomCode?: string
  cash?: number
  netWorth?: number
  rank?: number
  playerName?: string
  tilePool?: number | 'EMPTY'
}

export function PageShell({
  phase,
  turn,
  fill = false,
  children,
  header,
  roomCode,
  cash,
  netWorth,
  rank,
  playerName,
  tilePool,
}: PageShellProps) {
  return (
    <div className={`${styles.shell} ${fill ? styles.fill : ''}`}>
      {header !== undefined ? (
        header
      ) : (
        <Header
          roomCode={roomCode}
          cash={cash}
          netWorth={netWorth}
          rank={rank}
          playerName={playerName}
          tilePool={tilePool}
        />
      )}
      {phase && (
        <div
          className={`${styles.phase} ${turn ? styles[turn] : ''}`}
          data-turn={turn}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="game-phase"
        >
          {phase}
        </div>
      )}
      <main className={styles.main}>{children}</main>
    </div>
  )
}
