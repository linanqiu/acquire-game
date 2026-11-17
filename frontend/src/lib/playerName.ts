/**
 * The name last used to create or join a game, offered again on the home page (BL-015). Kept in
 * this browser only; a browser without storage (private window) simply starts with no name.
 */
const KEY = 'player_name_last'

export function recallName(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function rememberName(name: string): void {
  try {
    localStorage.setItem(KEY, name)
  } catch {
    // Storage unavailable: the name is asked again next time.
  }
}
