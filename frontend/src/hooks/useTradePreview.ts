import { useEffect, useRef, useState } from 'react'
import { fetchTradePreview, type TradeDraft, type TradePreview } from '../lib/trades'

/** How long the composer waits after the last change before asking (taps come in bursts). */
export const PREVIEW_DELAY_MS = 150

export interface TradePreviewState {
  /** The server's last answer; null until the first one, or when there is nothing to ask. */
  preview: TradePreview | null
  /** True when `preview` answers the offer asked about now (not an earlier draft). */
  current: boolean
}

/**
 * What the server says an offer would do (`trade_preview`): asked again, a moment after the
 * last change, whenever the draft or the game changes. The last answer stays on screen until
 * the next one arrives, so the numbers next to the controls do not blink; `current` says
 * whether they are for the draft on screen now. A move at the table asks again without marking
 * the answer old (the lines are replaced when the new answer is in). `body` null: nothing to ask.
 *
 * `version` is anything that changes when the game does (the game state object).
 */
export function useTradePreview(
  room: string,
  playerId: string | undefined,
  body: TradeDraft | { trade_id: string } | null,
  version?: unknown
): TradePreviewState {
  const key = body ? JSON.stringify(body) : ''
  const [answer, setAnswer] = useState<{ key: string; preview: TradePreview }>()
  const latest = useRef(body)
  useEffect(() => {
    latest.current = body
  })

  useEffect(() => {
    if (!key || !room || !playerId) return
    const abort = new AbortController()
    const timer = setTimeout(async () => {
      const asked = latest.current
      if (!asked) return
      const preview = await fetchTradePreview(room, playerId, asked, abort.signal)
      if (preview && !abort.signal.aborted) setAnswer({ key, preview })
    }, PREVIEW_DELAY_MS)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [room, playerId, key, version])

  if (!key || !answer) return { preview: null, current: false }
  return { preview: answer.preview, current: answer.key === key }
}
