import { useEffect, useRef, useState, type ReactNode } from 'react'

interface VirtualListProps<T> {
  items: T[]
  rowHeight: number
  /** Viewport height used until the element is measured (and in tests, where layout is 0). */
  fallbackHeight?: number
  overscan?: number
  /** Index kept in view when it changes. */
  activeIndex?: number
  renderRow: (item: T, index: number) => ReactNode
  className?: string
  ariaLabel?: string
  testId?: string
}

/**
 * Minimal fixed-row-height windowing: only the rows near the viewport are in the DOM,
 * so a transcript with thousands of decisions stays responsive.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  fallbackHeight = 400,
  overscan = 8,
  activeIndex,
  renderRow,
  className,
  ariaLabel,
  testId,
}: VirtualListProps<T>) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(fallbackHeight)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      if (el.clientHeight > 0) setHeight(el.clientHeight)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || activeIndex === undefined || activeIndex < 0) return
    const top = activeIndex * rowHeight
    const view = el.clientHeight || fallbackHeight
    let next = el.scrollTop
    if (top < next) next = top
    else if (top + rowHeight > next + view) next = top + rowHeight - view
    el.scrollTop = next
    // jsdom and some browsers do not emit a scroll event for programmatic scrolling
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScrollTop(next)
  }, [activeIndex, rowHeight, fallbackHeight])

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + overscan)
  const rows: ReactNode[] = []
  for (let i = start; i < end; i++) {
    rows.push(
      <div
        key={i}
        style={{ position: 'absolute', top: i * rowHeight, left: 0, right: 0, height: rowHeight }}
      >
        {renderRow(items[i], i)}
      </div>
    )
  }
  return (
    <div
      ref={ref}
      className={className}
      style={{ overflowY: 'auto', position: 'relative' }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>{rows}</div>
    </div>
  )
}
