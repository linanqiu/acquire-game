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

/** What the trade builder starts from when a player answers someone else's public offer. */
export interface TradePrefill {
  partnerId: string
  offer: TradeItems
  want: TradeItems
  /** The offer this one started from (shown in the builder). */
  basedOn: TradeOffer
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
