/**
 * Phase banner text, worded from the ruleset's theme (chain noun, share noun, merger noun,
 * stock label). Default: "CHOOSE A HOTEL CHAIN", "DISPOSE YOUR SHARES", "BUY STOCKS".
 */

import type { AwaitingDecision, GamePhase } from '../types/api'
import type { Ruleset } from '../types/ruleset'
import { withArticle } from './ruleset'

const up = (s: string) => s.toUpperCase()

function foundPhaseText(rs: Ruleset): string {
  return up(`Choose ${withArticle(rs.theme.chain_noun)}`)
}

export function survivorPhaseText(rs: Ruleset): string {
  return up(`Choose the surviving ${rs.theme.chain_noun}`)
}

export function dispositionPhaseText(rs: Ruleset): string {
  return up(`Dispose your ${rs.theme.share_noun_plural}`)
}

export function buyPhaseText(rs: Ruleset): string {
  return up(`Buy ${rs.theme.stock_label}`)
}

/**
 * The player page's banner in the lobby (BL-015): the one line that says what the room waits
 * for. The host reads how many players are missing, or that the start is theirs to press; a
 * guest reads that the host starts.
 */
export function lobbyPhaseText(isHost: boolean, players: number, minPlayers: number): string {
  if (!isHost) return 'WAITING FOR THE HOST TO START'
  const missing = minPlayers - players
  if (missing > 0) return `NEED ${missing} MORE PLAYER${missing > 1 ? 'S' : ''} TO START`
  return 'START WHEN EVERYONE IS IN'
}

/**
 * The player page's banner while the table waits on someone else (BL-015): who, and what they
 * are doing ("CARA IS BUYING SHARES"). It names the player the engine waits on, who is not
 * always the player on turn (a merger asks each stockholder). `shortName` is what a narrow row
 * prints for that seat. An unknown decision falls back to "<NAME>'s TURN".
 */
export function waitingPhaseText(
  rs: Ruleset,
  awaiting: AwaitingDecision | null | undefined,
  players: Record<string, { name: string }>,
  currentPlayerName: string,
  shortName?: (playerId: string) => string | undefined
): string {
  const t = rs.theme
  const doing: Record<string, string> = {
    place_tile: 'placing a tile',
    found_chain: `founding ${withArticle(t.chain_noun)}`,
    choose_survivor: `choosing the surviving ${t.chain_noun}`,
    stock_disposition: `disposing of ${t.share_noun_plural}`,
    buy_stocks: `buying ${t.share_noun_plural}`,
    trade_response: 'answering a trade offer',
  }
  const awaited = awaiting ? players[awaiting.player_id] : undefined
  const what = awaited && awaiting ? doing[awaiting.decision] : undefined
  if (!awaited || !awaiting || !what) return `${currentPlayerName}'s TURN`
  return up(`${shortName?.(awaiting.player_id) ?? awaited.name} is ${what}`)
}

/** The player page's banner. */
export function playerPhaseText(
  rs: Ruleset,
  phase: GamePhase,
  isMyTurn: boolean,
  currentPlayerName: string
): string {
  if (phase === 'lobby') return 'WAITING FOR HOST'
  if (phase === 'game_over') return 'GAME OVER'
  if (!isMyTurn) return `${currentPlayerName}'s TURN`

  switch (phase) {
    case 'place_tile':
      return 'PLACE A TILE'
    case 'found_chain':
      return foundPhaseText(rs)
    case 'merger':
      return up(`${rs.theme.merger_noun} in progress`)
    case 'stock_disposition':
      return dispositionPhaseText(rs)
    case 'buy_stocks':
      return buyPhaseText(rs)
    default: {
      const _exhaustiveCheck: never = phase
      return String(_exhaustiveCheck).toUpperCase()
    }
  }
}

/** The host view's banner: `<name>'s TURN - <step>`. */
export function hostPhaseText(rs: Ruleset, phase: GamePhase, currentPlayerName: string): string {
  if (phase === 'lobby') return 'WAITING FOR PLAYERS'
  if (phase === 'game_over') return 'GAME OVER'

  const step = (() => {
    switch (phase) {
      case 'place_tile':
        return 'PLACE TILE'
      case 'found_chain':
        return up(`Found ${withArticle(rs.theme.chain_noun)}`)
      case 'merger':
        return up(rs.theme.merger_noun)
      case 'stock_disposition':
        return up(`${rs.theme.merger_noun}: ${rs.theme.share_noun_plural}`)
      case 'buy_stocks':
        return buyPhaseText(rs)
      default: {
        const _exhaustiveCheck: never = phase
        return String(_exhaustiveCheck).toUpperCase()
      }
    }
  })()

  return `${currentPlayerName}'s TURN - ${step}`
}
