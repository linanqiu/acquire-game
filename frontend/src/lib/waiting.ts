import type { AwaitingDecision } from '../types/api'

const WHAT: Record<string, string> = {
  place_tile: 'place a tile',
  found_chain: 'found a chain',
  choose_survivor: 'choose the surviving chain',
  stock_disposition: 'dispose of their stock',
  buy_stocks: 'buy stock',
  trade_response: 'answer a trade offer',
}

/**
 * "Waiting for Bob to dispose of their stock...": names the player whose decision the engine is
 * actually waiting on (which is not always the player whose turn it is, e.g. during a merger),
 * falling back to the player whose turn it is.
 */
export function waitingMessage(
  awaiting: AwaitingDecision | null | undefined,
  players: Record<string, { name: string }>,
  currentPlayerName: string
): string {
  const awaitedName = awaiting ? players[awaiting.player_id]?.name : undefined
  const who = awaitedName ?? currentPlayerName
  const what = (awaitedName && awaiting && WHAT[awaiting.decision]) || 'take action'
  return `Waiting for ${who} to ${what}...`
}
