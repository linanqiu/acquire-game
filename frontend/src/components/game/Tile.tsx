import { useEffect, useRef } from 'react'
import styles from './Tile.module.css'
import type { ChainId } from '../../types/ruleset'
import type { Coordinate, TileVisualState } from '../../types/game'
import { useRules } from '../../ruleset/useRules'
import { reducedMotion } from '../../lib/motion'

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
  /**
   * Board squares only: the sides joined to a neighbour of the same chain (`"n e s w"` subset,
   * from lib/boardShapes) so a chain draws as one block.
   */
  join?: string
  /** Board squares only: whether this chain square shows the chain's label (one per group). */
  anchor?: boolean
  /** Board squares only: nudge of the anchor's label towards the shape's centre, in squares. */
  labelShift?: { dx: number; dy: number }
}

export function Tile({
  coordinate,
  chain,
  state = 'default',
  highlighted = false,
  onClick,
  size = 'md',
  showLabel = true,
  join,
  anchor = true,
  labelShift,
}: TileProps) {
  const rules = useRules()
  const inChain = !!chain && chain !== 'orphan'
  const bg = inChain ? rules.chain(chain).color : chain === 'orphan' ? 'orphan' : null

  // Motion that explains (CSS keyframes in Tile.module.css, only without prefers-reduced-motion):
  // a tile placed on an empty square settles in; a square whose chain changes (a merger, or an
  // orphan joining a chain) sweeps from its old colour to the new one, column by column.
  // Imperative on purpose: a data attribute, no re-render, and nothing on the first paint.
  const ref = useRef<HTMLDivElement>(null)
  const prevBg = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const el = ref.current
    const before = prevBg.current
    prevBg.current = bg
    if (!el || before === undefined || before === bg || bg === null || reducedMotion()) return
    const kind = before === null ? 'place' : 'sweep'
    if (kind === 'sweep') {
      el.style.setProperty('--chain-prev', before === 'orphan' ? 'var(--chain-orphan)' : before)
      el.style.setProperty('--sweep-col', String(parseInt(coordinate, 10) || 0))
    }
    el.removeAttribute('data-anim')
    void el.offsetWidth // restart the animation if one is still running
    el.setAttribute('data-anim', kind)
    const done = (e: AnimationEvent) => {
      if (e.target === el) el.removeAttribute('data-anim')
    }
    el.addEventListener('animationend', done, { once: true })
    return () => el.removeEventListener('animationend', done)
  }, [bg, coordinate])
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
  // the tooltip and accessible name. On the board only one square per chain shows it visibly
  // (the others keep it for screen readers and tests).
  const label = inChain ? rules.abbr(chain) : coordinate
  const labelClass = `${styles.label} ${inChain && !anchor ? styles.srOnly : ''}`
  const title = inChain ? `${coordinate} · ${rules.name(chain)}` : undefined

  return (
    <div
      ref={ref}
      className={classes}
      style={
        inChain
          ? {
              ...rules.style(chain),
              ...(labelShift && (labelShift.dx || labelShift.dy)
                ? { '--label-dx': labelShift.dx, '--label-dy': labelShift.dy }
                : {}),
            }
          : undefined
      }
      onClick={state !== 'disabled' ? onClick : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick && state !== 'disabled' ? 0 : undefined}
      onKeyDown={onClick ? handleKeyDown : undefined}
      title={title}
      data-testid={`tile-${coordinate}`}
      data-chain={chain ?? 'empty'}
      data-join={join || undefined}
      data-anchor={inChain && join !== undefined ? String(anchor) : undefined}
    >
      {showLabel && <span className={labelClass}>{label}</span>}
      {state === 'merger' && <span className={styles.indicator}>!!</span>}
      {state === 'disabled' && <span className={styles.indicator}>🔒</span>}
      {state === 'dead' && <span className={styles.indicator}>✕</span>}
    </div>
  )
}
