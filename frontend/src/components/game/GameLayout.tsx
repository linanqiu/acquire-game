import { useEffect, type ReactNode } from 'react'
import { TabList, TabPanels, type TabItem } from '../ui/Tabs'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useGameTabs } from '../../hooks/useGameTabs'
import { NOW_TAB, WIDE_QUERY } from '../../lib/gameTabs'
import styles from './GameLayout.module.css'

export interface GameLayoutProps {
  room: string
  /** `player` or `host` (each remembers its own tab). */
  scope: 'player' | 'host'
  board: ReactNode
  /** The tile rack (player page). */
  rack?: ReactNode
  /** The decision tab ("Now", BL-011): what needs me / what is happening, with its context. */
  decision: ReactNode | ((select: (tab: string) => void) => ReactNode)
  decisionLabel?: string
  /** One slim line naming what is needed (under the board, or in the phone dock); tapping it
   *  opens the decision tab. */
  status?: (openDecision: () => void) => ReactNode
  /** Event keys that take the page to the decision tab (see `useGameTabs`). */
  events?: string[]
  /** Bumped to open the decision tab (a merger opened from the log). */
  openNow?: number
  /** Reference tabs (Players, Chains, Chat, Trades or Log); the decision tab comes first and
   *  phones add the Board before it. */
  tabs: TabItem[]
  /** Tab open by default on wide screens. */
  wideDefault: string
  /** Tabs shown side by side above the others when `pinQuery` matches (host on a TV). */
  pin?: string[]
  pinQuery?: string
  /** Is it my turn to place a tile (Board marker, auto-switch to the Board on phones)? */
  myPlaceTurn?: boolean
  myId?: string
}

/**
 * The in-game layout of the player and host pages (BL-008, BL-011).
 *
 * Phones: the selected tab fills the screen between the phase bar and a slim dock (one status
 * line and the rack) above the tab bar: Board, Now (the decision tab), then the reference tabs.
 * Wide screens: the board (status line and rack under it) on the left, always visible; on the
 * right the tabs, Now first. Decisions and their context live in the Now tab only: no action
 * card and no merger card on top of other tabs. The page itself never scrolls; the selected
 * tab scrolls inside itself.
 */
export function GameLayout({
  room,
  scope,
  board,
  rack,
  decision,
  decisionLabel = 'Now',
  status,
  events,
  openNow = 0,
  tabs,
  wideDefault,
  pin = [],
  pinQuery = 'not all',
  myPlaceTurn = false,
  myId,
}: GameLayoutProps) {
  const wide = useMediaQuery(WIDE_QUERY)
  const pinning = useMediaQuery(pinQuery) && wide
  const pinned = pinning ? tabs.filter((t) => pin.includes(t.id)) : []
  const reference = tabs.filter((t) => !pinned.includes(t))
  const ids = [...(wide ? [] : ['board']), NOW_TAB, ...reference.map((t) => t.id)]
  const fallback = wide ? (ids.includes(wideDefault) ? wideDefault : NOW_TAB) : 'board'

  const state = useGameTabs({
    room,
    scope,
    available: ids,
    fallback,
    myPlaceTurn,
    myId,
    events,
  })
  const { select } = state
  useEffect(() => {
    if (openNow > 0) select(NOW_TAB)
  }, [openNow, select])

  const nowTab: TabItem = {
    id: NOW_TAB,
    label: decisionLabel,
    content: (
      <div className={styles.decision}>
        {typeof decision === 'function' ? decision(select) : decision}
      </div>
    ),
  }
  const boardTab: TabItem = {
    id: 'board',
    label: 'Board',
    content: <div className={styles.boardFit}>{board}</div>,
  }
  const all = [...(wide ? [] : [boardTab]), nowTab, ...reference]

  // Badges computed here join the page's own (pending offers on Trades).
  const withBadges = all.map((t): TabItem => {
    if (t.id === 'chat' && state.chatUnread > 0)
      return { ...t, badge: state.chatUnread, badgeLabel: `${state.chatUnread} unread` }
    if (t.id === NOW_TAB && state.nowBadge) return { ...t, badge: 'dot', badgeLabel: 'new' }
    if (t.id === 'board' && state.boardMarker)
      return { ...t, badge: 'dot', badgeLabel: 'your tile to place' }
    return t
  })

  const prefix = `${scope}-tabs`
  const panels = (
    <TabPanels
      tabs={withBadges}
      selected={state.selected}
      idPrefix={prefix}
      className={styles.panel}
    />
  )
  const list = (
    <TabList
      tabs={withBadges}
      selected={state.selected}
      onSelect={state.select}
      label="Game views"
      idPrefix={prefix}
      variant={wide ? 'top' : 'bar'}
      testId={wide ? 'tab-list' : 'tab-bar'}
    />
  )
  const statusLine = status?.(() => state.select(NOW_TAB))

  if (!wide) {
    return (
      <div className={styles.phone} data-testid="game-layout" data-layout="phone">
        <div className={styles.content}>{panels}</div>
        {(statusLine || rack) && (
          <div className={styles.dock} data-testid="dock">
            {statusLine}
            {rack && <div className={styles.rack}>{rack}</div>}
          </div>
        )}
        {list}
      </div>
    )
  }

  return (
    <div
      className={`${styles.wide} ${pinned.length ? styles.pinning : ''}`}
      data-testid="game-layout"
      data-layout="wide"
    >
      <section className={styles.boardPane} aria-label="Board" data-testid="board-pane">
        <div className={styles.boardFit}>{board}</div>
        {statusLine}
        {rack && <div className={styles.rackUnderBoard}>{rack}</div>}
      </section>
      <div className={styles.sidebar}>
        {pinned.length > 0 && (
          <div className={styles.pinned}>
            {pinned.map((t) => (
              <section
                key={t.id}
                className={styles.pinnedCard}
                aria-label={t.label}
                data-testid={`pinned-${t.id}`}
              >
                <h2 className={styles.pinnedTitle}>{t.label}</h2>
                {typeof t.content === 'function' ? t.content(true) : t.content}
              </section>
            ))}
          </div>
        )}
        <div className={styles.tabs}>
          {list}
          {panels}
        </div>
      </div>
    </div>
  )
}
