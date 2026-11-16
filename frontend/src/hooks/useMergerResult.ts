import { useState } from 'react'
import type { MergerRecord } from '../types/api'

/**
 * Which merger the table panel shows by itself (BL-007, BL-011, BL-013). There is nothing to
 * close: a merger is shown while it runs, its result stays after it ends until play moves on
 * (the next tile is placed, or a decision of mine takes the place), and then it is gone. Every
 * merger of the game remains one tap away in the merger log.
 *
 * `auto`: the merger to show now, or null. `live`: the mergers seen in progress or arriving on
 * this page (their start and end are news; the finished ones loaded with the page are not, so
 * a reload does not bring an old result back).
 *
 * @param tilesOnBoard how many tiles are on the board: a new tile means play has moved on.
 */
export function useMergerResult(mergers: MergerRecord[] | undefined, tilesOnBoard: number) {
  const [initialDone, setInitialDone] = useState<number[] | null>(null)
  // The live merger last seen finished, and the board it finished on.
  const [ended, setEnded] = useState<{ seq: number; tiles: number } | null>(null)

  // React's "adjust state when a prop changes" pattern (no effect, no extra render pass).
  if (mergers && initialDone === null) {
    setInitialDone(mergers.filter((m) => m.complete).map((m) => m.seq))
  }
  const before = new Set(initialDone ?? (mergers ?? []).filter((m) => m.complete).map((m) => m.seq))
  const last = mergers?.[mergers.length - 1]
  if (last && last.complete && !before.has(last.seq) && ended?.seq !== last.seq) {
    setEnded({ seq: last.seq, tiles: tilesOnBoard })
  }

  let auto: MergerRecord | null = null
  if (last && !last.complete) auto = last
  else if (last && ended?.seq === last.seq && ended.tiles === tilesOnBoard) auto = last

  return {
    auto,
    live: (mergers ?? []).filter((m) => !before.has(m.seq)).map((m) => m.seq),
  }
}
