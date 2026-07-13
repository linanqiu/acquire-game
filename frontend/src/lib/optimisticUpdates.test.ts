import { describe, it, expect } from 'vitest'
import { predictTilePlacement, predictStockPurchase } from './optimisticUpdates'
import type { ChainName, GameStateMessage } from '../types/api'

function makeGameState(overrides: Partial<GameStateMessage> = {}): GameStateMessage {
  return {
    type: 'game_state',
    board: {
      cells: {
        '1A': { state: 'played', chain: null },
        '2B': { state: 'in_chain', chain: 'American' },
      },
    },
    hotel: {
      chains: [
        { name: 'American', size: 3, price: 300, stocks_available: 20 },
        { name: 'Tower', size: 0, price: 200, stocks_available: 25 },
      ],
      available_stocks: { American: 20, Tower: 25 } as Record<ChainName, number>,
      active_chains: ['American'],
    },
    turn_order: ['p1', 'p2'],
    current_player: 'p1',
    phase: 'place_tile',
    players: {
      p1: {
        name: 'Alice',
        money: 6000,
        stocks: { American: 2 } as Record<ChainName, number>,
        hand_size: 6,
      },
      p2: {
        name: 'Bob',
        money: 5000,
        stocks: {} as Record<ChainName, number>,
        hand_size: 6,
      },
    },
    tiles_remaining: 90,
    ...overrides,
  }
}

describe('predictTilePlacement', () => {
  it('adds the tile to the board as a played (orphan) cell', () => {
    const state = makeGameState()
    const result = predictTilePlacement(state, ['3C', '4D'], '3C')
    expect(result.gameState.board.cells['3C']).toEqual({ state: 'played', chain: null })
  })

  it('removes the tile from the hand', () => {
    const state = makeGameState()
    const result = predictTilePlacement(state, ['3C', '4D'], '3C')
    expect(result.yourHand).toEqual(['4D'])
  })

  it('preserves existing board cells', () => {
    const state = makeGameState()
    const result = predictTilePlacement(state, ['3C'], '3C')
    expect(result.gameState.board.cells['1A']).toEqual({ state: 'played', chain: null })
    expect(result.gameState.board.cells['2B']).toEqual({ state: 'in_chain', chain: 'American' })
  })

  it('does not mutate the original state or hand', () => {
    const state = makeGameState()
    const hand = ['3C', '4D']
    predictTilePlacement(state, hand, '3C')
    expect(state.board.cells['3C']).toBeUndefined()
    expect(hand).toEqual(['3C', '4D'])
  })

  it('leaves other state (phase, players, turn) untouched', () => {
    const state = makeGameState()
    const result = predictTilePlacement(state, ['3C'], '3C')
    expect(result.gameState.phase).toBe('place_tile')
    expect(result.gameState.current_player).toBe('p1')
    expect(result.gameState.players).toBe(state.players)
  })
})

describe('predictStockPurchase', () => {
  it('deducts the total cost from the buying player', () => {
    const state = makeGameState()
    const result = predictStockPurchase(state, 'p1', { American: 2, Tower: 1 })
    // 2 * 300 + 1 * 200 = 800
    expect(result.players.p1.money).toBe(6000 - 800)
  })

  it('adds purchased stocks to the player holdings', () => {
    const state = makeGameState()
    const result = predictStockPurchase(state, 'p1', { American: 2, Tower: 1 })
    expect(result.players.p1.stocks.American).toBe(4)
    expect(result.players.p1.stocks.Tower).toBe(1)
  })

  it('decrements available stock counts', () => {
    const state = makeGameState()
    const result = predictStockPurchase(state, 'p1', { American: 2 })
    expect(result.hotel.available_stocks.American).toBe(18)
    expect(result.hotel.chains.find((c) => c.name === 'American')?.stocks_available).toBe(18)
    // Untouched chain remains as-is
    expect(result.hotel.available_stocks.Tower).toBe(25)
    expect(result.hotel.chains.find((c) => c.name === 'Tower')?.stocks_available).toBe(25)
  })

  it('ignores zero and missing quantities', () => {
    const state = makeGameState()
    const result = predictStockPurchase(state, 'p1', { American: 0 })
    expect(result.players.p1.money).toBe(6000)
    expect(result.players.p1.stocks.American).toBe(2)
  })

  it('does not touch other players', () => {
    const state = makeGameState()
    const result = predictStockPurchase(state, 'p1', { American: 1 })
    expect(result.players.p2).toBe(state.players.p2)
  })

  it('returns the state unchanged for an unknown player', () => {
    const state = makeGameState()
    const result = predictStockPurchase(state, 'nope', { American: 1 })
    expect(result).toBe(state)
  })

  it('does not mutate the original state', () => {
    const state = makeGameState()
    predictStockPurchase(state, 'p1', { American: 2 })
    expect(state.players.p1.money).toBe(6000)
    expect(state.players.p1.stocks.American).toBe(2)
    expect(state.hotel.available_stocks.American).toBe(20)
  })

  it('never predicts negative stock availability', () => {
    const state = makeGameState()
    state.hotel.available_stocks.Tower = 1
    const result = predictStockPurchase(state, 'p1', { Tower: 3 })
    expect(result.hotel.available_stocks.Tower).toBe(0)
  })
})
