import { useCallback, useState } from 'react'
import { useGameStore } from '../../store/gameStore'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { WIDE_QUERY } from '../../lib/gameTabs'
import { setCommentary } from '../../lib/lobby'
import { useToast } from '../ui/useToast'
import type { CommentaryLine } from '../../types/api'
import styles from './Commentary.module.css'

/** Lines the strip shows on a wide screen (the latest and the two before it); phones: one. */
const STRIP_LINES_WIDE = 3
/** Earlier lines listed in the Log tab. */
const LOG_LINES = 40

/** How many of the newest lines the strip shows at this screen width. */
function useStripLines(): number {
  return useMediaQuery(WIDE_QUERY) ? STRIP_LINES_WIDE : 1
}

function useToggle(room: string) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const toggle = useCallback(
    async (enabled: boolean) => {
      setBusy(true)
      try {
        // The new setting comes back over the socket (`commentary_history`).
        await setCommentary(room, enabled)
      } catch {
        toast('Could not change the commentary setting', 'error')
      } finally {
        setBusy(false)
      }
    },
    [room, toast]
  )
  return { busy, toggle }
}

/** "rules" under a templated line, nothing under a model's: said once, quietly. */
function sourceNote(line: CommentaryLine | undefined, mode: string): string {
  const source = line?.source ?? mode
  return source === 'model' ? 'model' : 'rules'
}

/**
 * The commentary strip of the watch page (LO-014): the commentator's latest line, large enough
 * to read from across a room on a big screen, and the two before it, quieter. A new line takes
 * the top place by itself. Phones: one compact line above the tab bar (the earlier ones are in
 * the Log tab). It has a fixed height, so the board does not move when a line arrives.
 * Nothing is rendered while commentary is off: the switch is then in the Log tab.
 */
export function CommentaryStrip({ room }: { room: string }) {
  const commentary = useGameStore((s) => s.commentary)
  const shown = useStripLines()
  const { busy, toggle } = useToggle(room)
  if (!commentary?.enabled) return null
  const lines = commentary.lines
  const latest = lines[lines.length - 1]
  const earlier = lines.slice(-shown, -1).reverse()
  const note = sourceNote(latest, commentary.mode)
  return (
    <section
      className={styles.strip}
      aria-label="Commentary"
      data-testid="commentary-strip"
      data-source={note}
    >
      <div className={styles.head}>
        <span className={styles.label}>COMMENTARY</span>
        <span
          className={styles.source}
          data-testid="commentary-source"
          title={
            note === 'model'
              ? 'Written by the commentary model from the game engine’s facts'
              : 'Templated from the game engine’s facts (no model)'
          }
        >
          {note}
        </span>
        <button
          type="button"
          className={styles.switch}
          onClick={() => void toggle(false)}
          disabled={busy}
          aria-label="Turn commentary off"
          data-testid="commentary-off"
        >
          OFF
        </button>
      </div>
      {/* aria-live: a screen reader hears each new line once. */}
      <div className={styles.lines} aria-live="polite">
        {latest ? (
          <p
            key={latest.id}
            className={styles.latest}
            data-testid="commentary-line"
            data-line-id={latest.id}
          >
            {latest.text}
          </p>
        ) : (
          <p className={`${styles.latest} ${styles.waiting}`} data-testid="commentary-waiting">
            The commentary starts with the first notable move.
          </p>
        )}
      </div>
      {shown > 1 && (
        <ol className={styles.earlier} aria-label="Earlier lines" data-testid="commentary-earlier">
          {earlier.map((l) => (
            <li key={l.id} className={styles.earlierLine} title={l.text} data-line-id={l.id}>
              {l.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * Commentary in the host's Log tab: the switch while it is off, and the lines that are no
 * longer in the strip (each line is on the page once), newest first.
 */
export function CommentaryLog({ room }: { room: string }) {
  const commentary = useGameStore((s) => s.commentary)
  const shown = useStripLines()
  const { busy, toggle } = useToggle(room)
  if (!commentary) return null
  if (!commentary.enabled) {
    return (
      <section aria-label="Commentary" className={styles.log} data-testid="commentary-log">
        <h4 className={styles.logTitle}>COMMENTARY</h4>
        <p className={styles.offLine}>
          <span>Off for this room.</span>
          <button
            type="button"
            className={styles.switch}
            onClick={() => void toggle(true)}
            disabled={busy}
            data-testid="commentary-on"
          >
            TURN ON
          </button>
        </p>
      </section>
    )
  }
  const earlier = commentary.lines.slice(0, -shown).slice(-LOG_LINES).reverse()
  if (earlier.length === 0) return null
  return (
    <section aria-label="Earlier commentary" className={styles.log} data-testid="commentary-log">
      <h4 className={styles.logTitle}>EARLIER COMMENTARY</h4>
      <ol className={styles.logList}>
        {earlier.map((l) => (
          <li
            key={l.id}
            className={styles.logLine}
            data-testid="commentary-log-line"
            data-line-id={l.id}
          >
            <span className={styles.turn}>T{l.turn}</span>
            <span>{l.text}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/**
 * The commentator's last word over the final standings: the line about the result. Nothing
 * until it has arrived (a model takes a second or two after the game ended), and nothing when
 * commentary is off.
 */
export function CommentaryFinal() {
  const commentary = useGameStore((s) => s.commentary)
  const last = commentary?.enabled ? commentary.lines[commentary.lines.length - 1] : undefined
  const latest = last?.moments?.includes('game_ended') ? last : undefined
  if (!latest) return null
  return (
    <p
      className={styles.final}
      aria-live="polite"
      data-testid="commentary-final"
      data-source={latest.source}
    >
      {latest.text}
    </p>
  )
}
