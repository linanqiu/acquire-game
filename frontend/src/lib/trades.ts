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
