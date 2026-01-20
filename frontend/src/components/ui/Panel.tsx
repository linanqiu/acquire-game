import type { ReactNode } from 'react'
import styles from './Panel.module.css'

interface PanelProps {
  title: string
  children: ReactNode
  className?: string
}

export function Panel({ title, children, className }: PanelProps) {
  return (
    <aside className={`${styles.panel} ${className || ''}`}>
      <h4 className={styles.panelTitle}>{title}</h4>
      <div className={styles.panelContent}>{children}</div>
    </aside>
  )
}
