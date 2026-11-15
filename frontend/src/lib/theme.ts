/**
 * Light / dark colour scheme. By default the page follows the system (`prefers-color-scheme`,
 * handled in CSS: styles/tokens.css). A manual choice is stored in localStorage and applied as
 * `data-theme` on <html>; choosing what the system already prefers clears the stored choice, so
 * the page follows the system again.
 */
export type Theme = 'light' | 'dark'

export const THEME_KEY = 'buyout-theme'
const EVENT = 'buyout-theme-change'

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function storedTheme(): Theme | null {
  try {
    const v = storage()?.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

export function systemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** The scheme on screen now. */
export function currentTheme(): Theme {
  const set = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined
  return set === 'light' || set === 'dark' ? set : systemTheme()
}

/** Put the stored choice (if any) on <html>; call once before the first render. */
export function applyStoredTheme(): void {
  if (typeof document === 'undefined') return
  const t = storedTheme()
  if (t) document.documentElement.dataset.theme = t
  else delete document.documentElement.dataset.theme
}

export function setTheme(theme: Theme): void {
  const followSystem = theme === systemTheme()
  try {
    if (followSystem) storage()?.removeItem(THEME_KEY)
    else storage()?.setItem(THEME_KEY, theme)
  } catch {
    // Private mode / storage blocked: the choice lasts for this page only.
  }
  if (followSystem) delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
  window.dispatchEvent(new Event(EVENT))
}

/** Subscribe to scheme changes (manual or system). */
export function subscribeTheme(onChange: () => void): () => void {
  const mq = window.matchMedia?.('(prefers-color-scheme: light)')
  // Another tab changed the choice: apply it here too.
  const onStorage = () => {
    applyStoredTheme()
    onChange()
  }
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onStorage)
  mq?.addEventListener?.('change', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onStorage)
    mq?.removeEventListener?.('change', onChange)
  }
}
