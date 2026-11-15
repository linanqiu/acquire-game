import { useEffect, useRef } from 'react'
import { reducedMotion } from '../lib/motion'

/**
 * Flash a number when it changes (cash, net worth): sets `data-flash="up"` or `"down"` on the
 * element for one short CSS animation (index.css; none under prefers-reduced-motion), then
 * removes it. Nothing on the first render, so a page load does not flash every number.
 */
export function useChangeFlash<T extends HTMLElement>(value: number | null | undefined) {
  const ref = useRef<T>(null)
  const prev = useRef(value)
  useEffect(() => {
    const el = ref.current
    const before = prev.current
    prev.current = value
    if (!el || before == null || value == null || before === value || reducedMotion()) return
    el.removeAttribute('data-flash')
    void el.offsetWidth // restart if a flash is still running
    el.setAttribute('data-flash', value > before ? 'up' : 'down')
    const done = () => el.removeAttribute('data-flash')
    el.addEventListener('animationend', done, { once: true })
    return () => el.removeEventListener('animationend', done)
  }, [value])
  return ref
}
