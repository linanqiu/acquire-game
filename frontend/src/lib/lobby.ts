/** The lobby's shared pieces (player and host pages): starting the game and the start hint. */

/** POST /room/<room>/start. Throws when the server refuses (e.g. too few players). */
export async function startGame(room: string): Promise<void> {
  const res = await fetch(`/api/room/${room}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error('Failed to start game')
}

/**
 * "Watch bots play": the server seats its AI players, turns commentary on and starts the game
 * when this page connects. Returns the room to watch at `/host/<room>`.
 */
export async function createShow(): Promise<string> {
  const res = await fetch('/api/create-show', { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || 'Failed to start a game to watch')
  return data.room_code as string
}

/** An empty room to watch, with commentary on: the host lobby picks its AI players. */
export async function createWatchRoom(): Promise<string> {
  const res = await fetch('/api/create-spectator?commentary=1', { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || 'Failed to create a room')
  return data.room_code as string
}

/** Turn the room's commentary on or off (off stops its model calls). */
export async function setCommentary(room: string, enabled: boolean): Promise<void> {
  const res = await fetch(`/api/room/${room}/commentary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  if (!res.ok) throw new Error('Failed to change the commentary setting')
}

/**
 * "Need 2 more players to start", or nothing once the game can start: an enabled START GAME
 * button already says that (BL-017).
 */
export function startHint(players: number, minPlayers: number): string {
  const missing = minPlayers - players
  if (missing <= 0) return ''
  return `Need ${missing} more player${missing > 1 ? 's' : ''} to start`
}
