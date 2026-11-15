/**
 * The server's configured ruleset (`GET /api/config/game`), loaded once at app start.
 * Inside a game the game's own ruleset (`game_state.ruleset`) takes over, and in the transcript
 * viewer the transcript's; see `RulesetScope` and `useRules`.
 *
 * The same response carries `brand`: the product name (server setting `GAME_BRAND_NAME`), used for
 * the site title, browser tab, headers and bench pages. It is not part of the ruleset: a ruleset's
 * `title` is its theme's name ("Grand Hotels", "Acquihire"), the brand is the product's.
 */

import { create } from 'zustand'
import { fetchWithRetry } from '../lib/http'
import type { Ruleset } from '../types/ruleset'

export type RulesetStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Shown only until the server's configuration has loaded (unit tests); the server's default. */
export const FALLBACK_BRAND = 'Buyout'

interface RulesetStoreState {
  ruleset: Ruleset | null
  /** The product name from the server (`brand` in `/api/config/game`). */
  brand: string
  status: RulesetStatus
  error: string | null
  /** Fetch the configured ruleset (no-op while loading or once loaded, unless `force`). */
  load: (opts?: { force?: boolean }) => Promise<void>
  /** Test hook / manual override. */
  setRuleset: (rs: Ruleset | null) => void
  /** Test hook / manual override. */
  setBrand: (brand: string) => void
}

export function isRuleset(v: unknown): v is Ruleset {
  if (!v || typeof v !== 'object') return false
  const r = v as Partial<Ruleset>
  return (
    typeof r.title === 'string' &&
    !!r.theme &&
    !!r.board &&
    typeof r.board.columns === 'number' &&
    typeof r.board.rows === 'number' &&
    Array.isArray(r.chains) &&
    Array.isArray(r.tiers)
  )
}

export const useRulesetStore = create<RulesetStoreState>((set, get) => ({
  ruleset: null,
  brand: FALLBACK_BRAND,
  status: 'idle',
  error: null,
  load: async ({ force = false } = {}) => {
    const { status } = get()
    if (!force && (status === 'loading' || status === 'ready')) return
    set({ status: 'loading', error: null })
    try {
      const res = await fetchWithRetry('/api/config/game', {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`The server answered ${res.status}`)
      const data: unknown = await res.json()
      if (!isRuleset(data)) throw new Error('The server sent an unexpected game configuration')
      const { brand, ...ruleset } = data as Ruleset & { brand?: unknown }
      set({
        ruleset,
        brand: typeof brand === 'string' && brand.trim() ? brand : FALLBACK_BRAND,
        status: 'ready',
        error: null,
      })
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : 'Could not load the game configuration',
      })
    }
  },
  setRuleset: (rs) => set({ ruleset: rs, status: rs ? 'ready' : 'idle', error: null }),
  setBrand: (brand) => set({ brand }),
}))
