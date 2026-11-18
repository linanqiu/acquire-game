import { useRef, type ReactNode } from 'react'
import { useHeightVar } from '../../hooks/useHeightVar'
import { Header } from './Header'
import { PhaseHelp } from './PhaseHelp'
import styles from './PageShell.module.css'

interface PageShellProps {
  phase?: string
  /**
   * Whose move the phase line announces: `mine` (the table waits on the viewer: accent tint),
   * `other` (someone else's turn: calm, with a turn marker), or none (lobby, game over).
   * The text always says it too; the tint never carries the meaning alone.
   */
  turn?: 'mine' | 'other'
  /**
   * In-game layout: the header and phase bar stay at the top while the page scrolls (their
   * height is handed to the layout below as --chrome-top), and the layout gets the rest.
   */
  fill?: boolean
  children: ReactNode
  header?: ReactNode
  roomCode?: string
  cash?: number
  netWorth?: number
  rank?: number
  playerName?: string
  tilePool?: number | 'EMPTY'
  /**
   * Shown behind a "?" at the end of the phase bar (BL-014): the hint of the moment and how to
   * read the table. It costs no height, unlike a line of instructions on the page.
   */
  help?: ReactNode
  /** The "?" is drawn in the accent colour: the player has not done what it explains yet. */
  helpFresh?: boolean
  /** In a game (see `Header`). */
  inGame?: boolean
  /** The in-game menu's room (see `Header`). */
  menuRoom?: string
  /**
   * The phase bar as the way to the decision (BL-017): set while a move of mine waits on a tab
   * that is not open. The bar becomes a button, with `label` ("Board") and an arrow at its end.
   */
  phaseLink?: { label: string; onOpen: () => void }
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
  help,
  helpFresh,
  inGame,
  menuRoom,
  phaseLink,
}: PageShellProps) {
  const shell = useRef<HTMLDivElement>(null)
  const top = useRef<HTMLDivElement>(null)
  useHeightVar(top, shell, '--chrome-top', fill)
  return (
    <div ref={shell} className={`${styles.shell} ${fill ? styles.fill : ''}`}>
      <div ref={top} className={styles.top}>
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
            inGame={inGame}
            menuRoom={menuRoom}
          />
        )}
        {phase && (
          <div className={styles.phaseBar}>
            <div
              className={`${styles.phase} ${turn ? styles[turn] : ''}`}
              data-turn={turn}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              data-testid="game-phase"
            >
              {phaseLink ? (
                <button
                  type="button"
                  className={styles.phaseLink}
                  onClick={phaseLink.onOpen}
                  aria-label={`${phase}. Go to ${phaseLink.label}`}
                  data-go={phaseLink.label}
                  data-testid="phase-link"
                >
                  {/* The text stays the phase alone (it is what the status region announces);
                    the tab's name and arrow are drawn after it from data-go, and are in the
                    button's accessible name. */}
                  {phase}
                </button>
              ) : (
                phase
              )}
            </div>
            {help && <PhaseHelp fresh={helpFresh}>{help}</PhaseHelp>}
          </div>
        )}
      </div>
      <main className={styles.main}>{children}</main>
    </div>
  )
}
