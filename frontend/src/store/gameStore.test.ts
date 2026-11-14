import { describe, it, expect, beforeEach } from 'vitest'
import { useGameStore } from './gameStore'
import type { GameStateMessage } from '../types/api'

function state(phase: string, awaiting: GameStateMessage['awaiting']): GameStateMessage {
  return {
    type: 'game_state',
    board: { cells: {} },
    hotel: { chains: [], available_stocks: {}, active_chains: [] },
    turn_order: ['me', 'bob'],
    current_player: 'me',
    phase,
    players: {},
    tiles_remaining: 90,
    awaiting,
  } as unknown as GameStateMessage
}

const prompt = {
  type: 'stock_disposition_required',
  defunct_chain: 'Tower',
  surviving_chain: 'Luxor',
  stock_count: 4,
  available_to_trade: 10,
} as const

describe('gameStore merger prompts', () => {
  beforeEach(() => {
    useGameStore.getState().reset()
    useGameStore.setState({ currentPlayer: { id: 'me', name: 'Me', token: 't', isHost: false } })
  })

  it('clears my disposition prompt once another human is the one disposing', () => {
    // Found by the two-humans journey: the form stayed up after confirming.
    const store = useGameStore.getState()
    store.handleMessage(prompt)
    store.handleMessage(
      state('merger', { player_id: 'me', kind: 'human', decision: 'stock_disposition' })
    )
    expect(useGameStore.getState().pendingStockDisposition).not.toBeNull()

    store.handleMessage(
      state('merger', { player_id: 'bob', kind: 'human', decision: 'stock_disposition' })
    )
    expect(useGameStore.getState().pendingStockDisposition).toBeNull()
  })

  it('keeps my prompt while an AI only answers a trade beside it', () => {
    const store = useGameStore.getState()
    store.handleMessage(prompt)
    store.handleMessage(
      state('merger', { player_id: 'bot', kind: 'bot', decision: 'trade_response' })
    )
    expect(useGameStore.getState().pendingStockDisposition).not.toBeNull()
  })

  it('clears my survivor choice once the merger moved on to dispositions', () => {
    const store = useGameStore.getState()
    store.handleMessage({ type: 'choose_merger_survivor', tied_chains: ['Tower', 'Luxor'] })
    store.handleMessage(
      state('merger', { player_id: 'me', kind: 'human', decision: 'choose_survivor' })
    )
    expect(useGameStore.getState().pendingMergerChoice).toEqual(['Tower', 'Luxor'])
    store.handleMessage(
      state('merger', { player_id: 'bob', kind: 'human', decision: 'stock_disposition' })
    )
    expect(useGameStore.getState().pendingMergerChoice).toBeNull()
  })

  it('clears prompts when the merger is over', () => {
    const store = useGameStore.getState()
    store.handleMessage(prompt)
    store.handleMessage(
      state('buy_stocks', { player_id: 'me', kind: 'human', decision: 'buy_stocks' })
    )
    expect(useGameStore.getState().pendingStockDisposition).toBeNull()
  })
})
