import { useLayoutEffect, useMemo, useState } from 'react'
import { ChainMarker } from './ChainMarker'
import { SeatKindBadge } from './SeatKindBadge'
import { StockStepper } from './StockStepper'
import { Button } from '../ui/Button'
import styles from './TradeBuilder.module.css'
import type { ChainId, SeatKind } from '../../types/api'
import { useRules } from '../../ruleset/useRules'
import { orderChainIds } from '../../lib/ruleset'
import { positionLines, toRecord, type TradeDraft, type TradeItems } from '../../lib/trades'
import { useTradePreview } from '../../hooks/useTradePreview'

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

export interface TradeBuilderProps {
  /** The other players, in seat order. */
  players: PlayerInfo[]
  myHoldings: StockOffer[]
  myCash: number
  onPropose: (partnerId: string, offer: TradeItems, want: TradeItems) => void
  onCancel: () => void
  /** The room and my seat: who asks the server what the draft would do (the preview). */
  room?: string
  myPlayerId?: string
  /** Changes when the game does (the game state): the preview is asked again. */
  version?: unknown
  /** The server's refusal of the last proposal (shown in place, the composer stays open). */
  serverError?: string
  /** True while a proposal is in flight. */
  submitting?: boolean
  /** Shown as a hint, e.g. while a merger freezes some chains. */
  notice?: string
  /**
   * A starting point (a tap in the holdings table, someone's public offer, an offer made to
   * me). Read when the composer mounts; the player can change everything.
   */
  initial?: { partnerId: string; offer: TradeItems; want: TradeItems }
  /** What kind of offer this is: the composer's title. */
  title?: string
  /** Says where `initial` came from, e.g. "Started from Cara's offer to Bob." */
  startedFrom?: string
  /** Current share price per chain on the board: both sides are valued with it. */
  prices?: Partial<Record<ChainId, number>>
}

const CASH_STEP = 100

type Counts = Partial<Record<ChainId, number>>
const counts = (items: TradeItems | undefined): Counts =>
  Object.fromEntries((items?.stocks ?? []).map((s) => [s.chain, s.quantity]))

/**
 * Compose a trade offer in place, on the Trades tab (BL-021): no sheet over the page and no
 * box that scrolls inside it. Who with, then two columns side by side: what I give and what I
 * get, one line per chain that side holds (the ruleset's chain order), and cash. Under them,
 * next to the button that sends it: both sides at list prices, what the deal does to first and
 * second place in each chain (the server's preview), and, when the other player is a
 * rules-based bot, whether it would accept and how much more cash would change its mind. The
 * button stays on screen above the rack while the page scrolls.
 *
 * The draft is this component's own state: nothing the game sends changes it. A count is only
 * cut down if its holder no longer has that many.
 */
