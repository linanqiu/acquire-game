import { useState, useMemo } from 'react'
import { ChainMarker } from './ChainMarker'
import { SeatKindBadge } from './SeatKindBadge'
import { StockStepper } from './StockStepper'
import { TextInput } from '../ui/TextInput'
import { Button } from '../ui/Button'
import styles from './TradeBuilder.module.css'
import type { ChainId, SeatKind } from '../../types/api'
import { useRules } from '../../ruleset/useRules'
import { orderChainIds } from '../../lib/ruleset'

interface PlayerInfo {
  id: string
  name: string
  cash: number
  stocks: Partial<Record<ChainId, number>>
  isBot?: boolean
  kind?: SeatKind
  agentLabel?: string | null
}

interface StockOffer {
  chain: ChainId
  quantity: number
}

interface TradeOffer {
  stocks: StockOffer[]
  cash: number
}

export interface TradeBuilderProps {
  players: PlayerInfo[]
  myHoldings: StockOffer[]
  myCash: number
  onPropose: (partnerId: string, offer: TradeOffer, want: TradeOffer) => void
  onCancel: () => void
  /** Error returned by the server for the last proposal (shown inline, builder stays open). */
  serverError?: string
  /** True while a proposal is in flight. */
  submitting?: boolean
  /** Shown as a hint, e.g. while a merger freezes some chains. */
  notice?: string
  /**
   * A starting point (partner and both sides), e.g. from another player's public offer.
   * Read when the builder mounts; the player can change everything.
   */
  initial?: { partnerId: string; offer: TradeOffer; want: TradeOffer }
  /** Says where `initial` came from, e.g. "Started from Cara's offer to Bob." */
  startedFrom?: string
  /** Current share price per chain on the board: the summary values both sides with it. */
  prices?: Partial<Record<ChainId, number>>
}

/**
 * Build a trade offer: who with, what I give, what I get. Rows are one line each (chain, how
 * many the owner holds, a stepper), chains in the ruleset's order. The footer stays in view
 * while the rows scroll: both sides of the deal in words with their value at current prices,
 * the reason a proposal was refused, and the buttons.
 */

