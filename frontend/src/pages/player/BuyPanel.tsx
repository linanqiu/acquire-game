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

const ROLE_WORD = { majority: 'most shares', minority: 'second most shares' } as const

/**
 * The buy decision (BL-011, BL-015): one compact row per chain on the board, under one header
 * row that names the columns once: price, tiles, shares left in the bank, my shares (marked as
 * in the players table: filled for the most shares, outlined for the second most, "=" for a
 * tie; "3→5" while I buy) and a stepper limited by the per-turn cap, the bank and my cash. The
 * row I am buying in opens a second line: how the purchase moves me among the holders and what
 * 1st and 2nd are paid. Tapping a chain's name opens the same line with every holder, so each
 * number stays one tap away without being printed seven times. The total, cash after and the
 * buttons stay pinned at the bottom.
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
  // The chain whose holders and bonuses are opened by a tap on its name.
  const [opened, setOpened] = useState<ChainId | null>(null)

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
        <div className={styles.rows} data-table-core>
          {/* Column names, once. Each cell also carries its own words for screen readers. */}
          <div className={`${styles.row} ${styles.head}`} aria-hidden="true" data-testid="buy-head">
            <span />
            <span>Price</span>
            <span>Tiles</span>
            <span>Bank</span>
            <span>You</span>
            <span className={styles.headBuy}>Buy</span>
          </div>
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
            const myHolder = holders.find((h) => h.player_id === myId)
            const role = mine > 0 ? (myHolder?.role ?? null) : null
            const tied = !!role && !!myHolder?.tied
            const open = opened === chain.name
            const name = rules.name(chain.name)

            return (
              <div
                key={chain.name}
                className={`${styles.row} ${currentQty > 0 ? styles.buying : ''}`}
                data-testid={`buy-row-${id}`}
                data-price={chain.price}
                data-available={available}
                data-mine={mine}
              >
                <button
                  type="button"
                  className={styles.chain}
                  onClick={() => setOpened(open ? null : chain.name)}
                  aria-expanded={open}
                  aria-label={`${name}: holders and bonuses`}
                  data-testid={`buy-details-${id}`}
                >
                  <ChainMarker chain={chain.name} variant="compact" />
                </button>
                <span className={styles.price} data-testid="buy-price">
                  {rules.money(chain.price)}
                </span>
                <span className={styles.num} data-testid="buy-size">
                  {chain.size}
                  <span className={styles.srOnly}> tiles</span>
                </span>
                <span
                  className={`${styles.num} ${available === 0 ? styles.soldOut : ''}`}
                  data-testid="buy-available"
                  title={`${theme.share_noun_plural} left in the bank`}
                >
                  {available}
                  <span className={styles.srOnly}> left</span>
                </span>
                <span
                  className={styles.mine}
                  data-testid="buy-mine"
                  title={`You hold ${rules.shares(mine)}${
                    role ? `, ${tied ? 'tied for ' : ''}${ROLE_WORD[role]}` : ''
                  }`}
                >
                  <span className={styles.srOnly}>you hold </span>
                  <span
                    className={`${styles.count} ${role ? styles[role] : ''}`}
                    style={role ? rules.style(chain.name) : undefined}
                  >
                    {tied && <span aria-hidden="true">=</span>}
                    {mine}
                  </span>
                  {role && (
                    <span className={styles.srOnly}>
                      {' '}
                      {tied ? 'tied for ' : ''}
                      {ROLE_WORD[role]}
                    </span>
                  )}
                  {currentQty > 0 && (
                    <span className={styles.next} data-testid="buy-mine-next">
                      <span aria-hidden="true">→</span>
                      <span className={styles.srOnly}> becomes </span>
                      {mine + currentQty}
                    </span>
                  )}
                </span>
                <span className={styles.stepper}>
                  <StockStepper
                    value={currentQty}
                    max={maxBuyable}
                    onChange={(qty) => setQuantity(chain.name, qty)}
                    disabled={!isMyTurn}
                    label={`${name} ${theme.share_noun_plural} to buy`}
                    compact
                  />
                </span>
                {(open || currentQty > 0) && (
                  <span className={styles.detail} data-testid={`buy-detail-${id}`}>
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
                    {open && (
                      <HolderChips
                        holders={holders}
                        players={gameState.players}
                        me={myId}
                        myNext={mine + currentQty}
                        testId={`buy-holders-${id}`}
                      />
                    )}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
      {/* Pinned at the bottom of the tab while the rows scroll. */}
      <div className={styles.footer} data-table-core>
        <div className={styles.summary}>
          <span>
            <span data-testid="purchase-total">Total: {rules.money(totalCost)}</span>{' '}
            <span className={styles.muted} data-testid="purchase-shares">
              ({totalShares}/{maxPurchases} {theme.share_noun_plural})
            </span>
          </span>
          <span data-testid="purchase-cash-after">Cash after {rules.money(cash - totalCost)}</span>
          {/* Why the steppers stop, next to the totals (no line of its own over the button). */}
          {cannotAffordAny && (
            <span className={styles.error} data-testid="buy-note-no-cash">
              Can&apos;t afford any {theme.share_noun_plural}
            </span>
          )}
          {!canAfford && (
            <span className={styles.error} data-testid="buy-error-cash">
              Not enough cash
            </span>
          )}
          {!validPurchase && (
            <span className={styles.error}>
              Maximum {maxPurchases} {theme.share_noun_plural} per turn
            </span>
          )}
        </div>
        <div className={styles.actions}>
          <Button
            variant="accent"
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
