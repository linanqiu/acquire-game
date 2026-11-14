import styles from './RangeBar.module.css'

interface RangeBarProps {
  value: number
  low: number
  high: number
  /** Axis extent; defaults to 0..1. */
  min?: number
  max?: number
  /** Accessible description, e.g. "Win rate 46%, interval 28% to 65%". */
  label: string
  testId?: string
}

/** A confidence interval drawn as a range on a fixed axis, with a tick at the point estimate. */
export function RangeBar({ value, low, high, min = 0, max = 1, label, testId }: RangeBarProps) {
  const span = max - min || 1
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / span) * 100))
  const l = pct(low)
  const h = pct(high)
  return (
    <span className={styles.bar} role="img" aria-label={label} data-testid={testId}>
      <span className={styles.track} />
      <span className={styles.range} style={{ left: `${l}%`, width: `${Math.max(h - l, 1)}%` }} />
      <span className={styles.point} style={{ left: `${pct(value)}%` }} />
    </span>
  )
}
