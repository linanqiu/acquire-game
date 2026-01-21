import styles from './ChainMarker.module.css'
import { Badge } from '../ui/Badge'
import type { ChainName } from '../../types/api'
import { chainToCssClass } from '../../types'

const CHAIN_ABBREV: Record<ChainName, string> = {
  Luxor: 'LUX',
  Tower: 'TWR',
  American: 'AME',
  Festival: 'FES',
  Worldwide: 'WOR',
  Continental: 'CON',
  Imperial: 'IMP',
}

const CHAIN_NAMES: Record<ChainName, string> = {
  Luxor: 'LUXOR',
  Tower: 'TOWER',
  American: 'AMERICAN',
  Festival: 'FESTIVAL',
  Worldwide: 'WORLDWIDE',
  Continental: 'CONTINENTAL',
  Imperial: 'IMPERIAL',
}

export interface ChainMarkerProps {
  chain: ChainName
  size?: number
  price?: number
  available?: number
  safe?: boolean
  variant?: 'icon' | 'compact' | 'full'
}

export function ChainMarker({
  chain,
  size,
  price,
  available,
  safe = false,
  variant = 'compact',
}: ChainMarkerProps) {
  const abbrev = CHAIN_ABBREV[chain]
  const name = CHAIN_NAMES[chain]
  const cssClass = chainToCssClass(chain)

  if (variant === 'icon') {
    return (
      <div
        className={`${styles.icon} ${styles[cssClass]}`}
        title={name}
        data-testid={`chain-marker-${cssClass}`}
      >
        {abbrev[0]}
      </div>
    )
  }

  if (variant === 'compact') {
    return (
      <span className={styles.compact} data-testid={`chain-marker-${cssClass}`}>
        <span className={`${styles.icon} ${styles[cssClass]}`}>{abbrev[0]}</span>
        <span className={styles.abbrev}>{abbrev}</span>
        {safe && <Badge label="SAFE" variant="safe" />}
      </span>
    )
  }

  // Full variant
  return (
    <div className={styles.full} data-testid={`chain-marker-${cssClass}`}>
      <span className={`${styles.icon} ${styles[cssClass]}`}>{abbrev[0]}</span>
      <span className={styles.name}>{name}</span>
      {size !== undefined && <span className={styles.size}>{size} tiles</span>}
      {price !== undefined && <span className={styles.price}>${price.toLocaleString()}/share</span>}
      {available !== undefined && <span className={styles.available}>[{available}]</span>}
      {safe && <Badge label="SAFE" variant="safe" />}
    </div>
  )
}
