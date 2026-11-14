import { describe, it, expect } from 'vitest'
import { buildFinalScores } from './finalScores'
import { snapshot } from '../../tests/unit/fixtures/wire'

const finished = (name: 'game-over' | 'game-over-tie') => {
  const view = snapshot(name)
  return {
    state: view.player.find((m) => m.type === 'game_state'),
    over: view.player.find((m) => m.type === 'game_over'),
  }
}

describe('buildFinalScores (a real finished game)', () => {
  it.each(['game-over', 'game-over-tie'])(
    '%s: final money splits into cash, bonuses and stock sales that add back up',
    (name) => {
      const { state, over } = finished(name)
      const scores = buildFinalScores(state, over)
      expect(scores.map((s) => s.playerId).sort()).toEqual(Object.keys(state.players).sort())
      for (const s of scores) {
        const sent = over.scores[s.playerId]
        expect(s.name).toBe(state.players[s.playerId].name)
        expect(s.total).toBe(state.players[s.playerId].money)
        expect(s.bonuses).toBe(sent.bonuses)
        expect(s.stockSales).toBe(sent.stock_sales)
        expect(s.cash + s.bonuses + s.stockSales).toBe(s.total)
      }
    }
  )

  it('without the game_over message the breakdown is unknown, not $0, and cash is the total', () => {
    const { state } = finished('game-over')
    for (const s of buildFinalScores(state, null)) {
      expect(s.bonuses).toBeUndefined()
      expect(s.stockSales).toBeUndefined()
      expect(s.cash).toBe(s.total)
    }
  })

  it('a game_over message missing a player does not invent a breakdown for them', () => {
    const { state, over } = finished('game-over')
    const [first, second] = Object.keys(over.scores)
    const partial = { ...over, scores: { [first]: over.scores[first] } }
    const byId = Object.fromEntries(buildFinalScores(state, partial).map((s) => [s.playerId, s]))
    expect(byId[first].bonuses).toBe(over.scores[first].bonuses)
    expect(byId[second].bonuses).toBeUndefined()
  })

  it('returns nothing before any game state has arrived', () => {
    expect(buildFinalScores(null, finished('game-over').over)).toEqual([])
  })
})
