import type { ReactNode } from 'react'
import { TabList, TabPanels, type TabItem } from '../ui/Tabs'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useGameTabs } from '../../hooks/useGameTabs'
import { WIDE_QUERY } from '../../lib/gameTabs'
import type { MergerRecord } from '../../types/api'
import styles from './GameLayout.module.css'

export interface GameLayoutProps {
  room: string
  /** `player` or `host` (each remembers its own tab). */
  scope: 'player' | 'host'
  board: ReactNode
  /** The tile rack (player page). */
  rack?: ReactNode
  /** What needs me now: the action card, incoming trade offers (player page). */
  now?: ReactNode
  /** The merger result card while it is open: shown above the tab content whatever the tab. */
  banner?: ReactNode
  /** Reference tabs (Players, Chains, Chat, Trades or Log); phones add the Board first. */
  tabs: TabItem[]
  /** Tab open by default on wide screens. */
  wideDefault: string
  /** Tab that holds the merger log (gets a dot when a merger result arrives). */
  logTab: string
  /** Tabs shown side by side above the others when `pinQuery` matches (host on a TV). */
  pin?: string[]
  pinQuery?: string
  /** Is it my turn to place a tile (Board marker, auto-switch to the Board on phones)? */
  myPlaceTurn?: boolean
  myId?: string
  mergers?: MergerRecord[]
}

/**
 * The in-game layout of the player and host pages (BL-008).
 *
 * Phones: the selected tab fills the screen between the phase bar and a bottom dock with what
 * needs me now (action card, then the rack) and the tab bar; the Board is a tab.
 * Wide screens: the board (and the rack under it) on the left, always visible; on the right a
 * sidebar with the "now" area on top and the tabs below. The page itself never scrolls; the
 * selected tab scrolls inside itself.
 */
export function GameLayout({
  room,
  scope,
  board,
  rack,
  now,
  banner,
  tabs,
  wideDefault,
  logTab,
  pin = [],
  pinQuery = 'not all',
  myPlaceTurn = false,
  myId,
  mergers,
}: GameLayoutProps) {
  const wide = useMediaQuery(WIDE_QUERY)
  const pinning = useMediaQuery(pinQuery) && wide
  const pinned = pinning ? tabs.filter((t) => pin.includes(t.id)) : []
  const reference = tabs.filter((t) => !pinned.includes(t))

  const boardTab: TabItem = {
    id: 'board',
    label: 'Board',
    content: <div className={styles.boardFit}>{board}</div>,
  }
  const all = wide ? reference : [boardTab, ...reference]
  const fallback = wide
    ? reference.some((t) => t.id === wideDefault)
      ? wideDefault
      : reference[0].id
    : 'board'

  const state = useGameTabs({
    room,
    scope,
    available: all.map((t) => t.id),
    fallback,
    myPlaceTurn,
    myId,
    mergers,
    logTab,
  })

  // Badges computed here join the page's own (pending offers on Trades).
  const withBadges = all.map((t): TabItem => {
    if (t.id === 'chat' && state.chatUnread > 0)
      return { ...t, badge: state.chatUnread, badgeLabel: `${state.chatUnread} unread` }
    if (t.id === logTab && state.newMerger && !t.badge)
      return { ...t, badge: 'dot', badgeLabel: 'new result' }
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
  const bannerBox = banner ? <div className={styles.banner}>{banner}</div> : null

  if (!wide) {
    return (
      <div className={styles.phone} data-testid="game-layout" data-layout="phone">
        <div className={styles.content}>
          {bannerBox}
          {panels}
        </div>
        {(now || rack) && (
          <div className={styles.dock} data-testid="now-area">
            {now && <div className={styles.now}>{now}</div>}
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
        {rack && <div className={styles.rackUnderBoard}>{rack}</div>}
      </section>
      <div className={styles.sidebar}>
        {now && (
          <div className={styles.now} data-testid="now-area">
            {now}
          </div>
        )}
        {bannerBox}
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
