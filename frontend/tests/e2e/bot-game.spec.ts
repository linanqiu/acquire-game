/**
 * E2E Tests - Bot Game Scenarios
 *
 * Tests for playing games with bot players via WebSocket.
 * These tests verify the full stack integration (frontend + backend).
 */

import { test, expect } from '@playwright/test'
import { setupGameWithBots, waitForHumanTurn, playTile, endTurn } from './helpers/game'
import { getMessages, waitForMessage } from './helpers/websocket'
import type { GameStateMessage } from '../../src/types/api'

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
    expect(gameState.phase).toBe('playing')
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
    expect(newState.board[tileToPlay]).not.toBeNull()
  })

  test('bots take turns automatically', async ({ page, request }) => {
    // Setup game
    const { humanPlayer } = await setupGameWithBots(request, page, 'TestHuman', 2)

    // Wait for initial state
    await waitForMessage<GameStateMessage>(page, { type: 'game_state' })

    // Wait a bit for bots to potentially take turns
    await page.waitForTimeout(3000)

    // Get all messages
    const messages = await getMessages(page)
    const gameStates = messages.filter(
      (m) => (m as GameStateMessage).type === 'game_state'
    ) as GameStateMessage[]

    // Should have received multiple game state updates as bots played
    // (At minimum: initial state, possibly more if bots went first)
    expect(gameStates.length).toBeGreaterThanOrEqual(1)

    // Check that the game is progressing (tiles on board or it's eventually our turn)
    const lastState = gameStates[gameStates.length - 1]
    const tilesOnBoard = Object.values(lastState.board).filter((v) => v !== null).length

    // Either tiles have been placed, or it's our turn with 0 tiles (we're first)
    const isOurTurn = lastState.current_player === humanPlayer.id
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

    // Game should still be playing
    expect(nextState.phase).toBe('playing')
  })
})

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
