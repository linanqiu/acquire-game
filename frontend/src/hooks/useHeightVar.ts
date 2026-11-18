import { useLayoutEffect, type RefObject } from 'react'

/**
 * Writes the height of `source` (px, rounded up) as the CSS custom property `name` on `target`,
 * and keeps it current while it changes size. The game pages use it for the parts of the screen
 * that stay put while the page scrolls (header and phase bar at the top, rack and tab bar at the
 * foot), so the layout can size the Board tab to the space left between them.
 */
export function useHeightVar(
  source: RefObject<HTMLElement | null>,
  target: RefObject<HTMLElement | null>,
  name: string,
  enabled = true
) {
  useLayoutEffect(() => {
    const el = source.current
    const host = target.current
    if (!el || !host || !enabled) return
    const apply = () => host.style.setProperty(name, `${Math.ceil(el.offsetHeight)}px`)
    apply()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    return () => {
      observer.disconnect()
      host.style.removeProperty(name)
    }
  }, [source, target, name, enabled])
}
