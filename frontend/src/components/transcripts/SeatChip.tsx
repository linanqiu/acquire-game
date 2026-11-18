import { Badge, type BadgeVariant } from '../ui/Badge'
import { resolveSeatKind } from '../../lib/agents'
import { SeatKindBadge } from '../game/SeatKindBadge'
import type { DecisionSource, SummarySeat } from '../../types/transcripts'
import styles from './SeatChip.module.css'

interface SeatChipProps {
  seat: Pick<SummarySeat, 'player_id' | 'name' | 'kind' | 'agent_label' | 'model'>
  winner?: boolean
  /**
   * One line, as in the game's players table (BL-019): the seat's name and its kind icon (the
   * model is the icon's label and is spelled out by the caller), cut with an ellipsis rather
   * than wrapped.
   */
  oneLine?: boolean
}

/**
 * A seat in the transcript pages and the games list. These pages compare models, so an AI seat
 * shows its model as the primary text and its character name ("Baron Brick") second, with the
 * kind as a small icon (BL-010). A human seat shows the name only. The icon is not a button:
 * the chip can sit inside a link (games list) and already spells the model out.
 */
export function SeatChip({ seat, winner = false, oneLine = false }: SeatChipProps) {
  const model = seat.agent_label || seat.model || ''
  const isAi = resolveSeatKind(seat) !== 'human'
  const primary = isAi && model && !oneLine ? model : seat.name
  const secondary = isAi && model && model !== seat.name && !oneLine ? seat.name : null
  return (
    <span
      className={`${styles.chip} ${winner ? styles.winner : ''} ${oneLine ? styles.oneLine : ''}`}
      data-testid={`seat-chip-${seat.player_id}`}
    >
      {winner && (
        <span className={styles.crown} role="img" aria-label="Winner">
          ★
        </span>
      )}
      <span className={styles.name}>{primary}</span>
      <SeatKindBadge
        playerId={seat.player_id}
        kind={seat.kind}
        agentLabel={model || null}
        interactive={false}
      />
      {secondary && <span className={styles.model}>{secondary}</span>}
    </span>
  )
}

const SOURCE_TEXT: Record<DecisionSource, { label: string; variant: BadgeVariant; title: string }> =
  {
    human: { label: 'HUMAN', variant: 'default', title: 'Decided by a person' },
    bot: { label: 'BOT', variant: 'warning', title: 'Decided by the rules-based bot' },
    scripted: { label: 'SCRIPTED', variant: 'info', title: 'Decided by a test script' },
    llm: { label: 'LLM', variant: 'safe', title: "Decided by the AI model's own answer" },
    fallback: {
      label: 'FALLBACK',
      variant: 'danger',
      title: 'The model failed; the rules-based player acted instead',
    },
  }

export function SourceBadge({ source }: { source: DecisionSource }) {
  const s = SOURCE_TEXT[source] ?? {
    label: String(source).toUpperCase(),
    variant: 'default' as const,
    title: '',
  }
  return (
    <span title={s.title} data-testid={`source-${source}`}>
      <Badge label={s.label} variant={s.variant} />
    </span>
  )
}
