import { APIRequestContext } from '@playwright/test'

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
  const createRes = await request.post('/create', {
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
    const joinRes = await request.post('/join', {
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
  hostSessionToken: string
): Promise<void> {
  const res = await request.post(`/games/${roomCode}/start`, {
    headers: { 'X-Session-Token': hostSessionToken },
  })

  if (!res.ok()) {
    throw new Error(`Failed to start game: ${await res.text()}`)
  }
}

/**
 * Get current game state via the API.
 *
 * @param request - Playwright APIRequestContext
 * @param roomCode - Room code of the game
 * @returns Game state object
 */
export async function getGameState(
  request: APIRequestContext,
  roomCode: string
): Promise<unknown> {
  const res = await request.get(`/games/${roomCode}/state`)

  if (!res.ok()) {
    throw new Error(`Failed to get game state: ${await res.text()}`)
  }

  return res.json()
}
