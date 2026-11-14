import styles from './Tile.module.css'
import type { ChainId } from '../../types/ruleset'
import type { Coordinate, TileVisualState } from '../../types/game'
import { useRules } from '../../ruleset/useRules'

interface TileProps {
  coordinate: Coordinate
  /** Chain id (colour and abbreviation from the ruleset), `orphan`, or empty when absent. */
  chain?: ChainId | 'orphan'
  state?: TileVisualState
  highlighted?: boolean
  onClick?: () => void
  /** `fluid` fills its grid cell (the board sizes it). */
  size?: 'sm' | 'md' | 'lg' | 'fluid'
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
  const rules = useRules()
  const inChain = !!chain && chain !== 'orphan'
  const chainClass = chain ? (chain === 'orphan' ? styles.orphan : styles.chain) : styles.empty

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

  // A chain square shows the chain's abbreviation (never colour alone); its coordinate stays in
  // the tooltip and accessible name.
  const label = inChain ? rules.abbr(chain) : coordinate
  const title = inChain ? `${coordinate} · ${rules.name(chain)}` : undefined

  return (
    <div
      className={classes}
      style={inChain ? rules.style(chain) : undefined}
      onClick={state !== 'disabled' ? onClick : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick && state !== 'disabled' ? 0 : undefined}
      onKeyDown={onClick ? handleKeyDown : undefined}
      title={title}
      data-testid={`tile-${coordinate}`}
      data-chain={chain ?? 'empty'}
    >
      {showLabel && <span className={styles.label}>{label}</span>}
      {state === 'merger' && <span className={styles.indicator}>!!</span>}
      {state === 'disabled' && <span className={styles.indicator}>🔒</span>}
      {state === 'dead' && <span className={styles.indicator}>✕</span>}
    </div>
  )
}
