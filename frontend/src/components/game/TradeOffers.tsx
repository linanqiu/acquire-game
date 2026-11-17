import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Hint } from '../ui/Hint'
import { ChainMarker } from './ChainMarker'
import { SeatKindBadge } from './SeatKindBadge'
import { incomingBlockReason, nonZero, type TradeParty } from '../../lib/trades'
import type { TradeOffer } from '../../types/api'
import { useRules } from '../../ruleset/useRules'
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
  /**
   * `incoming`: offers waiting for my answer (shown in the "now" area whatever tab is open;
   * nothing when there are none). `mine`: the Trades tab: PROPOSE TRADE, my own pending
   * offers, and every other open offer at the table (offers are public).
   */
  part: 'incoming' | 'mine'
  /** Every open offer at the table (`part="mine"`); the ones I did not make are listed. */
  tableOffers?: TradeOffer[]
  /** Start my own offer from someone else's: to its recipient or to its proposer. */
  onCompete?: (offer: TradeOffer, target: 'recipient' | 'proposer') => void
  /** Go to where I answer an offer made to me (the decision tab). */
  onAnswer?: () => void
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
  const rules = useRules()
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
        {money > 0 && <span className={styles.item}>{rules.money(money)}</span>}
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
        playerName={party?.name}
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
  part,
  tableOffers = [],
  onCompete,
  onAnswer,
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
  // Offers I did not make: the ones for me (answered in the decision tab) and the ones
  // between two other players (read-only, with a way to make my own offer to either side).
  const atTable = tableOffers.filter((o) => o.from_player_id !== myPlayerId)
  const me = players[myPlayerId]
  const rules = useRules()

  if (part === 'incoming' && incoming.length === 0) return null

  return (
    <section
      className={part === 'incoming' ? `${styles.panel} ${styles.attention}` : styles.section}
      data-testid={part === 'incoming' ? 'trade-incoming' : 'trade-offers'}
      aria-label={part === 'incoming' ? 'Trade offers for you' : 'Your trade offers'}
    >
      {/* An offer for me names itself ("Cara offers you a trade"): no title over it. The
          Trades tab starts with the one line an empty table needs, and the way to propose. */}
      {part === 'mine' && (
        <>
          <header className={styles.header}>
            <h4 className={styles.title}>Offers</h4>
            <Hint id="trades">
              Offers are public: everyone sees them, and anyone can make a competing offer.
            </Hint>
            <Button variant="secondary" onClick={onPropose} className={styles.propose}>
              PROPOSE TRADE
            </Button>
          </header>
          {outgoing.length === 0 && atTable.length === 0 && (
            <p className={styles.empty} data-testid="trade-table-empty">
              No open offers
            </p>
          )}
        </>
      )}

      {part === 'incoming' &&
        incoming.map((offer) => {
          const proposer = players[offer.from_player_id]
          const reason = incomingBlockReason(offer, me, proposer, rules.rs)
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
              <Side label="You get" stocks={offer.offering_stocks} money={offer.offering_money} />
              <Side
                label="You give"
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

      {part === 'mine' &&
        outgoing.map((offer) => {
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

      {part === 'mine' && atTable.length > 0 && (
        <div className={styles.table} data-testid="trade-table" aria-label="Offers at the table">
          {atTable.map((offer) => {
            const proposer = players[offer.from_player_id]
            const target = players[offer.to_player_id]
            const forMe = offer.to_player_id === myPlayerId
            return (
              <div
                key={offer.trade_id}
                className={styles.offer}
                data-testid={`trade-table-${offer.trade_id}`}
              >
                <div className={styles.offerHead}>
                  <PlayerName id={offer.from_player_id} party={proposer} />
                  <span className={styles.verb}>offers</span>
                  {forMe ? (
                    <strong>you</strong>
                  ) : (
                    <PlayerName id={offer.to_player_id} party={target} />
                  )}
                </div>
                <Side label="Gives" stocks={offer.offering_stocks} money={offer.offering_money} />
                <Side
                  label="Wants"
                  stocks={offer.requesting_stocks}
                  money={offer.requesting_money}
                />
                {forMe ? (
                  <div className={styles.actions}>
                    <Button
                      size="sm"
                      onClick={onAnswer}
                      data-testid={`trade-answer-${offer.trade_id}`}
                    >
                      ANSWER
                    </Button>
                  </div>
                ) : (
                  <div className={styles.compete}>
                    <span className={styles.sideLabel}>Compete</span>
                    <span className={styles.competeButtons}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onCompete?.(offer, 'recipient')}
                        data-testid={`trade-compete-recipient-${offer.trade_id}`}
                      >
                        TO {target?.name ?? 'the recipient'}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onCompete?.(offer, 'proposer')}
                        data-testid={`trade-compete-proposer-${offer.trade_id}`}
                      >
                        TO {proposer?.name ?? 'the proposer'}
                      </Button>
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