export function TradeBuilder({
  players,
  myHoldings,
  myCash,
  onPropose,
  onCancel,
  room = '',
  myPlayerId,
  version,
  serverError,
  submitting = false,
  notice,
  initial,
  title = 'New offer',
  startedFrom,
  prices,
}: TradeBuilderProps) {
  const rules = useRules()
  const [partnerId, setPartnerId] = useState<string>(initial?.partnerId ?? '')
  const [give, setGive] = useState<Counts>(() => counts(initial?.offer))
  const [get, setGet] = useState<Counts>(() => counts(initial?.want))
  const [giveCash, setGiveCash] = useState(initial?.offer.cash ?? 0)
  const [getCash, setGetCash] = useState(initial?.want.cash ?? 0)

  // The composer opens at the top of the Trades tab, by my own action: show it from its top.
  useLayoutEffect(() => {
    if (typeof window.scrollTo === 'function' && window.scrollY > 0) window.scrollTo(0, 0)
  }, [])

  const partner = useMemo(() => players.find((p) => p.id === partnerId), [players, partnerId])
  const mine: Counts = useMemo(
    () => Object.fromEntries(myHoldings.map((h) => [h.chain, h.quantity])),
    [myHoldings]
  )
  const theirs: Counts = partner?.stocks ?? {}
  const held = (stocks: Counts) =>
    orderChainIds(
      rules.rs,
      Object.keys(stocks).filter((c) => (stocks[c] ?? 0) > 0)
    )

  // What would be sent: each count cut down to what its holder has right now.
  const side = (chosen: Counts, stocks: Counts, cash: number, max: number): TradeItems => ({
    stocks: held(stocks)
      .map((chain) => ({ chain, quantity: Math.min(chosen[chain] ?? 0, stocks[chain] ?? 0) }))
      .filter((s) => s.quantity > 0),
    cash: Math.max(0, Math.min(cash, max)),
  })
  const offer = side(give, mine, giveCash, myCash)
  const want = side(get, theirs, getCash, partner?.cash ?? 0)
  const shareValue = (items: TradeItems) =>
    items.stocks.reduce((sum, s) => sum + s.quantity * (prices?.[s.chain] ?? 0), 0)
  const giveShares = shareValue(offer)
  const getShares = shareValue(want)
  const empty =
    offer.stocks.length === 0 && want.stocks.length === 0 && offer.cash === 0 && want.cash === 0

  const draft: TradeDraft | null =
    partner && !empty
      ? {
          to_player_id: partner.id,
          offering_stocks: toRecord(offer.stocks),
          offering_money: offer.cash,
          requesting_stocks: toRecord(want.stocks),
          requesting_money: want.cash,
        }
      : null
  const { preview, current } = useTradePreview(room, myPlayerId, draft, version)
  const refused = preview && current && !preview.valid ? preview.error : ''
  const names = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p.name])), [players])
  const effects = preview?.valid ? positionLines(preview.positions, names, myPlayerId) : []
  const sharesMove = offer.stocks.length > 0 || want.stocks.length > 0
  const bot = preview?.valid ? (preview.bot ?? null) : null
  // A rules bot on the other side: its verdict has a line, and the cash it needs a button.
  const botSeat = partner?.kind === 'bot' || !!bot
  const needed = bot && !bot.acceptable ? (bot.cash_needed ?? 0) : 0

  const selectPartner = (id: string) => {
    if (id === partnerId) return
    setPartnerId(id)
    // Their holdings differ: what I asked of the last player does not carry over.
    setGet({})
    setGetCash(0)
  }

  // Cash that makes both sides equal at list prices (shares only), on the side that owes it.
  const gap = giveShares - getShares
  const even = {
    give: gap < 0 ? Math.min(-gap, myCash) : 0,
    get: gap > 0 ? Math.min(gap, partner?.cash ?? 0) : 0,
  }
  // Offered only when that side has the cash, and the cash is not already set that way.
  const canEven =
    !!partner &&
    sharesMove &&
    gap !== 0 &&
    even.give + even.get === Math.abs(gap) &&
    (offer.cash !== even.give || want.cash !== even.get)
  const makeEven = () => {
    setGiveCash(even.give)
    setGetCash(even.get)
  }
  /** More cash for the other side: first less asked of them, then more offered. */
  const addCash = (extra: number) => {
    const less = Math.min(extra, want.cash)
    setGetCash(want.cash - less)
    setGiveCash(Math.min(myCash, offer.cash + extra - less))
  }

  const hint = !partner
    ? 'Choose who to offer to'
    : empty
      ? 'Add what you give or what you get'
      : ''
  const canSend = !!partner && !empty && !refused && !submitting

  const column = (
    label: string,
    testId: string,
    rowPrefix: string,
    stocks: Counts,
    chosen: Counts,
    setChosen: (next: Counts) => void,
    items: TradeItems,
    cash: number,
    setCash: (n: number) => void,
    maxCash: number,
    cashId: string,
    owner: string,
    shares: number
  ) => {
    const chains = held(stocks)
    const picked = (chain: ChainId) => Math.min(chosen[chain] ?? 0, stocks[chain] ?? 0)
    const rows = chains.filter((chain) => picked(chain) > 0)
    const set = (n: number) => setCash(Math.max(0, Math.min(maxCash, n)))
    const giving = rowPrefix === 'offer'
    return (
      <section className={styles.column} aria-label={label} data-testid={testId}>
        <h4 className={styles.columnHead}>
          <span>{label}</span>
          <span className={styles.listValue} title="At list prices" data-testid={`${testId}-value`}>
            {items.stocks.length > 0 || items.cash > 0 ? rules.money(shares + items.cash) : ''}
          </span>
        </h4>
        {/* What this side holds: a tap adds one share to the deal. The chips keep their
            places; the chains in the deal get a line with a stepper under the cash. */}
        <div className={styles.chips}>
          {chains.map((chain) => {
            const n = picked(chain)
            const all = stocks[chain] ?? 0
            return (
              <button
                key={chain}
                type="button"
                className={`${styles.chip} ${n > 0 ? styles.on : ''}`}
                onClick={() => setChosen({ ...chosen, [chain]: Math.min(all, n + 1) })}
                disabled={n >= all}
                aria-label={`${giving ? 'Give' : 'Get'} one ${rules.name(chain)} (${owner} ${all})`}
                title={`${owner} ${rules.shares(all)} of ${rules.name(chain)}`}
                data-testid={`${rowPrefix}-add-${chain}`}
              >
                <ChainMarker chain={chain} variant="icon" />
                <span className={styles.held}>{all}</span>
              </button>
            )
          })}
          {chains.length === 0 && (
            <p className={styles.none}>
              {!giving && !partner ? 'Choose a player' : `No ${rules.theme.share_noun_plural}`}
            </p>
          )}
        </div>
        <div className={`${styles.cash} ${cash > 0 ? styles.on : ''}`}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => set(cash - CASH_STEP)}
            disabled={cash <= 0}
            aria-label={`${CASH_STEP} less cash`}
            data-testid={`${cashId}-less`}
          >
            −
          </Button>
          <input
            className={styles.cashInput}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={cash > 0 ? String(cash) : ''}
            onChange={(e) => set(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
            placeholder={`${rules.theme.currency_symbol}0`}
            disabled={maxCash <= 0}
            aria-label={
              rowPrefix === 'offer'
                ? `Cash you give, up to ${rules.money(maxCash)}`
                : `Cash you get, up to ${rules.money(maxCash)}`
            }
            data-testid={`${cashId}-input`}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => set(cash + CASH_STEP)}
            disabled={cash >= maxCash}
            aria-label={`${CASH_STEP} more cash`}
            data-testid={`${cashId}-more`}
          >
            +
          </Button>
        </div>
        {rows.map((chain) => (
          <div key={chain} className={styles.row} data-testid={`${rowPrefix}-stock-${chain}`}>
            <ChainMarker chain={chain} variant="icon" />
            <span className={styles.of}>of {stocks[chain]}</span>
            <StockStepper
              compact
              value={picked(chain)}
              max={stocks[chain] ?? 0}
              onChange={(qty) => setChosen({ ...chosen, [chain]: qty })}
              label={`${rules.name(chain)} ${rules.theme.share_noun_plural} ${
                giving ? 'you give' : 'you get'
              }`}
            />
          </div>
        ))}
      </section>
    )
  }

  return (
    <section className={styles.builder} data-testid="trade-builder" aria-label={title}>
      <h4 className={styles.title}>{title}</h4>
      {startedFrom && (
        <p className={styles.note} data-testid="trade-started-from">
          {startedFrom}
        </p>
      )}
      {notice && <p className={styles.note}>{notice}</p>}

      <div className={styles.players} role="group" aria-label="Offer to">
        {players.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`${styles.playerButton} ${partnerId === p.id ? styles.selected : ''}`}
            onClick={() => selectPartner(p.id)}
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
                testId={`trade-player-kind-${p.id}`}
              />
            </span>
            <span className={styles.playerCash}>{rules.money(p.cash)}</span>
          </button>
        ))}
      </div>

      <div className={styles.columns}>
        {column(
          'You give',
          'trade-give',
          'offer',
          mine,
          give,
          setGive,
          offer,
          offer.cash,
          setGiveCash,
          myCash,
          'offer-cash',
          'You hold',
          giveShares
        )}
        {column(
          'You get',
          'trade-get',
          'want',
          theirs,
          get,
          setGet,
          want,
          want.cash,
          setGetCash,
          partner?.cash ?? 0,
          'want-cash',
          `${partner?.name ?? 'They'} holds`,
          getShares
        )}
      </div>

      {/* Stays on screen over the rack: what the deal does, and the button that sends it. The
          lines and the one-tap amounts keep their room whether or not they have something to
          say, so the answer of the server, arriving a moment after a tap, never moves SEND. */}
      <div className={styles.foot} data-testid="trade-foot">
        <div
          className={`${styles.effects} ${botSeat ? styles.three : ''} ${
            preview && !current ? styles.stale : ''
          }`}
          aria-live="polite"
          data-testid="trade-effects"
        >
          {hint && (
            <p className={styles.quiet} data-testid="trade-hint">
              {hint}
            </p>
          )}
          {(refused || serverError) && (
            <p className={styles.error} role="alert" data-testid="trade-error">
              {refused || serverError}
            </p>
          )}
          {effects.map((line) => (
            <p
              key={line.chain}
              className={styles.effect}
              data-testid={`trade-effect-${line.chain}`}
            >
              <ChainMarker chain={line.chain} variant="icon" />
              <span>
                <span className={styles.srOnly}>{rules.name(line.chain)}: </span>
                {line.text}
              </span>
            </p>
          ))}
          {preview?.valid && sharesMove && effects.length === 0 && (
            <p className={styles.quiet} data-testid="trade-effect-none">
              No change of 1st or 2nd place
            </p>
          )}
          {bot && partner && (
            <p
              className={bot.acceptable ? styles.accept : styles.refuse}
              data-testid="trade-bot-verdict"
              data-acceptable={bot.acceptable ? 'true' : 'false'}
              title="A rules-based bot answers by a fixed, published rule"
            >
              {bot.acceptable
                ? `${partner.name} (bot) would accept`
                : bot.cash_needed
                  ? `${partner.name} (bot) would refuse: about ${rules.money(bot.cash_needed)} short`
                  : `${partner.name} (bot) would refuse, even for all your cash`}
            </p>
          )}
        </div>
        <div className={styles.assist}>
          <Button
            variant="secondary"
            size="sm"
            className={styles.even}
            onClick={makeEven}
            disabled={!canEven}
            data-testid="trade-even"
          >
            EVEN AT LIST
            {canEven &&
              (gap > 0
                ? `: ${partner?.name.toUpperCase()} PAYS ${rules.money(even.get)}`
                : `: YOU PAY ${rules.money(even.give)}`)}
          </Button>
          {botSeat && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => addCash(needed)}
              disabled={needed <= 0}
              data-testid="trade-bot-match"
            >
              {needed > 0 ? `ADD ${rules.money(needed)}` : 'ADD CASH'}
            </Button>
          )}
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onCancel} data-testid="cancel-trade">
            CANCEL
          </Button>
          <Button
            variant="accent"
            onClick={() => partner && onPropose(partner.id, offer, want)}
            disabled={!canSend}
            data-testid="propose-trade"
          >
            <span className={styles.sendLabel}>
              {submitting
                ? 'SENDING…'
                : partner
                  ? `SEND TO ${partner.name.toUpperCase()}`
                  : 'SEND OFFER'}
            </span>
          </Button>
        </div>
      </div>
    </section>
  )
}
