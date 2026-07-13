/**
 * Optimistic Updates (RT-004)
 *
 * Pure functions that compute the *predicted* next game state for a user
 * action, so the UI can update instantly while the action is in flight.
 *
 * The server remains authoritative: every successful action triggers a
 * `game_state` broadcast that overwrites the optimistic prediction (and
 * confirms it), while a rejected action triggers an `error` message that
 * rolls the store back to the snapshot taken before the prediction was
 * applied. See gameStore.beginOptimisticAction / handleMessage.
 *
 * These functions never mutate their inputs.
 */

import type { ChainName, GameStateMessage } from '../types/api'

export interface OptimisticResult {
  gameState: GameStateMessage
  yourHand: string[]
}

/**
 * Predict the state after placing a tile:
 * - The tile appears on the board as a played (orphan) cell.
 * - The tile is removed from the player's hand.
 *
 * Chain growth, founding, and mergers are NOT predicted — the server
 * resolves those and its `game_state` broadcast fills in the details.
 */
export function predictTilePlacement(
  gameState: GameStateMessage,
  yourHand: string[],
  tile: string
): OptimisticResult {
  return {
    gameState: {
      ...gameState,
      board: {
        ...gameState.board,
        cells: {
          ...gameState.board.cells,
          [tile]: { state: 'played', chain: null },
        },
      },
    },
    yourHand: yourHand.filter((t) => t !== tile),
  }
}

/**
 * Predict the state after buying stocks:
 * - Cash is deducted from the buying player.
 * - Purchased stocks are added to the player's holdings.
 * - Available stock counts are decremented.
 *
 * Turn advancement (buy_stocks ends the turn) is NOT predicted — the
 * server's `game_state` broadcast moves the turn forward.
 */
export function predictStockPurchase(
  gameState: GameStateMessage,
  playerId: string,
  purchases: Partial<Record<ChainName, number>>
): GameStateMessage {
  const player = gameState.players[playerId]
  if (!player) return gameState

  const priceByChain: Partial<Record<ChainName, number>> = {}
  for (const chain of gameState.hotel.chains) {
    priceByChain[chain.name] = chain.price
  }

  let totalCost = 0
  const newStocks = { ...player.stocks }
  const newAvailable = { ...gameState.hotel.available_stocks }
  for (const [chainName, quantity] of Object.entries(purchases) as [ChainName, number][]) {
    if (!quantity || quantity <= 0) continue
    totalCost += (priceByChain[chainName] ?? 0) * quantity
    newStocks[chainName] = (newStocks[chainName] ?? 0) + quantity
    newAvailable[chainName] = Math.max(0, (newAvailable[chainName] ?? 0) - quantity)
  }

  return {
    ...gameState,
    hotel: {
      ...gameState.hotel,
      available_stocks: newAvailable,
      chains: gameState.hotel.chains.map((chain) =>
        purchases[chain.name]
          ? { ...chain, stocks_available: newAvailable[chain.name] ?? chain.stocks_available }
          : chain
      ),
    },
    players: {
      ...gameState.players,
      [playerId]: {
        ...player,
        money: player.money - totalCost,
        stocks: newStocks,
      },
    },
  }
}
