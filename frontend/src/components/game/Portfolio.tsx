import { ChainMarker } from './ChainMarker'
import { chainTestId } from '../../lib/ruleset'
import { useRules } from '../../ruleset/useRules'
import { Card } from '../ui/Card'
import styles from './Portfolio.module.css'
import type { ChainId } from '../../types/ruleset'

export interface StockHolding {
  chain: ChainId
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
  const rules = useRules()
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
          No {rules.theme.share_noun_plural} owned
        </p>
      </Card>
    )
  }

  return (
    <Card title="PORTFOLIO">
      <table className={styles.table} data-testid="portfolio-table">
        <tbody>
          {holdingsWithValue.map((h) => (
            <tr key={h.chain} data-testid={`portfolio-row-${chainTestId(h.chain)}`}>
              <td className={styles.chain}>
                <ChainMarker chain={h.chain} variant="compact" />
              </td>
              <td className={styles.quantity}>{h.quantity}</td>
              <td className={styles.times}>×</td>
              <td className={styles.price}>{rules.money(h.price)}</td>
              <td className={styles.equals}>=</td>
              <td className={styles.value}>{rules.money(h.value)}</td>
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
                {rules.money(total)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </Card>
  )
}
