import styles from './Slider.module.css'

export interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  displayValue?: string
  disabled?: boolean
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  displayValue,
  disabled = false,
}: SliderProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value))
  }

  const percentage = max > min ? ((value - min) / (max - min)) * 100 : 0

  return (
    <div className={`${styles.sliderContainer} ${disabled ? styles.disabled : ''}`}>
      <label className={styles.label}>
        <span className={styles.labelText}>{label}</span>
        {displayValue && <span className={styles.displayValue}>{displayValue}</span>}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        className={styles.slider}
        style={{ '--slider-percentage': `${percentage}%` } as React.CSSProperties}
        data-testid={`slider-${label.toLowerCase().replace(/\s+/g, '-')}`}
      />
    </div>
  )
}
