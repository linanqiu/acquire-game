/**
 * Where a share count stands among a chain's holders (BL-011). Only share counts are compared:
 * who is paid what stays the engine's business (the server's `chain_holders` and
 * `survivor_after` carry roles and amounts).
 */

export interface Count {
  player_id: string
  shares: number
}

export interface Place {
  /** 1-based competition place among holders with shares (null: holds none). */
  place: number | null
  /** Another holder has the same count. */
  tied: boolean
  /** Shares behind the holder just above (0 when 1st). */
  behind: number
  /** Shares ahead of the next holder below (null when nobody is below). */
  ahead: number | null
}

const ORD = ['1st', '2nd', '3rd']
export const ordinal = (n: number): string => ORD[n - 1] ?? `${n}th`

/** My place if I held `mine` shares and everyone else kept theirs. */
export function placeOf(others: Count[], me: string, mine: number): Place {
  const rest = others.filter((o) => o.player_id !== me && o.shares > 0).map((o) => o.shares)
  if (mine <= 0) return { place: null, tied: false, behind: 0, ahead: null }
  const above = rest.filter((n) => n > mine)
  const below = rest.filter((n) => n < mine)
  return {
    place: above.length + 1,
    tied: rest.includes(mine),
    behind: above.length ? Math.min(...above) - mine : 0,
    ahead: below.length ? mine - Math.max(...below) : null,
  }
}

/** "1st", "tied 2nd", "3rd, 2 behind" */
export function placeText(p: Place): string {
  if (p.place === null) return 'none'
  const base = `${p.tied ? 'tied ' : ''}${ordinal(p.place)}`
  return p.place > 1 && !p.tied ? `${base}, ${p.behind} behind` : base
}

/**
 * How buying or trading into a chain changes my place: "would tie 1st", "takes 2nd",
 * "stays 1st", "3rd, 2 behind". Empty when nothing changes (no extra shares).
 */
export function changeText(others: Count[], me: string, now: number, extra: number): string {
  if (extra <= 0) return ''
  const before = placeOf(others, me, now)
  const after = placeOf(others, me, now + extra)
  if (after.place === null) return ''
  if (after.tied) return `would tie ${ordinal(after.place)}`
  if (after.place <= 2 && before.place === after.place && !before.tied)
    return `stays ${ordinal(after.place)}`
  if (after.place <= 2) return `takes ${ordinal(after.place)}`
  return `${ordinal(after.place)}, ${after.behind} behind`
}
