import styles from './Header.module.css'

interface HeaderProps {
  roomCode?: string
  cash?: number
  playerName?: string
  tilePool?: number | 'EMPTY'
}

export function Header({ roomCode, cash, playerName, tilePool }: HeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.logo}>ACQUIRE</div>
      <div className={styles.info}>
        {roomCode && <div className={styles.roomCode}>Room: {roomCode}</div>}
        {playerName && <div className={styles.playerName}>{playerName}</div>}
        {cash !== undefined && <div className={styles.cash}>${cash.toLocaleString()}</div>}
        {tilePool !== undefined && (
          <div className={styles.tilePool}>
            [{typeof tilePool === 'number' ? tilePool : tilePool}]
          </div>
        )}
      </div>
    </header>
  )
}
