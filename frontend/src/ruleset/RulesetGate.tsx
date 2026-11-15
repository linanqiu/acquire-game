import { useEffect, type ReactNode } from 'react'
import { useRulesetStore } from './store'
import { Spinner } from '../components/ui/Spinner'
import { Button } from '../components/ui/Button'
import { useServerWaking } from '../lib/http'
import styles from './RulesetGate.module.css'

/**
 * Loads the server's ruleset (`/api/config/game`) before rendering the app, so no screen ever
 * shows another game's name or numbers while it loads. Also keeps `document.title` on the
 * product name (brand).
 */
export function RulesetGate({ children }: { children: ReactNode }) {
  const status = useRulesetStore((s) => s.status)
  const error = useRulesetStore((s) => s.error)
  const brand = useRulesetStore((s) => s.brand)
  const load = useRulesetStore((s) => s.load)
  const waking = useServerWaking()

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (status === 'ready') document.title = brand
  }, [status, brand])

  if (status === 'ready') return <>{children}</>

  if (status === 'error') {
    return (
      <div className={styles.splash} role="alert" data-testid="ruleset-error">
        <p className={styles.headline}>Can&apos;t reach the game server</p>
        <p className={styles.detail}>{error}</p>
        <Button onClick={() => void load({ force: true })} data-testid="ruleset-retry">
          TRY AGAIN
        </Button>
      </div>
    )
  }

  return (
    <div className={styles.splash} role="status" data-testid="ruleset-loading">
      <Spinner size="md" />
      <p className={styles.detail}>
        {waking
          ? 'Waking the server… it sleeps when nobody is around and can take up to a minute.'
          : 'Loading…'}
      </p>
    </div>
  )
}
