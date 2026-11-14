import type { AwaitingDecision } from '../types/api'
import type { Ruleset } from '../types/ruleset'
import { withArticle } from './ruleset'

function what(rs: Ruleset): Record<string, string> {
  const t = rs.theme
  return {
    place_tile: 'place a tile',
    found_chain: `found ${withArticle(t.chain_noun)}`,
    choose_survivor: `choose the surviving ${t.chain_noun}`,
    stock_disposition: `dispose of their ${t.share_noun_plural}`,
    buy_stocks: `buy ${t.share_noun_plural}`,
    trade_response: 'answer a trade offer',
  }
}

/**
 * "Waiting for Bob to dispose of their stock...": names the player whose decision the engine is
 * actually waiting on (which is not always the player whose turn it is, e.g. during a merger),
 * falling back to the player whose turn it is.
 */
export function waitingMessage(
  awaiting: AwaitingDecision | null | undefined,
  players: Record<string, { name: string }>,
  currentPlayerName: string,
  rs: Ruleset
): string {
  const awaitedName = awaiting ? players[awaiting.player_id]?.name : undefined
  const who = awaitedName ?? currentPlayerName
  const doing = (awaitedName && awaiting && what(rs)[awaiting.decision]) || 'take action'
  return `Waiting for ${who} to ${doing}...`
}
