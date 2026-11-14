import { useState } from 'react'
import { Button } from '../ui/Button'
import { useToast } from '../ui/useToast'
import { removeSeat } from '../../lib/agents'

export interface RemoveSeatButtonProps {
  room: string
  playerId: string
  playerName: string
}

/** Lobby-only control for removing an AI seat. The lobby list refreshes via WebSocket. */
export function RemoveSeatButton({ room, playerId, playerName }: RemoveSeatButtonProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)

  const handleClick = async () => {
    setLoading(true)
    try {
      await removeSeat(room, playerId)
    } catch (err) {
      console.error('Failed to remove seat:', err)
      toast('Failed to remove AI opponent', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      disabled={loading}
      aria-label={`Remove ${playerName}`}
      data-testid={`remove-seat-${playerId}`}
    >
      ×
    </Button>
  )
}
