import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { ChainMarker } from './ChainMarker'
import { SeatKindBadge } from './SeatKindBadge'
import { incomingBlockReason, nonZero, type TradeParty } from '../../lib/trades'
import type { TradeOffer } from '../../types/api'
import styles from './TradeOffers.module.css'

export type { TradeParty }

export interface TradeOffersProps {
  offers: TradeOffer[]
  myPlayerId: string
  /** Everyone in the game, keyed by player id (includes me). */
  players: Record<string, TradeParty>
  onAccept: (tradeId: string) => void
  onReject: (tradeId: string) => void
  onCancel: (tradeId: string) => void
  onPropose: () => void
  proposeDisabled?: boolean
}

function Side({
  stocks,
  money,
  label,
}: {
  stocks: TradeOffer['offering_stocks']
  money: number
  label: string
}) {
  const items = nonZero(stocks)
  return (
    <div className={styles.side}>
      <span className={styles.sideLabel}>{label}</span>
      <span className={styles.items}>
        {items.map(([chain, qty]) => (
          <span key={chain} className={styles.item} data-testid={`trade-stock-${chain}`}>
            <ChainMarker chain={chain} variant="compact" />
            <span className={styles.qty}>×{qty}</span>
          </span>
        ))}
        {money > 0 && <span className={styles.item}>${money.toLocaleString()}</span>}
        {items.length === 0 && money <= 0 && <span className={styles.nothing}>nothing</span>}
      </span>
    </div>
  )
}

function PlayerName({ id, party }: { id: string; party?: TradeParty }) {
  return (
    <span className={styles.who}>
      <strong>{party?.name ?? 'Unknown'}</strong>
      <SeatKindBadge
        playerId={id}
        kind={party?.kind}
        isBot={party?.is_bot}
        agentLabel={party?.agent_label}
      />
    </span>
  )
}

export function TradeOffers({
  offers,
  myPlayerId,
  players,
  onAccept,
  onReject,
  onCancel,
  onPropose,
  proposeDisabled,
}: TradeOffersProps) {
  // Ids we have already responded to: buttons stay disabled until the offer disappears
  // (or a few seconds pass, in case the server refused the action).
  const [acting, setActing] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (acting.size === 0) return
    const timer = setTimeout(() => setActing(new Set()), 4000)
    return () => clearTimeout(timer)
  }, [acting])

  const act = (id: string, fn: (id: string) => void) => {
    setActing((prev) => new Set(prev).add(id))
    fn(id)
  }

  const incoming = offers.filter((o) => o.to_player_id === myPlayerId)
  const outgoing = offers.filter((o) => o.from_player_id === myPlayerId)
  const me = players[myPlayerId]

  return (
    <section
      className={`${styles.panel} ${incoming.length > 0 ? styles.attention : ''}`}
      data-testid="trade-offers"
      aria-label="Trade offers"
    >
      <header className={styles.header}>
        <h4 className={styles.title}>
          TRADES
          {incoming.length > 0 && (
            <span className={styles.count} data-testid="trade-incoming-count">
              {incoming.length} NEW
            </span>
          )}
        </h4>
        <Button variant="secondary" size="sm" onClick={onPropose} disabled={proposeDisabled}>
          PROPOSE TRADE
        </Button>
      </header>

      {offers.length === 0 && <p className={styles.empty}>No pending offers</p>}

      {incoming.map((offer) => {
        const proposer = players[offer.from_player_id]
        const reason = incomingBlockReason(offer, me, proposer)
        const busy = acting.has(offer.trade_id)
        return (
          <div
            key={offer.trade_id}
            className={styles.offer}
            data-testid={`trade-offer-${offer.trade_id}`}
          >
            <div className={styles.offerHead}>
              <PlayerName id={offer.from_player_id} party={proposer} />
              <span className={styles.verb}>offers you a trade</span>
            </div>
            <Side label="They give" stocks={offer.offering_stocks} money={offer.offering_money} />
            <Side
              label="They want"
              stocks={offer.requesting_stocks}
              money={offer.requesting_money}
            />
            {reason && (
              <p className={styles.reason} data-testid={`trade-reason-${offer.trade_id}`}>
                {reason}
              </p>
            )}
            <div className={styles.actions}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => act(offer.trade_id, onReject)}
                disabled={busy}
                data-testid={`trade-reject-${offer.trade_id}`}
              >
                REJECT
              </Button>
              <Button
                size="sm"
                onClick={() => act(offer.trade_id, onAccept)}
                disabled={busy || reason !== null}
                title={reason ?? undefined}
                data-testid={`trade-accept-${offer.trade_id}`}
              >
                ACCEPT
              </Button>
            </div>
          </div>
        )
      })}

      {outgoing.map((offer) => {
        const target = players[offer.to_player_id]
        const busy = acting.has(offer.trade_id)
        return (
          <div
            key={offer.trade_id}
            className={`${styles.offer} ${styles.outgoing}`}
            data-testid={`trade-outgoing-${offer.trade_id}`}
          >
            <div className={styles.offerHead}>
              <span className={styles.verb}>Your offer to</span>
              <PlayerName id={offer.to_player_id} party={target} />
              <span className={styles.pending}>waiting</span>
            </div>
            <Side label="You give" stocks={offer.offering_stocks} money={offer.offering_money} />
            <Side
              label="You want"
              stocks={offer.requesting_stocks}
              money={offer.requesting_money}
            />
            <div className={styles.actions}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => act(offer.trade_id, onCancel)}
                disabled={busy}
                data-testid={`trade-cancel-${offer.trade_id}`}
              >
                CANCEL OFFER
              </Button>
            </div>
          </div>
        )
      })}
    </section>
  )
}
