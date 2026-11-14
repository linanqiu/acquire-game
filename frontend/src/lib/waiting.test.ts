import { describe, it, expect } from 'vitest'
import { waitingMessage } from './waiting'
import { CLASSIC, MINI, VALLEY } from '../../tests/unit/fixtures/rulesets'

const players = { p1: { name: 'Alice' }, p2: { name: 'Bob' } }

describe('waitingMessage', () => {
  it('names the player the engine is waiting on, not the turn owner', () => {
    expect(
      waitingMessage(
        { player_id: 'p2', kind: 'human', decision: 'stock_disposition' },
        players,
        'Alice',
        CLASSIC
      )
    ).toBe('Waiting for Bob to dispose of their shares...')
  })

  it('describes each flow decision in the ruleset wording', () => {
    const msg = (decision: string, rs = CLASSIC) =>
      waitingMessage({ player_id: 'p1', kind: 'human', decision }, players, 'Alice', rs)
    expect(msg('place_tile')).toBe('Waiting for Alice to place a tile...')
    expect(msg('found_chain')).toBe('Waiting for Alice to found a hotel chain...')
    expect(msg('choose_survivor')).toBe('Waiting for Alice to choose the surviving hotel chain...')
    expect(msg('buy_stocks')).toBe('Waiting for Alice to buy shares...')
    expect(msg('found_chain', VALLEY)).toBe('Waiting for Alice to found an AI startup...')
    expect(msg('buy_stocks', VALLEY)).toBe('Waiting for Alice to buy equity shares...')
    expect(msg('choose_survivor', MINI)).toBe(
      'Waiting for Alice to choose the surviving shipping line...'
    )
  })

  it('says when the table waits for a trade answer, and for an unknown kind of decision', () => {
    expect(
      waitingMessage(
        { player_id: 'p2', kind: 'bot', decision: 'trade_response' },
        players,
        'Alice',
        CLASSIC
      )
    ).toBe('Waiting for Bob to answer a trade offer...')
    expect(
      waitingMessage(
        { player_id: 'p2', kind: 'bot', decision: 'something_new' },
        players,
        'Alice',
        CLASSIC
      )
    ).toBe('Waiting for Bob to take action...')
  })

  it('falls back to the current player when nothing is awaited or the id is unknown', () => {
    expect(waitingMessage(null, players, 'Alice', CLASSIC)).toBe(
      'Waiting for Alice to take action...'
    )
    expect(
      waitingMessage(
        { player_id: 'zz', kind: 'human', decision: 'place_tile' },
        players,
        'Alice',
        CLASSIC
      )
    ).toBe('Waiting for Alice to take action...')
  })
})
