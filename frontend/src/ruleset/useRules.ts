import { useContext } from 'react'
import type { CSSProperties } from 'react'
import { RulesetContext } from './context'
import { useRulesetStore } from './store'
import { DEFAULT_RULESET } from './defaultRuleset'
import {
  chainName,
  chainSpec,
  chainStyle,
  columnLabels,
  formatAmount,
  rowLabels,
  shareCount,
  tierOf,
} from '../lib/ruleset'
import type { ChainId, ChainSpec, Ruleset, RulesetTheme } from '../types/ruleset'

/** A ruleset plus bound display helpers, so components read `rules.name(id)`, `rules.money(n)`. */
export interface Rules {
  rs: Ruleset
  title: string
  theme: RulesetTheme
  rows: string[]
  cols: number[]
  chain: (id: ChainId) => ChainSpec
  name: (id: ChainId) => string
  abbr: (id: ChainId) => string
  /** Inline style with `--chain-bg` / `--chain-fg` for a chain swatch. */
  style: (id: ChainId) => CSSProperties
  tierLabel: (id: ChainId) => string
  money: (n: number | null | undefined) => string
  shares: (n: number) => string
}

const cache = new WeakMap<Ruleset, Rules>()

export function rulesFor(rs: Ruleset): Rules {
  const hit = cache.get(rs)
  if (hit) return hit
  const rules: Rules = {
    rs,
    title: rs.title,
    theme: rs.theme,
    rows: rowLabels(rs),
    cols: columnLabels(rs),
    chain: (id) => chainSpec(rs, id),
    name: (id) => chainName(rs, id),
    abbr: (id) => chainSpec(rs, id).abbreviation,
    style: (id) => chainStyle(rs, id) as CSSProperties,
    tierLabel: (id) => tierOf(rs, chainSpec(rs, id).tier)?.label ?? '',
    money: (n) => formatAmount(rs, n),
    shares: (n) => shareCount(rs, n),
  }
  cache.set(rs, rules)
  return rules
}

/**
 * The server's configured ruleset. Default only until it has loaded, which in the app never
 * renders (RulesetGate waits); unit tests that do not set one get default.
 */
export function useServerRuleset(): Ruleset {
  return useRulesetStore((s) => s.ruleset) ?? DEFAULT_RULESET
}

/** The ruleset in effect here: the nearest RulesetScope, else the server's. */
export function useRuleset(): Ruleset {
  const scoped = useContext(RulesetContext)
  const server = useServerRuleset()
  return scoped ?? server
}

export function useRules(): Rules {
  return rulesFor(useRuleset())
}

/** The product name (server setting `GAME_BRAND_NAME`): site title, headers, bench pages. */
export function useBrand(): string {
  return useRulesetStore((s) => s.brand)
}

/** Rules for the server's configured ruleset (home page pitch, numbers), ignoring any scope. */
export function useServerRules(): Rules {
  return rulesFor(useServerRuleset())
}
