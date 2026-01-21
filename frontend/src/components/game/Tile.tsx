import styles from './Tile.module.css'
import type { ChainName } from '../../types/api'
import { chainToCssClass } from '../../types'
import type { Coordinate, TileVisualState } from '../../types/game'

interface TileProps {
  coordinate: Coordinate
  chain?: ChainName | 'orphan'
  state?: TileVisualState
  highlighted?: boolean
  onClick?: () => void
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
}

export function Tile({
  coordinate,
  chain,
  state = 'default',
  highlighted = false,
  onClick,
  size = 'md',
  showLabel = true,
}: TileProps) {
  // Build chain class name (convert ChainName to lowercase for CSS)
  const chainClass = chain
    ? chain === 'orphan'
      ? styles.orphan
      : styles[chainToCssClass(chain as ChainName)]
    : styles.empty

  const classes = [
    styles.tile,
    styles[size],
    styles[state],
    chainClass,
    highlighted ? styles.highlighted : '',
    onClick ? styles.interactive : '',
  ]
    .filter(Boolean)
    .join(' ')

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      onClick()
    }
  }

  return (
    <div
      className={classes}
      onClick={state !== 'disabled' ? onClick : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick && state !== 'disabled' ? 0 : undefined}
      onKeyDown={onClick ? handleKeyDown : undefined}
      data-testid={`tile-${coordinate}`}
    >
      {showLabel && <span className={styles.label}>{coordinate}</span>}
      {state === 'merger' && <span className={styles.indicator}>!!</span>}
      {state === 'disabled' && <span className={styles.indicator}>🔒</span>}
      {state === 'dead' && <span className={styles.indicator}>✕</span>}
    </div>
  )
}
