import { Badge, type BadgeVariant } from '../ui/Badge'
import { seatModelLabel } from '../../lib/format'
import type { DecisionSource, SummarySeat } from '../../types/transcripts'
import styles from './SeatChip.module.css'

const KIND_VARIANT: Record<string, BadgeVariant> = {
  human: 'default',
  bot: 'warning',
  llm: 'safe',
  scripted: 'info',
}

const KIND_LABEL: Record<string, string> = {
  human: 'HUMAN',
  bot: 'BOT',
  llm: 'LLM',
  scripted: 'SCRIPTED',
}

export function KindBadge({ kind }: { kind: string }) {
  return (
    <Badge
      label={KIND_LABEL[kind] ?? kind.toUpperCase()}
      variant={KIND_VARIANT[kind] ?? 'default'}
    />
  )
}

interface SeatChipProps {
  seat: Pick<SummarySeat, 'player_id' | 'name' | 'kind' | 'agent_label' | 'model'>
  winner?: boolean
  showModel?: boolean
}

/** A seat: name, kind badge and (for AI seats) the model label. */
export function SeatChip({ seat, winner = false, showModel = true }: SeatChipProps) {
  const model = showModel ? seatModelLabel(seat) : ''
  return (
    <span
      className={`${styles.chip} ${winner ? styles.winner : ''}`}
      data-testid={`seat-chip-${seat.player_id}`}
    >
      {winner && (
        <span className={styles.crown} role="img" aria-label="Winner">
          ★
        </span>
      )}
      <span className={styles.name}>{seat.name}</span>
      <KindBadge kind={seat.kind} />
      {model && <span className={styles.model}>{model}</span>}
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
