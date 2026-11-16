import { resolveSeatKind } from './agents'
import type { GameStateMessage } from '../types/api'

type Players = GameStateMessage['players']

/**
 * What a narrow row prints for each seat. AI seats have two-word character names ("Dolly
 * Dollars"): the first word is enough to tell them apart, so the rest is dropped where the
 * column is narrow (it stays in the DOM, the title and the seat popover). A name is only
 * shortened when the short form is still unique at the table; people's names are never cut.
 */
export function shortNames(players: Players): Record<string, { head: string; rest: string }> {
  const first = (name: string) => name.trim().split(/\s+/)[0] ?? name
  const wanted = Object.fromEntries(
    Object.entries(players).map(([id, p]) => {
      const ai = resolveSeatKind(p) !== 'human'
      return [id, ai ? first(p.name) : p.name]
    })
  )
  const taken = Object.values(wanted).map((n) => n.toLowerCase())
  return Object.fromEntries(
    Object.entries(players).map(([id, p]) => {
      const head = wanted[id]
      const unique = taken.filter((n) => n === head.toLowerCase()).length === 1
      const cut = unique && head.length > 0 && head !== p.name && p.name.startsWith(head)
      return [id, cut ? { head, rest: p.name.slice(head.length) } : { head: p.name, rest: '' }]
    })
  )
}
