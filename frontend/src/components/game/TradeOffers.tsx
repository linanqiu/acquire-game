import { useEffect, useMemo, useState } from 'react'
import { Button } from '../ui/Button'
import { ChainMarker } from './ChainMarker'
import { SeatKindBadge } from './SeatKindBadge'
import { incomingBlockReason, nonZero, positionLines, type TradeParty } from '../../lib/trades'
import { useTradePreview } from '../../hooks/useTradePreview'
import { orderChainIds } from '../../lib/ruleset'
import type { TradeOffer } from '../../types/api'
import { useRules } from '../../ruleset/useRules'
import styles from './TradeOffers.module.css'

export type { TradeParty }

export interface TradeOffersProps {
  /** The offers I am a party to (made to me, made by me). */
  offers: TradeOffer[]
  myPlayerId: string
  /** Everyone in the game, keyed by player id (includes me). */
  players: Record<string, TradeParty>
  onAccept: (tradeId: string) => void
  onReject: (tradeId: string) => void
  onCancel: (tradeId: string) => void
  /**
   * `incoming`: offers waiting for my answer, in the table panel with my other decisions
   * (nothing when there are none). `mine`: the Trades tab's list of every open offer at the
   * table (offers are public): for me (answered in place), mine (WITHDRAW), between others
   * (read-only, with a way to compete).
   */
  part: 'incoming' | 'mine'
  /** Every open offer at the table (`part="mine"`). */
  tableOffers?: TradeOffer[]
  /** Start my own offer from someone else's: to its recipient or to its proposer. */
  onCompete?: (offer: TradeOffer, target: 'recipient' | 'proposer') => void
  /** Answer an offer made to me with one of my own (the composer, filled in and reversed). */
  onCounter?: (offer: TradeOffer) => void
  /** The room: an offer for me asks the server what it would do to the positions. */
  room?: string
  /** Changes when the game does (the game state). */
  version?: unknown
  /** Is the tab that holds the list on screen? (`part="mine"`; the list is put in order,
   *  offers for me first, each time it comes on screen.) */
  shown?: boolean
}

