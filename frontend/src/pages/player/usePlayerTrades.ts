import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../../components/ui/useToast'
import { useGameStore, type TradeEvent } from '../../store/gameStore'
import type { ChainId, GameAction, GameStateMessage, TradeOffer } from '../../types/api'
import type { TradePrefill } from '../../lib/trades'

/** How long the builder waits for the server to confirm a proposal. */
export const PROPOSE_TIMEOUT_MS = 8000
const NO_ANSWER = 'The server did not confirm the offer. Check the Trades tab, then try again.'
const NOT_CONNECTED = 'Not connected to the game. Try again in a moment.'

type TradeSide = { stocks: { chain: ChainId; quantity: number }[]; cash: number }

function toRecord(stocks: TradeSide['stocks']): Partial<Record<ChainId, number>> {
  const out: Partial<Record<ChainId, number>> = {}
  for (const { chain, quantity } of stocks) out[chain] = quantity
  return out
}

interface Options {
  sendAction: (action: GameAction) => boolean
  gameState: GameStateMessage | null
  myPlayerId: string | undefined
  /** Recent trade events at the whole table, oldest first (the store's `tradeLog`). */
  tradeLog: TradeEvent[]
  /** Every open offer at the table. */
  publicTrades: TradeOffer[]
}

/**
 * Player-to-player trades on the player page: the builder's open/submitting/error state (and
 * what it starts from), the propose/accept/reject/cancel actions, and the notices. Offers are
 * public, so events between two other players arrive here too: an offer between others is
 * one short toast and a mark on the Trades tab until it has been looked at; their answers
 * only go to the activity list. Events that involve me each get their toast.
 *
 * Trades are not turn-bound, so nothing here touches the turn's loading state. A proposal
 * keeps the builder open until the server confirms it (`trade_proposed` closes it) or refuses
 * it (`onRefused` shows the server's reason inside the builder).
 */
