/**
 * The backend's shipped rulesets (backend/rulesets/*.json), read from disk so unit tests always
 * use the real files, plus helpers to make one the "server's" ruleset for a test.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Ruleset } from '../../../src/types/ruleset'
import { useRulesetStore } from '../../../src/ruleset/store'

const DIR = resolve(__dirname, '../../../../backend/rulesets')

export function loadRuleset(name: 'classic' | 'valley' | 'mini'): Ruleset {
  return JSON.parse(readFileSync(resolve(DIR, `${name}.json`), 'utf8')) as Ruleset
}

export const CLASSIC = loadRuleset('classic')
export const VALLEY = loadRuleset('valley')
export const MINI = loadRuleset('mini')
export const ALL_RULESETS = { classic: CLASSIC, valley: VALLEY, mini: MINI }

/** Every classic chain name, any case (must not appear when another ruleset is active). */
export const CLASSIC_CHAIN_WORDS = CLASSIC.chains.map((c) => c.name)

/** Make `rs` the server's configured ruleset (what `/api/config/game` would return). */
export function useServerRuleset(rs: Ruleset | null) {
  useRulesetStore.getState().setRuleset(rs)
}

/** Text that must never show while a non-classic ruleset is active. */
export function classicLeaks(text: string): string[] {
  const found: string[] = []
  for (const w of [...CLASSIC_CHAIN_WORDS, 'Acquire', 'ACQUIRE', 'hotel', 'Hotel', 'HOTEL']) {
    if (new RegExp(`\\b${w}\\b`).test(text)) found.push(w)
  }
  return found
}
