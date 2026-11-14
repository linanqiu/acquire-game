import { describe, it, expect } from 'vitest'
import { waitingMessage } from './waiting'

const players = { p1: { name: 'Alice' }, p2: { name: 'Bob' } }

describe('waitingMessage', () => {
  it('names the player the engine is waiting on, not the turn owner', () => {
    expect(
      waitingMessage(
        { player_id: 'p2', kind: 'human', decision: 'stock_disposition' },
        players,
        'Alice'
      )
    ).toBe('Waiting for Bob to dispose of their stock...')
  })

  it('describes each flow decision', () => {
    const msg = (decision: string) =>
      waitingMessage({ player_id: 'p1', kind: 'human', decision }, players, 'Alice')
    expect(msg('place_tile')).toBe('Waiting for Alice to place a tile...')
    expect(msg('found_chain')).toBe('Waiting for Alice to found a chain...')
    expect(msg('choose_survivor')).toBe('Waiting for Alice to choose the surviving chain...')
    expect(msg('buy_stocks')).toBe('Waiting for Alice to buy stock...')
  })

  it('falls back to the current player when nothing is awaited or the id is unknown', () => {
    expect(waitingMessage(null, players, 'Alice')).toBe('Waiting for Alice to take action...')
    expect(
      waitingMessage({ player_id: 'zz', kind: 'human', decision: 'place_tile' }, players, 'Alice')
    ).toBe('Waiting for Alice to take action...')
  })
})
