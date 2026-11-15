import type { ReactNode } from 'react'
import styles from './Panel.module.css'

interface PanelProps {
  title: string
  children: ReactNode
}

export function Panel({ title, children }: PanelProps) {
  return (
    <aside className={styles.panel}>
      <h4 className={styles.panelTitle}>{title}</h4>
      <div className={styles.panelContent}>{children}</div>
    </aside>
  )
}
