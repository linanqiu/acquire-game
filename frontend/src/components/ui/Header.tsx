import styles from './Header.module.css'
import { useBrand, useRules } from '../../ruleset/useRules'

interface HeaderProps {
  roomCode?: string
  cash?: number
  playerName?: string
  tilePool?: number | 'EMPTY'
}

export function Header({ roomCode, cash, playerName, tilePool }: HeaderProps) {
  // Product name: the brand; amounts: the ruleset in effect (a game's own).
  const brand = useBrand()
  const rules = useRules()
  return (
    <header className={styles.header}>
      <div className={styles.logo} data-testid="header-title">
        {brand.toUpperCase()}
      </div>
      <div className={styles.info}>
        {roomCode && (
          <div className={styles.roomCode} data-testid="header-room">
            Room: {roomCode}
          </div>
        )}
        {playerName && (
          <div className={styles.playerName} data-testid="header-name">
            {playerName}
          </div>
        )}
        {cash !== undefined && (
          <div className={styles.cash} data-testid="header-cash">
            {rules.money(cash)}
          </div>
        )}
        {tilePool !== undefined && (
          <div className={styles.tilePool} data-testid="header-tile-pool">
            [{typeof tilePool === 'number' ? tilePool : tilePool}]
          </div>
        )}
      </div>
    </header>
  )
}
