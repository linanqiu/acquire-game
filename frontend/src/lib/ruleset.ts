/**
 * Pure helpers over a {@link Ruleset}: board geometry, chain display data (name, abbreviation,
 * colour with a readable foreground), theme wording, money formatting and limits.
 *
 * Nothing here knows any particular game: every value is read from the ruleset passed in.
 */

import type { ChainId, ChainSpec, Ruleset, TierSpec } from '../types/ruleset'
import { DEFAULT_RULESET } from '../ruleset/defaultRuleset'

// -- Board --------------------------------------------------------------------

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Row labels top to bottom: `A`, `B`, ... (`rows` letters). */
export function rowLabels(rs: Ruleset): string[] {
  return LETTERS.slice(0, Math.max(0, Math.min(26, rs.board.rows))).split('')
}

/** Column labels left to right: `1` .. `columns`. */
export function columnLabels(rs: Ruleset): number[] {
  return Array.from({ length: Math.max(0, rs.board.columns) }, (_, i) => i + 1)
}

export function tileCount(rs: Ruleset): number {
  return rs.board.columns * rs.board.rows
}

// -- Colour -------------------------------------------------------------------

/** Foregrounds a chain colour can get: light and dark. */
export const LIGHT_TEXT = '#FFFFFF'
export const DARK_TEXT = '#111111'

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of a `#RRGGBB` (or `#RGB`) colour; 0 for anything unparsable. */
export function luminance(hex: string): number {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return 0
  const n = parseInt(h, 16)
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  )
}

