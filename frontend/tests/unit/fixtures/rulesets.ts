/**
 * The backend's shipped rulesets (backend/rulesets/*.json), read from disk so unit tests always
 * use the real files, plus helpers to make one the "server's" ruleset for a test.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Ruleset } from '../../../src/types/ruleset'
import { useRulesetStore } from '../../../src/ruleset/store'

const DIR = resolve(__dirname, '../../../../backend/rulesets')

export function loadRuleset(name: 'default' | 'valley' | 'mini'): Ruleset {
  return JSON.parse(readFileSync(resolve(DIR, `${name}.json`), 'utf8')) as Ruleset
}

export const DEFAULT_RS = loadRuleset('default')
export const VALLEY = loadRuleset('valley')
export const MINI = loadRuleset('mini')
export const ALL_RULESETS = { default: DEFAULT_RS, valley: VALLEY, mini: MINI }

/** Every default chain name, any case (must not appear when another ruleset is active). */
export const DEFAULT_CHAIN_WORDS = DEFAULT_RS.chains.map((c) => c.name)

/** Make `rs` the server's configured ruleset (what `/api/config/game` would return). */
export function useServerRuleset(rs: Ruleset | null) {
  useRulesetStore.getState().setRuleset(rs)
}

/**
 * Text that must never show while a non-default ruleset is active: the default theme's title,
 * its hotel words, and its chain names, except the ones the active (server) ruleset shares with
 * it (mini uses five of the default chains). The brand ("Buyout") is the product's name and shows
 * under every ruleset, so it is not a leak.
 */
export function defaultLeaks(text: string): string[] {
  const active = useRulesetStore.getState().ruleset
  const shared = new Set(active?.chains.map((c) => c.name) ?? [])
  const found: string[] = []
  const title = DEFAULT_RS.title
  for (const w of [
    ...DEFAULT_CHAIN_WORDS.filter((n) => !shared.has(n)),
    title,
    title.toUpperCase(),
    'hotel',
    'Hotel',
    'HOTEL',
  ]) {
    if (new RegExp(`\\b${w}\\b`).test(text)) found.push(w)
  }
  return found
}
