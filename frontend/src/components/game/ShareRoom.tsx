import { useState } from 'react'
import { joinLink } from '../../lib/joinLink'
import styles from './ShareRoom.module.css'

type Outcome = 'idle' | 'copied' | 'failed'

/**
 * The lobby's invite (BL-018): the room code, large, and one button that shares a join link
 * (`/?code=ABCD`, which opens the home page's join step with the code filled in). The phone's
 * share sheet when the browser has one (Web Share API), else the link is copied; when even that
 * is refused the link is shown to copy by hand. The button is a real link, so it also works as
 * one (long press, open in a new tab).
 */
export function ShareRoom({
  room,
  testIdPrefix = 'lobby',
}: {
  room: string
  testIdPrefix?: string
}) {
  const link = joinLink(window.location.origin, room)
  const [outcome, setOutcome] = useState<Outcome>('idle')

  const share = async (e: React.MouseEvent) => {
    e.preventDefault()
    const data = { title: 'Join my game', text: `Join my game: room ${room}`, url: link }
    if (typeof navigator.share === 'function' && navigator.canShare?.(data) !== false) {
      try {
        await navigator.share(data)
        return
      } catch (err) {
        // The person closed the share sheet: nothing to say.
        if (err instanceof DOMException && err.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(link)
      setOutcome('copied')
    } catch {
      setOutcome('failed')
    }
  }

  return (
    <div className={styles.share}>
      <h2 className={styles.code}>
        <span className={styles.label}>Room</span>{' '}
        <span className={styles.letters} data-testid={`${testIdPrefix}-room-code`}>
          {room}
        </span>
      </h2>
      <a
        href={link}
        className={styles.button}
        onClick={share}
        data-testid={`${testIdPrefix}-share`}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Invite
      </a>
      {outcome !== 'idle' && (
        <p className={styles.outcome} role="status" data-testid={`${testIdPrefix}-share-outcome`}>
          {outcome === 'copied' ? 'Link copied' : link}
        </p>
      )}
    </div>
  )
}
