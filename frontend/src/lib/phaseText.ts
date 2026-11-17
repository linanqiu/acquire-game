/**
 * Phase banner text, worded from the ruleset's theme (chain noun, share noun, merger noun,
 * stock label). Default: "CHOOSE A HOTEL CHAIN", "DISPOSE YOUR SHARES", "BUY STOCKS".
 */

import type { GamePhase } from '../types/api'
import type { Ruleset } from '../types/ruleset'
import { withArticle } from './ruleset'

const up = (s: string) => s.toUpperCase()

function foundPhaseText(rs: Ruleset): string {
  return up(`Choose ${withArticle(rs.theme.chain_noun)}`)
}

export function survivorPhaseText(rs: Ruleset): string {
  return up(`Choose the surviving ${rs.theme.chain_noun}`)
}

export function orderPhaseText(rs: Ruleset): string {
  return up(`Choose the ${rs.theme.merger_noun} order`)
}

export function dispositionPhaseText(rs: Ruleset): string {
  return up(`Dispose your ${rs.theme.share_noun_plural}`)
}

export function buyPhaseText(rs: Ruleset): string {
  return up(`Buy ${rs.theme.stock_label}`)
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
