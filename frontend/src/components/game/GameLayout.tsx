import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { TabList, TabPanels, type TabItem } from '../ui/Tabs'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useHeightVar } from '../../hooks/useHeightVar'
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
  /** The placement line (PLACE TILE, END GAME), when there is something to press: under the
   *  board on wide screens, over the rack on phones (on every tab). */
  status?: ReactNode
  /** Told whether the table panel (my decision, the players table) is on screen: the page's
   *  header and phase bar say only what the screen does not already show (BL-017). */
  onTableVisible?: (visible: boolean) => void
  /** Event keys that bring the decision into view (see `useGameTabs`). */
  events?: string[]
  /** Bumped to bring the table panel into view (the phase bar's link to my decision). */
  openTable?: number
  /** `n` bumped to open tab `id` by the player's own action elsewhere on the page (COUNTER on
   *  an offer in the table panel opens the composer in Trades). */
  openTab?: { id: string; n: number }
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
 * goes when it is made. The page is the only scroller (BL-019): no panel scrolls inside itself.
 * The header and phase bar stay at the top, the rack and tab bar at the foot (phones), the
 * board beside the tabs (wide screens); a tab longer than the screen scrolls the page.
 */
/** The gap between the parts of a decision marked `data-table-core` (the buy panel's gap). */
const CORE_GAP = 4

export function GameLayout({
  room,
  scope,
  board,
  rack,
  table,
  tableLabel = 'Table',
  deciding = false,
  status,
  onTableVisible,
  events,
  openTable = 0,
  openTab,
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
  const openTabId = openTab?.id
  const openTabN = openTab?.n ?? 0
  useEffect(() => {
    if (openTabN > 0 && openTabId) select(openTabId)
  }, [openTabN, openTabId, select])

  const tableVisible = tablePinned || state.selected === decisionTab
  useEffect(() => {
    onTableVisible?.(tableVisible)
  }, [tableVisible, onTableVisible])

  // Another tab opens, or what needs me changes while the table panel (where it is shown, at
  // the top) is on screen: show the top of the page. A layout effect, so a tab that wants its
  // foot instead (Chat, in a plain effect) has the last word. While a reference tab is open
  // (Chains, Chat, Trades) the events of the game do not move the page (BL-021): an offer
  // made to me or withdrawn, a merger starting, used to throw a reader of the Trades tab back
  // to its top.
  const signature = (events ?? []).join('|')
  const shown = useRef({ selected: state.selected, openTable })
  useLayoutEffect(() => {
    const opened =
      shown.current.selected !== state.selected || shown.current.openTable !== openTable
    shown.current = { selected: state.selected, openTable }
    if (!opened && !tableVisible) return
    if (typeof window.scrollTo === 'function' && window.scrollY > 0) window.scrollTo(0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tableVisible follows the selected tab
  }, [signature, openTable, state.selected])

  // Phones: the rack and the tab bar stay at the foot; the Board tab is sized to what is left.
  const phoneRoot = useRef<HTMLDivElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  useHeightVar(bottom, phoneRoot, '--chrome-bottom', !wide)

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
    // Every measure is read before anything is written, and a value is written only when it
    // changed: a write invalidates the styles below the board tab, and a read after it forces
    // a second layout (BL-020).
    const set = (name: string, value: string | null) => {
      if (tab.style.getPropertyValue(name) === (value ?? '')) return
      if (value === null) tab.style.removeProperty(name)
      else tab.style.setProperty(name, value)
    }
    const apply = () => {
      // Hidden (another tab is open): keep the last measure, so the board does not jump back.
      const need = Math.ceil(inner.offsetHeight)
      // A decision may mark the parts that must be on screen together (`data-table-core`: the
      // buy rows and the buy button, BL-017). Their own heights, from the top of the panel,
      // are what the board yields to while I decide (capped in the stylesheet).
      const core = Array.from(inner.querySelectorAll<HTMLElement>('[data-table-core]'))
      const top =
        core.length > 0
          ? core[0].getBoundingClientRect().top - inner.getBoundingClientRect().top
          : 0
      const parts = core.reduce((sum, el) => sum + el.offsetHeight, 0)
      if (need > 0) set('--table-need', `${need}px`)
      if (core.length === 0) {
        set('--core-need', null)
        return
      }
      const coreNeed = Math.ceil(top + parts + CORE_GAP * (core.length - 1))
      if (parts > 0) set('--core-need', `${coreNeed}px`)
    }
    apply()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(apply)
    observer.observe(inner)
    // The core parts can change height while the panel does not (a buy row opening its line).
    // Measure again only when the set of core parts changes: measuring forces a layout, and the
    // panel's content changes with every move at the table (BL-020). Size changes come
    // through the ResizeObserver.
    const watched = new Set<Element>()
    const watchCore = () => {
      let changed = false
      const now = new Set(inner.querySelectorAll('[data-table-core]'))
      now.forEach((el) => {
        if (!watched.has(el)) {
          watched.add(el)
          observer.observe(el)
          changed = true
        }
      })
      watched.forEach((el) => {
        if (!now.has(el)) {
          watched.delete(el)
          observer.unobserve(el)
          changed = true
        }
      })
      if (changed) apply()
    }
    watchCore()
    const mutations =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(watchCore)
    mutations?.observe(inner, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      mutations?.disconnect()
    }
  }, [wide])

  const tablePanel = (
    <div
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
  const statusLine = status

  if (!wide) {
    const showStatus = !!statusLine
    return (
      <div
        ref={phoneRoot}
        className={styles.phone}
        data-testid="game-layout"
        data-layout="phone"
        data-deciding={deciding && state.selected === 'board' ? 'true' : undefined}
      >
        <div className={styles.content}>{panels}</div>
        <div ref={bottom} className={styles.bottom}>
          {(showStatus || rack) && (
            <div className={styles.dock} data-testid="dock">
              {showStatus && statusLine}
              {rack && <div className={styles.rack}>{rack}</div>}
            </div>
          )}
          {list}
        </div>
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
