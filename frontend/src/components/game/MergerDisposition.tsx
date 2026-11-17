import { useState, type ReactNode } from 'react'
import { ChainMarker } from './ChainMarker'
import { Slider } from '../ui/Slider'
import { Button } from '../ui/Button'
import styles from './MergerDisposition.module.css'
import type { ChainId } from '../../types/ruleset'
import { useRules } from '../../ruleset/useRules'

export interface DispositionDraft {
  sell: number
  trade: number
}

export interface MergerDispositionProps {
  defunctChain: ChainId
  survivorChain: ChainId
  sharesOwned: number
  defunctPrice: number
  survivorStockAvailable: number
  /** My cash now: the line over the button shows the cash after the sale. */
  cash?: number
  onConfirm: (sell: number, trade: number, hold: number) => void
  /** Every change of the sliders (the merger view projects my position from it). */
  onDraftChange?: (draft: DispositionDraft) => void
  /** Shown above the controls (the merger's title). */
  header?: ReactNode
  /** Shown between the controls and the confirm button (who holds what). */
  children?: ReactNode
}

/**
 * My sell / trade / keep choice for a defunct chain's shares. Each number is said once
 * (BL-017): what a slider gives is next to that slider, the cash after the sale is over the
 * button, and my survivor shares after the trade are in the survivor's holder table. In the decision tab (BL-011) the merger view goes around it: its title in
 * `header`, who holds what and the survivor after the merger in `children`, so the confirm
 * button can stay pinned at the bottom of the whole view.
 */
export function MergerDisposition({
  defunctChain,
  survivorChain,
  sharesOwned,
  defunctPrice,
  survivorStockAvailable,
  cash,
  onConfirm,
  onDraftChange,
  header,
  children,
}: MergerDispositionProps) {
  const rules = useRules()
  const { theme } = rules
  // Defunct shares per survivor share (the ruleset's merger_trade_ratio; 2 in default).
  const ratio = Math.max(1, rules.rs.merger_trade_ratio)
  const defunctName = rules.name(defunctChain)
  const survivorName = rules.name(survivorChain)
  const [draft, setDraft] = useState<DispositionDraft>({ sell: 0, trade: 0 })
  const { sell: sellCount, trade: tradeCount } = draft

  // Maximum tradeable shares: limited by survivor stock in the bank and the shares not sold,
  // and always a multiple of the trade ratio (only whole survivor shares are handed out).
  const maxTradeByStock = survivorStockAvailable * ratio
  const maxTrade = Math.floor(Math.min(sharesOwned - sellCount, maxTradeByStock) / ratio) * ratio

  const holdCount = sharesOwned - sellCount - tradeCount
  const cashFromSell = sellCount * defunctPrice
  const sharesFromTrade = Math.floor(tradeCount / ratio)

  const update = (next: DispositionDraft) => {
    setDraft(next)
    onDraftChange?.(next)
  }

  const handleSellChange = (value: number) => {
    // Selling more takes shares back from a trade that no longer fits.
    const remaining = sharesOwned - value
    const trade = tradeCount > remaining ? Math.floor(remaining / ratio) * ratio : tradeCount
    update({ sell: value, trade })
  }

  const handleTradeChange = (value: number) =>
    update({ sell: sellCount, trade: Math.floor(value / ratio) * ratio })

  const canTrade = survivorStockAvailable > 0

  return (
    <section
      className={styles.container}
      data-testid="merger-disposition"
      data-defunct={defunctChain}
      data-shares={sharesOwned}
      aria-label={`Your ${defunctName} ${theme.share_noun_plural}`}
    >
      {header}
      <div className={styles.controls}>
        <h4 className={styles.title} data-testid="disposition-title">
          Your <ChainMarker chain={defunctChain} variant="compact" /> {theme.share_noun_plural}:{' '}
          <strong>{sharesOwned}</strong>
          <span className={styles.muted} title={`The price at the ${theme.merger_noun}`}>
            {' '}
            at {rules.money(defunctPrice)}
          </span>
        </h4>

        <div className={styles.sliders}>
          <Slider
            label="SELL to bank"
            value={sellCount}
            min={0}
            max={sharesOwned}
            step={1}
            onChange={handleSellChange}
            displayValue={`${rules.shares(sellCount)} → ${rules.money(cashFromSell)}`}
            valueTestId="disposition-sell"
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
            valueTestId="disposition-trade"
          />

          <div className={styles.hold} data-testid="hold-display">
            <span className={styles.holdLabel}>KEEP {rules.shares(holdCount)}</span>
            <span className={styles.holdValue}>
              {rules.money(0)} until {defunctName} is founded again
            </span>
          </div>
        </div>
      </div>
      {children}

      {/* Last child of the whole view, so it can stay at the bottom while the tab scrolls. */}
      <div className={styles.confirm}>
        {cash !== undefined && (
          <div className={styles.summary}>
            <span data-testid="disposition-cash-after">
              Cash after {rules.money(cash + cashFromSell)}
            </span>
          </div>
        )}
        <Button
          variant="accent"
          fullWidth
          onClick={() => onConfirm(sellCount, tradeCount, holdCount)}
          data-testid="confirm-disposition"
        >
          CONFIRM DISPOSITION
        </Button>
      </div>
    </section>
  )
}
