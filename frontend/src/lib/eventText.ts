/**
 * Readable sentences for engine events and decision actions, worded from the game's ruleset
 * (chain display names, currency, chain/share/merger nouns).
 * Unknown event types fall back to a generic "type key=value ..." line.
 */

import type { EngineEvent } from '../types/transcripts'
import type { Ruleset } from '../types/ruleset'
import { chainName, countOf, formatAmount, withArticle } from './ruleset'

export type Names = Record<string, string>

export interface EventLine {
  key: string
  type: string
  text: string
  /** Information only the acting seat saw (hands, draws). */
  isPrivate: boolean
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export function nameOf(names: Names, pid: unknown): string {
  if (typeof pid !== 'string') return 'The game'
  return names[pid] ?? pid
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Word helpers bound to one ruleset. */
function lexicon(rs: Ruleset) {
  const money = (n: unknown) => formatAmount(rs, Number(n ?? 0))
  const chain = (id: unknown) => (typeof id === 'string' ? chainName(rs, id) : String(id))
  const shares = (n: number) => countOf(n, rs.theme.share_noun, rs.theme.share_noun_plural)
  const stockText = (stocks: unknown) => {
    const entries = Object.entries((stocks as Record<string, number>) ?? {}).filter(
      ([, n]) => n > 0
    )
    return entries.length ? entries.map(([c, n]) => `${n} ${chain(c)}`).join(', ') : ''
  }
  const founderBonus = (type: unknown, value: unknown) =>
    type === 'cash'
      ? `${money(value)} bonus`
      : countOf(
          Number(value ?? rs.founder_bonus_shares),
          `free ${rs.theme.share_noun}`,
          `free ${rs.theme.share_noun_plural}`
        )
  return { rs, money, chain, shares, stockText, founderBonus }
}

type Lex = ReturnType<typeof lexicon>

const TRADE_EVENT_KIND = {
  trade_proposed: 'proposed',
  trade_accepted: 'accepted',
  trade_rejected: 'rejected',
  trade_cancelled: 'canceled',
} as const

export function tradeText(
  t: Record<string, unknown> | undefined,
  names: Names,
  rs: Ruleset
): string {
  if (!t) return 'a trade'
  const { money, stockText } = lexicon(rs)
  const give = [
    stockText(t.offering_stocks),
    Number(t.offering_money) ? money(t.offering_money) : '',
  ]
    .filter(Boolean)
    .join(' + ')
  const get = [
    stockText(t.requesting_stocks),
    Number(t.requesting_money) ? money(t.requesting_money) : '',
  ]
    .filter(Boolean)
    .join(' + ')
  return `${nameOf(names, t.from_player_id)} gives ${give || 'nothing'} for ${get || 'nothing'} from ${nameOf(names, t.to_player_id)}`
}

/** One side of an offer in words: "2 Tower + $100", or "nothing". */
function sideText(lx: Lex, stocks: unknown, cash: unknown): string {
  return (
    [lx.stockText(stocks), Number(cash) ? lx.money(cash) : ''].filter(Boolean).join(' + ') ||
    'nothing'
  )
}

export type TradeEventKind = 'proposed' | 'accepted' | 'rejected' | 'canceled'

/**
 * A public trade event in one sentence, with the offer's terms, the same for the live game
 * (trade messages) and for transcripts (engine events): "Ada offers Bo 2 Tower for $600.",
 * "Bo accepted Ada's offer: 2 Tower for $600.". `trade` may be missing (transcripts recorded
 * before answers carried the offer): then the sentence names what is known.
 */
export function tradeEventText(
  kind: TradeEventKind,
  trade: Record<string, unknown> | null | undefined,
  names: Names,
  rs: Ruleset,
  opts: { by?: unknown; reason?: unknown } = {}
): string {
  const lx = lexicon(rs)
  if (!trade || typeof trade.from_player_id !== 'string') {
    const who = nameOf(names, opts.by)
    if (kind === 'proposed') return `${who} proposed a trade.`
    if (kind === 'accepted') return `${who} accepted a trade offer.`
    if (kind === 'rejected') return `${who} rejected a trade offer.`
    return `A trade offer was cancelled (${String(opts.reason ?? 'cancelled').replace(/_/g, ' ')}).`
  }
  const from = nameOf(names, trade.from_player_id)
  const to = nameOf(names, trade.to_player_id)
  const terms = `${sideText(lx, trade.offering_stocks, trade.offering_money)} for ${sideText(
    lx,
    trade.requesting_stocks,
    trade.requesting_money
  )}`
  switch (kind) {
    case 'proposed':
      return `${from} offers ${to} ${terms}.`
    case 'accepted':
      return `${to} accepted ${from}'s offer: ${terms}.`
    case 'rejected':
      return `${to} rejected ${from}'s offer: ${terms}.`
    default:
      return opts.reason === 'no_longer_valid'
        ? `${from}'s offer to ${to} can no longer be met and was removed: ${terms}.`
        : `${from} withdrew the offer to ${to}: ${terms}.`
  }
}

function generic(e: EngineEvent): string {
  const skip = new Set(['seq', 'type', 'player_id', 'private_to'])
  const parts = Object.entries(e)
    .filter(([k]) => !skip.has(k))
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
  const who = e.player_id ? `${e.player_id}: ` : ''
  return `${who}${e.type.replace(/_/g, ' ')}${parts.length ? ` (${parts.join(', ')})` : ''}`
}

function one(e: EngineEvent, names: Names, lx: Lex): string {
  const { rs, money, chain, stockText, founderBonus } = lx
  const theme = rs.theme
  const who = nameOf(names, e.player_id)
  switch (e.type) {
    case 'game_started': {
      const order = ((e.turn_order as string[]) ?? []).map((p) => nameOf(names, p))
      return `Game started. Turn order: ${order.join(', ')}.`
    }
    case 'tiles_dealt': {
      const tiles = (e.tiles as string[]) ?? []
      return `${who} was dealt ${plural(tiles.length, 'tile')}: ${tiles.join(', ')}.`
    }
    case 'tile_placed': {
      const chains = ((e.chains as string[]) ?? []).map(chain)
      switch (e.outcome) {
        case 'nothing':
          return `${who} placed ${e.tile}.`
        case 'expand':
          return `${who} placed ${e.tile} — ${list(chains)} grows.`
        case 'found':
          return `${who} placed ${e.tile} — ${withArticle(`new ${theme.chain_noun}`)} can be founded.`
        case 'merge':
        case 'merge_tie':
          return `${who} placed ${e.tile} — ${theme.merger_noun} of ${list(chains)}.`
        default:
          return `${who} placed ${e.tile}.`
      }
    }
    case 'chain_founded':
      return `${who} founded ${chain(e.chain)} (${plural(Number(e.size ?? 0), 'tile')}) and received ${founderBonus(e.founder_bonus_type, e.founder_bonus_value)}.`
    case 'chain_expanded':
      return `${chain(e.chain)} grows to ${e.size}.`
    case 'survivor_chosen':
      return `${who} chose ${chain(e.survivor)} to survive the tie.`
    case 'defunct_order_chosen':
      return `${who} chose ${chain(e.chain)} to be absorbed first.`
    case 'merger_started': {
      const defunct = ((e.defunct as string[]) ?? []).map(chain).join(', ')
      return `${capitalized(theme.merger_noun)}: ${chain(e.survivor)} absorbs ${defunct}.`
    }
    case 'bonuses_paid': {
      const b = (e.bonuses as Record<string, { majority?: number; minority?: number }>) ?? {}
      const parts = Object.entries(b).map(([pid, v]) => {
        const bits = [
          v.majority ? `${money(v.majority)} majority` : '',
          v.minority ? `${money(v.minority)} minority` : '',
        ].filter(Boolean)
        return `${nameOf(names, pid)} ${bits.join(' + ') || money(0)}`
      })
      return `${e.final ? 'Final bonuses' : 'Bonuses'} for ${chain(e.chain)}: ${parts.join('; ') || 'none'}.`
    }
    case 'stock_disposition': {
      const sell = Number(e.sell ?? 0)
      const trade = Number(e.trade ?? 0)
      const hold = Number(e.hold ?? 0)
      const received = Number(
        e.survivor_shares_received ?? trade / Math.max(1, rs.merger_trade_ratio)
      )
      const bits = [
        sell ? `sold ${sell} (${money(e.sale_proceeds)})` : '',
        trade ? `traded ${trade} for ${received} ${chain(e.surviving_chain)}` : '',
        hold ? `kept ${hold}` : '',
      ].filter(Boolean)
      return `${who} ${chain(e.defunct_chain)} ${theme.share_noun_plural}: ${bits.join(', ') || 'nothing to dispose'}.`
    }
    case 'merger_completed':
      return `${capitalized(theme.merger_noun)} complete: ${chain(e.survivor)} now has ${e.survivor_size} tiles.`
    case 'stocks_purchased': {
      const p = stockText(e.purchases)
      return p
        ? `${who} bought ${p} for ${money(e.total_cost)}.`
        : `${who} bought no ${theme.share_noun_plural}.`
    }
    case 'tile_drawn':
      return `${who} drew ${e.tile}.`
    case 'tiles_replaced': {
      const removed = (e.removed_tiles as string[]) ?? []
      return `${who} discarded ${plural(removed.length, 'unplayable tile')} (${removed.join(', ')}) and drew replacements.`
    }
    case 'tile_placement_skipped':
      return `${who} had no playable tile and skipped placement.`
    case 'turn_ended':
      return `${who} ended their turn. ${nameOf(names, e.next_player_id)} is up.`
    case 'trade_proposed':
    case 'trade_accepted':
    case 'trade_rejected':
    case 'trade_cancelled':
      return tradeEventText(
        TRADE_EVENT_KIND[e.type],
        e.trade as Record<string, unknown> | undefined,
        names,
        rs,
        { by: e.player_id, reason: e.reason }
      )
    case 'end_game_declared':
      return `${who} declared the game over.`
    case 'game_ended': {
      const standings = (e.standings as { name?: string; player_id?: string }[]) ?? []
      const winner = standings[0]
        ? (standings[0].name ?? nameOf(names, standings[0].player_id))
        : null
      return `Game over (${String(e.reason ?? 'ended').replace(/_/g, ' ')})${winner ? `. Winner: ${winner}` : ''}.`
    }
    default:
      return generic(e)
  }
}

function capitalized(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Sentences for a step's events, in order. A placement and the growth it causes read as one line. */
export function describeEvents(events: EngineEvent[], names: Names, rs: Ruleset): EventLine[] {
  const lx = lexicon(rs)
  const lines: EventLine[] = []
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    const next = events[i + 1]
    let text = one(e, names, lx)
    if (
      e.type === 'tile_placed' &&
      next &&
      e.tile === next.tile &&
      (next.type === 'chain_expanded' || next.type === 'chain_founded')
    ) {
      const who = nameOf(names, e.player_id)
      text =
        next.type === 'chain_expanded'
          ? `${who} placed ${e.tile} — ${lx.chain(next.chain)} grows to ${next.size}.`
          : `${who} placed ${e.tile} — founded ${lx.chain(next.chain)} (${plural(Number(next.size ?? 0), 'tile')}) and received ${
              next.founder_bonus_type === 'cash'
                ? lx.money(next.founder_bonus_value)
                : lx.founderBonus(next.founder_bonus_type, next.founder_bonus_value)
            }.`
      i += 1
    }
    lines.push({
      key: `${e.seq}-${e.type}`,
      type: e.type,
      text,
      isPrivate: e.private_to != null,
    })
  }
  return lines
}

/** One-line summary of an action, e.g. `place 9D`, `buy 2 Sandpiper, 1 Marlowe`. */
export function describeAction(
  action: Record<string, unknown> | null | undefined,
  rs: Ruleset
): string {
  if (!action) return '—'
  const { chain, stockText } = lexicon(rs)
  const a = String(action.action ?? '')
  switch (a) {
    case 'place_tile':
      return action.tile ? `place ${action.tile}` : 'place (no tile)'
    case 'found_chain':
      return `found ${chain(action.chain)}`
    case 'merger_choice':
      return `keep ${chain(action.surviving_chain)}`
    case 'merger_disposition': {
      const d = (action.disposition as Record<string, number>) ?? {}
      return `${chain(action.defunct_chain)}: sell ${d.sell ?? 0} / trade ${d.trade ?? 0} / hold ${d.hold ?? 0}`
    }
    case 'buy_stocks': {
      const p = stockText(action.purchases)
      return p ? `buy ${p}` : 'buy nothing'
    }
    case 'end_turn':
      return 'end turn'
    case 'declare_end_game':
      return 'declare game over'
    case 'propose_trade':
      return 'propose trade'
    case 'accept_trade':
      return 'accept trade'
    case 'reject_trade':
      return 'reject trade'
    case 'cancel_trade':
      return 'cancel trade'
    default:
      return a ? a.replace(/_/g, ' ') : '—'
  }
}

/** Short labels for decision kinds (`found_chain` -> `Found a hotel chain`). */
export function decisionKindLabel(kind: string, rs: Ruleset): string {
  const t = rs.theme
  const labels: Record<string, string> = {
    place_tile: 'Place a tile',
    found_chain: `Found ${withArticle(t.chain_noun)}`,
    choose_survivor: 'Choose survivor',
    choose_defunct_order: `${capitalized(t.merger_noun)} order`,
    stock_disposition: `${capitalized(t.merger_noun)} ${t.share_noun_plural}`,
    buy_stocks: `Buy ${t.share_noun_plural}`,
    trade_response: 'Answer a trade',
  }
  return labels[kind] ?? kind.replace(/_/g, ' ')
}
