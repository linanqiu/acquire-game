import type { ReactNode } from 'react'
import styles from './Card.module.css'

interface CardProps {
  title?: string
  onClose?: () => void
  footer?: ReactNode
  children: ReactNode
  className?: string
}

export function Card({ title, onClose, footer, children, className }: CardProps) {
  return (
    <div className={`${styles.card} ${className || ''}`}>
      {(title || onClose) && (
        <div className={styles.cardHeader}>
          {title && <h3 className={styles.cardTitle}>{title}</h3>}
          {onClose && (
            <button className={styles.closeButton} onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>
      )}
      <div className={styles.cardBody}>{children}</div>
      {footer && <div className={styles.cardFooter}>{footer}</div>}
    </div>
  )
}
