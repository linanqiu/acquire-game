import { Badge } from '../ui/Badge'
import type { BadgeVariant } from '../ui/Badge'
import { resolveSeatKind, seatKindLabel } from '../../lib/agents'
import type { SeatKind } from '../../types/api'

export interface SeatKindBadgeProps {
  playerId: string
  kind?: SeatKind
  isBot?: boolean
  agentLabel?: string | null
}

const VARIANTS: Record<SeatKind, BadgeVariant> = {
  human: 'default',
  bot: 'warning',
  llm: 'safe',
  scripted: 'info',
}

/** Badge showing what occupies a seat. Renders nothing for human seats. */
export function SeatKindBadge({ playerId, kind, isBot, agentLabel }: SeatKindBadgeProps) {
  const seat = { kind, is_bot: isBot, agent_label: agentLabel }
  const resolved = resolveSeatKind(seat)
  if (resolved === 'human') return null
  return (
    <span data-testid={`seat-kind-${playerId}`} data-kind={resolved}>
      <Badge label={seatKindLabel(seat)} variant={VARIANTS[resolved]} />
    </span>
  )
}
