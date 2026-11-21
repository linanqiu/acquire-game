import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  NO_ITEMS,
  competingOffer,
  counterOffer,
  fetchTradePreview,
  incomingBlockReason,
  nonZero,
  positionLines,
  positionText,
  startOffer,
  toRecord,
  type PositionChange,
  type Standing,
  type TradeParty,
} from './trades'
import { snapshot, playerState, wireTrades } from '../../tests/unit/fixtures/wire'
import { DEFAULT_RS, MINI } from '../../tests/unit/fixtures/rulesets'

/** A default chain's display name (ids are lowercase, names capitalised). */
const nameOf = (id: string) => DEFAULT_RS.chains.find((c) => c.id === id)?.name ?? id

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
    expect(incomingBlockReason(offer, me, proposer, DEFAULT_RS)).toBeNull()
  })

  it('without knowing the player there is nothing to block on', () => {
    const { offer, proposer } = real()
    expect(incomingBlockReason(offer, undefined, proposer, DEFAULT_RS)).toBeNull()
  })

  it('cash: exactly enough is fine; one short says what it costs', () => {
    const { offer, me, proposer } = real()
    me.money = offer.requesting_money
    expect(incomingBlockReason(offer, me, proposer, DEFAULT_RS)).toBeNull()
    me.money = offer.requesting_money - 1
    expect(incomingBlockReason(offer, me, proposer, DEFAULT_RS)).toBe(
      `You can't afford $${offer.requesting_money.toLocaleString('en-US')}`
    )
  })

  it("shares asked of me: exactly enough is fine; fewer says how many I have, in the chain's name", () => {
    const { offer, me, proposer } = real()
    offer.requesting_stocks = { sandpiper: 3 }
    offer.requesting_money = 0
    me.stocks = { sandpiper: 3 }
    expect(incomingBlockReason(offer, me, proposer, DEFAULT_RS)).toBeNull()
    me.stocks = { sandpiper: 2 }
    expect(incomingBlockReason(offer, me, proposer, DEFAULT_RS)).toBe('You only have 2 Sandpiper')
    me.stocks = {}
    expect(incomingBlockReason(offer, me, proposer, DEFAULT_RS)).toBe('You only have 0 Sandpiper')
  })

  it('I may not end up with more than the bank size of one chain (25 default, 18 mini)', () => {
    const { offer, me, proposer } = real()
    const [chain, qty] = Object.entries(offer.offering_stocks)[0] as [string, number]
    offer.requesting_money = 0
    me.stocks = { [chain]: DEFAULT_RS.stocks_per_chain - qty }
    expect(incomingBlockReason(offer, me, proposer, DEFAULT_RS)).toBeNull()
    me.stocks = { [chain]: DEFAULT_RS.stocks_per_chain - qty + 1 }
    expect(incomingBlockReason(offer, me, proposer, DEFAULT_RS)).toBe(
      `You would hold more than 25 ${nameOf(chain)}`
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
    expect(incomingBlockReason(offer, me, proposer, DEFAULT_RS)).toBeNull()
    proposer.stocks = { [chain]: qty - 1 }
    expect(incomingBlockReason(offer, me, proposer, DEFAULT_RS)).toBe(
      `${proposer.name} no longer has the ${nameOf(chain)}`
    )
    proposer.stocks = { [chain]: qty }
    offer.offering_stocks = {}
    offer.offering_money = 500
    proposer.money = 500
    expect(incomingBlockReason(offer, me, proposer, DEFAULT_RS)).toBeNull()
    proposer.money = 499
    expect(incomingBlockReason(offer, me, proposer, DEFAULT_RS)).toBe(
      `${proposer.name} can't cover the cash`
    )
  })

  it('what I must give is checked before what I would receive', () => {
    const { offer, me, proposer } = real()
    me.money = 0
    proposer.stocks = {}
    expect(incomingBlockReason(offer, me, proposer, DEFAULT_RS)).toMatch(/^You can't afford/)
  })

  it('an offer from a player who has left is judged on my side only', () => {
    const { offer, me } = real()
    expect(incomingBlockReason(offer, me, undefined, DEFAULT_RS)).toBeNull()
  })
})

