import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../../components/ui/useToast'
import { useGameStore } from '../../store/gameStore'
import { startGame } from '../../lib/lobby'
import type { ChainId, GameAction, GameStateMessage } from '../../types/api'
import type { Coordinate } from '../../types/game'
import type { Purchases } from './BuyPanel'

const NOT_CONNECTED = 'Not connected to the game. Try again in a moment.'

type Prompt =
  | 'pendingChainChoice'
  | 'pendingMergerChoice'
  | 'pendingMergerOrder'
  | 'pendingStockDisposition'

interface Options {
  room: string
  sendAction: (action: GameAction) => boolean
  gameState: GameStateMessage | null
}

/**
 * The player's turn-bound actions (start, place, found, merger answers, buy, end game) and the
 * `loading` flag that locks the turn UI while one is in flight. Any new game state ends the
 * wait; a safety timer unlocks the UI after 10 s regardless.
 *
 * Chain / survivor / disposition prompts are cleared the moment the answer is sent (the server
 * sends no "resolved" message and the phase can stay `merger` across several prompts). If the
 * server then refuses the answer, `onRefused` puts the prompt back so the player can try again.
 */
export function useTurnActions({ room, sendAction, gameState }: Options) {
  const { toast } = useToast()
  // The game state an action was sent from: the turn UI stays locked until a newer one arrives.
  const [pending, setPending] = useState<{ from: GameStateMessage | null } | null>(null)
  const loading = pending !== null && pending.from === gameState
  const setLoading = useCallback((on: boolean) => {
    setPending(on ? { from: useGameStore.getState().gameState } : null)
  }, [])
  const restorePrompt = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (gameState) restorePrompt.current = null
  }, [gameState])

  useEffect(() => {
    if (!loading) return
    const timer = setTimeout(() => setLoading(false), 10000)
    return () => clearTimeout(timer)
  }, [loading, setLoading])

  const onRefused = useCallback(() => {
    restorePrompt.current?.()
    restorePrompt.current = null
  }, [])

  const start = useCallback(async () => {
    setLoading(true)
    try {
      await startGame(room)
    } catch (err) {
      console.error('Failed to start game:', err)
      toast('Failed to start game', 'error')
      setLoading(false)
    }
  }, [room, toast, setLoading])

  const send = useCallback(
    (action: GameAction) => {
      setLoading(true)
      sendAction(action)
    },
    [sendAction, setLoading]
  )

  const answerPrompt = useCallback(
    (action: GameAction, prompt: Prompt) => {
      const store = useGameStore.getState()
      const saved = {
        pendingChainChoice: store.pendingChainChoice,
        pendingMergerChoice: store.pendingMergerChoice,
        pendingMergerOrder: store.pendingMergerOrder,
        pendingStockDisposition: store.pendingStockDisposition,
      }
      setLoading(true)
      if (sendAction(action) === false) {
        setLoading(false)
        toast(NOT_CONNECTED, 'error')
        return
      }
      restorePrompt.current = () => {
        useGameStore.setState(saved)
        setLoading(false)
      }
      useGameStore.setState({ [prompt]: null })
    },
    [sendAction, toast, setLoading]
  )

  const placeTile = useCallback((tile: Coordinate) => send({ action: 'place_tile', tile }), [send])

  const foundChain = useCallback(
    (chain: ChainId) => answerPrompt({ action: 'found_chain', chain }, 'pendingChainChoice'),
    [answerPrompt]
  )

  const chooseSurvivor = useCallback(
    (chain: ChainId) =>
      answerPrompt({ action: 'merger_choice', surviving_chain: chain }, 'pendingMergerChoice'),
    [answerPrompt]
  )

  const chooseMergerOrder = useCallback(
    (chain: ChainId) =>
      answerPrompt({ action: 'merger_order', defunct_chain: chain }, 'pendingMergerOrder'),
    [answerPrompt]
  )

  const dispose = useCallback(
    (defunctChain: ChainId, sell: number, trade: number, hold: number) =>
      answerPrompt(
        {
          action: 'merger_disposition',
          defunct_chain: defunctChain,
          disposition: { sell, trade, hold },
        },
        'pendingStockDisposition'
      ),
    [answerPrompt]
  )

  // Skipping is a plain end_turn: it also works when the purchase for this turn is already
  // recorded (a second buy_stocks, even an empty one, is refused by the engine).
  const buy = useCallback(
    (purchases: Purchases) => {
      const shares = Object.values(purchases).reduce<number>((sum, qty) => sum + (qty ?? 0), 0)
      send(shares === 0 ? { action: 'end_turn' } : { action: 'buy_stocks', purchases })
    },
    [send]
  )

  const declareEndGame = useCallback(() => send({ action: 'declare_end_game' }), [send])

  return {
    loading,
    onRefused,
    start,
    placeTile,
    foundChain,
    chooseSurvivor,
    chooseMergerOrder,
    dispose,
    buy,
    declareEndGame,
  }
}
