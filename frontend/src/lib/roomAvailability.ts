/**
 * "This game does not exist / you are not in it", as reported by the server when it
 * refuses a WebSocket (backend api/ws.py `_refuse`: close code 4004 + reason).
 */

export const NOT_FOUND_CLOSE_CODE = 4004
export const ROOM_NOT_FOUND = 'Room not found'
export const PLAYER_NOT_FOUND = 'Player not found'

export type RoomUnavailable = 'room' | 'player' | null

/** Map the store's connection error to why the room cannot be shown, if that is the case. */
export function roomUnavailable(
  connectionStatus: string,
  connectionError: string | null
): RoomUnavailable {
  if (connectionStatus !== 'error') return null
  if (connectionError === ROOM_NOT_FOUND) return 'room'
  if (connectionError === PLAYER_NOT_FOUND) return 'player'
  return null
}
