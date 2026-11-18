import { useState, type CSSProperties, type ReactNode } from 'react'
import { ChainMarker } from './ChainMarker'
import { Button } from '../ui/Button'
import sliderStyles from '../ui/Slider.module.css'
import styles from './MergerDisposition.module.css'
import type { ChainId } from '../../types/ruleset'
import { useRules } from '../../ruleset/useRules'
import { changeText, placeOf, placeText, type Count } from '../../lib/standing'

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
  /**
   * Everyone's survivor shares as they stand (the merger's `survivor_after`, before my trade):
   * the line over the button says what my trade makes of my place in the survivor.
   */
  survivorHolders?: Count[]
  myId?: string
  onConfirm: (sell: number, trade: number, hold: number) => void
  /** Every change of the sliders (the merger view projects my position from it). */
  onDraftChange?: (draft: DispositionDraft) => void
  /** Shown above the controls (the merger's title). */
  header?: ReactNode
  /** Shown after the button (who holds what): under the decision, the page scrolls to it. */
  children?: ReactNode
}

/**
 * My sell / trade / keep choice for a defunct chain's shares (BL-011, BL-017, BL-019). One
 * compact card the board leaves room for (`data-table-core`): the shares and their price once,
 * three quick choices (sell all, trade the most the bank allows, keep all), one line per way
 * with its fine control and what it gives, then the consequence of the whole choice (cash
 * after; my survivor shares and place after) right over the button. Who holds what follows
 * under the card.
 */
export function MergerDisposition({
  defunctChain,
  survivorChain,
  sharesOwned,
  defunctPrice,
  survivorStockAvailable,
  cash,
  survivorHolders,
  myId,
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
  const tradeCap = (sold: number) =>
    Math.floor(Math.min(sharesOwned - sold, maxTradeByStock) / ratio) * ratio
  const maxTrade = tradeCap(sellCount)

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

  const canTrade = survivorStockAvailable > 0 && tradeCap(0) > 0
  const quick = [
    { id: 'sell-all', label: 'Sell all', draft: { sell: sharesOwned, trade: 0 } },
    { id: 'trade-max', label: 'Trade max', draft: { sell: 0, trade: tradeCap(0) }, off: !canTrade },
    { id: 'keep-all', label: 'Keep all', draft: { sell: 0, trade: 0 } },
  ]

  // My survivor shares and place after the trade.
  const counts = survivorHolders ?? []
  const myNow = counts.find((h) => h.player_id === myId)?.shares ?? 0
  const myAfter = myNow + sharesFromTrade
  const place =
    myId && survivorHolders
      ? sharesFromTrade > 0
        ? changeText(counts, myId, myNow, sharesFromTrade)
        : myNow > 0
          ? placeText(placeOf(counts, myId, myNow))
          : ''
      : ''

  const range = (
    label: string,
    value: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
    testId: string,
    disabled = false
  ) => (
    <input
      type="range"
      min={0}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      disabled={disabled}
      aria-label={label}
      className={`${sliderStyles.slider} ${styles.range}`}
      style={
        {
          '--slider-percentage': `${max > 0 ? (value / max) * 100 : 0}%`,
        } as CSSProperties
      }
      data-testid={testId}
    />
  )

  return (
    <section
      className={styles.container}
      data-testid="merger-disposition"
      data-defunct={defunctChain}
      data-shares={sharesOwned}
      aria-label={`Your ${defunctName} ${theme.share_noun_plural}`}
    >
      {header}
      <div className={styles.card} data-table-core>
        <div className={styles.titleRow}>
          <h4 className={styles.title} data-testid="disposition-title">
            Your <ChainMarker chain={defunctChain} variant="icon" />{' '}
            <span className={styles.srOnly}>{defunctName} </span>
            {theme.share_noun_plural}: <strong>{sharesOwned}</strong>
            <span className={styles.muted} title={`The price at the ${theme.merger_noun}`}>
              {' '}
              at {rules.money(defunctPrice)}
            </span>
          </h4>
          <div className={styles.quick} role="group" aria-label="Quick choices">
            {quick.map((q) => {
              const on = q.draft.sell === sellCount && q.draft.trade === tradeCount
              return (
                <button
                  key={q.id}
                  type="button"
                  className={`${styles.quickButton} ${on ? styles.quickOn : ''}`}
                  aria-pressed={on}
                  disabled={q.off}
                  onClick={() => update(q.draft)}
                  data-testid={`disposition-${q.id}`}
                >
                  {q.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className={styles.rows}>
          <span className={styles.label}>Sell</span>
          {range(
            `${defunctName} ${theme.share_noun_plural} to sell to the bank`,
            sellCount,
            sharesOwned,
            1,
            handleSellChange,
            'slider-sell-to-bank'
          )}
          <span className={styles.value} data-testid="disposition-sell">
            {sellCount} → {rules.money(cashFromSell)}
          </span>

          <span className={styles.label}>
            Trade <span className={styles.ratio}>{ratio}:1</span>
          </span>
          {range(
            `${defunctName} ${theme.share_noun_plural} to trade ${ratio} for 1 ${survivorName}`,
            tradeCount,
            maxTrade,
            ratio,
            handleTradeChange,
            `slider-trade-${ratio}:1-for-${survivorName.toLowerCase()}`,
            !canTrade
          )}
          <span className={styles.value} data-testid="disposition-trade">
            {tradeCount} → {sharesFromTrade} <ChainMarker chain={survivorChain} variant="icon" />
            <span className={styles.srOnly}> {survivorName}</span>
          </span>

          <span className={styles.label}>Keep</span>
          <span
            className={styles.keepNote}
            title={`Worth nothing until ${defunctName} is founded again`}
          >
            worth {rules.money(0)} for now
          </span>
          <span className={styles.value} data-testid="hold-display">
            {holdCount}
          </span>
        </div>

        <div className={styles.after} data-testid="disposition-after">
          {cash !== undefined && (
            <span data-testid="disposition-cash-after">
              Cash after <strong>{rules.money(cash + cashFromSell)}</strong>
            </span>
          )}
          {survivorHolders && (
            <span data-testid="disposition-survivor-after">
              <ChainMarker chain={survivorChain} variant="icon" />{' '}
              <span className={styles.srOnly}>{survivorName} </span>
              <strong>{sharesFromTrade > 0 ? `${myNow}→${myAfter}` : myNow}</strong>
              {place && <span className={styles.muted}> · {place}</span>}
            </span>
          )}
        </div>
        <Button
          variant="accent"
          fullWidth
          onClick={() => onConfirm(sellCount, tradeCount, holdCount)}
          data-testid="confirm-disposition"
        >
          CONFIRM
        </Button>
      </div>
      {children}
    </section>
  )
}
