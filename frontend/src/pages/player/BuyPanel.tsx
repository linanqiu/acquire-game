import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { ChainMarker } from '../../components/game/ChainMarker'
import { StockStepper } from '../../components/game/StockStepper'
import { useRules } from '../../ruleset/useRules'
import { chainTestId } from '../../lib/ruleset'
import { buyPhaseText } from '../../lib/phaseText'
import type { ChainId, GameStateMessage } from '../../types/api'
import styles from '../PlayerPage.module.css'

type HotelChain = GameStateMessage['hotel']['chains'][number]
export type Purchases = Partial<Record<ChainId, number>>

interface BuyPanelProps {
  /** Active chains, in the ruleset's order. */
  chains: HotelChain[]
  /** Shares left in the bank, per chain. */
  bank: Partial<Record<ChainId, number>>
  cash: number
  isMyTurn: boolean
  endGameAvailable: boolean
  loading: boolean
  /** BUY & END TURN / SKIP & END TURN (empty purchases). */
  onSubmit: (purchases: Purchases) => void
  onDeclareEndGame: () => void
}

/** The buy phase: a stepper per active chain, limited by the per-turn cap, the bank and cash. */
export function BuyPanel({
  chains,
  bank,
  cash,
  isMyTurn,
  endGameAvailable,
  loading,
  onSubmit,
  onDeclareEndGame,
}: BuyPanelProps) {
  const rules = useRules()
  const { theme } = rules
  const maxPurchases = rules.rs.max_stock_purchases_per_turn
  const [purchases, setPurchases] = useState<Purchases>({})

  const priceOf = (chain: string) => chains.find((c) => c.name === chain)?.price ?? 0
  const totalCost = Object.entries(purchases).reduce<number>(
    (sum, [chain, qty]) => sum + priceOf(chain) * (qty ?? 0),
    0
  )
  const totalShares = Object.values(purchases).reduce<number>((sum, qty) => sum + (qty ?? 0), 0)
  const canAfford = cash >= totalCost
  const validPurchase = totalShares <= maxPurchases
  const inStock = chains.filter((c) => (bank[c.name] ?? 0) > 0)
  const cannotAffordAny = inStock.length > 0 && inStock.every((c) => c.price > cash)

  const setQuantity = (chain: ChainId, qty: number) =>
    setPurchases((prev) => {
      const next = { ...prev }
      if (qty > 0) next[chain] = qty
      else delete next[chain]
      return next
    })

  const submit = () => {
    onSubmit(purchases)
    setPurchases({})
  }

  return (
    <div className={styles.buyingContent}>
      <Card title={buyPhaseText(rules.rs)}>
        <div className={styles.stockPurchaseForm}>
          {chains.length === 0 ? (
            <p className={styles.noChains}>No active {theme.chain_noun_plural} to buy into</p>
          ) : (
            chains.map((chain) => {
              const available = bank[chain.name] ?? 0
              const currentQty = purchases[chain.name] ?? 0
              // Limits: the per-turn maximum, what the bank has left, and what I can pay for.
              const cashLeft = cash - totalCost + currentQty * chain.price
              const affordable = chain.price > 0 ? Math.floor(cashLeft / chain.price) : 0
              const maxBuyable = Math.max(
                0,
                Math.min(available, maxPurchases - totalShares + currentQty, affordable)
              )

              return (
                <div
                  key={chain.name}
                  className={styles.purchaseRow}
                  data-testid={`buy-row-${chainTestId(chain.name)}`}
                  data-price={chain.price}
                  data-available={available}
                >
                  <span className={styles.purchaseChain}>
                    <ChainMarker chain={chain.name} variant="compact" />
                  </span>
                  <span className={styles.chainPrice} data-testid="buy-price">
                    {rules.money(chain.price)}
                  </span>
                  <span className={styles.chainSize} data-testid="buy-size">
                    {chain.size} tiles
                  </span>
                  <StockStepper
                    value={currentQty}
                    max={maxBuyable}
                    onChange={(qty) => setQuantity(chain.name, qty)}
                    disabled={!isMyTurn}
                  />
                  <span
                    className={styles.availableStock}
                    data-testid="buy-available"
                    title={`${theme.share_noun_plural} left in the bank`}
                  >
                    [{available}]
                  </span>
                </div>
              )
            })
          )}
          <div className={styles.purchaseSummary}>
            <span data-testid="purchase-total">Total: {rules.money(totalCost)}</span>
            <span data-testid="purchase-shares">
              ({totalShares}/{maxPurchases} {theme.share_noun_plural})
            </span>
          </div>
          {cannotAffordAny && (
            <p className={styles.errorText} data-testid="buy-note-no-cash">
              You can&apos;t afford any {theme.share_noun_plural} right now.
            </p>
          )}
          {!canAfford && (
            <p className={styles.errorText} data-testid="buy-error-cash">
              Not enough cash
            </p>
          )}
          {!validPurchase && (
            <p className={styles.errorText}>
              Maximum {maxPurchases} {theme.share_noun_plural} per turn
            </p>
          )}
        </div>
      </Card>
      <div className={styles.buyingActions}>
        <Button
          onClick={submit}
          disabled={!isMyTurn || !canAfford || !validPurchase || loading}
          loading={loading}
          data-testid="end-turn-button"
        >
          {totalShares > 0 ? 'BUY & END TURN' : 'SKIP & END TURN'}
        </Button>
        {endGameAvailable && (
          <Button
            variant="danger"
            onClick={onDeclareEndGame}
            disabled={!isMyTurn || loading}
            loading={loading}
            data-testid="end-game-button"
          >
            END GAME
          </Button>
        )}
      </div>
    </div>
  )
}
