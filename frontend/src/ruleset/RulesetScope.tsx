import type { ReactNode } from 'react'
import { RulesetContext } from './context'
import type { Ruleset } from '../types/ruleset'

/**
 * Everything below uses `ruleset` (a game's `game_state.ruleset`, a transcript's) instead of the
 * server's configured one. `null`/`undefined` keeps the surrounding ruleset.
 */
export function RulesetScope({
  ruleset,
  children,
}: {
  ruleset: Ruleset | null | undefined
  children: ReactNode
}) {
  if (!ruleset) return <>{children}</>
  return <RulesetContext.Provider value={ruleset}>{children}</RulesetContext.Provider>
}
