import { APIRequestContext } from '@playwright/test'

const API_URL = 'http://127.0.0.1:8000'

export interface GameConfig {
  hostName: string
  playerNames?: string[]
}

export interface GameSetupResult {
  roomCode: string
  hostPlayerId: string
  hostSessionToken: string
  players: Array<{
    name: string
    playerId: string
    sessionToken: string
  }>
}

/**
 * Create a new game via the API.
 *
 * @param request - Playwright APIRequestContext
 * @param config - Game configuration with host name and optional player names
 * @returns Game setup result with room code and player credentials
 */
export async function createGame(
  request: APIRequestContext,
  config: GameConfig
): Promise<GameSetupResult> {
  // Create game
  const createRes = await request.post(`${API_URL}/create`, {
    form: { player_name: config.hostName },
  })

  if (!createRes.ok()) {
    throw new Error(`Failed to create game: ${await createRes.text()}`)
  }

  const createData = await createRes.json()

  const result: GameSetupResult = {
    roomCode: createData.room_code,
    hostPlayerId: createData.player_id,
    hostSessionToken: createData.session_token,
    players: [],
  }

  // Join additional players
  for (const name of config.playerNames || []) {
    const joinRes = await request.post(`${API_URL}/join`, {
      form: { player_name: name, room_code: result.roomCode },
    })

    if (!joinRes.ok()) {
      throw new Error(`Failed to join game as ${name}: ${await joinRes.text()}`)
    }

    const joinData = await joinRes.json()
    result.players.push({
      name,
      playerId: joinData.player_id,
      sessionToken: joinData.session_token,
    })
  }

  return result
}

/**
 * Start a game via the API.
 *
 * @param request - Playwright APIRequestContext
 * @param roomCode - Room code of the game to start
 * @param hostSessionToken - Session token of the host
 */
export async function startGame(
  request: APIRequestContext,
  roomCode: string,
  _hostSessionToken?: string
): Promise<void> {
  const res = await request.post(`${API_URL}/room/${roomCode}/start`)

  if (!res.ok()) {
    throw new Error(`Failed to start game: ${await res.text()}`)
  }
}

/**
 * Add a bot to a room via the API.
 *
 * @param request - Playwright APIRequestContext
 * @param roomCode - Room code of the game
 * @returns Bot ID
 */
export async function addBot(request: APIRequestContext, roomCode: string): Promise<string> {
  const res = await request.post(`${API_URL}/room/${roomCode}/add-bot`)

  if (!res.ok()) {
    throw new Error(`Failed to add bot: ${await res.text()}`)
  }

  const data = await res.json()
  return data.bot_id
}

/**
 * Get current room state via the API.
 * Note: This returns room metadata (started, players, etc.), not game state.
 * Full game state is obtained via WebSocket.
 *
 * @param request - Playwright APIRequestContext
 * @param roomCode - Room code of the game
 * @returns Room state object
 */
export async function getRoomState(request: APIRequestContext, roomCode: string): Promise<unknown> {
  const res = await request.get(`${API_URL}/room/${roomCode}/state`)

  if (!res.ok()) {
    throw new Error(`Failed to get room state: ${await res.text()}`)
  }

  return res.json()
}

// Alias for backward compatibility
export const getGameState = getRoomState
