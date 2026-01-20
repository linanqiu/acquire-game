import styles from './Toast.module.css'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface ToastProps {
  id: string
  message: string
  type: ToastType
  onDismiss: (id: string) => void
}

const icons: Record<ToastType, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✕',
}

export function Toast({ id, message, type, onDismiss }: ToastProps) {
  return (
    <div className={`${styles.toast} ${styles[type]}`} role="alert" aria-live="polite">
      <span className={styles.icon} aria-hidden="true">
        {icons[type]}
      </span>
      <span className={styles.message}>{message}</span>
      <button
        className={styles.dismiss}
        onClick={() => onDismiss(id)}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  )
}
