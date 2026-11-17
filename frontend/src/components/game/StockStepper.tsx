import { Button } from '../ui/Button'
import styles from './StockStepper.module.css'

export interface StockStepperProps {
  value: number
  min?: number
  max: number
  onChange: (value: number) => void
  disabled?: boolean
  /** What is being counted ("Marlowe shares to buy"): the spinbutton's accessible name. */
  label?: string
  /** Tighter, for a table row. */
  compact?: boolean
}

export function StockStepper({
  value,
  min = 0,
  max,
  onChange,
  disabled = false,
  label,
  compact = false,
}: StockStepperProps) {
  const canDecrement = value > min && !disabled
  const canIncrement = value < max && !disabled

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault()
      if (canIncrement) onChange(value + 1)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault()
      if (canDecrement) onChange(value - 1)
    }
  }

  return (
    <div
      className={`${styles.stepper} ${compact ? styles.compact : ''}`}
      role="spinbutton"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={handleKeyDown}
      data-testid="stock-stepper"
    >
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onChange(value - 1)}
        disabled={!canDecrement}
        aria-label="Decrease quantity"
        data-testid="stepper-decrement"
      >
        −
      </Button>
      <span className={styles.value} data-testid="stepper-value">
        {value}
      </span>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onChange(value + 1)}
        disabled={!canIncrement}
        aria-label="Increase quantity"
        data-testid="stepper-increment"
      >
        +
      </Button>
    </div>
  )
}
