/**
 * E2E Test Helpers - Game Operations
 *
 * Higher-level helper functions for game setup and play.
 */

import type { Page, APIRequestContext } from '@playwright/test'
import { createRoom, addBot, startGame } from './api'
import { connectWebSocket, waitForMessage, sendAction } from './websocket'
import type { GameStateMessage } from '../../../src/types/api'

export interface GameSetup {
  roomCode: string
  humanPlayer: { id: string; token: string }
  botIds: string[]
}

/**
 * Set up a game with the specified number of bots.
 * Creates room, adds bots, connects WebSocket, and starts game.
 */
export async function setupGameWithBots(
  request: APIRequestContext,
  page: Page,
  humanName: string,
  botCount: number
): Promise<GameSetup> {
  // Create room
  const { room_code, player_id, session_token } = await createRoom(request, humanName)

  // Add bots
  const botIds: string[] = []
  for (let i = 0; i < botCount; i++) {
    const { bot_id } = await addBot(request, room_code)
    botIds.push(bot_id)
  }

  // Navigate to a page (needed for evaluate context)
  await page.goto('/')

  // Connect WebSocket
  await connectWebSocket(page, room_code, player_id, session_token)

  // Start game
  await startGame(request, room_code)

  // Wait for initial game state
  await waitForMessage<GameStateMessage>(page, { type: 'game_state' })

  return {
    roomCode: room_code,
    humanPlayer: { id: player_id, token: session_token },
    botIds,
  }
}

/**
 * Wait for it to be the human player's turn.
 */
export async function waitForHumanTurn(
  page: Page,
  playerId: string,
  timeout = 15000
): Promise<GameStateMessage> {
  return waitForMessage<GameStateMessage>(
    page,
    { type: 'game_state', current_player: playerId },
    timeout
  )
}

/**
 * Wait for a specific game phase.
 */
export async function waitForPhase(
  page: Page,
  phase: 'waiting' | 'playing' | 'game_over',
  timeout = 10000
): Promise<GameStateMessage> {
  return waitForMessage<GameStateMessage>(page, { type: 'game_state', phase }, timeout)
}

/**
 * Play a tile from the player's hand.
 */
export async function playTile(page: Page, tile: string): Promise<void> {
  await sendAction(page, { action: 'place_tile', tile })
}

/**
 * Buy stocks.
 */
export async function buyStocks(page: Page, purchases: Record<string, number>): Promise<void> {
  await sendAction(page, { action: 'buy_stocks', purchases })
}

/**
 * End the current turn.
 */
export async function endTurn(page: Page): Promise<void> {
  await sendAction(page, { action: 'end_turn' })
}

/**
 * Found a new chain.
 */
export async function foundChain(page: Page, chainName: string): Promise<void> {
  await sendAction(page, { action: 'found_chain', chain: chainName })
}

/**
 * Choose the surviving chain in a merger.
 */
export async function chooseMergerSurvivor(page: Page, chainName: string): Promise<void> {
  await sendAction(page, { action: 'merger_choice', surviving_chain: chainName })
}

/**
 * Handle stock disposition during a merger.
 */
export async function handleStockDisposition(
  page: Page,
  defunctChain: string,
  disposition: { sell: number; trade: number; hold: number }
): Promise<void> {
  await sendAction(page, {
    action: 'merger_disposition',
    defunct_chain: defunctChain,
    disposition,
  })
}
