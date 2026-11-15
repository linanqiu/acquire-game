import { useSyncExternalStore } from 'react'
import { currentTheme, setTheme, subscribeTheme } from '../../lib/theme'
import styles from './ThemeToggle.module.css'

/**
 * A small light/dark switch. The page follows the system until the player picks; the pick is
 * remembered (lib/theme). The icon shows the scheme you would switch TO; the label says it.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => 'dark' as const)
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      className={`${styles.toggle} ${className ?? ''}`}
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      data-testid="theme-toggle"
      data-theme-current={theme}
    >
      <span aria-hidden="true">{next === 'light' ? '☀' : '☾'}</span>
    </button>
  )
}
