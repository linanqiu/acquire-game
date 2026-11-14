import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import styles from './ReconnectedToast.module.css'
import { useRules } from '../../ruleset/useRules'

export interface ReconnectedToastProps {
  playerName: string
  currentTurn: string
  phase: string
  cash: number
  stockCount: number
  tileCount: number
  onContinue: () => void
}

export function ReconnectedToast({
  playerName,
  currentTurn,
  phase,
  cash,
  stockCount,
  tileCount,
  onContinue,
}: ReconnectedToastProps) {
  const rules = useRules()
  return (
    <Card title="RECONNECTED" className={styles.toast}>
      <div className={styles.container} data-testid="reconnected-toast">
        <p className={styles.welcome}>Welcome back, {playerName}!</p>

        <div className={styles.state}>
          <h4 className={styles.stateTitle}>CURRENT GAME STATE:</h4>
          <p className={styles.stateLine}>
            <span className={styles.label}>Turn:</span> {currentTurn} ({phase})
          </p>
          <p className={styles.stateLine}>
            <span className={styles.label}>Your cash:</span> {rules.money(cash)}
          </p>
          <p className={styles.stateLine}>
            <span className={styles.label}>Your {rules.theme.share_noun_plural}:</span> {stockCount}{' '}
            total
          </p>
          <p className={styles.stateLine}>
            <span className={styles.label}>Your tiles:</span> {tileCount} in hand
          </p>
        </div>

        <Button fullWidth onClick={onContinue} data-testid="continue-playing">
          CONTINUE PLAYING
        </Button>
      </div>
    </Card>
  )
}
