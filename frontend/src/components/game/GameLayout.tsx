import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
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
  /**
   * The table panel (BL-013): my decision when there is one, what the table waits for, a merger
   * while it runs, and the players matrix. Phones: under the board, in the Board tab. Wide
   * screens: the first sidebar tab, next to the board.
   */
  table: ReactNode
  /** Label of the table tab on wide screens. */
  tableLabel?: string
  /**
   * A decision of mine is in the table panel: on a phone it is given at least half of the
   * Board tab (the board gets smaller on a short screen, but stays whole).
   */
  deciding?: boolean
  /** One slim line naming what is needed; tapping it opens the tab with the decision. Under
   *  the board on wide screens; on phones in the dock of the other tabs (the way back). */
  status?: (openDecision: () => void) => ReactNode
  /** Phones: show the status line on the Board tab too (it carries PLACE TILE). */
  statusOnBoard?: boolean
  /** Event keys that bring the decision into view (see `useGameTabs`). */
  events?: string[]
  /** Bumped to bring the table panel into view (ANSWER on an offer in the Trades tab). */
  openTable?: number
  /** Reference tabs (Chains, Chat, Trades or Log). */
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
 * The in-game layout of the player and host pages (BL-008, BL-011, BL-013).
 *
 * Phones: the Board tab is the game: the board, and under it the table panel (the decision in
 * place when there is one, otherwise the players matrix), then the rack and the tab bar. With
 * no decision open the panel is as tall as its content and the board takes the rest, so header,
 * board, every player row and the rack are on screen at once with nothing to scroll (a phone
 * browser with its toolbars showing leaves about 390x675). The
 * other tabs are reference: Chains, Chat, Trades (or Log). Wide screens: the board (status line
 * and rack under it) on the left, always visible; on the right the tabs, the table panel first.
 * There is no pop-up and nothing to close: a decision replaces the top of the table panel and
 * goes when it is made. The page itself never scrolls; panels scroll inside themselves.
 */
export function GameLayout({
  room,
  scope,
  board,
  rack,
  table,
  tableLabel = 'Table',
  deciding = false,
  status,
  statusOnBoard = false,
  events,
  openTable = 0,
  tabs,
  wideDefault,
  pin = [],
  pinQuery = 'not all',
  myPlaceTurn = false,
  myId,
}: GameLayoutProps) {
  const wide = useMediaQuery(WIDE_QUERY)
  const pinning = useMediaQuery(pinQuery) && wide
  const tablePinned = pinning && pin.includes(NOW_TAB)
  const pinned = pinning ? tabs.filter((t) => pin.includes(t.id)) : []
  const reference = tabs.filter((t) => !pinned.includes(t))
  const decisionTab = wide ? (tablePinned ? null : NOW_TAB) : 'board'
  const ids = [
    ...(wide ? (tablePinned ? [] : [NOW_TAB]) : ['board']),
    ...reference.map((t) => t.id),
  ]
  const fallback = wide ? (ids.includes(wideDefault) ? wideDefault : ids[0]) : 'board'

  const state = useGameTabs({
    room,
    scope,
    available: ids,
    fallback,
    decisionTab,
    myPlaceTurn,
    myId,
    events,
  })

  const { select } = state
  useEffect(() => {
    if (openTable > 0 && decisionTab) select(decisionTab)
  }, [openTable, decisionTab, select])

  // Something new needs me: it is at the top of the table panel, so show the top.
  const scroller = useRef<HTMLDivElement>(null)
  const signature = (events ?? []).join('|')
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0
  }, [signature, openTable])

  // Phones: the board gives the table panel exactly the height its content needs (BL-014), so
  // the players matrix shows whole, with no scrolling, whenever the screen can hold both. The
  // content's own height is measured (it does not depend on the panel's) and handed to the CSS
  // as --table-need; see .boardTab in the stylesheet for what the board does with it.
  const boardTab = useRef<HTMLDivElement>(null)
  const tableInner = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const inner = tableInner.current
    const tab = boardTab.current
    if (!inner || !tab) return
    const apply = () => {
      // Hidden (another tab is open): keep the last measure, so the board does not jump back.
      const need = Math.ceil(inner.offsetHeight)
      if (need > 0) tab.style.setProperty('--table-need', `${need}px`)
    }
    apply()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(apply)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [wide])

  const tablePanel = (
    <div
      ref={scroller}
      className={styles.table}
      data-testid="table-panel"
      data-deciding={deciding ? 'true' : undefined}
    >
      <div ref={tableInner} className={styles.tableInner}>
        {table}
      </div>
    </div>
  )

  const first: TabItem = wide
    ? { id: NOW_TAB, label: tableLabel, content: tablePanel }
    : {
        id: 'board',
        label: 'Board',
        content: (
          <div
            ref={boardTab}
            className={styles.boardTab}
            data-deciding={deciding ? 'true' : undefined}
          >
            <div className={styles.boardBox}>{board}</div>
            {tablePanel}
          </div>
        ),
      }
  const all = [...(tablePinned ? [] : [first]), ...reference]

  // Badges computed here join the page's own (pending offers on Trades).
  const withBadges = all.map((t): TabItem => {
    if (t.id === 'chat' && state.chatUnread > 0)
      return { ...t, badge: state.chatUnread, badgeLabel: `${state.chatUnread} unread` }
    if (t.id === decisionTab && (state.nowBadge || state.boardMarker))
      return {
        ...t,
        badge: 'dot',
        badgeLabel: state.boardMarker ? 'your tile to place' : 'new',
      }
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
  const statusLine = status?.(() => {
    if (decisionTab) state.select(decisionTab)
  })

  if (!wide) {
    // On the Board tab the phase bar and the panel under the board already say what is needed.
    const showStatus = statusLine && (state.selected !== 'board' || statusOnBoard)
    return (
      <div
        className={styles.phone}
        data-testid="game-layout"
        data-layout="phone"
        data-deciding={deciding && state.selected === 'board' ? 'true' : undefined}
      >
        <div className={styles.content}>{panels}</div>
        {(showStatus || rack) && (
          <div className={styles.dock} data-testid="dock">
            {showStatus && statusLine}
            {rack && <div className={styles.rack}>{rack}</div>}
          </div>
        )}
        {list}
      </div>
    )
  }

  return (
    <div
      className={`${styles.wide} ${pinning ? styles.pinning : ''}`}
      data-testid="game-layout"
      data-layout="wide"
    >
      <section className={styles.boardPane} aria-label="Board" data-testid="board-pane">
        <div className={styles.boardFit}>{board}</div>
        {statusLine}
        {rack && <div className={styles.rackUnderBoard}>{rack}</div>}
      </section>
      <div className={styles.sidebar}>
        {(tablePinned || pinned.length > 0) && (
          <div className={styles.pinned}>
            {tablePinned && (
              <section
                className={styles.pinnedCard}
                aria-label={tableLabel}
                data-testid={`pinned-${NOW_TAB}`}
              >
                <h2 className={styles.pinnedTitle}>{tableLabel}</h2>
                {table}
              </section>
            )}
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
