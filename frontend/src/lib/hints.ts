/**
 * Which one-time instructions this browser's player no longer needs (see `ui/Hint`). Stored in
 * localStorage; where storage is unavailable every hint simply stays visible.
 */
const KEY = 'buyout-hints-seen'

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function hintSeen(id: string): boolean {
  return read().includes(id)
}

/** The player has done what hint `id` explains: from the next time on it is a "?" button. */
export function markHintSeen(id: string): void {
  try {
    const list = read()
    if (list.includes(id)) return
    window.localStorage.setItem(KEY, JSON.stringify([...list, id]))
  } catch {
    // No storage (private mode, blocked): the hint stays.
  }
}
