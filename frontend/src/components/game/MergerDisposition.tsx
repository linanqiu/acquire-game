import { useState, useCallback } from 'react'
import { ChainMarker } from './ChainMarker'
import { Slider } from '../ui/Slider'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import styles from './MergerDisposition.module.css'
import type { ChainName } from '../../types/api'

export interface MergerDispositionProps {
  defunctChain: ChainName
  survivorChain: ChainName
  sharesOwned: number
  defunctPrice: number
  survivorStockAvailable: number
  onConfirm: (sell: number, trade: number, hold: number) => void
}

export function MergerDisposition({
  defunctChain,
  survivorChain,
  sharesOwned,
  defunctPrice,
  survivorStockAvailable,
  onConfirm,
}: MergerDispositionProps) {
  const [sellCount, setSellCount] = useState(0)
  const [tradeCount, setTradeCount] = useState(0)

  // Calculate maximum tradeable shares (limited by survivor stock and remaining shares)
  // Must be even number for 2:1 trade ratio
  const maxTradeByStock = survivorStockAvailable * 2 // 2:1 ratio
  const maxTradeRaw = Math.min(sharesOwned - sellCount, maxTradeByStock)
  const maxTrade = Math.floor(maxTradeRaw / 2) * 2 // Round down to even

  // Calculate hold count and derived values
  const holdCount = sharesOwned - sellCount - tradeCount
  const cashFromSell = sellCount * defunctPrice
  const sharesFromTrade = Math.floor(tradeCount / 2)

  const handleSellChange = useCallback(
    (value: number) => {
      setSellCount(value)
      // Adjust trade if it would exceed remaining shares
      const remainingAfterSell = sharesOwned - value
      if (tradeCount > remainingAfterSell) {
        // Round down to even number
        setTradeCount(Math.floor(remainingAfterSell / 2) * 2)
      }
    },
    [sharesOwned, tradeCount]
  )

  const handleTradeChange = useCallback((value: number) => {
    // Ensure even number for 2:1 trade
    setTradeCount(Math.floor(value / 2) * 2)
  }, [])

  const handleConfirm = () => {
    onConfirm(sellCount, tradeCount, holdCount)
  }

  const canTrade = survivorStockAvailable > 0

  return (
    <Card title={`DISPOSE OF YOUR ${defunctChain.toUpperCase()} STOCK`}>
      <div className={styles.container} data-testid="merger-disposition">
        <div className={styles.info}>
          <p className={styles.infoRow}>
            You have: <strong>{sharesOwned}</strong>{' '}
            <ChainMarker chain={defunctChain} variant="compact" /> shares
          </p>
          <p className={styles.infoRow}>
            Price at merger: <strong>${defunctPrice.toLocaleString()}</strong>/share
          </p>
          <p className={styles.infoRow}>
            <ChainMarker chain={survivorChain} variant="compact" /> stock available:{' '}
            <strong>{survivorStockAvailable}</strong>
          </p>
        </div>

        <div className={styles.sliders}>
          <Slider
            label="SELL to bank"
            value={sellCount}
            min={0}
            max={sharesOwned}
            step={1}
            onChange={handleSellChange}
            displayValue={`${sellCount} shares → $${cashFromSell.toLocaleString()}`}
          />

          <Slider
            label={`TRADE 2:1 for ${survivorChain.toUpperCase()}`}
            value={tradeCount}
            min={0}
            max={maxTrade}
            step={2}
            onChange={handleTradeChange}
            displayValue={`${tradeCount} shares → ${sharesFromTrade} ${survivorChain.toUpperCase()}`}
            disabled={!canTrade}
          />

          <div className={styles.hold} data-testid="hold-display">
            <span className={styles.holdLabel}>HOLD (keep for re-founding)</span>
            <span className={styles.holdValue}>
              {holdCount} share{holdCount !== 1 ? 's' : ''} (worth $0 until re-founded)
            </span>
          </div>
        </div>

        <div className={styles.summary} data-testid="disposition-summary">
          <strong>SUMMARY:</strong> SELL {sellCount} (+${cashFromSell.toLocaleString()}) | TRADE{' '}
          {tradeCount} (+{sharesFromTrade} {survivorChain.toUpperCase()}) | HOLD {holdCount}
        </div>

        <Button fullWidth onClick={handleConfirm} data-testid="confirm-disposition">
          CONFIRM DISPOSITION
        </Button>
      </div>
    </Card>
  )
}