/** One side of a deal: a small label over its items, chains in the ruleset's order. */
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
  const held = Object.fromEntries(nonZero(stocks))
  const items = orderChainIds(rules.rs, Object.keys(held)).map((c) => [c, held[c]] as const)
  return (
    <div className={styles.side}>
      <span className={styles.sideLabel}>{label}</span>
      <span className={styles.items}>
        {items.map(([chain, qty]) => (
          <span
            key={chain}
            className={styles.item}
            data-testid={`trade-stock-${chain}`}
            title={rules.name(chain)}
          >
            <ChainMarker chain={chain} variant="icon" />
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

interface IncomingProps {
  offer: TradeOffer
  myPlayerId: string
  players: Record<string, TradeParty>
  /** Test ids: `trade-offer-…`, `trade-accept-…` in the table panel; `trade-table-…` in the
   *  Trades tab (both stay mounted, each id is on the page once). */
  ids: { card: string; action: string; effects: string }
  busy: boolean
  onAccept: () => void
  onReject: () => void
  onCounter?: () => void
  room?: string
  version?: unknown
}

/**
 * An offer made to me, with everything to answer it in place: what I give and get, what it
 * does to first and second place (the server's preview of this offer), and REJECT / COUNTER /
 * ACCEPT.
 */
function IncomingOffer({
  offer,
  myPlayerId,
  players,
  ids,
  busy,
  onAccept,
  onReject,
  onCounter,
  room = '',
  version,
}: IncomingProps) {
  const rules = useRules()
  const proposer = players[offer.from_player_id]
  const reason = incomingBlockReason(offer, players[myPlayerId], proposer, rules.rs)
  const body = useMemo(() => ({ trade_id: offer.trade_id }), [offer.trade_id])
  const { preview } = useTradePreview(room, myPlayerId, body, version)
  const names = useMemo(
    () => Object.fromEntries(Object.entries(players).map(([id, p]) => [id, p.name])),
    [players]
  )
  const effects = preview?.valid ? positionLines(preview.positions, names, myPlayerId) : []
  const id = offer.trade_id
  return (
    <div className={`${styles.offer} ${styles.forMe}`} data-testid={`${ids.card}-${id}`}>
      <div className={styles.offerHead}>
        <PlayerName id={offer.from_player_id} party={proposer} />
        <span className={styles.verb}>offers you a trade</span>
      </div>
      <div className={styles.terms}>
        <Side label="You give" stocks={offer.requesting_stocks} money={offer.requesting_money} />
        <Side label="You get" stocks={offer.offering_stocks} money={offer.offering_money} />
      </div>
      {effects.length > 0 && (
        <div className={styles.effects} data-testid={`${ids.effects}-${id}`}>
          {effects.map((line) => (
            <p key={line.chain} className={styles.effect}>
              <ChainMarker chain={line.chain} variant="icon" />
              <span>
                <span className={styles.srOnly}>{rules.name(line.chain)}: </span>
                {line.text}
              </span>
            </p>
          ))}
        </div>
      )}
      {reason && (
        <p className={styles.reason} data-testid={`${ids.action}-reason-${id}`}>
          {reason}
        </p>
      )}
      <div className={styles.answers}>
        <Button
          variant="secondary"
          onClick={onReject}
          disabled={busy}
          data-testid={`${ids.action}-reject-${id}`}
        >
          REJECT
        </Button>
        {onCounter && (
          <Button
            variant="secondary"
            onClick={onCounter}
            disabled={busy}
            data-testid={`${ids.action}-counter-${id}`}
          >
            COUNTER
          </Button>
        )}
        <Button
          variant="accent"
          onClick={onAccept}
          disabled={busy || reason !== null}
          title={reason ?? undefined}
          data-testid={`${ids.action}-accept-${id}`}
        >
          ACCEPT
        </Button>
      </div>
    </div>
  )
}

export function TradeOffers({
  offers,
  myPlayerId,
  players,
  onAccept,
  onReject,
  onCancel,
  part,
  tableOffers = [],
  onCompete,
  onCounter,
  room,
  version,
  shown = true,
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

  // The order of the Trades tab's list as it was when the tab was last opened.
  const [opened, setOpened] = useState<string[]>([])
  const [wasShown, setWasShown] = useState(false)
  if (shown !== wasShown) {
    setWasShown(shown)
    if (shown) {
      const group = (o: TradeOffer) =>
        o.to_player_id === myPlayerId ? 0 : o.from_player_id === myPlayerId ? 1 : 2
      const all = [
        ...tableOffers,
        ...offers.filter((o) => !tableOffers.some((t) => t.trade_id === o.trade_id)),
      ]
      setOpened([0, 1, 2].flatMap((g) => all.filter((o) => group(o) === g).map((o) => o.trade_id)))
    }
  }

  const forMe = (offer: TradeOffer, ids: IncomingProps['ids']) => (
    <IncomingOffer
      key={offer.trade_id}
      offer={offer}
      myPlayerId={myPlayerId}
      players={players}
      ids={ids}
      busy={acting.has(offer.trade_id)}
      onAccept={() => act(offer.trade_id, onAccept)}
      onReject={() => act(offer.trade_id, onReject)}
      onCounter={onCounter ? () => onCounter(offer) : undefined}
      room={room}
      version={version}
    />
  )

  if (part === 'incoming') {
    if (incoming.length === 0) return null
    // An offer for me names itself ("Cara offers you a trade"): no title over it.
    return (
      <section
        className={styles.incoming}
        data-testid="trade-incoming"
        aria-label="Trade offers for you"
      >
        {incoming.map((offer) =>
          forMe(offer, { card: 'trade-offer', action: 'trade', effects: 'trade-effects-offer' })
        )}
      </section>
    )
  }

  // Every open offer. When the tab opens (my own action) the ones that wait for my answer come
  // first, then mine, then the others'. While it stays open a new offer is added at the foot of
  // the list, whoever it is for, so the cards above it and their buttons stay where they are
  // under the reader's thumb (BL-021); the tab's badge counts what is for me.
  const open = [
    ...tableOffers,
    ...offers.filter((o) => !tableOffers.some((t) => t.trade_id === o.trade_id)),
  ]
  const listed = [
    ...opened.flatMap((id) => open.filter((o) => o.trade_id === id)),
    ...open.filter((o) => !opened.includes(o.trade_id)),
  ]

  const mine = (offer: TradeOffer) => {
    const target = players[offer.to_player_id]
    return (
      <div
        key={offer.trade_id}
        className={styles.offer}
        data-testid={`trade-outgoing-${offer.trade_id}`}
      >
        <div className={styles.offerHead}>
          <span className={styles.verb}>Your offer to</span>
          <PlayerName id={offer.to_player_id} party={target} />
          <span className={styles.pending}>waiting</span>
          <Button
            variant="secondary"
            size="sm"
            className={styles.headAction}
            onClick={() => act(offer.trade_id, onCancel)}
            disabled={acting.has(offer.trade_id)}
            data-testid={`trade-cancel-${offer.trade_id}`}
          >
            WITHDRAW
          </Button>
        </div>
        <div className={styles.terms}>
          <Side label="You give" stocks={offer.offering_stocks} money={offer.offering_money} />
          <Side label="You get" stocks={offer.requesting_stocks} money={offer.requesting_money} />
        </div>
      </div>
    )
  }

  // Between two other players: read-only, with a way to make my own offer to either side.
  const theirs = (offer: TradeOffer) => {
    const proposer = players[offer.from_player_id]
    const target = players[offer.to_player_id]
    return (
      <div
        key={offer.trade_id}
        className={styles.offer}
        data-testid={`trade-table-${offer.trade_id}`}
      >
        <div className={styles.offerHead}>
          <PlayerName id={offer.from_player_id} party={proposer} />
          <span className={styles.verb}>offers</span>
          <PlayerName id={offer.to_player_id} party={target} />
        </div>
        <div className={styles.terms}>
          <Side
            label={`${proposer?.name ?? 'Proposer'} gives`}
            stocks={offer.offering_stocks}
            money={offer.offering_money}
          />
          <Side
            label={`${target?.name ?? 'Recipient'} gives`}
            stocks={offer.requesting_stocks}
            money={offer.requesting_money}
          />
        </div>
        {onCompete && (
          <div className={styles.compete}>
            <span className={styles.sideLabel}>Compete</span>
            <span className={styles.competeButtons}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onCompete(offer, 'recipient')}
                data-testid={`trade-compete-recipient-${offer.trade_id}`}
              >
                TO {target?.name ?? 'the recipient'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onCompete(offer, 'proposer')}
                data-testid={`trade-compete-proposer-${offer.trade_id}`}
              >
                TO {proposer?.name ?? 'the proposer'}
              </Button>
            </span>
          </div>
        )}
      </div>
    )
  }

  return (
    <section className={styles.section} data-testid="trade-offers" aria-label="Open offers">
      <h4 className={styles.title}>Offers</h4>
      {listed.length === 0 && (
        <p className={styles.empty} data-testid="trade-table-empty">
          No open offers
        </p>
      )}
      {listed.map((offer) =>
        offer.to_player_id === myPlayerId
          ? forMe(offer, {
              card: 'trade-table',
              action: 'trade-table',
              effects: 'trade-effects-table',
            })
          : offer.from_player_id === myPlayerId
            ? mine(offer)
            : theirs(offer)
      )}
    </section>
  )
}
