import { ChainMarker } from './ChainMarker'
import { Badge } from '../ui/Badge'
import styles from './PlayerCard.module.css'
import type { ChainName } from '../../types/api'

export interface StockHolding {
  chain: ChainName
  quantity: number
}

export interface PlayerCardProps {
  name: string
  cash: number
  stocks: StockHolding[]
  isCurrentTurn?: boolean
  isHost?: boolean
  isBot?: boolean
  variant?: 'full' | 'compact'
}

export function PlayerCard({
  name,
  cash,
  stocks,
  isCurrentTurn = false,
  isHost = false,
  isBot = false,
  variant = 'full',
}: PlayerCardProps) {
  const stocksWithQuantity = stocks.filter((s) => s.quantity > 0)

  if (variant === 'compact') {
    return (
      <div className={styles.compact} data-testid="player-card-compact">
        <span className={styles.compactName}>{name}</span>
        <span className={styles.compactCash}>${cash.toLocaleString()}</span>
        {stocksWithQuantity.length > 0 && (
          <div className={styles.compactStocks}>
            {stocksWithQuantity.map((s) => (
              <span key={s.chain} className={styles.compactStock}>
                <ChainMarker chain={s.chain} variant="icon" />
                {s.quantity}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={`${styles.card} ${isCurrentTurn ? styles.active : ''}`}
      data-testid="player-card"
    >
      <div className={styles.header}>
        {isCurrentTurn && (
          <span className={styles.turnMarker} data-testid="turn-marker">
            &gt;
          </span>
        )}
        <span className={styles.name}>{name}</span>
        <div className={styles.badges}>
          {isHost && <Badge label="HOST" variant="info" />}
          {isBot && <Badge label="BOT" variant="warning" />}
        </div>
        <span className={styles.cash} data-testid="player-cash">
          ${cash.toLocaleString()}
        </span>
      </div>
      {stocksWithQuantity.length > 0 && (
        <div className={styles.stocks} data-testid="player-stocks">
          {stocksWithQuantity.map((s) => (
            <span key={s.chain} className={styles.stock}>
              <ChainMarker chain={s.chain} variant="compact" />:{s.quantity}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
