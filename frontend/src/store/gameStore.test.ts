/**
 * What the player's browser knows after the server's messages arrive. Every message here was
 * recorded from the real backend (tests/unit/fixtures/generate_wire_messages.py) and goes
 * through the real handler, so a change in the wire format or in the store's reading of it
 * fails here.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useGameStore } from './gameStore'
import {
  SNAPSHOT_NAMES,
  snapshot,
  deliver,
  loadSnapshotAsPlayer,
  wireTrades,
} from '../../tests/unit/fixtures/wire'

const store = () => useGameStore.getState()

beforeEach(() => store().reset())

describe('lobby', () => {
  it('shows the seats and whether the game can start', () => {
    store().handleMessage({
      type: 'lobby_update',
      players: [{ player_id: 'a', name: 'Alice', is_bot: false }],
      can_start: false,
    })
    expect(store().lobbyPlayers.map((p) => p.name)).toEqual(['Alice'])
    expect(store().canStart).toBe(false)
    store().handleMessage({ type: 'lobby_update', players: [], can_start: true })
    expect(store().canStart).toBe(true)
    expect(store().lobbyPlayers).toEqual([])
  })
})

describe('a recorded game state, as each seat receives it', () => {
  it('every recorded state yields the hand, money and phase the engine reported', () => {
    for (const name of SNAPSHOT_NAMES) {
      store().reset()
      const view = loadSnapshotAsPlayer(name)
      expect(store().yourHand, name).toEqual(view.expect.human.hand)
      expect(store().gameState.players[view.human].money, name).toBe(view.expect.human.cash)
      expect(store().gameState.phase, name).toBe(view.expect.phase)
    }
  })

  it('keeps the last known hand and tile hints when a state omits the private part', () => {
    const view = loadSnapshotAsPlayer('dead-tile-in-hand')
    const hand = [...store().yourHand]
    const hints = store().tilePlayability
    expect(hints).not.toBeNull()
    // The spectator's copy of the same moment has no private fields.
    store().handleMessage(view.host)
    expect(store().yourHand).toEqual(hand)
    expect(store().tilePlayability).toBe(hints)
  })

  it('shows the pending offers of the player (incoming) and of the table (public)', () => {
    const view = loadSnapshotAsPlayer('trade-incoming')
    expect(store().trades).toHaveLength(1)
    expect(store().trades[0].to_player_id).toBe(view.human)
    expect(store().publicTrades).toEqual(view.host.pending_trades)
    const mine = loadSnapshotAsPlayer('trade-outgoing-pending')
    expect(store().trades[0].from_player_id).toBe(mine.human)
  })
})

describe('decision prompts', () => {
  it('a chain choice arrives as the list of chains that may be founded', () => {
    const view = loadSnapshotAsPlayer('found-chain-choice')
    const offered = view.player.find((m) => m.type === 'choose_chain').available_chains
    expect(offered.length).toBeGreaterThan(0)
    expect(store().pendingChainChoice).toEqual(offered)
  })

  it('a survivor tie arrives as the tied chains', () => {
    const view = loadSnapshotAsPlayer('merger-survivor-tie')
    const tied = view.player.find((m) => m.type === 'choose_merger_survivor').tied_chains
    expect(tied.length).toBeGreaterThanOrEqual(2)
    expect(store().pendingMergerChoice).toEqual(tied)
  })

  it('a stock disposition prompt keeps the shares owned and what the bank can still trade', () => {
    const view = loadSnapshotAsPlayer('disposition-trade-limited')
    const p = view.player.find((m) => m.type === 'stock_disposition_required')
    expect(store().pendingStockDisposition).toEqual({
      defunctChain: p.defunct_chain,
      survivingChain: p.surviving_chain,
      stockCount: p.stock_count,
      availableToTrade: p.available_to_trade,
    })
  })

  it('the disposition prompt goes away once the server moves on (the form must not stay up)', () => {
    // Found by the two-humans journey: the form stayed up after confirming.
    const view = loadSnapshotAsPlayer('disposition-human-first')
    expect(store().pendingStockDisposition).not.toBeNull()
    expect(view.after_disposition.length).toBeGreaterThan(0)
    for (const m of view.after_disposition) store().handleMessage(m)
    expect(store().pendingStockDisposition).toBeNull()
  })

  it('a prompt for someone else does not show on my screen', () => {
    const view = loadSnapshotAsPlayer('disposition-waiting-on-other')
    expect(store().pendingStockDisposition).toBeNull()
    expect(view.player.find((m) => m.type === 'game_state').awaiting.player_id).not.toBe(view.human)
  })

  it('my prompt stays while an AI only answers a trade beside it', () => {
    const view = loadSnapshotAsPlayer('disposition-human-first')
    const state = view.player.find((m) => m.type === 'game_state')
    store().handleMessage({
      ...state,
      awaiting: { player_id: 'some-bot', kind: 'bot', decision: 'trade_response' },
    })
    expect(store().pendingStockDisposition).not.toBeNull()
  })

  it('my survivor choice goes away once the merger moved on to dispositions', () => {
    const tie = loadSnapshotAsPlayer('merger-survivor-tie')
    expect(store().pendingMergerChoice).not.toBeNull()
    const state = tie.player.find((m) => m.type === 'game_state')
    store().handleMessage({
      ...state,
      awaiting: { player_id: 'bob', kind: 'human', decision: 'stock_disposition' },
    })
    expect(store().pendingMergerChoice).toBeNull()
  })

  it('every prompt is cleared when the game is back in an ordinary phase', () => {
    loadSnapshotAsPlayer('disposition-human-first')
    store().handleMessage({ type: 'choose_chain', available_chains: ['sandpiper'] })
    const buy = snapshot('buy-phase-multi-chain')
    store().handleMessage(buy.player.find((m) => m.type === 'game_state'))
    expect(store().pendingStockDisposition).toBeNull()
    expect(store().pendingMergerChoice).toBeNull()
    expect(store().pendingChainChoice).toBeNull()
  })

  it('a chain choice that arrives just before its game_state is kept (the state is for found_chain)', () => {
    // choose_chain is sent before the state: it must survive the state of that same phase.
    const view = snapshot('found-chain-choice')
    deliver(view.player, view.human)
    expect(store().pendingChainChoice).not.toBeNull()
  })
})

describe('trades', () => {
  const t = wireTrades()

  it('a proposal shows up and is announced to the page', () => {
    store().handleMessage(t.proposed)
    expect(store().trades.map((x) => x.trade_id)).toEqual([t.proposed.trade.trade_id])
    expect(store().lastTradeEvent).toMatchObject({
      seq: 1,
      kind: 'proposed',
      tradeId: t.proposed.trade.trade_id,
      byPlayerId: t.proposed.trade.from_player_id,
    })
  })

  it('the same offer proposed again is not listed twice', () => {
    store().handleMessage(t.proposed)
    store().handleMessage(t.proposed)
    expect(store().trades).toHaveLength(1)
    expect(store().lastTradeEvent.seq).toBe(2)
  })

  it.each([
    ['accepted', 'trade_accepted', 'to_player'],
    ['rejected', 'trade_rejected', 'rejected_by'],
    ['canceled', 'trade_canceled', 'canceled_by'],
  ])('an offer that was %s leaves the list and says who answered', (kind, _type, who) => {
    store().handleMessage(t.proposed)
    const id = t.proposed.trade.trade_id
    store().handleMessage({ ...t[kind], trade_id: id })
    expect(store().trades).toEqual([])
    expect(store().lastTradeEvent).toMatchObject({
      seq: 2,
      kind,
      tradeId: id,
      byPlayerId: t[kind][who],
    })
    // The resolved offer is still described, so the toast can name its terms.
    expect(store().lastTradeEvent.trade.trade_id).toBe(id)
  })

  it('answers about an offer this browser never saw still announce the outcome', () => {
    store().handleMessage(t.accepted)
    expect(store().lastTradeEvent).toMatchObject({ kind: 'accepted', trade: undefined })
  })
})

describe('trade lists follow what the server says', () => {
  it('a state that lists only my incoming offers (no outgoing key) still replaces the list', () => {
    const view = loadSnapshotAsPlayer('trade-incoming')
    const state = view.player.find((m) => m.type === 'game_state')
    const { outgoing_trades: _drop, ...onlyIncoming } = state
    store().handleMessage({ ...onlyIncoming, incoming_trades: [] })
    expect(store().trades).toEqual([])
  })

  it('a state that says nothing about trades leaves the lists as they were (the offers survive)', () => {
    const view = loadSnapshotAsPlayer('trade-incoming')
    const state = view.player.find((m) => m.type === 'game_state')
    const { incoming_trades: _a, outgoing_trades: _b, pending_trades: _c, ...quiet } = state
    expect(store().trades).toHaveLength(1)
    store().handleMessage(quiet)
    expect(store().trades).toHaveLength(1)
    expect(store().publicTrades).toHaveLength(1)
  })

  it("an empty public list clears the table's pending offers", () => {
    const view = loadSnapshotAsPlayer('trade-incoming')
    store().handleMessage({ ...view.host, pending_trades: [] })
    expect(store().publicTrades).toEqual([])
  })

  it('an answer about one offer removes that offer only', () => {
    const t = wireTrades()
    store().handleMessage(t.proposed)
    store().handleMessage({ ...t.proposed, trade: { ...t.proposed.trade, trade_id: 'second' } })
    store().handleMessage({ ...t.rejected, trade_id: 'second' })
    expect(store().trades.map((x) => x.trade_id)).toEqual([t.proposed.trade.trade_id])
  })

  it('a proposal without a trade id is ignored', () => {
    store().handleMessage({ type: 'trade_proposed', trade: {} })
    store().handleMessage({ type: 'trade_proposed' })
    expect(store().trades).toEqual([])
    expect(store().lastTradeEvent).toBeNull()
  })

  it('the prompt stays while the merger phase is still on and the table waits for me', () => {
    const view = loadSnapshotAsPlayer('disposition-human-first')
    const state = view.player.find((m) => m.type === 'game_state')
    store().handleMessage({ ...state, phase: 'stock_disposition' })
    expect(store().pendingStockDisposition).not.toBeNull()
    store().handleMessage({ ...state, phase: 'stock_disposition', awaiting: null })
    expect(store().pendingStockDisposition).not.toBeNull()
  })
})

describe('end of game', () => {
  it('keeps the final scores, and a reset (new game) clears them', () => {
    const view = loadSnapshotAsPlayer('game-over')
    const over = view.player.find((m) => m.type === 'game_over')
    expect(store().gameOver).toEqual(over)
    store().reset()
    expect(store().gameOver).toBeNull()
  })
})

describe('other messages', () => {
  it('a replacement hand after unplayable tiles replaces the rack', () => {
    store().handleMessage({ type: 'tiles_replaced', removed_tiles: ['1A'], new_hand: ['2B', '3C'] })
    expect(store().yourHand).toEqual(['2B', '3C'])
  })

  it('an AI fallback is announced with an increasing sequence number', () => {
    const msg = {
      type: 'agent_fallback',
      player_id: 'p',
      player_name: 'Bot',
      agent_label: 'LLM',
      reason: 'illegal',
      decision: 'place_tile',
      message: 'fell back',
    }
    store().handleMessage(msg)
    store().handleMessage(msg)
    expect(store().lastFallbackEvent.seq).toBe(2)
    expect(store().lastFallbackEvent.message).toEqual(msg)
  })

  it('connection status carries its error, and clears it on the next status', () => {
    store().setConnectionStatus('error', 'boom')
    expect(store().connectionError).toBe('boom')
    store().setConnectionStatus('connected')
    expect(store().connectionError).toBeNull()
  })
})
