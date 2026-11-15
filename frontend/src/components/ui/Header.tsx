import { FlashValue } from './FlashValue'
import styles from './Header.module.css'
import { useBrand, useRules } from '../../ruleset/useRules'

interface HeaderProps {
  roomCode?: string
  cash?: number
  /** The viewer's net worth and rank (from the server), shown next to their cash. */
  netWorth?: number
  rank?: number
  playerName?: string
  tilePool?: number | 'EMPTY'
}

export function Header({ roomCode, cash, netWorth, rank, playerName, tilePool }: HeaderProps) {
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
            Room {roomCode}
          </div>
        )}
        {tilePool !== undefined && (
          <div className={styles.tilePool} title="Tiles left in the bag">
            <span className={styles.label}>bag</span>{' '}
            <span data-testid="header-tile-pool">[{tilePool}]</span>
          </div>
        )}
        {playerName && (
          <div className={styles.playerName} data-testid="header-name">
            {playerName}
          </div>
        )}
        {cash !== undefined && (
          <div className={styles.cash} title="Cash">
            <span className={styles.label}>cash</span>{' '}
            <FlashValue value={cash} data-testid="header-cash">
              {rules.money(cash)}
            </FlashValue>
          </div>
        )}
        {netWorth !== undefined && (
          <div className={styles.worth} title="Net worth: cash + shares at current prices">
            <span className={styles.label}>worth</span>{' '}
            <FlashValue value={netWorth} data-testid="header-networth">
              {rules.money(netWorth)}
            </FlashValue>
            {rank !== undefined && (
              <span className={styles.rank} data-testid="header-rank">
                {' '}
                #{rank}
              </span>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
