import type { ChainId, SeatKind, TradeOffer } from '../types/api'
import type { Ruleset } from '../types/ruleset'
import { chainName, formatAmount } from './ruleset'

export interface TradeParty {
  name: string
  money: number
  stocks: Partial<Record<ChainId, number>>
  is_bot?: boolean
  kind?: SeatKind
  agent_label?: string | null
}

export function nonZero(stocks: Partial<Record<ChainId, number>> | undefined) {
  return Object.entries(stocks ?? {}).filter(([, q]) => (q ?? 0) > 0) as [ChainId, number][]
}

/** Why `me` cannot fulfil an incoming offer right now, or null when they can. */
export function incomingBlockReason(
  offer: TradeOffer,
  me: TradeParty | undefined,
  proposer: TradeParty | undefined,
  rs: Ruleset
): string | null {
  if (!me) return null
  // A player may hold at most the bank's size of one chain (stocks_per_chain).
  const cap = rs.stocks_per_chain
  const name = (c: ChainId) => chainName(rs, c)
  for (const [chain, qty] of nonZero(offer.requesting_stocks)) {
    if ((me.stocks[chain] ?? 0) < qty)
      return `You only have ${me.stocks[chain] ?? 0} ${name(chain)}`
  }
  if (offer.requesting_money > me.money)
    return `You can't afford ${formatAmount(rs, offer.requesting_money)}`
  for (const [chain, qty] of nonZero(offer.offering_stocks)) {
    if ((me.stocks[chain] ?? 0) + qty > cap) {
      return `You would hold more than ${cap} ${name(chain)}`
    }
  }
  if (proposer) {
    for (const [chain, qty] of nonZero(offer.offering_stocks)) {
      if ((proposer.stocks[chain] ?? 0) < qty)
        return `${proposer.name} no longer has the ${name(chain)}`
    }
    if (offer.offering_money > proposer.money) return `${proposer.name} can't cover the cash`
  }
  return null
}

export interface TradeItems {
  stocks: { chain: ChainId; quantity: number }[]
  cash: number
}

/**
 * What the trade composer starts from: a tap in the holdings table (a player, or a player's
 * shares of one chain), someone else's public offer (a competing offer), or an offer made to me
 * (a counter-offer).
 */
export interface TradePrefill {
  /** '' when the player has not been chosen yet (a tap on my own shares). */
  partnerId: string
  offer: TradeItems
  want: TradeItems
  /** The offer this one started from (named in the composer). */
  basedOn?: TradeOffer
  /** A counter to `basedOn`, an offer made to me: sending it turns that one down. */
  counter?: boolean
}

export const NO_ITEMS: TradeItems = { stocks: [], cash: 0 }

/** The composer opened from the holdings table: this player, one share of this chain. */
export function startOffer(partnerId: string, chain?: ChainId, side: 'give' | 'get' = 'get') {
  const one: TradeItems = chain ? { stocks: [{ chain, quantity: 1 }], cash: 0 } : NO_ITEMS
  return {
    partnerId,
    offer: side === 'give' ? one : NO_ITEMS,
    want: side === 'get' ? one : NO_ITEMS,
  } satisfies TradePrefill
}

function clampItems(
  stocks: Partial<Record<ChainId, number>> | undefined,
  cash: number,
  holder: Pick<TradeParty, 'money' | 'stocks'> | undefined
): TradeItems {
  return {
    stocks: nonZero(stocks)
      .map(([chain, qty]) => ({
        chain,
        quantity: Math.min(qty, holder?.stocks[chain] ?? 0),
      }))
      .filter((s) => s.quantity > 0),
    cash: Math.max(0, Math.min(cash, holder?.money ?? 0)),
  }
}

/**
 * My own offer, started from an open offer between two other players (offers are public).
 *
 * To the `recipient`: I step in for the proposer, so I give what they offered and ask what
 * they asked. To the `proposer`: I step in for the recipient, so I give what was asked of the
 * recipient and ask for what the proposer offered. Each side is cut down to what its holder
 * has right now, so the builder never opens on something that cannot be sent; it is only a
 * starting point the player edits.
 */
export function competingOffer(
  offer: TradeOffer,
  target: 'recipient' | 'proposer',
  me: TradeParty | undefined,
  players: Record<string, TradeParty>
): TradePrefill {
  const partnerId = target === 'recipient' ? offer.to_player_id : offer.from_player_id
  const partner = players[partnerId]
  const [giveStocks, giveCash, wantStocks, wantCash] =
    target === 'recipient'
      ? [
          offer.offering_stocks,
          offer.offering_money,
          offer.requesting_stocks,
          offer.requesting_money,
        ]
      : [
          offer.requesting_stocks,
          offer.requesting_money,
          offer.offering_stocks,
          offer.offering_money,
        ]
  return {
    partnerId,
    offer: clampItems(giveStocks, giveCash, me),
    want: clampItems(wantStocks, wantCash, partner),
    basedOn: offer,
  }
}

