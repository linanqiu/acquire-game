/**
 * Readable sentences for engine events and decision actions.
 * Unknown event types fall back to a generic "type key=value ..." line.
 */

import type { EngineEvent } from '../types/transcripts'

export type Names = Record<string, string>

export interface EventLine {
  key: string
  type: string
  text: string
  /** Information only the acting seat saw (hands, draws). */
  isPrivate: boolean
}

const money = (n: unknown) => `$${Number(n ?? 0).toLocaleString('en-US')}`
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export function nameOf(names: Names, pid: unknown): string {
  if (typeof pid !== 'string') return 'The game'
  return names[pid] ?? pid
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function stockText(stocks: unknown): string {
  const entries = Object.entries((stocks as Record<string, number>) ?? {}).filter(([, n]) => n > 0)
  return entries.length ? entries.map(([c, n]) => `${n} ${c}`).join(', ') : ''
}

export function tradeText(t: Record<string, unknown> | undefined, names: Names): string {
  if (!t) return 'a trade'
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

function generic(e: EngineEvent): string {
  const skip = new Set(['seq', 'type', 'player_id', 'private_to'])
  const parts = Object.entries(e)
    .filter(([k]) => !skip.has(k))
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
  const who = e.player_id ? `${e.player_id}: ` : ''
  return `${who}${e.type.replace(/_/g, ' ')}${parts.length ? ` (${parts.join(', ')})` : ''}`
}

function one(e: EngineEvent, names: Names): string {
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
      const chains = (e.chains as string[]) ?? []
      switch (e.outcome) {
        case 'nothing':
          return `${who} placed ${e.tile}.`
        case 'expand':
          return `${who} placed ${e.tile} — ${list(chains)} grows.`
        case 'found':
          return `${who} placed ${e.tile} — a new chain can be founded.`
        case 'merge':
        case 'merge_tie':
          return `${who} placed ${e.tile} — merger of ${list(chains)}.`
        default:
          return `${who} placed ${e.tile}.`
      }
    }
    case 'chain_founded': {
      const bonus =
        e.founder_bonus_type === 'cash'
          ? `${money(e.founder_bonus_value)} bonus`
          : `${plural(Number(e.founder_bonus_value ?? 1), 'free share')}`
      return `${who} founded ${e.chain} (${plural(Number(e.size ?? 0), 'tile')}) and received ${bonus}.`
    }
    case 'chain_expanded':
      return `${e.chain} grows to ${e.size}.`
    case 'survivor_chosen':
      return `${who} chose ${e.survivor} to survive the tie.`
    case 'merger_started': {
      const defunct = ((e.defunct as string[]) ?? []).join(', ')
      return `Merger: ${e.survivor} absorbs ${defunct}.`
    }
    case 'bonuses_paid': {
      const b = (e.bonuses as Record<string, { majority?: number; minority?: number }>) ?? {}
      const parts = Object.entries(b).map(([pid, v]) => {
        const bits = [
          v.majority ? `${money(v.majority)} majority` : '',
          v.minority ? `${money(v.minority)} minority` : '',
        ].filter(Boolean)
        return `${nameOf(names, pid)} ${bits.join(' + ') || '$0'}`
      })
      return `${e.final ? 'Final bonuses' : 'Bonuses'} for ${e.chain}: ${parts.join('; ') || 'none'}.`
    }
    case 'stock_disposition': {
      const sell = Number(e.sell ?? 0)
      const trade = Number(e.trade ?? 0)
      const hold = Number(e.hold ?? 0)
      const bits = [
        sell ? `sold ${sell} (${money(e.sale_proceeds)})` : '',
        trade
          ? `traded ${trade} for ${Number(e.survivor_shares_received ?? trade / 2)} ${e.surviving_chain}`
          : '',
        hold ? `kept ${hold}` : '',
      ].filter(Boolean)
      return `${who} ${e.defunct_chain} stock: ${bits.join(', ') || 'nothing to dispose'}.`
    }
    case 'merger_completed':
      return `Merger complete: ${e.survivor} now has ${e.survivor_size} tiles.`
    case 'stocks_purchased': {
      const p = stockText(e.purchases)
      return p ? `${who} bought ${p} for ${money(e.total_cost)}.` : `${who} bought no stock.`
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
      return `${who} proposed a trade: ${tradeText(e.trade as Record<string, unknown>, names)}.`
    case 'trade_accepted':
      return `${who} accepted the trade: ${tradeText(e.trade as Record<string, unknown>, names)}.`
    case 'trade_rejected':
      return `${who} rejected a trade offer.`
    case 'trade_cancelled':
      return `A trade offer was cancelled (${String(e.reason ?? 'cancelled').replace(/_/g, ' ')}).`
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

/** Sentences for a step's events, in order. A placement and the growth it causes read as one line. */
export function describeEvents(events: EngineEvent[], names: Names): EventLine[] {
  const lines: EventLine[] = []
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    const next = events[i + 1]
    let text = one(e, names)
    if (
      e.type === 'tile_placed' &&
      next &&
      e.tile === next.tile &&
      (next.type === 'chain_expanded' || next.type === 'chain_founded')
    ) {
      const who = nameOf(names, e.player_id)
      text =
        next.type === 'chain_expanded'
          ? `${who} placed ${e.tile} — ${next.chain} grows to ${next.size}.`
          : `${who} placed ${e.tile} — founded ${next.chain} (${plural(Number(next.size ?? 0), 'tile')}) and received ${
              next.founder_bonus_type === 'cash'
                ? `${money(next.founder_bonus_value)}`
                : plural(Number(next.founder_bonus_value ?? 1), 'free share')
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

/** One-line summary of an action, e.g. `place 9D`, `buy 2 Luxor, 1 Tower`. */
export function describeAction(action: Record<string, unknown> | null | undefined): string {
  if (!action) return '—'
  const a = String(action.action ?? '')
  switch (a) {
    case 'place_tile':
      return action.tile ? `place ${action.tile}` : 'place (no tile)'
    case 'found_chain':
      return `found ${action.chain}`
    case 'merger_choice':
      return `keep ${action.surviving_chain}`
    case 'merger_disposition': {
      const d = (action.disposition as Record<string, number>) ?? {}
      return `${action.defunct_chain}: sell ${d.sell ?? 0} / trade ${d.trade ?? 0} / hold ${d.hold ?? 0}`
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

export const DECISION_KIND_LABEL: Record<string, string> = {
  place_tile: 'Place a tile',
  found_chain: 'Found a chain',
  choose_survivor: 'Choose survivor',
  stock_disposition: 'Merger stock',
  buy_stocks: 'Buy stock',
  trade_response: 'Answer a trade',
}

export function decisionKindLabel(kind: string): string {
  return DECISION_KIND_LABEL[kind] ?? kind.replace(/_/g, ' ')
}