describe('nonZero', () => {
  it('lists only the chains with shares in them', () => {
    expect(nonZero({ sandpiper: 2, marlowe: 0, halcyon: 1 })).toEqual([
      ['sandpiper', 2],
      ['halcyon', 1],
    ])
    expect(nonZero(undefined)).toEqual([])
    expect(nonZero({})).toEqual([])
  })
})

describe('competingOffer (my own offer, started from an offer between two other players)', () => {
  // A real public offer as a third player received it: Cara offers Bob 2 Aurelia for $800.
  const o = wireTrades().others
  const [offer] = o.state.pending_trades
  const players = o.state.players as Record<string, TradeParty>
  const me = players[o.human]

  it('to the recipient: I offer what the proposer offered, as far as I hold it, for the same price', () => {
    expect(offer.offering_stocks).toEqual({ aurelia: 2 })
    expect(me.stocks.aurelia).toBe(1)
    expect(competingOffer(offer, 'recipient', me, players)).toEqual({
      partnerId: o.to,
      offer: { stocks: [{ chain: 'aurelia', quantity: 1 }], cash: 0 },
      want: { stocks: [], cash: offer.requesting_money },
      basedOn: offer,
    })
  })

  it('to the proposer: I pay what was asked of the recipient, for what the proposer offered', () => {
    expect(competingOffer(offer, 'proposer', me, players)).toEqual({
      partnerId: o.from,
      offer: { stocks: [], cash: offer.requesting_money },
      want: { stocks: [{ chain: 'aurelia', quantity: 2 }], cash: 0 },
      basedOn: offer,
    })
  })

  it('never starts from more than a side has: cash and shares are cut to the holdings', () => {
    const poor = { ...me, money: 300, stocks: {} }
    expect(competingOffer(offer, 'proposer', poor, players).offer).toEqual({
      stocks: [],
      cash: 300,
    })
    expect(competingOffer(offer, 'recipient', poor, players).offer).toEqual({ stocks: [], cash: 0 })
    const broke = { ...players, [o.to]: { ...players[o.to], money: 50 } }
    expect(competingOffer(offer, 'recipient', me, broke).want.cash).toBe(50)
    const sold = { ...players, [o.from]: { ...players[o.from], stocks: { aurelia: 1 } } }
    expect(competingOffer(offer, 'proposer', me, sold).want.stocks).toEqual([
      { chain: 'aurelia', quantity: 1 },
    ])
    // Nothing known about me: an empty starting point, still addressed to the right player.
    expect(competingOffer(offer, 'recipient', undefined, players)).toMatchObject({
      partnerId: o.to,
      offer: { stocks: [], cash: 0 },
    })
  })
})

describe('counterOffer and startOffer (what the composer opens on)', () => {
  it('a counter is the same deal from my side, to the player who made the offer', () => {
    const { offer, me, proposer } = real()
    const start = counterOffer(offer, me, { [offer.from_player_id]: proposer })
    expect(start.counter).toBe(true)
    expect(start.basedOn).toBe(offer)
    expect(start.partnerId).toBe(offer.from_player_id)
    // They offered shares for cash: I give the cash and get the shares.
    expect(start.offer).toEqual({ stocks: [], cash: offer.requesting_money })
    expect(start.want.stocks).toEqual(
      Object.entries(offer.offering_stocks).map(([chain, quantity]) => ({ chain, quantity }))
    )
  })

  it('a counter never starts from more than a side has', () => {
    const { offer, me, proposer } = real()
    me.money = 100
    const [chain] = Object.keys(offer.offering_stocks)
    proposer.stocks = { [chain]: 1 }
    const start = counterOffer(offer, me, { [offer.from_player_id]: proposer })
    expect(start.offer.cash).toBe(100)
    expect(start.want.stocks).toEqual([{ chain, quantity: 1 }])
  })

  it('from the holdings table: a player alone, their shares (one asked), or mine (one given)', () => {
    expect(startOffer('p2')).toEqual({ partnerId: 'p2', offer: NO_ITEMS, want: NO_ITEMS })
    expect(startOffer('p2', 'sandpiper')).toEqual({
      partnerId: 'p2',
      offer: NO_ITEMS,
      want: { stocks: [{ chain: 'sandpiper', quantity: 1 }], cash: 0 },
    })
    expect(startOffer('', 'sandpiper', 'give')).toEqual({
      partnerId: '',
      offer: { stocks: [{ chain: 'sandpiper', quantity: 1 }], cash: 0 },
      want: NO_ITEMS,
    })
  })
})