/**
 * My counter to an offer made to me: the same deal seen from my side (I give what they asked,
 * I get what they offered), cut down to what each of us holds, for me to change. It is an
 * ordinary proposal to the player who made the offer; sending it turns their offer down.
 */
export function counterOffer(
  offer: TradeOffer,
  me: TradeParty | undefined,
  players: Record<string, TradeParty>
): TradePrefill {
  return { ...competingOffer(offer, 'proposer', me, players), counter: true }
}

// ---- The preview of an offer (BL-021) --------------------------------------------------------

/** A player's bonus standing in a chain, as the server's calculator names it. */
export type Standing =
  | 'none'
  | 'minority_tied'
  | 'minority_sole'
  | 'majority_tied'
  | 'majority_sole'

export interface PositionChange {
  chain: ChainId
  player_id: string
  before: Standing
  after: Standing
  shares_before: number
  shares_after: number
}

/**
 * What an offer would do (`POST /api/room/{room}/trade-preview/{player}`; the server's
 * `trade_preview`): can it be made, both sides at list prices, every change of majority or
 * minority standing, and, for a draft addressed to a rules-based bot, what the bot would answer.
 */
export interface TradePreview {
  valid: boolean
  error: string
  from_player_id?: string
  to_player_id?: string
  list?: { offering: number; requesting: number }
  positions?: PositionChange[]
  bot?: { player_id: string; acceptable: boolean; cash_needed: number | null } | null
}

/** The body of a draft: the fields of a `propose_trade` action. */
export interface TradeDraft {
  to_player_id: string
  offering_stocks: Partial<Record<ChainId, number>>
  offering_money: number
  requesting_stocks: Partial<Record<ChainId, number>>
  requesting_money: number
}

export function toRecord(stocks: TradeItems['stocks']): Partial<Record<ChainId, number>> {
  const out: Partial<Record<ChainId, number>> = {}
  for (const { chain, quantity } of stocks) if (quantity > 0) out[chain] = quantity
  return out
}

/** Ask the server what a draft (or an open offer, by id) would do. Null when it cannot say. */
export async function fetchTradePreview(
  room: string,
  playerId: string,
  body: TradeDraft | { trade_id: string },
  signal?: AbortSignal
): Promise<TradePreview | null> {
  try {
    const res = await fetch(
      `/api/room/${encodeURIComponent(room)}/trade-preview/${encodeURIComponent(playerId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      }
    )
    if (!res.ok) return null
    const data = (await res.json()) as TradePreview
    return typeof data?.valid === 'boolean' ? data : null
  } catch {
    return null
  }
}

const RANK: Record<Standing, number> = {
  none: 0,
  minority_tied: 1,
  minority_sole: 2,
  majority_tied: 3,
  majority_sole: 4,
}

/**
 * One change of standing in words, without the chain (the caller shows its swatch and name):
 * "You take 1st", "Bob drops to 2nd", "Cara ties for 2nd", "Dev loses the bonus".
 */
export function positionText(change: PositionChange, who: string, me: boolean): string {
  const up = RANK[change.after] > RANK[change.before]
  const s = (verb: string) => (me ? verb : `${verb}s`)
  const lose = me ? 'lose' : 'loses'
  switch (change.after) {
    case 'majority_sole':
      return `${who} ${s('take')} 1st`
    case 'majority_tied':
      return up ? `${who} ${s('tie')} for 1st` : `${who} ${s('drop')} to a tie for 1st`
    case 'minority_sole':
      return up ? `${who} ${s('take')} 2nd` : `${who} ${s('drop')} to 2nd`
    case 'minority_tied':
      return up ? `${who} ${s('tie')} for 2nd` : `${who} ${s('drop')} to a tie for 2nd`
    default:
      return `${who} ${lose} the bonus`
  }
}

/** The changes of standing of an offer, grouped by chain, mine first, in words. */
export function positionLines(
  positions: PositionChange[] | undefined,
  names: Record<string, string>,
  myId: string | undefined
): { chain: ChainId; text: string }[] {
  const byChain = new Map<ChainId, PositionChange[]>()
  for (const p of positions ?? []) byChain.set(p.chain, [...(byChain.get(p.chain) ?? []), p])
  return [...byChain.entries()].map(([chain, list]) => ({
    chain,
    text: [...list]
      .sort((a, b) => Number(b.player_id === myId) - Number(a.player_id === myId))
      .map((p) =>
        positionText(
          p,
          p.player_id === myId ? 'You' : (names[p.player_id] ?? 'Someone'),
          p.player_id === myId
        )
      )
      .join(' · '),
  }))
}
