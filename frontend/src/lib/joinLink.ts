/**
 * Join links (BL-018): the lobby shares `<origin>/?code=ABCD`; the home page opens its join step
 * with the code filled in. `/?join` opens the join step empty.
 */
export const ROOM_CODE_LENGTH = 4

/** What may be typed in the room-code field: letters only, upper case, at most four. */
export function cleanCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, ROOM_CODE_LENGTH)
}

/** The join step's code from the URL: null on the name step, '' for `?join`, else the code. */
export function joinStepCode(params: URLSearchParams): string | null {
  const code = params.get('code')
  if (code !== null) return cleanCode(code)
  return params.has('join') ? '' : null
}

/** The link a host shares so a friend lands on the join step with the code filled in. */
export function joinLink(origin: string, room: string): string {
  return `${origin}/?code=${encodeURIComponent(room)}`
}
