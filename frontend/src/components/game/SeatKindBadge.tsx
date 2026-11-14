import { Badge } from '../ui/Badge'
import type { BadgeVariant } from '../ui/Badge'
import { describeFallbacks, resolveSeatKind, seatKindLabel } from '../../lib/agents'
import styles from './SeatKindBadge.module.css'
import type { SeatFallbacks, SeatKind } from '../../types/api'

export interface SeatKindBadgeProps {
  playerId: string
  kind?: SeatKind
  isBot?: boolean
  agentLabel?: string | null
  /** When `count > 0` a small marker shows the rules-based bot played for this seat. */
  fallbacks?: SeatFallbacks
  /** The seat's display name: when the agent label is the same text it is not repeated. */
  playerName?: string
}

const VARIANTS: Record<SeatKind, BadgeVariant> = {
  human: 'default',
  bot: 'warning',
  llm: 'safe',
  scripted: 'info',
}

/** Badge showing what occupies a seat. Renders nothing for human seats. */
export function SeatKindBadge({
  playerId,
  kind,
  isBot,
  agentLabel,
  fallbacks,
  playerName,
}: SeatKindBadgeProps) {
  // An AI seat is usually named after its agent ("Fake LLM (test)"): show the kind, not the
  // same words twice.
  const repeatsName = !!agentLabel && !!playerName && agentLabel.trim() === playerName.trim()
  const seat = { kind, is_bot: isBot, agent_label: repeatsName ? null : agentLabel }
  const resolved = resolveSeatKind(seat)
  if (resolved === 'human') return null
  const fallbackCount = fallbacks?.count ?? 0
  return (
    <>
      <span data-testid={`seat-kind-${playerId}`} data-kind={resolved}>
        <Badge label={seatKindLabel(seat)} variant={VARIANTS[resolved]} />
      </span>
      {fallbacks && fallbackCount > 0 && (
        <span
          className={styles.fallback}
          data-testid={`seat-fallback-${playerId}`}
          data-count={fallbackCount}
          title={describeFallbacks(fallbacks)}
          aria-label={describeFallbacks(fallbacks)}
          role="img"
        >
          BOT ASSIST &times;{fallbackCount}
        </span>
      )}
    </>
  )
}
