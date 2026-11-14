import styles from './Badge.module.css'

export type BadgeVariant = 'default' | 'safe' | 'warning' | 'danger' | 'info'

export interface BadgeProps {
  label: string
  variant?: BadgeVariant
  size?: 'sm' | 'md'
  title?: string
}

export function Badge({ label, variant = 'default', size = 'sm', title }: BadgeProps) {
  return (
    <span
      className={`${styles.badge} ${styles[variant]} ${styles[size]}`}
      data-testid={`badge-${variant}`}
      title={title}
    >
      {label}
    </span>
  )
}
