import { tradeEventText } from '../../lib/eventText'
import { useRules } from '../../ruleset/useRules'
import type { TradeEvent } from '../../store/gameStore'
import styles from './TradeActivity.module.css'

export interface TradeActivityProps {
  /** Trade events, oldest first (the store's `tradeLog`). */
  events: TradeEvent[]
  /** Everyone in the game, keyed by player id. */
  players: Record<string, { name: string }>
  /** How many lines to show (the newest). */
  limit?: number
}

/**
 * The table's recent trade activity in words, newest first: every offer and every answer,
 * whoever the two players are (offers are public). Nothing when there was none.
 */
export function TradeActivity({ events, players, limit = 6 }: TradeActivityProps) {
  const rules = useRules()
  if (events.length === 0) return null
  const names = Object.fromEntries(Object.entries(players).map(([id, p]) => [id, p.name]))
  const shown = events.slice(-limit).reverse()
  return (
    <ul className={styles.list} data-testid="trade-activity" aria-label="Recent trade activity">
      {shown.map((e) => (
        <li key={e.seq} className={styles.line} data-testid={`trade-activity-${e.kind}`}>
          {tradeEventText(
            e.kind,
            (e.trade as unknown as Record<string, unknown>) ??
              (e.fromPlayerId
                ? { from_player_id: e.fromPlayerId, to_player_id: e.toPlayerId }
                : undefined),
            names,
            rules.rs,
            { by: e.byPlayerId, reason: e.reason }
          )}
        </li>
      ))}
    </ul>
  )
}