describe('the changes of place of an offer, in words', () => {
  const change = (player_id: string, before: Standing, after: Standing, chain = 'sandpiper') =>
    ({ chain, player_id, before, after, shares_before: 0, shares_after: 0 }) as PositionChange

  it.each([
    ['minority_sole', 'majority_sole', 'You take 1st', 'Bob takes 1st'],
    ['none', 'majority_tied', 'You tie for 1st', 'Bob ties for 1st'],
    ['majority_sole', 'majority_tied', 'You drop to a tie for 1st', 'Bob drops to a tie for 1st'],
    ['none', 'minority_sole', 'You take 2nd', 'Bob takes 2nd'],
    ['majority_sole', 'minority_sole', 'You drop to 2nd', 'Bob drops to 2nd'],
    ['none', 'minority_tied', 'You tie for 2nd', 'Bob ties for 2nd'],
    ['majority_tied', 'minority_tied', 'You drop to a tie for 2nd', 'Bob drops to a tie for 2nd'],
    ['minority_sole', 'none', 'You lose the bonus', 'Bob loses the bonus'],
  ] as const)('%s -> %s', (before, after, mine, theirs) => {
    expect(positionText(change('me', before, after), 'You', true)).toBe(mine)
    expect(positionText(change('p2', before, after), 'Bob', false)).toBe(theirs)
  })

  it('one line per chain, in the order given (the ruleset order), my own change first', () => {
    const lines = positionLines(
      [
        change('p2', 'majority_sole', 'minority_sole'),
        change('me', 'minority_sole', 'majority_sole'),
        change('p3', 'minority_sole', 'none', 'aurelia'),
      ],
      { p2: 'Bob', p3: 'Cara' },
      'me'
    )
    expect(lines).toEqual([
      { chain: 'sandpiper', text: 'You take 1st · Bob drops to 2nd' },
      { chain: 'aurelia', text: 'Cara loses the bonus' },
    ])
    expect(positionLines(undefined, {}, 'me')).toEqual([])
  })
})

describe('fetchTradePreview', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts the draft to the room and seat, and gives back what the server said', async () => {
    const preview = { valid: true, error: '', positions: [], bot: null }
    const fetched = vi.fn(async () => ({ ok: true, json: async () => preview }))
    vi.stubGlobal('fetch', fetched)
    const draft = {
      to_player_id: 'p 2',
      offering_stocks: { sandpiper: 1 },
      offering_money: 0,
      requesting_stocks: {},
      requesting_money: 300,
    }
    expect(await fetchTradePreview('AB/C', 'me 1', draft)).toEqual(preview)
    const [url, init] = fetched.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/room/AB%2FC/trade-preview/me%201')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual(draft)
  })

  it('is null when the server cannot say (an error status, no connection, not a preview)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    )
    expect(await fetchTradePreview('ABCD', 'me', { trade_id: 't' })).toBeNull()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      })
    )
    expect(await fetchTradePreview('ABCD', 'me', { trade_id: 't' })).toBeNull()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ detail: 'x' }) }))
    )
    expect(await fetchTradePreview('ABCD', 'me', { trade_id: 't' })).toBeNull()
  })

  it('toRecord leaves out what is not in the deal', () => {
    expect(
      toRecord([
        { chain: 'sandpiper', quantity: 2 },
        { chain: 'aurelia', quantity: 0 },
      ])
    ).toEqual({ sandpiper: 2 })
  })
})
