import { useEffect, useRef } from 'react'
import { useGameStore } from '../store'
import { useToast } from '../components/ui/useToast'

/** Toast every `agent_fallback` message: the rules-based bot moved for an AI seat. */
export function useFallbackToasts() {
  const { toast } = useToast()
  const event = useGameStore((s) => s.lastFallbackEvent)
  const seen = useRef(0)

  useEffect(() => {
    if (!event || event.seq === seen.current) return
    seen.current = event.seq
    toast(event.message.message, 'warning', 8000)
  }, [event, toast])
}
