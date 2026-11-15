/** The host (spectator) socket: `/ws/host/<room>`, no player credentials. Receive-only. */

import { useGameSocket, type GameSocketOptions } from './useGameSocket'

interface UseHostWebSocketOptions extends GameSocketOptions {
  roomCode: string
}

export function useHostWebSocket({ roomCode, ...options }: UseHostWebSocketOptions) {
  const { reconnect } = useGameSocket(`/ws/host/${roomCode}`, options)
  return { reconnect }
}
