import styles from './inputs.module.css'

interface Option {
  value: string
  label: string
}

interface RadioGroupProps {
  name: string
  options: Option[]
  value: string
  onChange: (value: string) => void
  label?: string
  disabled?: boolean
}

export function RadioGroup({ name, options, value, onChange, label, disabled }: RadioGroupProps) {
  return (
    <div className={styles.inputWrapper}>
      {label && <span className={styles.label}>{label}</span>}
      <div className={styles.radioGroup} role="radiogroup" aria-label={label}>
        {options.map((opt) => (
          <label key={opt.value} className={styles.radioLabel}>
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              className={styles.radioInput}
              disabled={disabled}
            />
            <span className={styles.radioText}>{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
