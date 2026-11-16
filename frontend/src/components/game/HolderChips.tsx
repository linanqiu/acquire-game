import type { GameStateMessage } from '../../types/api'
import styles from './HolderChips.module.css'

export interface HolderChip {
  player_id: string
  shares: number
  role?: 'majority' | 'minority' | null
  tied?: boolean
}

export interface HolderChipsProps {
  holders: HolderChip[]
  players: GameStateMessage['players']
  /** The viewer: shown as "you", highlighted, always listed (with 0 when not holding). */
  me?: string
  /** My shares after the purchase / trade being prepared ("3→5"). */
  myNext?: number
  /** Test id prefix: chips are `${testId}-${player_id}`. */
  testId: string
}

const ROLE: Record<string, string> = { majority: '1st', minority: '2nd' }

/** First word, at most 8 letters: chips must fit a phone row. */
function short(name: string): string {
  const first = name.split(/\s+/)[0] ?? name
  return first.length > 8 ? `${first.slice(0, 7)}…` : first
}

/**
 * Who holds a chain, most shares first, in one wrapping line: "1st Bob 9 · 2nd Cara 5 · you 3".
 * The 1st / 2nd marks are the server's roles (the engine's bonus code); "=" marks a tie.
 */
export function HolderChips({ holders, players, me, myNext, testId }: HolderChipsProps) {
  const rows = holders.filter((h) => h.shares > 0 || h.player_id === me)
  if (me && !rows.some((h) => h.player_id === me)) rows.push({ player_id: me, shares: 0 })
  if (rows.length === 0) return <span className={styles.none}>nobody holds any</span>
  return (
    <span className={styles.chips} data-testid={testId}>
      {rows.map((h) => {
        const mine = h.player_id === me
        const name = mine ? 'you' : short(players[h.player_id]?.name ?? '?')
        const next = mine && myNext !== undefined && myNext !== h.shares ? myNext : null
        return (
          <span
            key={h.player_id}
            className={`${styles.chip} ${mine ? styles.me : ''}`}
            data-testid={`${testId}-${h.player_id}`}
            data-shares={h.shares}
            title={players[h.player_id]?.name}
          >
            {h.role && (
              <span className={styles.role}>
                {h.tied ? '=' : ''}
                {ROLE[h.role]}
              </span>
            )}
            <span className={styles.name}>{name}</span>
            <span className={styles.num}>
              {h.shares}
              {next !== null && <>→{next}</>}
            </span>
          </span>
        )
      })}
    </span>
  )
}
