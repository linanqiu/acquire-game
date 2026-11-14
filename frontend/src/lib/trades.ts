import type { ChainName, SeatKind, TradeOffer } from '../types/api'

/** Mirrors Player.MAX_STOCKS_PER_CHAIN on the backend. */
const MAX_STOCKS_PER_CHAIN = 25

export interface TradeParty {
  name: string
  money: number
  stocks: Partial<Record<ChainName, number>>
  is_bot?: boolean
  kind?: SeatKind
  agent_label?: string | null
}

export function nonZero(stocks: Partial<Record<ChainName, number>> | undefined) {
  return Object.entries(stocks ?? {}).filter(([, q]) => (q ?? 0) > 0) as [ChainName, number][]
}

/** Why `me` cannot fulfil an incoming offer right now, or null when they can. */
export function incomingBlockReason(
  offer: TradeOffer,
  me: TradeParty | undefined,
  proposer: TradeParty | undefined
): string | null {
  if (!me) return null
  for (const [chain, qty] of nonZero(offer.requesting_stocks)) {
    if ((me.stocks[chain] ?? 0) < qty) return `You only have ${me.stocks[chain] ?? 0} ${chain}`
  }
  if (offer.requesting_money > me.money) return `You can't afford $${offer.requesting_money}`
  for (const [chain, qty] of nonZero(offer.offering_stocks)) {
    if ((me.stocks[chain] ?? 0) + qty > MAX_STOCKS_PER_CHAIN) {
      return `You would hold more than ${MAX_STOCKS_PER_CHAIN} ${chain}`
    }
  }
  if (proposer) {
    for (const [chain, qty] of nonZero(offer.offering_stocks)) {
      if ((proposer.stocks[chain] ?? 0) < qty) return `${proposer.name} no longer has the ${chain}`
    }
    if (offer.offering_money > proposer.money) return `${proposer.name} can't cover the cash`
  }
  return null
}
