import { ChainMarker } from './ChainMarker'
import { Card } from '../ui/Card'
import styles from './Portfolio.module.css'
import type { ChainName } from '../../types/api'

export interface StockHolding {
  chain: ChainName
  quantity: number
}

export interface ChainPrices {
  [key: string]: number // chain name -> price per share
}

export interface PortfolioProps {
  holdings: StockHolding[]
  prices: ChainPrices
  showTotal?: boolean
}

export function Portfolio({ holdings, prices, showTotal = true }: PortfolioProps) {
  const holdingsWithValue = holdings
    .filter((h) => h.quantity > 0)
    .map((h) => ({
      ...h,
      price: prices[h.chain] || 0,
      value: h.quantity * (prices[h.chain] || 0),
    }))

  const total = holdingsWithValue.reduce((sum, h) => sum + h.value, 0)

  if (holdingsWithValue.length === 0) {
    return (
      <Card title="PORTFOLIO">
        <p className={styles.empty} data-testid="portfolio-empty">
          No stocks owned
        </p>
      </Card>
    )
  }

  return (
    <Card title="PORTFOLIO">
      <table className={styles.table} data-testid="portfolio-table">
        <tbody>
          {holdingsWithValue.map((h) => (
            <tr key={h.chain} data-testid={`portfolio-row-${h.chain.toLowerCase()}`}>
              <td className={styles.chain}>
                <ChainMarker chain={h.chain} variant="compact" />
              </td>
              <td className={styles.quantity}>{h.quantity}</td>
              <td className={styles.times}>×</td>
              <td className={styles.price}>${h.price.toLocaleString()}</td>
              <td className={styles.equals}>=</td>
              <td className={styles.value}>${h.value.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
        {showTotal && (
          <tfoot>
            <tr className={styles.totalRow}>
              <td colSpan={5} className={styles.totalLabel}>
                TOTAL VALUE:
              </td>
              <td className={styles.totalValue} data-testid="portfolio-total">
                ${total.toLocaleString()}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </Card>
  )
}
