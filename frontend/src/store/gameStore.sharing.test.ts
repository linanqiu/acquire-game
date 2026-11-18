/**
 * Rendering cost of incoming states (BL-020): one store update per `game_state`, and the parts
 * of a state that did not change keep their identity, so memoised views (the board and its
 * squares) skip them. Real recorded server messages.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { shareUnchanged, useGameStore } from './gameStore'
import { playedGame } from '../../tests/unit/fixtures/wire'
import type { GameStateMessage, WebSocketMessage } from '../types/api'

const store = () => useGameStore.getState()

beforeEach(() => store().reset())

function realState(): GameStateMessage {
  return structuredClone(playedGame('default').states['buy_stocks/with_chains']) as GameStateMessage
}

describe('incoming game states', () => {
  it('a game_state is one store update (one render), prompts it ends included', () => {
    store().setCurrentPlayer({ id: 'x', name: 'X', isHost: false })
    store().setPendingChainChoice(['halcyon'] as never)
    let updates = 0
    const stop = useGameStore.subscribe(() => updates++)
    store().handleMessage(realState() as unknown as WebSocketMessage)
    stop()
    expect(updates).toBe(1)
    expect(store().pendingChainChoice).toBeNull()
  })

  it('keeps every unchanged part of the state as the same object', () => {
    const first = realState()
    store().handleMessage(first as unknown as WebSocketMessage)
    const before = store().gameState!
    const hand = store().yourHand

    // The same table a moment later: one player's cash changed (a bot bought shares).
    const next = realState()
    const someone = Object.keys(next.players)[0]
    next.players[someone].money -= 300
    store().handleMessage(next as unknown as WebSocketMessage)
    const after = store().gameState!

    expect(after).not.toBe(before)
    expect(after.board).toBe(before.board)
    expect(after.hotel).toBe(before.hotel)
    expect(after.ruleset).toBe(before.ruleset)
    expect(after.chain_holders).toBe(before.chain_holders)
    expect(store().yourHand).toBe(hand)
    // What changed is new, with the new content.
    expect(after.players).not.toBe(before.players)
    expect(after.players[someone].money).toBe(first.players[someone].money - 300)
  })

  it('a changed board is a new board', () => {
    const prev = realState()
    const next = realState()
    next.board.cells['12I'] = { state: 'played', chain: null }
    const shared = shareUnchanged(prev, next)
    expect(shared.board).not.toBe(prev.board)
    expect(shared.board.cells['12I']).toEqual({ state: 'played', chain: null })
    expect(shared.hotel).toBe(prev.hotel)
  })
})
