import { useState, useMemo } from 'react'
import { ChainMarker } from './ChainMarker'
import { StockStepper } from './StockStepper'
import { TextInput } from '../ui/TextInput'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import styles from './TradeBuilder.module.css'
import type { ChainName } from '../../types/api'

interface PlayerInfo {
  id: string
  name: string
  cash: number
  stocks: Partial<Record<ChainName, number>>
}

interface StockOffer {
  chain: ChainName
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
}

export function TradeBuilder({
  players,
  myHoldings,
  myCash,
  onPropose,
  onCancel,
}: TradeBuilderProps) {
  const [partnerId, setPartnerId] = useState<string>('')
  const [offer, setOffer] = useState<TradeOffer>({ stocks: [], cash: 0 })
  const [want, setWant] = useState<TradeOffer>({ stocks: [], cash: 0 })
  const [error, setError] = useState('')
  const [offerCashInput, setOfferCashInput] = useState('')
  const [wantCashInput, setWantCashInput] = useState('')

  const partner = useMemo(() => players.find((p) => p.id === partnerId), [players, partnerId])

  const partnerHoldings: StockOffer[] = useMemo(() => {
    if (!partner) return []
    return Object.entries(partner.stocks)
      .filter(([, qty]) => qty && qty > 0)
      .map(([chain, qty]) => ({ chain: chain as ChainName, quantity: qty! }))
  }, [partner])

  const updateOfferStock = (chain: ChainName, qty: number) => {
    const stocks = [...offer.stocks.filter((s) => s.chain !== chain)]
    if (qty > 0) stocks.push({ chain, quantity: qty })
    setOffer({ ...offer, stocks })
    setError('')
  }

  const updateWantStock = (chain: ChainName, qty: number) => {
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
        return `You don't have enough ${s.chain} stock`
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
          return `${partner.name} doesn't have enough ${s.chain} stock`
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

  const myHoldingsWithStock = myHoldings.filter((h) => h.quantity > 0)

  return (
    <Card title="NEW TRADE" onClose={handleCancel}>
      <div className={styles.container} data-testid="trade-builder">
        {error && (
          <p className={styles.error} role="alert" data-testid="trade-error">
            {error}
          </p>
        )}

        <div className={styles.section}>
          <label className={styles.sectionLabel}>TRADE WITH:</label>
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
                <span className={styles.playerName}>{p.name}</span>
                <span className={styles.playerCash}>${p.cash.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <label className={styles.sectionLabel}>YOU OFFER:</label>
          {myHoldingsWithStock.length > 0 ? (
            <div className={styles.stockList}>
              {myHoldingsWithStock.map((h) => (
                <div key={h.chain} className={styles.stockRow}>
                  <ChainMarker chain={h.chain} variant="compact" />
                  <StockStepper
                    value={offer.stocks.find((s) => s.chain === h.chain)?.quantity || 0}
                    max={h.quantity}
                    onChange={(qty) => updateOfferStock(h.chain, qty)}
                  />
                  <span className={styles.available}>(you have {h.quantity})</span>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.noStocks}>You have no stocks to offer</p>
          )}
          <div className={styles.cashRow}>
            <label htmlFor="offer-cash">Cash:</label>
            <TextInput
              id="offer-cash"
              type="number"
              min={0}
              max={myCash}
              value={offerCashInput}
              onChange={handleOfferCashChange}
              placeholder="0"
              data-testid="offer-cash-input"
            />
            <span className={styles.available}>(max ${myCash.toLocaleString()})</span>
          </div>
        </div>

        {partner && (
          <div className={styles.section}>
            <label className={styles.sectionLabel}>YOU WANT FROM {partner.name.toUpperCase()}:</label>
            {partnerHoldings.length > 0 ? (
              <div className={styles.stockList}>
                {partnerHoldings.map((h) => (
                  <div key={h.chain} className={styles.stockRow}>
                    <ChainMarker chain={h.chain} variant="compact" />
                    <StockStepper
                      value={want.stocks.find((s) => s.chain === h.chain)?.quantity || 0}
                      max={h.quantity}
                      onChange={(qty) => updateWantStock(h.chain, qty)}
                    />
                    <span className={styles.available}>(they have {h.quantity})</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.noStocks}>{partner.name} has no stocks</p>
            )}
            <div className={styles.cashRow}>
              <label htmlFor="want-cash">Cash:</label>
              <TextInput
                id="want-cash"
                type="number"
                min={0}
                max={partner.cash}
                value={wantCashInput}
                onChange={handleWantCashChange}
                placeholder="0"
                data-testid="want-cash-input"
              />
              <span className={styles.available}>(max ${partner.cash.toLocaleString()})</span>
            </div>
          </div>
        )}

        {!partner && (
          <div className={styles.section}>
            <p className={styles.hint}>Select a trade partner to see their holdings</p>
          </div>
        )}

        <div className={styles.actions}>
          <Button variant="secondary" onClick={handleCancel} data-testid="cancel-trade">
            CANCEL
          </Button>
          <Button onClick={handleSubmit} data-testid="propose-trade">
            PROPOSE TRADE
          </Button>
        </div>
      </div>
    </Card>
  )
}
