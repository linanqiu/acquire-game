import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { useToast } from '../ui/useToast'
import { addSeat, fetchAgentCatalog } from '../../lib/agents'
import type { AgentCatalogEntry } from '../../types/api'
import styles from './AddAiControl.module.css'

export interface AddAiControlProps {
  room: string
  /** Disable all controls (e.g. lobby full or another action in flight). */
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
  /** Called with the new seat's player id (and display name) after a successful add. */
  onAdded?: (playerId: string | undefined, name?: string) => void
}

/**
 * Lobby control for adding AI opponents.
 *
 * Always renders the plain "+ ADD BOT" button (legacy `add-bot` route, so older
 * backends and existing flows keep working). When `GET /api/agents/catalog`
 * succeeds, also renders "+ ADD AI" which lists the catalog entries.
 */
export function AddAiControl({ room, disabled = false, size = 'md', onAdded }: AddAiControlProps) {
  const { toast } = useToast()
  const [catalog, setCatalog] = useState<AgentCatalogEntry[] | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchAgentCatalog(controller.signal)
      .then(setCatalog)
      .catch(() => setCatalog(null)) // Older backend: fall back to plain add-bot
    return () => controller.abort()
  }, [])

  const handleAddBot = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/room/${room}/add-bot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error('Failed to add bot')
      const data = await res.json().catch(() => ({}))
      onAdded?.(data?.bot_id, data?.name)
    } catch (err) {
      console.error('Failed to add bot:', err)
      toast('Failed to add bot', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleChoose = async (entry: AgentCatalogEntry) => {
    setBusy(true)
    try {
      const data = await addSeat(room, entry.id)
      setOpen(false)
      onAdded?.(data?.player_id, data?.name)
    } catch (err) {
      console.error('Failed to add AI opponent:', err)
      toast('Failed to add AI opponent', 'error')
    } finally {
      setBusy(false)
    }
  }

  const off = disabled || busy

  return (
    <div className={styles.wrapper}>
      <div className={styles.buttons}>
        <Button
          variant="secondary"
          size={size}
          onClick={handleAddBot}
          disabled={off}
          data-testid="add-bot-button"
        >
          + ADD BOT
        </Button>
        {catalog && (
          <Button
            variant="secondary"
            size={size}
            onClick={() => setOpen((o) => !o)}
            disabled={disabled}
            aria-expanded={open}
            aria-haspopup="true"
            data-testid="add-ai-button"
          >
            + ADD AI
          </Button>
        )}
      </div>
      {catalog && open && (
        <ul className={styles.menu} data-testid="ai-menu" aria-label="AI opponents">
          {catalog.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={styles.option}
                disabled={off || !entry.available}
                onClick={() => handleChoose(entry)}
                data-testid={`ai-option-${entry.id}`}
              >
                <span className={styles.optionLabel}>{entry.label}</span>
                <span className={styles.optionDesc}>{entry.description}</span>
                {!entry.available && (
                  <span className={styles.optionReason}>not configured on this server</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
