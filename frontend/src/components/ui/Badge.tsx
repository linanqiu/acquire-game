import styles from './Badge.module.css'

export type BadgeVariant = 'default' | 'safe' | 'warning' | 'danger' | 'info'

export interface BadgeProps {
  label: string
  variant?: BadgeVariant
  title?: string
}

export function Badge({ label, variant = 'default', title }: BadgeProps) {
  return (
    <span
      className={`${styles.badge} ${styles[variant]}`}
      data-testid={`badge-${variant}`}
      title={title}
    >
      {label}
    </span>
  )
}
