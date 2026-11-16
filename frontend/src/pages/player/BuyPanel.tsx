import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { ChainMarker } from '../../components/game/ChainMarker'
import { HolderChips } from '../../components/game/HolderChips'
import { StockStepper } from '../../components/game/StockStepper'
import { useRules } from '../../ruleset/useRules'
import { chainTestId } from '../../lib/ruleset'
import { changeText } from '../../lib/standing'
import { buyPhaseText } from '../../lib/phaseText'
import type { ChainId, GameStateMessage } from '../../types/api'
import styles from './BuyPanel.module.css'

type HotelChain = GameStateMessage['hotel']['chains'][number]
export type Purchases = Partial<Record<ChainId, number>>

interface BuyPanelProps {
  /** Active chains, in the ruleset's order. */
  chains: HotelChain[]
  /** Shares left in the bank, per chain. */
  bank: Partial<Record<ChainId, number>>
  cash: number
  /** Holders per chain and everyone's names (the server's `chain_holders`). */
  gameState: GameStateMessage
  myId?: string
  isMyTurn: boolean
  endGameAvailable: boolean
  loading: boolean
  /** BUY & END TURN / SKIP & END TURN (empty purchases). */
  onSubmit: (purchases: Purchases) => void
  onDeclareEndGame: () => void
}

/**
 * The buy decision (BL-011): one row per chain on the board with its price, bank stock, who
 * holds it (1st / 2nd from the engine, everyone else, me) and what 1st and 2nd would be paid
 * now, a stepper limited by the per-turn cap, the bank and cash, and how my purchase would move
 * me among the holders. The total, cash after and the buttons stay pinned at the bottom.
 */
export function BuyPanel({
  chains,
  bank,
  cash,
  gameState,
  myId,
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
  const me = myId ? gameState.players[myId] : undefined

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
    <section className={styles.buy} aria-label={buyPhaseText(rules.rs)} data-testid="buy-panel">
      {chains.length === 0 ? (
        <p className={styles.note}>No active {theme.chain_noun_plural} to buy into</p>
      ) : (
        <div className={styles.rows}>
          {chains.map((chain) => {
            const available = bank[chain.name] ?? 0
            const currentQty = purchases[chain.name] ?? 0
            // Limits: the per-turn maximum, what the bank has left, and what I can pay for.
            const cashLeft = cash - totalCost + currentQty * chain.price
            const affordable = chain.price > 0 ? Math.floor(cashLeft / chain.price) : 0
            const maxBuyable = Math.max(
              0,
              Math.min(available, maxPurchases - totalShares + currentQty, affordable)
            )
            const info = gameState.chain_holders?.[chain.name]
            const holders = info?.holders ?? []
            const mine = me?.stocks[chain.name] ?? 0
            const id = chainTestId(chain.name)
            const change = myId ? changeText(holders, myId, mine, currentQty) : ''

            return (
              <div
                key={chain.name}
                className={`${styles.row} ${mine > 0 ? styles.held : ''}`}
                data-testid={`buy-row-${id}`}
                data-price={chain.price}
                data-available={available}
                data-mine={mine}
              >
                <span className={styles.chain}>
                  <ChainMarker chain={chain.name} variant="compact" />
                </span>
                <span className={styles.facts}>
                  <span className={styles.price} data-testid="buy-price">
                    {rules.money(chain.price)}
                  </span>
                  <span className={styles.muted} data-testid="buy-size">
                    {chain.size} tiles
                  </span>
                  <span
                    className={styles.muted}
                    data-testid="buy-available"
                    title={`${theme.share_noun_plural} left in the bank`}
                  >
                    {available} left
                  </span>
                </span>
                <span className={styles.stepper}>
                  <StockStepper
                    value={currentQty}
                    max={maxBuyable}
                    onChange={(qty) => setQuantity(chain.name, qty)}
                    disabled={!isMyTurn}
                  />
                </span>
                <span className={styles.holders}>
                  <HolderChips
                    holders={holders}
                    players={gameState.players}
                    me={myId}
                    myNext={mine + currentQty}
                    testId={`buy-holders-${id}`}
                  />
                  {change && (
                    <span className={styles.change} data-testid="buy-projection">
                      {change}
                    </span>
                  )}
                  {info && (
                    <span className={styles.bonus} data-testid="buy-bonus">
                      1st {rules.money(info.majority_bonus)} · 2nd{' '}
                      {rules.money(info.minority_bonus)}
                    </span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {(cannotAffordAny || !canAfford || !validPurchase) && (
        <div className={styles.notes}>
          {cannotAffordAny && (
            <p className={styles.error} data-testid="buy-note-no-cash">
              You can&apos;t afford any {theme.share_noun_plural} right now.
            </p>
          )}
          {!canAfford && (
            <p className={styles.error} data-testid="buy-error-cash">
              Not enough cash
            </p>
          )}
          {!validPurchase && (
            <p className={styles.error}>
              Maximum {maxPurchases} {theme.share_noun_plural} per turn
            </p>
          )}
        </div>
      )}
      {/* Pinned at the bottom of the tab while the rows scroll. */}
      <div className={styles.footer}>
        <div className={styles.summary}>
          <span data-testid="purchase-total">Total: {rules.money(totalCost)}</span>
          <span data-testid="purchase-shares">
            ({totalShares}/{maxPurchases} {theme.share_noun_plural})
          </span>
          <span data-testid="purchase-cash-after">Cash after {rules.money(cash - totalCost)}</span>
        </div>
        <div className={styles.actions}>
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
    </section>
  )
}
