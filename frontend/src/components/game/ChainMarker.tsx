import styles from './ChainMarker.module.css'
import { Badge } from '../ui/Badge'
import type { ChainId } from '../../types/ruleset'
import { useRules } from '../../ruleset/useRules'
import { chainTestId } from '../../lib/ruleset'

export interface ChainMarkerProps {
  chain: ChainId
  size?: number
  price?: number
  available?: number
  safe?: boolean
  /** icon: swatch only; compact: swatch + name; full: swatch + name + numbers. */
  variant?: 'icon' | 'compact' | 'full'
}

/**
 * A chain's swatch (ruleset colour with a readable foreground and the chain's abbreviation, so
 * colour is never the only cue) and, except for `icon`, its display name.
 */
export function ChainMarker({
  chain,
  size,
  price,
  available,
  safe = false,
  variant = 'compact',
}: ChainMarkerProps) {
  const rules = useRules()
  const name = rules.name(chain)
  const abbrev = rules.abbr(chain)
  const testId = `chain-marker-${chainTestId(chain)}`
  const swatch = (
    <span className={styles.icon} style={rules.style(chain)} aria-hidden={variant !== 'icon'}>
      {abbrev}
    </span>
  )
  const safeBadge = safe && <Badge label={rules.theme.safe_phrase} variant="safe" />

  if (variant === 'icon') {
    return (
      <span
        className={`${styles.icon} ${styles.standalone}`}
        style={rules.style(chain)}
        title={name}
        role="img"
        aria-label={name}
        data-testid={testId}
      >
        {abbrev}
      </span>
    )
  }

  if (variant === 'compact') {
    return (
      <span className={styles.compact} data-testid={testId} title={name}>
        {swatch}
        <span className={styles.abbrev}>{name}</span>
        {safeBadge}
      </span>
    )
  }

  // Full variant
  return (
    <div className={styles.full} data-testid={testId}>
      {swatch}
      <span className={styles.name}>{name}</span>
      {size !== undefined && <span className={styles.size}>{size} tiles</span>}
      {price !== undefined && (
        <span className={styles.price} title={`Price per ${rules.theme.share_noun}`}>
          {rules.money(price)}
        </span>
      )}
      {available !== undefined && <span className={styles.available}>[{available}]</span>}
      {safeBadge}
    </div>
  )
}
