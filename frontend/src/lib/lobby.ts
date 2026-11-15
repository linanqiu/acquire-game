/** The lobby's shared pieces (player and host pages): starting the game and the start hint. */

/** POST /room/<room>/start. Throws when the server refuses (e.g. too few players). */
export async function startGame(room: string): Promise<void> {
  const res = await fetch(`/api/room/${room}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error('Failed to start game')
}

/** "Need 2 more players to start" / "Ready to start!" */
export function startHint(players: number, minPlayers: number): string {
  const missing = minPlayers - players
  if (missing <= 0) return 'Ready to start!'
  return `Need ${missing} more player${missing > 1 ? 's' : ''} to start`
}
