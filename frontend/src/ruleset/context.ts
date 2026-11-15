import { createContext } from 'react'
import type { Ruleset } from '../types/ruleset'

/** A ruleset that overrides the server's for a subtree (a game's or a transcript's). */
export const RulesetContext = createContext<Ruleset | null>(null)
