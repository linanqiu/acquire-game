import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { PageShell } from '../ui/PageShell'
import { Spinner } from '../ui/Spinner'
import { Button } from '../ui/Button'
import type { TranscriptApiError } from '../../lib/transcripts'
import { useServerWaking } from '../../lib/http'
import { useBrand } from '../../ruleset/useRules'
import styles from './PageFrame.module.css'

/**
 * Where the transcript / benchmark pages lead (BL-018): one way up (the list a page belongs to,
 * or the home page) and one way across (the other section). The page's own title says where
 * you are, so the bar does not repeat it.
 */
function frameLinks(
  pathname: string,
  brand: string
): { up: { to: string; label: string }; across: { to: string; label: string } } {
  const games = { to: '/games', label: 'Games' }
  const bench = { to: '/bench', label: `${brand} Bench` }
  const home = { to: '/', label: 'Home' }
  if (pathname.startsWith('/games/')) return { up: games, across: bench }
  if (pathname.startsWith('/bench/')) return { up: bench, across: games }
  if (pathname.startsWith('/bench')) return { up: home, across: games }
  return { up: home, across: bench }
}

/** Shared chrome for the transcript / benchmark pages: header, a back link and the other section. */
export function PageFrame({ children }: { children: ReactNode }) {
  const brand = useBrand()
  const { pathname } = useLocation()
  const { up, across } = frameLinks(pathname, brand)
  return (
    <PageShell>
      <nav className={styles.nav} aria-label="Transcripts and benchmark">
        <Link to={up.to} className={styles.navLink} data-testid="frame-up">
          <span aria-hidden="true">&larr;</span> {up.label}
        </Link>
        <Link to={across.to} className={styles.navLink} data-testid="frame-across">
          {across.label}
        </Link>
      </nav>
      <div className={styles.content}>
        <WakingBanner />
        {children}
      </div>
    </PageShell>
  )
}

/**
 * Shown while idempotent GETs are being retried because the (sleeping) host has not answered
 * yet. Friendly, not an error: the request is still going to succeed in most cases.
 */
export function WakingBanner() {
  const waking = useServerWaking()
  if (!waking) return null
  return (
    <div className={styles.waking} role="status" data-testid="waking-server">
      <Spinner size="sm" />
      <span>Waking the server… it sleeps when nobody is around and can take up to a minute.</span>
    </div>
  )
}

export function LoadingView({ label = 'Loading' }: { label?: string }) {
  return (
    <div className={styles.state} role="status" data-testid="loading-state">
      <Spinner size="md" />
      <p>{label}…</p>
    </div>
  )
}

interface ErrorViewProps {
  error: TranscriptApiError
  /** What the missing thing is, e.g. "game" or "leaderboard". */
  what: string
  /** `true` when a 404 most likely means an unknown id rather than a missing route. */
  byId?: boolean
  onRetry?: () => void
}

/** Friendly not-found / unreachable / server-error states. */
export function ErrorView({ error, what, byId = false, onRetry }: ErrorViewProps) {
  let title: string
  let body: string
  let testId: string
  if (error.kind === 'not_found') {
    testId = 'error-not-found'
    title = byId ? `We couldn't find that ${what}` : `${cap(what)} not available on this server`
    body = byId
      ? 'The id may be wrong, or this server may not record transcripts (older versions do not). Check the link and try again.'
      : 'This server does not offer transcripts or benchmark results yet. It may be running an older version.'
  } else if (error.kind === 'network') {
    testId = 'error-network'
    title = "Can't reach the server"
    body = 'Check your connection and try again.'
  } else {
    testId = 'error-server'
    title = `Something went wrong loading the ${what}`
    body = error.message
  }
  return (
    <div className={styles.state} role="alert" data-testid={testId}>
      <h2 className={styles.stateTitle}>{title}</h2>
      <p>{body}</p>
      <div className={styles.stateActions}>
        {error.kind !== 'not_found' && onRetry && (
          <Button variant="secondary" onClick={onRetry} data-testid="retry-button">
            TRY AGAIN
          </Button>
        )}
        <Link to="/games" className={styles.stateLink}>
          Games &amp; transcripts
        </Link>
        <Link to="/" className={styles.stateLink}>
          Home
        </Link>
      </div>
    </div>
  )
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
