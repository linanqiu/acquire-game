import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import styles from './Tabs.module.css'

export interface TabItem {
  id: string
  /** Short label shown on the tab. */
  label: string
  /** The panel; a function gets whether the panel is shown (e.g. to scroll a list on open). */
  content: ReactNode | ((shown: boolean) => ReactNode)
  /** A number (shown as a count, hidden at 0), `'dot'` for a marker, or nothing. */
  badge?: number | 'dot' | null
  /** Screen-reader text for the badge, e.g. "2 unread". */
  badgeLabel?: string
}

interface TabListProps {
  tabs: TabItem[]
  selected: string
  onSelect: (id: string) => void
  /** Accessible name of the tab list. */
  label: string
  /** Prefix for the tab / panel element ids (unique per page). */
  idPrefix: string
  /** `bar`: a bottom bar of equal-width buttons (phones); `top`: tabs above a panel. */
  variant?: 'top' | 'bar'
  testId?: string
}

const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`
const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`

function hasBadge(badge: TabItem['badge']): boolean {
  return badge === 'dot' || (typeof badge === 'number' && badge > 0)
}

/**
 * A row of tabs (WAI-ARIA tabs pattern): one tab stop, arrow keys / Home / End move between
 * tabs and select them, `aria-selected` marks the open one. The panels are rendered by
 * `TabPanels` (which may sit elsewhere in the layout, e.g. above a bottom tab bar).
 */
export function TabList({
  tabs,
  selected,
  onSelect,
  label,
  idPrefix,
  variant = 'top',
  testId = 'tab-list',
}: TabListProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.id === selected)
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % tabs.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (index - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next < 0) return
    e.preventDefault()
    const id = tabs[next].id
    onSelect(id)
    refs.current[id]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`${styles.list} ${styles[variant]}`}
      onKeyDown={onKeyDown}
      data-testid={testId}
    >
      {tabs.map((t) => {
        const on = t.id === selected
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, t.id)}
            aria-selected={on}
            aria-controls={panelId(idPrefix, t.id)}
            tabIndex={on ? 0 : -1}
            aria-label={
              hasBadge(t.badge) && t.badgeLabel ? `${t.label} (${t.badgeLabel})` : undefined
            }
            className={`${styles.tab} ${on ? styles.selected : ''}`}
            onClick={() => onSelect(t.id)}
            data-testid={`tab-${t.id}`}
          >
            <span className={styles.label}>{t.label}</span>
            {hasBadge(t.badge) && (
              <span
                className={t.badge === 'dot' ? styles.dot : styles.count}
                data-testid={`tab-badge-${t.id}`}
                aria-hidden="true"
              >
                {t.badge === 'dot' ? '' : t.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

interface TabPanelsProps {
  tabs: TabItem[]
  selected: string
  idPrefix: string
  className?: string
}

/**
 * Every tab's panel stays mounted (a chat draft or a scroll position survives a switch); only the
 * selected one is shown. Each panel scrolls inside itself.
 */
export function TabPanels({ tabs, selected, idPrefix, className }: TabPanelsProps) {
  return (
    <>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={panelId(idPrefix, t.id)}
          aria-labelledby={tabId(idPrefix, t.id)}
          hidden={t.id !== selected}
          tabIndex={0}
          className={`${styles.panel} ${className ?? ''}`}
          data-testid={`tabpanel-${t.id}`}
        >
          {typeof t.content === 'function' ? t.content(t.id === selected) : t.content}
        </div>
      ))}
    </>
  )
}