export function TradeBuilder({
  players,
  myHoldings,
  myCash,
  onPropose,
  onCancel,
  serverError,
  submitting = false,
  notice,
  initial,
  startedFrom,
  prices,
}: TradeBuilderProps) {
  const rules = useRules()
  const shareWord = rules.theme.share_noun_plural
  const [partnerId, setPartnerId] = useState<string>(initial?.partnerId ?? '')
  const [offer, setOffer] = useState<TradeOffer>(initial?.offer ?? { stocks: [], cash: 0 })
  const [want, setWant] = useState<TradeOffer>(initial?.want ?? { stocks: [], cash: 0 })
  const [error, setError] = useState('')
  const cashText = (n: number | undefined) => (n && n > 0 ? String(n) : '')
  const [offerCashInput, setOfferCashInput] = useState(cashText(initial?.offer.cash))
  const [wantCashInput, setWantCashInput] = useState(cashText(initial?.want.cash))

  const partner = useMemo(() => players.find((p) => p.id === partnerId), [players, partnerId])

  const partnerHoldings: StockOffer[] = useMemo(() => {
    if (!partner) return []
    const held = Object.keys(partner.stocks).filter((c) => (partner.stocks[c] ?? 0) > 0)
    return orderChainIds(rules.rs, held).map((chain) => ({
      chain,
      quantity: partner.stocks[chain]!,
    }))
  }, [partner, rules.rs])

  const updateOfferStock = (chain: ChainId, qty: number) => {
    const stocks = [...offer.stocks.filter((s) => s.chain !== chain)]
    if (qty > 0) stocks.push({ chain, quantity: qty })
    setOffer({ ...offer, stocks })
    setError('')
  }

  const updateWantStock = (chain: ChainId, qty: number) => {
    const stocks = [...want.stocks.filter((s) => s.chain !== chain)]
    if (qty > 0) stocks.push({ chain, quantity: qty })
    setWant({ ...want, stocks })
    setError('')
  }

  const handleOfferCashChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setOfferCashInput(value)
    const parsed = parseInt(value, 10) || 0
    const clamped = Math.max(0, Math.min(myCash, parsed))
    setOffer({ ...offer, cash: clamped })
    setError('')
  }

  const handleWantCashChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setWantCashInput(value)
    const parsed = parseInt(value, 10) || 0
    const partnerCash = partner?.cash ?? 0
    const clamped = Math.max(0, Math.min(partnerCash, parsed))
    setWant({ ...want, cash: clamped })
    setError('')
  }

  const handlePartnerSelect = (id: string) => {
    setPartnerId(id)
    // Reset want when changing partner since their holdings differ
    setWant({ stocks: [], cash: 0 })
    setWantCashInput('')
    setError('')
  }

  const validateTrade = (): string | null => {
    if (!partnerId) {
      return 'Select a trade partner'
    }
    if (offer.stocks.length === 0 && offer.cash === 0) {
      return 'You must offer something'
    }
    if (want.stocks.length === 0 && want.cash === 0) {
      return 'You must request something'
    }
    // Validate offer doesn't exceed holdings
    for (const s of offer.stocks) {
      const holding = myHoldings.find((h) => h.chain === s.chain)
      if (!holding || s.quantity > holding.quantity) {
        return `You don't have enough ${rules.name(s.chain)} ${shareWord}`
      }
    }
    if (offer.cash > myCash) {
      return "You don't have enough cash"
    }
    // Validate want doesn't exceed partner holdings
    if (partner) {
      for (const s of want.stocks) {
        const partnerQty = partner.stocks[s.chain] ?? 0
        if (s.quantity > partnerQty) {
          return `${partner.name} doesn't have enough ${rules.name(s.chain)} ${shareWord}`
        }
      }
      if (want.cash > partner.cash) {
        return `${partner.name} doesn't have enough cash`
      }
    }
    return null
  }

  const handleSubmit = () => {
    const validationError = validateTrade()
    if (validationError) {
      setError(validationError)
      return
    }
    onPropose(partnerId, offer, want)
  }

  const handleCancel = () => {
    setPartnerId('')
    setOffer({ stocks: [], cash: 0 })
    setWant({ stocks: [], cash: 0 })
    setOfferCashInput('')
    setWantCashInput('')
    setError('')
    onCancel()
  }

  const order = orderChainIds(
    rules.rs,
    myHoldings.map((h) => h.chain)
  )
  const myHoldingsWithStock = myHoldings
    .filter((h) => h.quantity > 0)
    .sort((a, b) => order.indexOf(a.chain) - order.indexOf(b.chain))

  // One side of the deal in words ("2 Sandpiper + $500") and its value at current prices.
  const side = (items: TradeOffer) => {
    const stocks = [...items.stocks].sort((a, b) => {
      const all = orderChainIds(
        rules.rs,
        items.stocks.map((x) => x.chain)
      )
      return all.indexOf(a.chain) - all.indexOf(b.chain)
    })
    const parts = stocks.map((x) => `${x.quantity} ${rules.name(x.chain)}`)
    if (items.cash > 0) parts.push(rules.money(items.cash))
    const value =
      items.cash + stocks.reduce((sum, x) => sum + x.quantity * (prices?.[x.chain] ?? 0), 0)
    return { text: parts.join(' + '), value, empty: parts.length === 0 }
  }
  const give = side(offer)
  const get = side(want)

  return (
    <div className={styles.builder} data-testid="trade-builder">
      <div className={styles.container}>
        {startedFrom && (
          <p className={styles.hint} data-testid="trade-started-from">
            {startedFrom}
          </p>
        )}
        {notice && <p className={styles.hint}>{notice}</p>}
        <div className={styles.section}>
          <span className={styles.sectionLabel}>TRADE WITH</span>
          <div className={styles.players}>
            {players.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`${styles.playerButton} ${partnerId === p.id ? styles.selected : ''}`}
                onClick={() => handlePartnerSelect(p.id)}
                aria-pressed={partnerId === p.id}
                data-testid={`player-select-${p.id}`}
              >
                <span className={styles.playerName}>
                  <span className={styles.playerNameText}>{p.name}</span>
                  <SeatKindBadge
                    playerId={p.id}
                    kind={p.kind}
                    isBot={p.isBot}
                    agentLabel={p.agentLabel}
                    interactive={false}
                  />
                </span>
                <span className={styles.playerCash}>{rules.money(p.cash)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <span className={styles.sectionLabel}>YOU OFFER</span>
          {myHoldingsWithStock.length > 0 ? (
            <div className={styles.stockList}>
              {myHoldingsWithStock.map((h) => (
                <div
                  key={h.chain}
                  className={styles.stockRow}
                  data-testid={`offer-stock-${h.chain}`}
                >
                  <ChainMarker chain={h.chain} variant="compact" />
                  <span className={styles.available} title={`You have ${h.quantity}`}>
                    of {h.quantity}
                  </span>
                  <StockStepper
                    value={offer.stocks.find((s) => s.chain === h.chain)?.quantity || 0}
                    max={h.quantity}
                    onChange={(qty) => updateOfferStock(h.chain, qty)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.noStocks}>You have no {shareWord} to offer</p>
          )}
          <div className={styles.cashRow}>
            <label htmlFor="offer-cash">Cash</label>
            <span className={styles.available} title="Your cash">
              of {rules.money(myCash)}
            </span>
            <TextInput
              id="offer-cash"
              type="number"
              min={0}
              max={myCash}
              value={offerCashInput}
              onChange={handleOfferCashChange}
              placeholder="0"
              inputMode="numeric"
              step={100}
              aria-label="Cash you offer"
              data-testid="offer-cash-input"
            />
          </div>
        </div>

        {partner && (
          <div className={styles.section}>
            <span className={styles.sectionLabel}>YOU WANT FROM {partner.name.toUpperCase()}</span>
            {partnerHoldings.length > 0 ? (
              <div className={styles.stockList}>
                {partnerHoldings.map((h) => (
                  <div
                    key={h.chain}
                    className={styles.stockRow}
                    data-testid={`want-stock-${h.chain}`}
                  >
                    <ChainMarker chain={h.chain} variant="compact" />
                    <span className={styles.available} title={`${partner.name} has ${h.quantity}`}>
                      of {h.quantity}
                    </span>
                    <StockStepper
                      value={want.stocks.find((s) => s.chain === h.chain)?.quantity || 0}
                      max={h.quantity}
                      onChange={(qty) => updateWantStock(h.chain, qty)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.noStocks}>
                {partner.name} has no {shareWord}
              </p>
            )}
            <div className={styles.cashRow}>
              <label htmlFor="want-cash">Cash</label>
              <span className={styles.available} title={`${partner.name}'s cash`}>
                of {rules.money(partner.cash)}
              </span>
              <TextInput
                id="want-cash"
                type="number"
                min={0}
                max={partner.cash}
                value={wantCashInput}
                onChange={handleWantCashChange}
                placeholder="0"
                inputMode="numeric"
                step={100}
                aria-label={`Cash you want from ${partner.name}`}
                data-testid="want-cash-input"
              />
            </div>
          </div>
        )}

        {!partner && (
          <div className={styles.section}>
            <p className={styles.hint}>Select a trade partner to see their holdings</p>
          </div>
        )}
      </div>

      {/* Always in view under the scrolling rows: the deal, the refusal reason, the buttons. */}
      <div className={styles.footer}>
        <dl className={styles.summary} data-testid="trade-summary">
          <div className={styles.summaryRow} data-testid="trade-give">
            <dt>You give</dt>
            <dd className={give.empty ? styles.nothing : undefined}>
              {give.empty ? 'nothing yet' : give.text}
            </dd>
            <dd className={styles.value} title="At current prices">
              {give.empty ? '' : rules.money(give.value)}
            </dd>
          </div>
          <div className={styles.summaryRow} data-testid="trade-get">
            <dt>You get</dt>
            <dd className={get.empty ? styles.nothing : undefined}>
              {get.empty ? 'nothing yet' : get.text}
            </dd>
            <dd className={styles.value} title="At current prices">
              {get.empty ? '' : rules.money(get.value)}
            </dd>
          </div>
        </dl>
        {(error || serverError) && (
          <p className={styles.error} role="alert" data-testid="trade-error">
            {error || serverError}
          </p>
        )}

        <div className={styles.actions}>
          <Button variant="secondary" onClick={handleCancel} data-testid="cancel-trade">
            CANCEL
          </Button>
          <Button onClick={handleSubmit} disabled={submitting} data-testid="propose-trade">
            {submitting ? 'SENDING…' : 'PROPOSE TRADE'}
          </Button>
        </div>
      </div>
    </div>
  )
}
