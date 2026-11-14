import { describe, it, expect } from 'vitest'
import { incomingBlockReason, nonZero, type TradeParty } from './trades'
import { snapshot, playerState } from '../../tests/unit/fixtures/wire'
import { CLASSIC, MINI } from '../../tests/unit/fixtures/rulesets'

/** A real incoming offer (stock for cash) with both parties as the server reports them. */
function real() {
  const view = snapshot('trade-incoming')
  const state = playerState('trade-incoming')
  const offer = structuredClone(state.incoming_trades[0])
  const party = (id: string): TradeParty => {
    const p = state.players[id]
    return { name: p.name, money: p.money, stocks: structuredClone(p.stocks) }
  }
  return { offer, me: party(view.human), proposer: party(offer.from_player_id) }
}

describe('incomingBlockReason (why Accept is off)', () => {
  it('a real offer the player can honour has no reason', () => {
    const { offer, me, proposer } = real()
    expect(offer.requesting_money).toBeLessThanOrEqual(me.money)
    expect(incomingBlockReason(offer, me, proposer, CLASSIC)).toBeNull()
  })

  it('without knowing the player there is nothing to block on', () => {
    const { offer, proposer } = real()
    expect(incomingBlockReason(offer, undefined, proposer, CLASSIC)).toBeNull()
  })

  it('cash: exactly enough is fine; one short says what it costs', () => {
    const { offer, me, proposer } = real()
    me.money = offer.requesting_money
    expect(incomingBlockReason(offer, me, proposer, CLASSIC)).toBeNull()
    me.money = offer.requesting_money - 1
    expect(incomingBlockReason(offer, me, proposer, CLASSIC)).toBe(
      `You can't afford $${offer.requesting_money.toLocaleString('en-US')}`
    )
  })

  it("shares asked of me: exactly enough is fine; fewer says how many I have, in the chain's name", () => {
    const { offer, me, proposer } = real()
    offer.requesting_stocks = { Luxor: 3 }
    offer.requesting_money = 0
    me.stocks = { Luxor: 3 }
    expect(incomingBlockReason(offer, me, proposer, CLASSIC)).toBeNull()
    me.stocks = { Luxor: 2 }
    expect(incomingBlockReason(offer, me, proposer, CLASSIC)).toBe('You only have 2 Luxor')
    me.stocks = {}
    expect(incomingBlockReason(offer, me, proposer, CLASSIC)).toBe('You only have 0 Luxor')
  })

  it('I may not end up with more than the bank size of one chain (25 classic, 18 mini)', () => {
    const { offer, me, proposer } = real()
    const [chain, qty] = Object.entries(offer.offering_stocks)[0] as [string, number]
    offer.requesting_money = 0
    me.stocks = { [chain]: CLASSIC.stocks_per_chain - qty }
    expect(incomingBlockReason(offer, me, proposer, CLASSIC)).toBeNull()
    me.stocks = { [chain]: CLASSIC.stocks_per_chain - qty + 1 }
    expect(incomingBlockReason(offer, me, proposer, CLASSIC)).toBe(
      `You would hold more than 25 ${chain}`
    )
    // Same holding is fine in a game with a bigger bank, too much in the small one.
    const mini = {
      ...MINI,
      chains: [{ ...MINI.chains[0], id: chain, name: chain }, ...MINI.chains.slice(1)],
    }
    me.stocks = { [chain]: MINI.stocks_per_chain - qty + 1 }
    expect(incomingBlockReason(offer, me, proposer, mini)).toBe(
      `You would hold more than 18 ${chain}`
    )
  })

  it('the proposer may no longer have what they offered, or the cash', () => {
    const { offer, me, proposer } = real()
    const [chain, qty] = Object.entries(offer.offering_stocks)[0] as [string, number]
    proposer.stocks = { [chain]: qty }
    expect(incomingBlockReason(offer, me, proposer, CLASSIC)).toBeNull()
    proposer.stocks = { [chain]: qty - 1 }
    expect(incomingBlockReason(offer, me, proposer, CLASSIC)).toBe(
      `${proposer.name} no longer has the ${chain}`
    )
    proposer.stocks = { [chain]: qty }
    offer.offering_stocks = {}
    offer.offering_money = 500
    proposer.money = 500
    expect(incomingBlockReason(offer, me, proposer, CLASSIC)).toBeNull()
    proposer.money = 499
    expect(incomingBlockReason(offer, me, proposer, CLASSIC)).toBe(
      `${proposer.name} can't cover the cash`
    )
  })

  it('what I must give is checked before what I would receive', () => {
    const { offer, me, proposer } = real()
    me.money = 0
    proposer.stocks = {}
    expect(incomingBlockReason(offer, me, proposer, CLASSIC)).toMatch(/^You can't afford/)
  })

  it('an offer from a player who has left is judged on my side only', () => {
    const { offer, me } = real()
    expect(incomingBlockReason(offer, me, undefined, CLASSIC)).toBeNull()
  })
})

describe('nonZero', () => {
  it('lists only the chains with shares in them', () => {
    expect(nonZero({ Luxor: 2, Tower: 0, American: 1 })).toEqual([
      ['Luxor', 2],
      ['American', 1],
    ])
    expect(nonZero(undefined)).toEqual([])
    expect(nonZero({})).toEqual([])
  })
})
