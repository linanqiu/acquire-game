/**
 * Tests for optimistic update reconciliation in the game store (RT-004).
 *
 * Flow under test:
 *  1. beginOptimisticAction applies a predicted state immediately and
 *     snapshots the previous state.
 *  2. A `game_state` message (server confirmation) clears pending actions
 *     and applies the authoritative state.
 *  3. An `error` message (server rejection) rolls back to the snapshot.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useGameStore } from './gameStore'
import type { ChainName, GameStateMessage } from '../types/api'

function makeGameState(overrides: Partial<GameStateMessage> = {}): GameStateMessage {
  return {
    type: 'game_state',
    board: { cells: {} },
    hotel: {
      chains: [{ name: 'American', size: 3, price: 300, stocks_available: 20 }],
      available_stocks: { American: 20 } as Record<ChainName, number>,
      active_chains: ['American'],
    },
    turn_order: ['p1', 'p2'],
    current_player: 'p1',
    phase: 'place_tile',
    players: {
      p1: {
        name: 'Alice',
        money: 6000,
        stocks: {} as Record<ChainName, number>,
        hand_size: 6,
      },
    },
    tiles_remaining: 90,
    your_hand: ['1A', '2B'],
    ...overrides,
  }
}

describe('gameStore optimistic updates (RT-004)', () => {
  beforeEach(() => {
    useGameStore.getState().reset()
  })

  describe('beginOptimisticAction', () => {
    it('applies the optimistic game state immediately', () => {
      const server = makeGameState()
      useGameStore.getState().handleMessage(server)

      const optimistic = makeGameState({ tiles_remaining: 89 })
      useGameStore.getState().beginOptimisticAction('place_tile', { gameState: optimistic })

      expect(useGameStore.getState().gameState?.tiles_remaining).toBe(89)
    })

    it('applies an optimistic hand immediately', () => {
      useGameStore.getState().handleMessage(makeGameState())
      expect(useGameStore.getState().yourHand).toEqual(['1A', '2B'])

      useGameStore.getState().beginOptimisticAction('place_tile', { yourHand: ['2B'] })

      expect(useGameStore.getState().yourHand).toEqual(['2B'])
    })

    it('tracks the pending action with a unique id', () => {
      useGameStore.getState().handleMessage(makeGameState())

      const id1 = useGameStore.getState().beginOptimisticAction('place_tile', { yourHand: ['2B'] })
      const id2 = useGameStore
        .getState()
        .beginOptimisticAction('buy_stocks', { gameState: makeGameState() })

      const pending = useGameStore.getState().pendingActions
      expect(pending).toHaveLength(2)
      expect(pending[0].id).toBe(id1)
      expect(pending[1].id).toBe(id2)
      expect(pending[0].type).toBe('place_tile')
      expect(pending[1].type).toBe('buy_stocks')
      expect(id1).not.toBe(id2)
    })

    it('snapshots the state before the optimistic update', () => {
      useGameStore.getState().handleMessage(makeGameState())

      useGameStore.getState().beginOptimisticAction('place_tile', { yourHand: ['2B'] })

      const pending = useGameStore.getState().pendingActions
      expect(pending[0].snapshot.yourHand).toEqual(['1A', '2B'])
      expect(pending[0].snapshot.gameState?.tiles_remaining).toBe(90)
    })
  })

  describe('server confirmation (game_state message)', () => {
    it('clears pending actions and applies the authoritative state', () => {
      useGameStore.getState().handleMessage(makeGameState())
      useGameStore.getState().beginOptimisticAction('place_tile', { yourHand: ['2B'] })

      const confirmed = makeGameState({
        tiles_remaining: 89,
        your_hand: ['2B', '9I'],
        current_player: 'p2',
        phase: 'buy_stocks',
      })
      useGameStore.getState().handleMessage(confirmed)

      const state = useGameStore.getState()
      expect(state.pendingActions).toEqual([])
      expect(state.gameState?.tiles_remaining).toBe(89)
      expect(state.gameState?.phase).toBe('buy_stocks')
      expect(state.yourHand).toEqual(['2B', '9I'])
    })

    it('a later error does not roll back past a confirmation', () => {
      useGameStore.getState().handleMessage(makeGameState())
      useGameStore.getState().beginOptimisticAction('place_tile', { yourHand: ['2B'] })

      // Server confirms with authoritative state
      const confirmed = makeGameState({ your_hand: ['2B', '9I'], phase: 'buy_stocks' })
      useGameStore.getState().handleMessage(confirmed)

      // A subsequent unrelated error must not restore the pre-action snapshot
      useGameStore.getState().handleMessage({ type: 'error', message: 'Not your turn' })

      expect(useGameStore.getState().yourHand).toEqual(['2B', '9I'])
      expect(useGameStore.getState().gameState?.phase).toBe('buy_stocks')
    })
  })

  describe('server rejection (error message)', () => {
    it('rolls back the optimistic game state and hand', () => {
      useGameStore.getState().handleMessage(makeGameState())

      const optimistic = makeGameState({ tiles_remaining: 89 })
      useGameStore
        .getState()
        .beginOptimisticAction('place_tile', { gameState: optimistic, yourHand: ['2B'] })
      expect(useGameStore.getState().yourHand).toEqual(['2B'])

      useGameStore.getState().handleMessage({ type: 'error', message: 'Invalid tile' })

      const state = useGameStore.getState()
      expect(state.gameState?.tiles_remaining).toBe(90)
      expect(state.yourHand).toEqual(['1A', '2B'])
      expect(state.pendingActions).toEqual([])
    })

    it('rolls back multiple pending actions to the oldest snapshot', () => {
      useGameStore.getState().handleMessage(makeGameState())

      useGameStore.getState().beginOptimisticAction('place_tile', { yourHand: ['2B'] })
      useGameStore.getState().beginOptimisticAction('buy_stocks', {
        gameState: makeGameState({ tiles_remaining: 42 }),
      })

      useGameStore.getState().handleMessage({ type: 'error', message: 'Invalid action' })

      const state = useGameStore.getState()
      expect(state.yourHand).toEqual(['1A', '2B'])
      expect(state.gameState?.tiles_remaining).toBe(90)
      expect(state.pendingActions).toEqual([])
    })

    it('is a no-op when there are no pending actions', () => {
      useGameStore.getState().handleMessage(makeGameState())
      const before = useGameStore.getState().gameState

      useGameStore.getState().handleMessage({ type: 'error', message: 'Not your turn' })

      const state = useGameStore.getState()
      expect(state.gameState).toBe(before)
      expect(state.yourHand).toEqual(['1A', '2B'])
    })
  })

  describe('reset', () => {
    it('clears pending actions', () => {
      useGameStore.getState().handleMessage(makeGameState())
      useGameStore.getState().beginOptimisticAction('place_tile', { yourHand: ['2B'] })

      useGameStore.getState().reset()

      expect(useGameStore.getState().pendingActions).toEqual([])
      expect(useGameStore.getState().gameState).toBeNull()
    })
  })
})