export function usePlayerTrades({
  sendAction,
  gameState,
  myPlayerId,
  tradeLog,
  publicTrades,
}: Options) {
  const { toast } = useToast()
  const [builderOpen, setBuilderOpen] = useState(false)
  // What the builder starts from (someone else's offer), and a key that remounts it.
  const [prefill, setPrefill] = useState<TradePrefill | null>(null)
  const [builderKey, setBuilderKey] = useState(0)
  const [proposing, setProposing] = useState(false)
  const [error, setError] = useState('')
  const proposingRef = useRef(false)
  useEffect(() => {
    proposingRef.current = proposing
  }, [proposing])

  // Offers between other players that I have looked at (the Trades tab was open).
  const [seenAtTable, setSeenAtTable] = useState<string[]>([])
  const othersOpen = publicTrades
    .filter((t) => t.from_player_id !== myPlayerId && t.to_player_id !== myPlayerId)
    .map((t) => t.trade_id)
  const newAtTable = othersOpen.filter((id) => !seenAtTable.includes(id)).length
  const othersKey = othersOpen.join('|')
  const markTableSeen = useCallback(() => {
    const ids = othersKey ? othersKey.split('|') : []
    setSeenAtTable((prev) => (ids.every((id) => prev.includes(id)) ? prev : ids))
  }, [othersKey])

  // A proposal the server never confirms (the connection dropped on the way) must not
  // leave the send button disabled for good: give up waiting and say so.
  useEffect(() => {
    if (!proposing) return
    const timer = setTimeout(() => {
      setProposing(false)
      setError(NO_ANSWER)
    }, PROPOSE_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [proposing])

  /** A server refusal arrived; if it answers my proposal, show it in the builder. */
  const onRefused = useCallback((message: string) => {
    if (proposingRef.current) {
      setError(message)
      setProposing(false)
    }
  }, [])

  const openBuilder = useCallback(() => {
    setError('')
    setProposing(false)
    setPrefill(null)
    setBuilderKey((k) => k + 1)
    setBuilderOpen(true)
  }, [])

  /** Open the builder on my own offer, started from another player's public offer. */
  const openBuilderFrom = useCallback((start: TradePrefill) => {
    setError('')
    setProposing(false)
    setPrefill(start)
    setBuilderKey((k) => k + 1)
    setBuilderOpen(true)
  }, [])

  /** The modal's close button: hides the builder (a proposal in flight still resolves). */
  const hideBuilder = useCallback(() => setBuilderOpen(false), [])

  /** The builder's CANCEL: hides it and stops waiting for the proposal's answer. */
  const cancelBuilder = useCallback(() => {
    setBuilderOpen(false)
    setProposing(false)
  }, [])

  const propose = useCallback(
    (partnerId: string, offer: TradeSide, want: TradeSide) => {
      setError('')
      const sent = sendAction({
        action: 'propose_trade',
        to_player_id: partnerId,
        offering_stocks: toRecord(offer.stocks),
        offering_money: offer.cash,
        requesting_stocks: toRecord(want.stocks),
        requesting_money: want.cash,
      })
      if (sent === false) {
        setError(NOT_CONNECTED)
        return
      }
      setProposing(true)
    },
    [sendAction]
  )

  const respond = useCallback(
    (action: 'accept_trade' | 'reject_trade' | 'cancel_trade', tradeId: string) => {
      if (sendAction({ action, trade_id: tradeId }) === false) toast(NOT_CONNECTED, 'error')
    },
    [sendAction, toast]
  )
  const accept = useCallback((id: string) => respond('accept_trade', id), [respond])
  const reject = useCallback((id: string) => respond('reject_trade', id), [respond])
  const cancel = useCallback((id: string) => respond('cancel_trade', id), [respond])

  // Announce what is new in the table's trade events, once each (the store remembers how
  // far, so a remount does not repeat it). Several events can arrive in one render (an AI
  // seat answers at once): each is handled, in order.
  useEffect(() => {
    if (tradeLog.length === 0) return
    // A trade can resolve before the first game state arrives (an AI seat
    // answers at once). Wait for the state so the toast can name the player.
    if (!gameState) return
    const announced = useGameStore.getState().tradeEventAnnouncedSeq
    const fresh = tradeLog.filter((e) => e.seq > announced)
    if (fresh.length === 0) return
    useGameStore.setState({ tradeEventAnnouncedSeq: fresh[fresh.length - 1].seq })
    if (!myPlayerId) return
    const nameOf = (id?: string) => (id && gameState.players[id]?.name) || 'Someone'
    const betweenOthers: TradeEvent[] = []
    for (const event of fresh) {
      // What had happened before this page had the game is history: listed, not announced.
      if (!event.live) continue
      const { kind, byPlayerId, fromPlayerId, toPlayerId } = event
      const mine = fromPlayerId === myPlayerId
      const toMe = toPlayerId === myPlayerId
      if (!mine && !toMe) {
        if (kind === 'proposed') betweenOthers.push(event)
        continue
      }
      if (kind === 'proposed') {
        if (mine) {
          toast(`Offer sent to ${nameOf(toPlayerId)}`, 'success')
          // The server confirmed my proposal (a store event): close the builder.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setProposing(false)
          setBuilderOpen(false)
        } else {
          toast(`${nameOf(fromPlayerId)} sent you a trade offer`, 'info', 8000)
        }
      } else if (kind === 'accepted') {
        toast(
          mine
            ? `${nameOf(toPlayerId)} accepted your offer`
            : `Trade with ${nameOf(fromPlayerId)} completed`,
          'success'
        )
      } else if (kind === 'rejected') {
        toast(
          byPlayerId === myPlayerId
            ? 'Offer rejected'
            : `${nameOf(toPlayerId)} rejected your offer`,
          mine ? 'warning' : 'info'
        )
      } else if (kind === 'canceled') {
        toast(
          byPlayerId === myPlayerId
            ? 'Offer canceled'
            : `${nameOf(fromPlayerId)} withdrew their offer`,
          'info'
        )
      }
    }
    // Offers between two other players: one toast, however many arrived together.
    if (betweenOthers.length === 1) {
      const [e] = betweenOthers
      toast(`${nameOf(e.fromPlayerId)} offers ${nameOf(e.toPlayerId)} a trade`, 'info')
    } else if (betweenOthers.length > 1) {
      toast(`${betweenOthers.length} new trade offers at the table`, 'info')
    }
  }, [tradeLog, myPlayerId, gameState, toast])

  return {
    builderOpen,
    builderKey,
    prefill,
    openBuilder,
    openBuilderFrom,
    newAtTable,
    markTableSeen,
    hideBuilder,
    cancelBuilder,
    proposing,
    error,
    onRefused,
    propose,
    accept,
    reject,
    cancel,
  }
}
