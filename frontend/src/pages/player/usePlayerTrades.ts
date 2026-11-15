import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../../components/ui/useToast'
import type { TradeEvent } from '../../store/gameStore'
import type { ChainId, GameAction, GameStateMessage } from '../../types/api'

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
  lastTradeEvent: TradeEvent | null
}

/**
 * Player-to-player trades on the player page: the builder's open/submitting/error state, the
 * propose/accept/reject/cancel actions, and a toast for each trade event that involves me.
 *
 * Trades are not turn-bound, so nothing here touches the turn's loading state. A proposal
 * keeps the builder open until the server confirms it (`trade_proposed` closes it) or refuses
 * it (`onRefused` shows the server's reason inside the builder).
 */
export function usePlayerTrades({ sendAction, gameState, myPlayerId, lastTradeEvent }: Options) {
  const { toast } = useToast()
  const [builderOpen, setBuilderOpen] = useState(false)
  const [proposing, setProposing] = useState(false)
  const [error, setError] = useState('')
  const proposingRef = useRef(false)
  useEffect(() => {
    proposingRef.current = proposing
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

  // One toast per trade event that involves me.
  const seenTradeSeq = useRef(lastTradeEvent?.seq ?? 0)
  useEffect(() => {
    if (!lastTradeEvent || lastTradeEvent.seq <= seenTradeSeq.current) return
    // A trade can resolve before the first game state arrives (an AI seat
    // answers at once). Wait for the state so the toast can name the player.
    if (!gameState) return
    seenTradeSeq.current = lastTradeEvent.seq
    if (!myPlayerId) return
    const nameOf = (id?: string) => (id && gameState.players[id]?.name) || 'Someone'
    const { kind, byPlayerId, fromPlayerId, toPlayerId } = lastTradeEvent
    const mine = fromPlayerId === myPlayerId
    const toMe = toPlayerId === myPlayerId
    if (!mine && !toMe) return
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
        byPlayerId === myPlayerId ? 'Offer rejected' : `${nameOf(toPlayerId)} rejected your offer`,
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
  }, [lastTradeEvent, myPlayerId, gameState, toast])

  return {
    builderOpen,
    openBuilder,
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
