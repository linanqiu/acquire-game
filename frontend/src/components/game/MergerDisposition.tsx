import { useState, useCallback } from 'react'
import { ChainMarker } from './ChainMarker'
import { Slider } from '../ui/Slider'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import styles from './MergerDisposition.module.css'
import type { ChainId } from '../../types/ruleset'
import { useRules } from '../../ruleset/useRules'

export interface MergerDispositionProps {
  defunctChain: ChainId
  survivorChain: ChainId
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
  const rules = useRules()
  const { theme } = rules
  // Defunct shares per survivor share (the ruleset's merger_trade_ratio; 2 in default).
  const ratio = Math.max(1, rules.rs.merger_trade_ratio)
  const defunctName = rules.name(defunctChain)
  const survivorName = rules.name(survivorChain)
  const [sellCount, setSellCount] = useState(0)
  const [tradeCount, setTradeCount] = useState(0)

  // Maximum tradeable shares: limited by survivor stock in the bank and the shares not sold,
  // and always a multiple of the trade ratio (only whole survivor shares are handed out).
  const maxTradeByStock = survivorStockAvailable * ratio
  const maxTrade = Math.floor(Math.min(sharesOwned - sellCount, maxTradeByStock) / ratio) * ratio

  // Calculate hold count and derived values
  const holdCount = sharesOwned - sellCount - tradeCount
  const cashFromSell = sellCount * defunctPrice
  const sharesFromTrade = Math.floor(tradeCount / ratio)

  const handleSellChange = useCallback(
    (value: number) => {
      setSellCount(value)
      // Adjust trade if it would exceed remaining shares
      const remainingAfterSell = sharesOwned - value
      if (tradeCount > remainingAfterSell) {
        setTradeCount(Math.floor(remainingAfterSell / ratio) * ratio)
      }
    },
    [sharesOwned, tradeCount, ratio]
  )

  const handleTradeChange = useCallback(
    (value: number) => setTradeCount(Math.floor(value / ratio) * ratio),
    [ratio]
  )

  const handleConfirm = () => {
    onConfirm(sellCount, tradeCount, holdCount)
  }

  const canTrade = survivorStockAvailable > 0

  return (
    <Card
      title={`DISPOSE OF YOUR ${defunctName.toUpperCase()} ${theme.share_noun_plural.toUpperCase()}`}
    >
      <div className={styles.container} data-testid="merger-disposition">
        <div className={styles.info}>
          <p className={styles.infoRow}>
            You have: <strong>{sharesOwned}</strong>{' '}
            <ChainMarker chain={defunctChain} variant="compact" /> {theme.share_noun_plural}
          </p>
          <p className={styles.infoRow}>
            Price at {theme.merger_noun}: <strong>{rules.money(defunctPrice)}</strong>/
            {theme.share_noun}
          </p>
          <p className={styles.infoRow}>
            <ChainMarker chain={survivorChain} variant="compact" /> {theme.share_noun_plural} left
            in the bank: <strong>{survivorStockAvailable}</strong>
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
            displayValue={`${rules.shares(sellCount)} → ${rules.money(cashFromSell)}`}
          />

          <Slider
            label={`TRADE ${ratio}:1 for ${survivorName.toUpperCase()}`}
            value={tradeCount}
            min={0}
            max={maxTrade}
            step={ratio}
            onChange={handleTradeChange}
            displayValue={`${rules.shares(tradeCount)} → ${sharesFromTrade} ${survivorName.toUpperCase()}`}
            disabled={!canTrade}
          />

          <div className={styles.hold} data-testid="hold-display">
            <span className={styles.holdLabel}>HOLD (keep for re-founding)</span>
            <span className={styles.holdValue}>
              {rules.shares(holdCount)} (worth {rules.money(0)} until re-founded)
            </span>
          </div>
        </div>

        <div className={styles.summary} data-testid="disposition-summary">
          <strong>SUMMARY:</strong> SELL {sellCount} (+{rules.money(cashFromSell)}) | TRADE{' '}
          {tradeCount} (+{sharesFromTrade} {survivorName.toUpperCase()}) | HOLD {holdCount}
        </div>

        <Button fullWidth onClick={handleConfirm} data-testid="confirm-disposition">
          CONFIRM DISPOSITION
        </Button>
      </div>
    </Card>
  )
}
