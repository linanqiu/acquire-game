/**
 * E2E Test Helpers - API Operations
 *
 * Helper functions for interacting with the backend API during E2E tests.
 */

import type { APIRequestContext } from '@playwright/test'

const API_URL = 'http://localhost:8000'

export interface RoomCreationResult {
  room_code: string
  player_id: string
  session_token: string
  is_host?: boolean
}

export interface AddBotResult {
  bot_id: string
}

export interface RoomState {
  room_code: string
  started: boolean
  players: Array<{ player_id: string; name: string; is_bot: boolean }>
  min_players: number
  max_players: number
}

/**
 * Create a new game room via the API.
 */
export async function createRoom(
  request: APIRequestContext,
  playerName: string
): Promise<RoomCreationResult> {
  const response = await request.post(`${API_URL}/create`, {
    form: { player_name: playerName },
  })
  if (!response.ok()) {
    throw new Error(`Failed to create room: ${response.status()}`)
  }
  return response.json()
}

/**
 * Join an existing room via the API.
 */
export async function joinRoom(
  request: APIRequestContext,
  roomCode: string,
  playerName: string
): Promise<RoomCreationResult> {
  const response = await request.post(`${API_URL}/join`, {
    form: { room_code: roomCode, player_name: playerName },
  })
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Failed to join room: ${response.status()} - ${body}`)
  }
  return response.json()
}

/**
 * Add a bot to a room via the API.
 */
export async function addBot(request: APIRequestContext, roomCode: string): Promise<AddBotResult> {
  const response = await request.post(`${API_URL}/room/${roomCode}/add-bot`)
  if (!response.ok()) {
    throw new Error(`Failed to add bot: ${response.status()}`)
  }
  return response.json()
}

/**
 * Start the game in a room via the API.
 */
export async function startGame(request: APIRequestContext, roomCode: string): Promise<void> {
  const response = await request.post(`${API_URL}/room/${roomCode}/start`)
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Failed to start game: ${response.status()} - ${body}`)
  }
}

/**
 * Get current room state via the API.
 */
export async function getRoomState(
  request: APIRequestContext,
  roomCode: string
): Promise<RoomState> {
  const response = await request.get(`${API_URL}/room/${roomCode}/state`)
  if (!response.ok()) {
    throw new Error(`Failed to get room state: ${response.status()}`)
  }
  return response.json()
}
