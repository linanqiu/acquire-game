import { describe, it, expect, beforeEach } from 'vitest'
import { buildFinalScores } from './finalScores'
import { useGameStore } from '../store/gameStore'
import type { GameOverMessage, GameStateMessage } from '../types/api'

const state = {
  type: 'game_state',
  board: { cells: {} },
  hotel: { chains: [], available_stocks: {}, active_chains: [] },
  turn_order: ['a', 'b'],
  current_player: 'a',
  phase: 'game_over',
  players: {
    a: { name: 'Alice', money: 30000, stocks: {}, hand_size: 0 },
    b: { name: 'Bob', money: 12000, stocks: {}, hand_size: 0 },
  },
  tiles_remaining: 0,
} as unknown as GameStateMessage

const over: GameOverMessage = {
  type: 'game_over',
  winner: 'a',
  scores: {
    a: { name: 'Alice', money: 30000, bonuses: 5000, stock_sales: 7000 },
    b: { name: 'Bob', money: 12000, bonuses: 0, stock_sales: 1500 },
  },
}

describe('buildFinalScores', () => {
  it('splits final money into cash, bonuses and stock sales from game_over', () => {
    const scores = buildFinalScores(state, over)
    expect(scores).toEqual([
      { playerId: 'a', name: 'Alice', cash: 18000, bonuses: 5000, stockSales: 7000, total: 30000 },
      { playerId: 'b', name: 'Bob', cash: 10500, bonuses: 0, stockSales: 1500, total: 12000 },
    ])
  })

  it('leaves the breakdown unknown (not $0) without a game_over breakdown', () => {
    const scores = buildFinalScores(state, null)
    expect(scores[0]).toEqual({
      playerId: 'a',
      name: 'Alice',
      cash: 30000,
      bonuses: undefined,
      stockSales: undefined,
      total: 30000,
    })
  })

  it('returns nothing without a game state', () => {
    expect(buildFinalScores(null, over)).toEqual([])
  })
})

describe('gameStore game_over', () => {
  beforeEach(() => useGameStore.getState().reset())

  it('keeps the game_over message and clears it on reset', () => {
    useGameStore.getState().handleMessage(over)
    expect(useGameStore.getState().gameOver).toEqual(over)
    useGameStore.getState().reset()
    expect(useGameStore.getState().gameOver).toBeNull()
  })
})
