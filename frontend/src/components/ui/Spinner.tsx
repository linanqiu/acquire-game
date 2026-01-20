import styles from './Spinner.module.css'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
}

export function Spinner({ size = 'md' }: SpinnerProps) {
  return (
    <span className={`${styles.spinner} ${styles[size]}`} role="status">
      <span className="sr-only">Loading...</span>
    </span>
  )
}