/** WCAG contrast ratio between two colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** The more readable text colour (light or dark) on a background colour. */
export function readableText(bg: string): string {
  return contrastRatio(bg, LIGHT_TEXT) >= contrastRatio(bg, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT
}

// -- Chains -------------------------------------------------------------------

const NEUTRAL_CHAIN_COLOR = '#6B7280'

/**
 * The chain's spec. An id the ruleset does not know (a mismatched transcript, an old backend)
 * still renders: its id is its name.
 */
export function chainSpec(rs: Ruleset, id: ChainId): ChainSpec {
  return (
    rs.chains.find((c) => c.id === id) ?? {
      id,
      name: id,
      tier: '',
      color: NEUTRAL_CHAIN_COLOR,
      abbreviation:
        id
          .replace(/[^A-Za-z0-9]/g, '')
          .slice(0, 2)
          .toUpperCase() || '?',
    }
  )
}

export function chainName(rs: Ruleset, id: ChainId): string {
  return chainSpec(rs, id).name
}

export function tierOf(rs: Ruleset, tierId: string): TierSpec | undefined {
  return rs.tiers.find((t) => t.id === tierId)
}

/** Chains grouped by tier, cheapest tier first, ruleset order inside a tier. */
export function chainsByTier(rs: Ruleset): { tier: TierSpec; chains: ChainSpec[] }[] {
  const groups = rs.tiers.map((tier) => ({
    tier,
    chains: rs.chains.filter((c) => c.tier === tier.id),
  }))
  return groups.filter((g) => g.chains.length > 0)
}

/** Ids in display order (ruleset order). Ids not in the ruleset are appended, sorted. */
export function orderChainIds(rs: Ruleset, ids: Iterable<ChainId>): ChainId[] {
  const set = new Set(ids)
  const known = rs.chains.map((c) => c.id).filter((id) => set.has(id))
  const unknown = [...set].filter((id) => !rs.chains.some((c) => c.id === id)).sort()
  return [...known, ...unknown]
}

/** Test id suffix for a chain (ids are opaque; lower-cased so test ids are stable). */
export function chainTestId(chain: ChainId): string {
  return chain.toLowerCase()
}

/** Inline CSS variables for a chain swatch: `--chain-bg` and a readable `--chain-fg`. */
export function chainStyle(rs: Ruleset, id: ChainId): Record<string, string> {
  const { color } = chainSpec(rs, id)
  return { '--chain-bg': color, '--chain-fg': readableText(color) }
}

// -- Wording ------------------------------------------------------------------

/**
 * `a` / `an` for a noun phrase, by how it is pronounced: a vowel first letter, or an ordinal that
 * starts with "eight(h)" or "eleven(th)" / "eighteen(th)" (8th, 11th, 18th, 80th-89th).
 */
export function article(phrase: string): string {
  return /^(?:[aeiou]|8|11(?!\d)|18(?!\d))/i.test(phrase.trim()) ? 'an' : 'a'
}

export function withArticle(phrase: string): string {
  return `${article(phrase)} ${phrase}`
}

/** `1 share`, `3 shares` with the theme's nouns. */
export function countOf(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

export function shareCount(rs: Ruleset, n: number): string {
  return countOf(n, rs.theme.share_noun, rs.theme.share_noun_plural)
}

/** Money in the ruleset's currency: `$6,000`. */
export function formatAmount(rs: Ruleset, n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  const sign = v < 0 ? '-' : ''
  return `${sign}${rs.theme.currency_symbol}${Math.abs(v).toLocaleString('en-US')}`
}

function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

/** Text for the backend's tile `reason` codes (wire names are historical; wording is not). */
export function unplayableReasonText(rs: Ruleset, reason: string | null | undefined): string {
  const n = rs.chains.length
  switch (reason) {
    case 'would_merge_safe_chains':
      return `it would merge two ${rs.theme.chain_noun_plural} that are ${rs.theme.safe_phrase}`
    case 'would_create_eighth_chain':
      return `it would start ${withArticle(ordinal(n + 1))} ${rs.theme.chain_noun} (all ${n} are already on the board)`
    default:
      return 'it is not playable now'
  }
}

/** Player-count hint: `3-6 players` (or `4 players`). */
export function playerRange(rs: Ruleset): string {
  return rs.min_players === rs.max_players
    ? `${rs.max_players} players`
    : `${rs.min_players}-${rs.max_players} players`
}

// -- Transcript fallback ------------------------------------------------------

interface StateLike {
  board?: { cells?: Record<string, unknown> }
  chains?: Record<string, { color?: string } | undefined>
}

/**
 * The ruleset of a transcript. Headers written by current backends carry it; older ones do not,
 * so it is rebuilt from what the state lines show: the first of `candidates` (normally the
 * server's ruleset, then the default one) whose chains
 * and board hold everything seen; failing that, default numbers with the chains (ids and
 * colours) and board extent seen in the states.
 */
export function rulesetForTranscript(
  headerRuleset: Ruleset | null | undefined,
  states: StateLike[],
  candidates: Ruleset[] = [DEFAULT_RULESET]
): Ruleset {
  if (headerRuleset && Array.isArray(headerRuleset.chains)) return headerRuleset
  const chainIds: string[] = []
  const colors: Record<string, string> = {}
  let maxCol = 0
  let maxRow = 0
  for (const s of states) {
    for (const [id, c] of Object.entries(s.chains ?? {})) {
      if (!chainIds.includes(id)) chainIds.push(id)
      if (c?.color) colors[id] = c.color
    }
    for (const coord of Object.keys(s.board?.cells ?? {})) {
      const m = /^(\d+)([A-Z])$/.exec(coord)
      if (!m) continue
      maxCol = Math.max(maxCol, Number(m[1]))
      maxRow = Math.max(maxRow, LETTERS.indexOf(m[2]) + 1)
    }
  }
  const fits = (rs: Ruleset) =>
    chainIds.every((id) => rs.chains.some((c) => c.id === id)) &&
    maxCol <= rs.board.columns &&
    maxRow <= rs.board.rows
  const known = [...candidates, DEFAULT_RULESET].find(fits)
  if (known) return known
  const defaultIds = new Set(DEFAULT_RULESET.chains.map((c) => c.id))
  const tier = DEFAULT_RULESET.tiers[Math.floor(DEFAULT_RULESET.tiers.length / 2)]
  return {
    ...DEFAULT_RULESET,
    id: 'unknown',
    // Not shown: page chrome uses the server's title. Never claim the default name for it.
    title: '',
    board: {
      columns: Math.max(maxCol, 2),
      rows: Math.max(maxRow, 2),
    },
    chains: chainIds.map((id) => ({
      ...chainSpec(DEFAULT_RULESET, id),
      tier: defaultIds.has(id) ? chainSpec(DEFAULT_RULESET, id).tier : tier.id,
      color: colors[id] ?? chainSpec(DEFAULT_RULESET, id).color,
    })),
  }
}
