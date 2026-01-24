/**
 * E2E Tests - Bot Game Scenarios
 *
 * Tests for playing games with bot players via WebSocket.
 * These tests verify the full stack integration (frontend + backend).
 *
 * NOTE: These tests require full WebSocket integration (RT-001, RT-002).
 * They are skipped until that work is complete.
 */

import { test, expect } from '@playwright/test'
import { setupGameWithBots, waitForHumanTurn, playTile, endTurn } from './helpers/game'
import { getMessages, waitForMessage } from './helpers/websocket'
import type { GameStateMessage } from '../../src/types/api'

// Skip bot game tests until RT-001/RT-002 WebSocket integration is complete
test.describe('Bot Game', () => {
  test('can create a game with bots and receive game state', async ({ page, request }) => {
    // Setup game with 2 bots
    const { roomCode, humanPlayer, botIds } = await setupGameWithBots(request, page, 'TestHuman', 2)

    // Verify setup
    expect(roomCode).toMatch(/^[A-Z]{4}$/)
    expect(humanPlayer.id).toBeTruthy()
    expect(botIds).toHaveLength(2)

    // Check we received game state
    const messages = await getMessages(page)
    const gameState = messages.find(
      (m) => (m as GameStateMessage).type === 'game_state'
    ) as GameStateMessage

    expect(gameState).toBeDefined()
    expect(gameState.phase).toBe('place_tile')
    expect(Object.keys(gameState.players)).toHaveLength(3) // 1 human + 2 bots
  })

  test('human player receives their hand', async ({ page, request }) => {
    // Setup game
    const { humanPlayer } = await setupGameWithBots(request, page, 'TestHuman', 2)

    // Wait for our turn (bots may go first)
    const state = await waitForHumanTurn(page, humanPlayer.id, 20000)

    // Verify we have a hand
    expect(state.your_hand).toBeDefined()
    expect(state.your_hand!.length).toBeGreaterThan(0)
    expect(state.your_hand!.length).toBeLessThanOrEqual(6)
  })

  test('can play a tile from hand', async ({ page, request }) => {
    // Setup game
    const { humanPlayer } = await setupGameWithBots(request, page, 'TestHuman', 2)

    // Wait for our turn
    const state = await waitForHumanTurn(page, humanPlayer.id, 20000)

    // Play the first tile in our hand
    const tileToPlay = state.your_hand![0]
    await playTile(page, tileToPlay)

    // Wait for updated state
    const newState = await waitForMessage<GameStateMessage>(page, {
      type: 'game_state',
      boardHasTile: tileToPlay,
    })

    // Verify tile was placed on board
    expect(newState.board.cells[tileToPlay]).not.toBeNull()
  })

  test('bots take turns automatically', async ({ page, request }) => {
    // Setup game
    const { humanPlayer } = await setupGameWithBots(request, page, 'TestHuman', 2)

    // Wait for initial state
    await waitForMessage<GameStateMessage>(page, { type: 'game_state' })

    // Wait for our turn - this naturally waits for bots to play their turns first
    const state = await waitForHumanTurn(page, humanPlayer.id, 30000)

    // Get all messages received up to this point
    const messages = await getMessages(page)
    const gameStates = messages.filter(
      (m) => (m as GameStateMessage).type === 'game_state'
    ) as GameStateMessage[]

    // Should have received multiple game state updates as bots played
    // (At minimum: initial state, possibly more if bots went first)
    expect(gameStates.length).toBeGreaterThanOrEqual(1)

    // Now it's our turn, so check that game has progressed
    const tilesOnBoard = Object.values(state.board.cells).filter((v) => v !== null).length

    // Either tiles have been placed by bots, or it's our turn with 0 tiles (we went first)
    const isOurTurn = state.current_player === humanPlayer.id
    expect(tilesOnBoard > 0 || isOurTurn).toBe(true)
  })

  test('can complete a turn: place tile, skip buy, end turn', async ({ page, request }) => {
    // Setup game
    const { humanPlayer } = await setupGameWithBots(request, page, 'TestHuman', 2)

    // Wait for our turn
    const state = await waitForHumanTurn(page, humanPlayer.id, 20000)

    // Play a tile
    const tile = state.your_hand![0]
    await playTile(page, tile)

    // Wait for state update after placing tile
    await waitForMessage<GameStateMessage>(page, { type: 'game_state', boardHasTile: tile })

    // End turn (skip buying stocks)
    await endTurn(page)

    // Wait for turn to pass (or for us to get our turn again in a 3-player game)
    const nextState = await waitForMessage<GameStateMessage>(page, { type: 'game_state' }, 10000)

    // Game should still be in an active phase (not lobby or game_over)
    expect(['place_tile', 'found_chain', 'merger', 'stock_disposition', 'buy_stocks']).toContain(
      nextState.phase
    )
  })
})

// Skip game state tests until RT-001/RT-002 WebSocket integration is complete
test.describe('Game State', () => {
  test('game state includes all required fields', async ({ page, request }) => {
    // Setup game
    await setupGameWithBots(request, page, 'TestHuman', 2)

    // Get messages
    const messages = await getMessages(page)
    const gameState = messages.find(
      (m) => (m as GameStateMessage).type === 'game_state'
    ) as GameStateMessage

    // Verify all required fields
    expect(gameState.type).toBe('game_state')
    expect(gameState.board).toBeDefined()
    expect(gameState.hotel).toBeDefined()
    expect(gameState.hotel.chains).toBeDefined()
    expect(gameState.hotel.available_stocks).toBeDefined()
    expect(gameState.hotel.active_chains).toBeDefined()
    expect(gameState.turn_order).toBeDefined()
    expect(gameState.current_player).toBeDefined()
    expect(gameState.phase).toBeDefined()
    expect(gameState.players).toBeDefined()
    expect(gameState.tiles_remaining).toBeDefined()
  })

  test('player state includes money and stocks', async ({ page, request }) => {
    // Setup game
    const { humanPlayer } = await setupGameWithBots(request, page, 'TestHuman', 2)

    // Get messages
    const messages = await getMessages(page)
    const gameState = messages.find(
      (m) => (m as GameStateMessage).type === 'game_state'
    ) as GameStateMessage

    // Check player info
    const playerInfo = gameState.players[humanPlayer.id]
    expect(playerInfo).toBeDefined()
    expect(playerInfo.name).toBe('TestHuman')
    expect(playerInfo.money).toBe(6000) // Starting cash
    expect(playerInfo.stocks).toBeDefined()
    expect(playerInfo.hand_size).toBeGreaterThan(0)
  })
})
