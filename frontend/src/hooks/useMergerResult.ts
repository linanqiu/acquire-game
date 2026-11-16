import { useState } from 'react'
import type { MergerRecord } from '../types/api'

function readDismissed(key: string): number[] {
  try {
    const raw = sessionStorage.getItem(key)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((n): n is number => typeof n === 'number') : []
  } catch {
    return []
  }
}

function writeDismissed(key: string, seqs: number[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify(seqs.slice(-50)))
  } catch {
    // Storage unavailable (private window): the result may show again after a reload.
  }
}

/**
 * Which merger the decision tab shows (BL-007, BL-011). A merger is shown by itself when it
 * appears (or is still in progress when the page loads) and stays until the viewer closes it,
 * or a newer merger replaces it. Mergers that were already finished when the page loaded are
 * not shown again; any merger can be reopened from the log (`open(seq)`, `explicit`). Closed
 * mergers are remembered for the tab (sessionStorage) so a reload does not bring back a result
 * the viewer already closed. `live` are the mergers seen in progress or arriving on this page
 * (their completion is news; the finished ones loaded with the page are not).
 */
export function useMergerResult(mergers: MergerRecord[] | undefined, storageKey: string) {
  const [known, setKnown] = useState<number[] | null>(null)
  const [openSeq, setOpenSeq] = useState<number | null>(null)
  const [explicit, setExplicit] = useState(false)
  const [initialDone, setInitialDone] = useState<number[] | null>(null)
  // Only the list of merger ids matters here (updates of a merger keep its id).
  const signature = mergers ? mergers.map((m) => m.seq).join(',') : null
  const [prev, setPrev] = useState<string | null>(null)

  // React's "adjust state when a prop changes" pattern (no effect, no extra render pass).
  if (signature !== prev) {
    setPrev(signature)
    if (mergers) {
      const done = mergers.filter((m) => m.complete).map((m) => m.seq)
      if (initialDone === null) setInitialDone(done)
      const seen = new Set(known ?? done)
      const fresh = mergers.filter((m) => !seen.has(m.seq))
      if (fresh.length > 0 || known === null) {
        const dismissed = new Set(readDismissed(storageKey))
        const show = [...fresh].reverse().find((m) => !dismissed.has(m.seq))
        if (show) {
          setOpenSeq(show.seq)
          setExplicit(false)
        }
        for (const m of fresh) seen.add(m.seq)
        setKnown([...seen])
      }
    }
  }

  const shown = openSeq === null ? null : (mergers?.find((m) => m.seq === openSeq) ?? null)
  const before = new Set(initialDone ?? [])
  return {
    shown,
    /** Opened from the log (shown even over a decision of mine, with a way back). */
    explicit: shown !== null && explicit,
    live: (mergers ?? []).filter((m) => !before.has(m.seq)).map((m) => m.seq),
    open: (seq: number) => {
      setOpenSeq(seq)
      setExplicit(true)
    },
    dismiss: () => {
      if (openSeq !== null) writeDismissed(storageKey, [...readDismissed(storageKey), openSeq])
      setOpenSeq(null)
      setExplicit(false)
    },
  }
}
