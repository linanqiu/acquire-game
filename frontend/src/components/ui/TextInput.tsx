import { forwardRef } from 'react'
import styles from './inputs.module.css'

interface TextInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string
  error?: string
  autoCapitalize?: boolean
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ label, error, autoCapitalize, onChange, className, id, ...props }, ref) => {
    const inputId = id || (label ? `input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined)

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (autoCapitalize) {
        e.target.value = e.target.value.toUpperCase()
      }
      onChange?.(e)
    }

    return (
      <div className={styles.inputWrapper}>
        {label && (
          <label className={styles.label} htmlFor={inputId}>
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`${styles.input} ${error ? styles.error : ''} ${className || ''}`.trim()}
          onChange={handleChange}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          {...props}
        />
        {error && (
          <span id={`${inputId}-error`} className={styles.errorText} role="alert">
            {error}
          </span>
        )}
      </div>
    )
  }
)

TextInput.displayName = 'TextInput'
