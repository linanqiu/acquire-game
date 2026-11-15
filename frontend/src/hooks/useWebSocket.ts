/** The player's game socket: `/ws/player/<room>/<player id>`, plus sending actions. */

import { useCallback } from 'react'
import type { GameAction } from '../types/api'
import { useGameSocket, type GameSocketOptions } from './useGameSocket'

// Player id used when this browser has no credentials: the server answers "Player not
// found" (or "Room not found"), which the page turns into a clear message.
const NO_PLAYER = '-'

interface UseWebSocketOptions extends GameSocketOptions {
  roomCode: string
  playerId: string
}

export function useWebSocket({ roomCode, playerId, ...options }: UseWebSocketOptions) {
  const { send, reconnect } = useGameSocket(
    `/ws/player/${roomCode}/${playerId || NO_PLAYER}`,
    options
  )
  const sendAction = useCallback((action: GameAction) => send(action), [send])
  return { sendAction, reconnect }
}
